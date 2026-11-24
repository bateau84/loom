import { randomUUID } from "node:crypto"
import { canonical, digest, type Actor } from "./model.js"
import type { EvaluatorPreparation } from "./evaluator-preparation.js"
import type { EvaluationStore } from "./evaluation-store.js"
import type { Store } from "./store.js"
import { parseEvaluatorAdmission, parseEvaluatorGrant, parseEvaluatorReceipt,
  type EvaluatorExecutionAdmission, type EvaluatorExecutionAuthority, type EvaluatorExecutionReceipt,
  type EvaluatorExecutionSnapshot, type EvaluatorExecutionSubject } from "./evaluator-execution-contract.js"

export type EvaluatorExecutionPins = { batch_id: string; request_id: string; manifest_sha256: string; attempt_id: string }
type Integration = { authority: EvaluatorExecutionAuthority; authorize: (actor: Actor) => Promise<void> }
type Prepared = ReturnType<EvaluatorPreparation["read"]>
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)

/** Consumer of a trusted execution owner, not an authority issuer or runtime.
 * Learning constructs this WITHOUT integration. Only qualification code supplies
 * the controlled fixture adapter; no public tool/configuration can install one.
 * There is intentionally no automatic scheduler, retry, or report publisher.
 */
export class EvaluatorExecution {
  constructor(private readonly preparation: EvaluatorPreparation, private readonly history: EvaluationStore,
    private readonly store: Store, private readonly integration?: Integration, private readonly clock = Date.now) {}

  private connected(): Integration {
    if (!this.integration) throw new Error("evaluator-execution-authority-unavailable")
    return this.integration
  }
  private pins(input: EvaluatorExecutionPins): void {
    if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).sort().join() !== "attempt_id,batch_id,manifest_sha256,request_id"
        || Object.values(input).some(v => typeof v !== "string" || !v)) throw new Error("Invalid evaluator execution pins")
  }
  private prepared(actor: Actor, pins: EvaluatorExecutionPins): Prepared {
    this.pins(pins)
    const p = this.preparation.read(actor.session_id, pins.batch_id)
    if (p.state !== "prepared" || p.request_id !== pins.request_id || p.manifest_sha256 !== pins.manifest_sha256
        || p.issue?.attempt.attempt_id !== pins.attempt_id) throw new Error("Evaluator execution preparation mismatch")
    return p
  }
  private subject(actor: Actor, p: Prepared): EvaluatorExecutionSubject {
    if (!p.issue) throw new Error("Evaluator execution issue unavailable")
    // Stage 3 can allocate another local batch UUID after an older restore.
    // Exclude that allocation, but retain the exact original source vector,
    // membership, method and policies. This is an idempotency key, NOT a grant.
    const { preparation_source_batch: _sourceBatch, preparation_budget_policy: _budget, ...boundary } = p.manifest.boundary
    const semantic_key = digest({ format: "loom-evaluation-enrollment-key/v1", source_store_id: p.manifest.source_store_id,
      owner_session: actor.session_id, slot: "overall", boundary, membership_sha256: p.manifest.membership_sha256,
      method: p.request.method, source_policy: p.request.source_policy, route_policy: p.request.route_policy, budget_policy: p.request.budget_policy })
    return { source_store_id: p.manifest.source_store_id, owner_session: actor.session_id, batch_id: p.batch_id,
      request_id: p.request_id, attempt_id: p.issue.attempt.attempt_id, manifest_sha256: p.manifest_sha256, semantic_key }
  }
  private bound(subject: EvaluatorExecutionSubject, raw: unknown, prepared?: Prepared): EvaluatorExecutionAdmission {
    const admission = parseEvaluatorAdmission(raw)
    if (!same(admission.grant.subject, subject)) throw new Error("Evaluator execution restore or authority binding conflict")
    if (prepared && !same(admission.grant.method, prepared.method_manifest)) throw new Error("Evaluator effective method changed")
    return admission
  }
  private live(expiresAt: string): void {
    if (Date.parse(expiresAt) <= this.clock()) throw new Error("Evaluator execution authority expired")
  }
  private remember(actor: Actor, subject: EvaluatorExecutionSubject, snapshot: EvaluatorExecutionSnapshot) {
    const admission = this.bound(subject, snapshot.admission)
    const observation = parseEvaluatorReceipt(snapshot.receipt, admission)
    const issue = this.store.reviews.readIssue(actor, subject.request_id)
    if (issue.attempt.attempt_id !== subject.attempt_id) throw new Error("Evaluator canonical issue changed")
    this.history.saveExecutionAdmission(subject.batch_id, actor.session_id, admission)
    const current = this.history.appendExecutionReceipt(subject.batch_id, actor.session_id, observation)
    // A concurrent reconciliation can replay an exact older observation. The
    // store preserves it idempotently; return the latest accepted receipt too.
    const receipt = current.receipts.at(-1)!
    // Reconciliation cannot acquire a missing/restored claim. Preserve a known
    // original claimant only; a stronger native receipt never mints a new permit.
    if (issue.attempt.claimant_id) this.store.reviews.issues.recordOutcome(issue.intent, issue.attempt.claimant_id, {
      status: receipt.execution === "not-admitted" ? "proven-non-admission"
        : ["admitted", "completed", "failed"].includes(receipt.execution) || receipt.result ? "issued" : "unknown",
      source_ref: receipt.receipt_id, reason: "execution-owner-observation-not-Q4-provenance",
    })
    return { admission, receipt }
  }
  private async disclose(actor: Actor, pins: EvaluatorExecutionPins, snapshot: EvaluatorExecutionSnapshot) {
    await this.connected().authorize(actor)
    this.prepared(actor, pins)
    return { ...snapshot, interpretation: null, qualification: "execution-consumer-only" as const }
  }
  private async existing(actor: Actor, pins: EvaluatorExecutionPins) {
    this.pins(pins)
    const saved = this.history.readExecution(pins.batch_id, actor.session_id)
    const subject = saved?.admission.grant.subject ?? this.subject(actor, this.prepared(actor, pins))
    if (subject.batch_id !== pins.batch_id || subject.request_id !== pins.request_id
        || subject.attempt_id !== pins.attempt_id || subject.manifest_sha256 !== pins.manifest_sha256)
      throw new Error("Evaluator execution pins disagree with saved admission")
    return { saved, subject }
  }

  /** Accounting recovery is permitted after inference expiry/revocation. Current
   * source/readback permission is still required before returning any result ID. */
  async recover(actor: Actor, pins: EvaluatorExecutionPins) {
    const { authority } = this.connected(), { subject } = await this.existing(actor, pins)
    const snapshot = await authority.reconcile(subject)
    if (!snapshot) throw new Error("Evaluator execution inventory unavailable; no absence inferred")
    const remembered = this.remember(actor, subject, snapshot)
    return this.disclose(actor, pins, remembered)
  }
  async cancel(actor: Actor, pins: EvaluatorExecutionPins) {
    const { authority } = this.connected(), { subject } = await this.existing(actor, pins)
    const snapshot = await authority.reconcile(subject)
    if (!snapshot) throw new Error("Evaluator execution inventory unavailable; no cancellation inferred")
    const admission = this.bound(subject, snapshot.admission)
    this.remember(actor, subject, snapshot)
    const receipt = await authority.cancel(admission)
    return this.disclose(actor, pins, this.remember(actor, subject, { admission, receipt }))
  }

  async execute(actor: Actor, pins: EvaluatorExecutionPins, signal: AbortSignal) {
    const { authority, authorize } = this.connected()
    await authorize(actor)
    signal.throwIfAborted()
    let prepared = this.prepared(actor, pins)
    const subject = this.subject(actor, prepared), saved = this.history.readExecution(pins.batch_id, actor.session_id)
    // Always consult the owner's inventory, including on a pristine local store.
    // A semantic collision after rollback must recover the original or fence.
    const remote = await authority.reconcile(subject)
    let admission: EvaluatorExecutionAdmission
    if (remote) {
      admission = this.bound(subject, remote.admission, prepared)
      const known = this.remember(actor, subject, remote)
      if (known.receipt.execution !== "reserved" || known.receipt.fenced || prepared.issue?.attempt.claimant_id)
        return this.disclose(actor, pins, known)
    } else {
      if (saved || prepared.issue?.attempt.claimant_id || prepared.issue?.attempt.state !== "prepared")
        throw new Error("Evaluator execution history disagreement; reconciliation required")
      if (!prepared.request.budget_policy) throw new Error("Evaluator execution budget authority required")
      const grant = parseEvaluatorGrant(await authority.prepare(subject, prepared.method_manifest, prepared.request.budget_policy))
      if (!same(grant.subject, subject) || !same(grant.method, prepared.method_manifest)) throw new Error("Evaluator prepared authority changed")
      this.live(grant.expires_at)
      await authorize(actor)
      signal.throwIfAborted()
      prepared = this.prepared(actor, pins)
      if (!same(this.subject(actor, prepared), subject)) throw new Error("Evaluator execution source changed")
      // A lost reserve ACK is an uncertain reservation, not permission to repeat.
      // The caller may recover; a repeated execute first inventories the owner.
      admission = this.bound(subject, await authority.reserve(grant), prepared)
      if (!same(admission.grant, grant)) throw new Error("Evaluator reserved authority changed")
      this.history.saveExecutionAdmission(pins.batch_id, actor.session_id, admission)
    }

    let claimed = false
    try {
      await authorize(actor)
      signal.throwIfAborted()
      prepared = this.prepared(actor, pins)
      this.bound(this.subject(actor, prepared), admission, prepared)
      this.live(admission.grant.expires_at)
      await authority.validate(admission, "claim")
      signal.throwIfAborted()
      // Recheck after asynchronous native authority validation, before the sole
      // local claim. The adapter must also recheck at the actual effect boundary.
      await authorize(actor)
      signal.throwIfAborted()
      this.live(admission.grant.expires_at)
      prepared = this.prepared(actor, pins)
      this.bound(this.subject(actor, prepared), admission, prepared)
      const claim = this.store.reviews.claimIssue(actor, { request_id: subject.request_id, kind: "initial" }, randomUUID())
      if (claim.status !== "claimed-now") return this.recover(actor, pins)
      claimed = true
      await authorize(actor)
      signal.throwIfAborted()
      prepared = this.prepared(actor, pins)
      this.bound(this.subject(actor, prepared), admission, prepared)
      this.live(admission.grant.expires_at)
      const receipt = await authority.execute(admission, async (memberKey, sourceIndex) => {
        signal.throwIfAborted()
        await authorize(actor)
        this.live(admission.grant.expires_at)
        await authority.validate(admission, "source")
        signal.throwIfAborted()
        // The authority check may await native I/O. Caller read permission and
        // the deadline must still hold when the original bytes are returned.
        await authorize(actor)
        signal.throwIfAborted()
        this.live(admission.grant.expires_at)
        // Original owner reads are preserved; the trusted adapter independently
        // authorizes this exact recipient/transfer before receiving these bytes.
        this.bound(this.subject(actor, this.prepared(actor, pins)), admission)
        return this.preparation.source(actor.session_id, pins.batch_id, pins.request_id, pins.manifest_sha256, memberKey, sourceIndex)
      }, signal)
      const remembered = this.remember(actor, subject, { admission, receipt })
      // A result can arrive after an abort that the native owner did not yet
      // observe. Retain it, then fence/cancel through the catch path; do not
      // report an uncancelled completion or discard the late original result.
      signal.throwIfAborted()
      const visible = await this.disclose(actor, pins, remembered)
      signal.throwIfAborted()
      return visible
    } catch (error) {
      // Never resend, release, or infer nonexecution here. Cancellation asks the
      // authority to fence; an interrupted acknowledgement keeps its reservation.
      if (signal.aborted || !claimed) {
        try { this.remember(actor, subject, { admission, receipt: await authority.cancel(admission) }) }
        catch { /* Preserve the original failure and uncertain owner reservation. */ }
      } else {
        try {
          const outcome = await authority.reconcile(subject)
          if (outcome) this.remember(actor, subject, outcome)
        } catch { /* No authoritative observation; the consumed claim stays held. */ }
      }
      throw error
    }
  }
}
