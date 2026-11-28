import { canonical, digest, ProcessingBudget, uid } from "./model.js"
import { parseEvaluatorMethod, type EvaluatorMethodManifest, type EvaluatorPolicyRef } from "./evaluator-method.js"
import type { RetrospectivePopulationRef } from "./retrospective-contract.js"

/** Idempotency selectors, not evidence of permission or native provenance. */
export type EvaluatorExecutionSubject = {
  source_store_id: string; owner_session: string; batch_id: string; request_id: string;
  attempt_id: string; manifest_sha256: string; semantic_key: string;
  // Absent for the existing complete Stage 3 source. Presence is the distinct
  // v2 enrollment contract, never an implicit conversion of a Stage 3 batch.
  source?: RetrospectivePopulationRef;
}
/** Stable enrollment identity only. Keep legacy key bytes unchanged; v2 names
 * the exact frozen source and separates its meaning from complete Stage 3. */
export function evaluatorEnrollmentKey(input: {
  source_store_id: string; owner_session: string; boundary: Record<string, string | number>;
  membership_sha256: string; method: unknown; source_policy: unknown; route_policy: unknown; budget_policy: unknown;
  source?: RetrospectivePopulationRef;
}): string {
  const { preparation_source_batch: _sourceBatch, preparation_budget_policy: _budget, ...boundary } = input.boundary
  return digest({ format: input.source ? "loom-evaluation-enrollment-key/v2" : "loom-evaluation-enrollment-key/v1",
    source_store_id: input.source_store_id, owner_session: input.owner_session, slot: "overall", boundary,
    membership_sha256: input.membership_sha256, method: input.method, source_policy: input.source_policy,
    route_policy: input.route_policy, budget_policy: input.budget_policy,
    ...(input.source ? { request_format: "loom-evaluation-request/v2", source: input.source } : {}) })
}
export type EvaluatorResources = { requests: number; input_tokens: number; output_tokens: number }
export type EvaluatorExecutionGrant = {
  authority_id: string; grant_id: string; expires_at: string;
  subject: EvaluatorExecutionSubject; method: EvaluatorMethodManifest;
  recipient: { host_id: string; session_id: string; agent: "evaluator" };
  account: { provider_id: string; model_id: string; account_id: string; credential_revision: string };
  source_authority_ref: string; account_authority_ref: string; budget_authority_ref: string;
  limits: EvaluatorResources;
}
export type EvaluatorExecutionAdmission = {
  format: "loom-evaluation-admission/v1"; grant: EvaluatorExecutionGrant;
  reservation_id: string; pool_id: string; authority_epoch: string;
}
export type EvaluatorExecutionReceipt = {
  format: "loom-evaluation-execution-receipt/v1";
  authority_id: string; receipt_id: string; sequence: number; admission_sha256: string;
  reservation_id: string;
  // The owner's budgeted effect boundary, not native inbox admission. In
  // particular, not-admitted does not prove that native input or source exposure
  // never occurred; it cannot supply a canonical native rejection observation.
  execution: "reserved" | "unknown" | "admitted" | "not-admitted" | "completed" | "failed" | "cancelled";
  budget: "held" | "uncertain" | "released" | "settled";
  fenced: boolean; usage: EvaluatorResources | null;
  result: { host_id: string; session_id: string; input_id: string; result_id: string; sha256: string } | null;
}
export type EvaluatorExecutionSnapshot = { admission: EvaluatorExecutionAdmission; receipt: EvaluatorExecutionReceipt }

/** Source delivery is attested by the trusted owner at the actual native tool
 * result/provider input boundary. Selection or an author's citation is not a
 * retrieval receipt. No public tool accepts these records. */
export type EvaluatorRetrievedSource = {
  member_key: string; source_index: 0; receipt_id: string;
  boundary: "native-tool-result" | "provider-input"; source_sha256: string;
}
/** Context delivery is a separate identity domain. An earlier original remains
 * a member of its own report's population, never of the current increment.
 * The qualified execution owner records every delivered report, list item and
 * original at the actual native boundary, including material the model omits
 * from its citations. These records are not accepted from public tools. */
export type EvaluatorRetrievedContext = {
  kind: "prior-interpretation"; report_id: string; report_sha256: string;
  receipt_id: string; boundary: "native-tool-result" | "provider-input";
} | {
  kind: "prior-original"; report_id: string; report_sha256: string;
  member_key: string; source_index: 0; source_sha256: string;
  receipt_id: string; boundary: "native-tool-result" | "provider-input";
}
export type EvaluatorPriorReportSelector = { report_id: string; report_sha256: string }
export type EvaluatorInterpretationReader = {
  list(input?: { before?: number; limit?: number }): Promise<unknown>;
  read(input: EvaluatorPriorReportSelector & { section?: string; after?: string; limit?: number }): Promise<unknown>;
  source(input: EvaluatorPriorReportSelector & { member_key: string; source_index: 0 }): Promise<unknown>;
}
export type EvaluatorSourceReader = ((memberKey: string, sourceIndex: number) => Promise<unknown>) & {
  interpretations: EvaluatorInterpretationReader;
}
export type EvaluatorOriginalResult = {
  format: "loom-evaluator-result/v1"; admission_sha256: string;
  result: NonNullable<EvaluatorExecutionReceipt["result"]>;
  text: string; retrieved: EvaluatorRetrievedSource[];
  // Omitted for existing originals; their canonical bytes are unchanged.
  context_retrieved?: EvaluatorRetrievedContext[];
}

/** Valid recovery observations need not authorize a fresh canonical claim. In
 * particular, reserved/uncertain is retainable evidence, never a usable budget. */
export function evaluatorReservationHeld(receipt: EvaluatorExecutionReceipt): boolean {
  return receipt.execution === "reserved" && receipt.budget === "held" && !receipt.fenced
    && receipt.usage === null && receipt.result === null
}

/** Trusted host/account integration, NEVER a tool argument or configuration flag.
 * No production implementation is qualified. A conforming owner must:
 * - prepare a concrete recipient without transferring sources or starting models;
 * - resolve genuine grants, and reserve atomically in the actual shared pool;
 * - inventory semantic enrollment outside restorable Loom state (null means
 *   authoritative absence, never a failed/partial lookup);
 * - revalidate and durably consume at every actual send, including retries,
 *   auxiliary work, fallback and native restart; enforce all resource limits;
 * - return only durable, scoped receipts; reconcile MUST NOT wake native work;
 * - fence before release, settle only authoritative usage, retain uncertainty.
 * Implementing this TypeScript interface alone establishes none of those facts.
 */
export interface EvaluatorExecutionAuthority {
  reconcile(subject: EvaluatorExecutionSubject): Promise<EvaluatorExecutionSnapshot | null>;
  prepare(subject: EvaluatorExecutionSubject, method: EvaluatorMethodManifest, budget: EvaluatorPolicyRef): Promise<EvaluatorExecutionGrant>;
  reserve(grant: EvaluatorExecutionGrant): Promise<EvaluatorExecutionAdmission>;
  /** At claim: finish asynchronous native checks, await recheckCaller, then read
   * current durable reservation/policy state without further awaited work and
   * return its bound receipt. Propagate callback failures without cancellation.
   * The consumer claims synchronously after that observation. Cross-process
   * changes afterward still require atomic enforcement at the actual send.
   * Source validation does not require a fresh held reservation. */
  validate(admission: EvaluatorExecutionAdmission, boundary: "claim" | "source",
    recheckCaller?: () => Promise<void>): Promise<EvaluatorExecutionReceipt>;
  execute(admission: EvaluatorExecutionAdmission,
    source: EvaluatorSourceReader, signal: AbortSignal): Promise<EvaluatorExecutionReceipt>;
  cancel(admission: EvaluatorExecutionAdmission): Promise<EvaluatorExecutionReceipt>;
  /** Read the exact original completed result and durable delivery receipts.
   * This must never infer, resume, retry, enqueue or wake native work. A missing
   * capability fails publication closed; caller-authored JSON is no substitute.
   * context_retrieved must account for EVERY delivered prior report/list item
   * and original, not only cited material. It survives process restart. */
  readResult?(admission: EvaluatorExecutionAdmission, receipt: EvaluatorExecutionReceipt): Promise<EvaluatorOriginalResult>;
}

const bounded = (value: unknown) => canonical(value, new ProcessingBudget(65536, 2048))
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Invalid execution record")
  if (Reflect.ownKeys(value).length !== keys.length) throw new Error("Invalid execution record fields")
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key)
    if (!field?.enumerable || !("value" in field)) throw new Error("Invalid execution record field")
  }
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 2000
      || /[\u0000-\u001f\u007f]/.test(value)) throw new Error("Invalid execution reference")
  return value
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid execution fingerprint")
  return value
}
function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error("Invalid execution resource quantity")
  return value as number
}
function resources(value: unknown, minimum: number): EvaluatorResources {
  const x = object(value, ["requests", "input_tokens", "output_tokens"])
  return { requests: integer(x.requests, minimum), input_tokens: integer(x.input_tokens, minimum), output_tokens: integer(x.output_tokens, minimum) }
}
function subject(value: unknown): EvaluatorExecutionSubject {
  const hasSource = !!value && typeof value === "object" && Object.hasOwn(value, "source")
  const x = object(value, ["source_store_id", "owner_session", "batch_id", "request_id", "attempt_id", "manifest_sha256", "semantic_key", ...(hasSource ? ["source"] : [])])
  let source: RetrospectivePopulationRef | undefined
  if (hasSource) {
    const s = object(x.source, ["kind", "format", "population_id", "manifest_sha256"])
    if (s.kind !== "retrospective-population" || s.format !== "loom-retrospective-population/v1" && s.format !== "loom-retrospective-population/v2") throw new Error("Unsupported execution source")
    source = { kind: s.kind, format: s.format, population_id: uid(s.population_id), manifest_sha256: hash(s.manifest_sha256) }
  }
  return { source_store_id: uid(x.source_store_id), owner_session: uid(x.owner_session), batch_id: uid(x.batch_id),
    request_id: uid(x.request_id), attempt_id: uid(x.attempt_id), manifest_sha256: hash(x.manifest_sha256), semantic_key: hash(x.semantic_key),
    ...(source ? { source } : {}) }
}
export function parseEvaluatorGrant(value: unknown): EvaluatorExecutionGrant {
  bounded(value)
  const x = object(value, ["authority_id", "grant_id", "expires_at", "subject", "method", "recipient", "account",
    "source_authority_ref", "account_authority_ref", "budget_authority_ref", "limits"])
  const recipient = object(x.recipient, ["host_id", "session_id", "agent"])
  if (recipient.agent !== "evaluator") throw new Error("Unexpected execution recipient")
  const account = object(x.account, ["provider_id", "model_id", "account_id", "credential_revision"])
  const expiry = text(x.expires_at)
  if (!Number.isFinite(Date.parse(expiry)) || new Date(expiry).toISOString() !== expiry) throw new Error("Invalid execution expiry")
  const method = parseEvaluatorMethod(x.method)
  if (account.provider_id !== method.model.provider_id || account.model_id !== method.model.model_id)
    throw new Error("Execution account/model mismatch")
  return { authority_id: text(x.authority_id), grant_id: text(x.grant_id), expires_at: expiry, subject: subject(x.subject), method,
    recipient: { host_id: text(recipient.host_id), session_id: uid(recipient.session_id), agent: "evaluator" },
    account: { provider_id: text(account.provider_id), model_id: text(account.model_id), account_id: text(account.account_id), credential_revision: text(account.credential_revision) },
    source_authority_ref: text(x.source_authority_ref), account_authority_ref: text(x.account_authority_ref), budget_authority_ref: text(x.budget_authority_ref), limits: resources(x.limits, 1) }
}
export function parseEvaluatorAdmission(value: unknown): EvaluatorExecutionAdmission {
  bounded(value)
  const x = object(value, ["format", "grant", "reservation_id", "pool_id", "authority_epoch"])
  if (x.format !== "loom-evaluation-admission/v1") throw new Error("Unsupported execution admission")
  return { format: x.format, grant: parseEvaluatorGrant(x.grant), reservation_id: text(x.reservation_id), pool_id: text(x.pool_id), authority_epoch: text(x.authority_epoch) }
}
export function parseEvaluatorReceipt(value: unknown, admission: EvaluatorExecutionAdmission): EvaluatorExecutionReceipt {
  bounded(value)
  const x = object(value, ["format", "authority_id", "receipt_id", "sequence", "admission_sha256", "reservation_id", "execution", "budget", "fenced", "usage", "result"])
  if (x.format !== "loom-evaluation-execution-receipt/v1" || x.authority_id !== admission.grant.authority_id
      || x.admission_sha256 !== digest(admission) || x.reservation_id !== admission.reservation_id) throw new Error("Execution receipt binding mismatch")
  if (x.execution !== "reserved" && x.execution !== "unknown" && x.execution !== "admitted" && x.execution !== "not-admitted"
      && x.execution !== "completed" && x.execution !== "failed" && x.execution !== "cancelled") throw new Error("Unsupported execution state")
  if (x.budget !== "held" && x.budget !== "uncertain" && x.budget !== "released" && x.budget !== "settled") throw new Error("Unsupported execution accounting")
  if (typeof x.fenced !== "boolean") throw new Error("Invalid execution fence")
  const usage = x.usage === null ? null : resources(x.usage, 0)
  let result: EvaluatorExecutionReceipt["result"] = null
  if (x.result !== null) {
    const r = object(x.result, ["host_id", "session_id", "input_id", "result_id", "sha256"])
    if (r.host_id !== admission.grant.recipient.host_id || r.session_id !== admission.grant.recipient.session_id)
      throw new Error("Execution result recipient mismatch")
    result = { host_id: text(r.host_id), session_id: uid(r.session_id), input_id: uid(r.input_id), result_id: uid(r.result_id), sha256: hash(r.sha256) }
  }
  if (x.execution === "completed" && result === null) throw new Error("Completed execution lacks original result")
  if (result && x.execution !== "completed" && x.execution !== "cancelled") throw new Error("Unexpected execution result")
  if (x.budget === "released" && (!x.fenced || x.execution !== "not-admitted" || usage === null
      || Object.values(usage).some(n => n !== 0))) throw new Error("Release lacks fenced non-admission")
  if (x.budget === "settled" && (!x.fenced || usage === null || !["completed", "failed", "cancelled"].includes(x.execution)))
    throw new Error("Settlement lacks terminal authoritative usage")
  if ((x.budget === "held" || x.budget === "uncertain") && usage !== null) throw new Error("Unsettled usage cannot release reservation")
  if ((x.execution === "unknown" || x.execution === "admitted") && x.budget !== "uncertain") throw new Error("Uncertain execution must retain reservation")
  if (usage && (Object.keys(usage) as Array<keyof EvaluatorResources>).some(k => usage[k] > admission.grant.limits[k]))
    throw new Error("Authoritative usage exceeds admission limits")
  return { format: x.format, authority_id: text(x.authority_id), receipt_id: text(x.receipt_id), sequence: integer(x.sequence, 1),
    admission_sha256: hash(x.admission_sha256), reservation_id: text(x.reservation_id), execution: x.execution,
    budget: x.budget, fenced: x.fenced, usage, result }
}

/** Append-only observations may replay, but must not contradict irreversible facts. */
export function assertEvaluatorReceiptProgress(previous: EvaluatorExecutionReceipt, next: EvaluatorExecutionReceipt): void {
  if (next.sequence <= previous.sequence) {
    if (bounded(next) !== bounded(previous)) throw new Error("Conflicting execution receipt sequence")
    return
  }
  if ((previous.fenced && !next.fenced) || (previous.result && bounded(previous.result) !== bounded(next.result))
      || (["released", "settled"].includes(previous.budget) && (next.budget !== previous.budget || bounded(next.usage) !== bounded(previous.usage)))
      || (previous.execution === "not-admitted" && next.execution !== "not-admitted")
      || (["admitted", "completed", "failed"].includes(previous.execution) && next.execution === "not-admitted")
      || (["failed", "cancelled"].includes(previous.execution) && next.execution === "admitted")
      || (previous.execution !== "reserved" && next.execution === "reserved")
      || (previous.execution === "completed" && next.execution !== "completed" && next.execution !== "cancelled"))
    throw new Error("Contradictory execution receipt; reconciliation required")
}
