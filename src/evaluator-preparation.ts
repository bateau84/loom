import { canonical, digest, ProcessingBudget, ProcessingLimitError, type Actor } from "./model.js"
import { DESCRIPTIVE_METHOD, EVALUATOR_BLOCK, type AutomaticLearning } from "./automatic-learning.js"
import { evaluatorRequestID, type EvaluationBatch, type EvaluationMember, type EvaluatorPreparationRecord } from "./evaluation-store.js"
import { evaluatorMethod, parseEvaluatorMethod, parseEvaluatorPolicy, type EvaluatorMethodManifest, type EvaluatorPolicyRef } from "./evaluator-method.js"
import type { Store } from "./store.js"
import type { ReviewRequest } from "./review-requests.js"
import type { RetrospectivePopulation, RetrospectivePopulationRef } from "./retrospective-contract.js"

const SCOPE = "evaluator-preparation/calling-session"
const RETROSPECTIVE_SCOPE = "evaluator-preparation/retrospective"
const READ_CHARS = 262144
const populationBudget = () => new ProcessingBudget(33554432, 2000000)
const same = (a: unknown, b: unknown) => canonical(a, populationBudget()) === canonical(b, populationBudget())
type Manifest = {
  format: "loom-evaluation-manifest/v1"; batch_id: string; source_batch_id: string; source_store_id: string;
  boundary: EvaluationBatch["boundary"]; method: EvaluationBatch["method"]; membership_sha256: string; member_count: number;
}
type PreparedRequest = {
  format: "loom-evaluation-request/v1"; request_id: string; review_request_id: string;
  batch_id: string; slot: "overall"; source_batch_id: string; source_store_id: string;
  manifest_sha256: string; method: EvaluationBatch["method"]; target_agent: "evaluator";
  source_policy: EvaluatorPolicyRef; route_policy: EvaluatorPolicyRef; budget_policy: EvaluatorPolicyRef | null;
  source_scope: "calling-session-existing-evidence"; originating_request_independence: "unknown";
  method_binding: "declared-not-admitted"; original_review_requests: "frozen-manifest-source-references";
  review_request: ReviewRequest;
}
type RetrospectiveSource = RetrospectivePopulationRef
type RetrospectiveManifest = Omit<Manifest, "format" | "source_batch_id"> & {
  format: "loom-evaluation-manifest/v2"; source: RetrospectiveSource;
  member_count_unit: "deduplicated-evidence-sources"; objective_count: 1;
}
type RetrospectiveRequest = Omit<PreparedRequest, "format" | "source_batch_id" | "source_scope"> & {
  format: "loom-evaluation-request/v2"; source: RetrospectiveSource; source_scope: "frozen-retrospective-population";
}
const retrospectiveSource = (population: RetrospectivePopulation): RetrospectiveSource => ({ kind: "retrospective-population",
  format: "loom-retrospective-population/v1", population_id: population.population_id, manifest_sha256: population.manifest_sha256 })
const retrospectiveMembers = (population: RetrospectivePopulation): EvaluationMember[] => population.manifest.members.map(member => ({
  key: member.key, kind: "objective", source_refs: [member.source],
}))
const retrospectiveBoundary = (population: RetrospectivePopulation, budget: EvaluatorPolicyRef | null) => ({
  retrospective_population: population.population_id, retrospective_manifest: population.manifest_sha256, preparation_budget_policy: digest(budget),
})
function retrospectiveManifest(batch: EvaluationBatch, population: RetrospectivePopulation): RetrospectiveManifest {
  return { format: "loom-evaluation-manifest/v2", batch_id: batch.id, source: retrospectiveSource(population),
    source_store_id: batch.source_store_id, boundary: batch.boundary, method: batch.method,
    membership_sha256: batch.membership_sha256, member_count: batch.member_count,
    member_count_unit: "deduplicated-evidence-sources", objective_count: 1 }
}
function retrospectiveRequest(batch: EvaluationBatch, population: RetrospectivePopulation, method: EvaluatorMethodManifest,
  budget: EvaluatorPolicyRef | null, manifestSHA: string, requestID: string, requester: Actor): RetrospectiveRequest {
  const { format: _format, source_batch_id: _sourceBatch, source_scope: _sourceScope, ...base } = request(batch, "", method, budget, manifestSHA, requestID, requester)
  const review: ReviewRequest = { ...base.review_request, mandate: { ...base.review_request.mandate,
    question: population.manifest.selection.question,
    inclusions: ["The complete exact frozen retrospective population, including attributed relationships, exclusions, permitted source views and explicit gaps."],
    exclusions: [...base.review_request.mandate.exclusions, "Connected objectives outside the approved selection", "Substitution of changed originals or inferred missing historical relationships"],
  } }
  return { ...base, format: "loom-evaluation-request/v2", source: retrospectiveSource(population), source_scope: "frozen-retrospective-population", review_request: review }
}

function policy(input: unknown): EvaluatorPolicyRef | null {
  return input === null ? null : parseEvaluatorPolicy(input)
}
function manifest(batch: EvaluationBatch, sourceBatchID: string): Manifest {
  return { format: "loom-evaluation-manifest/v1", batch_id: batch.id, source_batch_id: sourceBatchID,
    source_store_id: batch.source_store_id, boundary: batch.boundary, method: batch.method,
    membership_sha256: batch.membership_sha256, member_count: batch.member_count }
}
function request(batch: EvaluationBatch, sourceBatchID: string, method: EvaluatorMethodManifest,
  budget: EvaluatorPolicyRef | null, manifestSHA: string, requestID: string, requester: Actor): PreparedRequest {
  const locator = `loom-evaluation://${batch.source_store_id}/${batch.id}/manifest`
  const review: ReviewRequest = {
    format: "loom-review-request/v1", request_id: requestID, requester,
    mandate: {
      question: "Assess the complete objective trajectories supported by the frozen authorized evidence, including corrective attempts and remaining gaps.",
      dimensions: ["observed versus reported outcomes", "verification and rework", "review scope", "positive practices", "counterevidence and uncertainty"],
      criteria: [{ text: "One goal with fail/fail/pass verification is one trajectory with correction, not three independent successes. Preserve original review mandates and partial re-review limits.", source_ref: locator },
        { text: "Separate source-backed facts, authored claims, interpretation and unsupported hypotheses. Retain useful practices; no-change and insufficient-evidence conclusions are valid.", source_ref: method.audit_skill.definition.locator }],
      mode: "whole-objective-retrospective",
      inclusions: ["All frozen members through the authorized manifest view; accessible authored links do not establish access to foreign originals."],
      exclusions: ["Independent-pattern or causal claims without evidence", "Canonical instruction changes, experiments and project mutations", "Inference before actual recipient, source, route and budget qualification"],
    },
    intended_recipient: { agent: "evaluator", session_id: null }, work_revision_policy: "frozen-historical",
    members: [{ member_id: "evaluation-manifest", work_ref: null, producing_attempt_refs: [], prior_review_request_id: null,
      artifact_refs: [{ locator, version: { kind: "sha256", value: manifestSHA }, content_ref: `loom_insights:evaluation-preparation-members:${batch.id}` }],
      membership_source_refs: [locator], gaps: [{ reason: "unsupported-host-boundary", source_ref: null }] }],
    rechecks: [], extensions: { classification: "evaluator-preparation", evaluation_batch_id: batch.id },
  }
  return { format: "loom-evaluation-request/v1", request_id: requestID, review_request_id: requestID,
    batch_id: batch.id, slot: "overall", source_batch_id: sourceBatchID, source_store_id: batch.source_store_id,
    manifest_sha256: manifestSHA, method: evaluatorMethod(method), target_agent: "evaluator",
    source_policy: method.source_policy, route_policy: method.route_policy, budget_policy: budget,
    source_scope: "calling-session-existing-evidence", originating_request_independence: "unknown",
    method_binding: "declared-not-admitted", original_review_requests: "frozen-manifest-source-references", review_request: review }
}

/** Source preparation only. This module has no native host or provider client,
 * no issue-claim path and no interpretation/report writer. */
export class EvaluatorPreparation {
  constructor(private readonly automatic: AutomaticLearning, private readonly store: Store) {}

  prepare(actor: Actor, sourceBatchID: string, rawMethod: unknown, rawBudget: unknown) {
    const method = parseEvaluatorMethod(rawMethod), budget = policy(rawBudget)
    const source = this.automatic.history.preparationPopulation(sourceBatchID, actor.session_id)
    if (source.batch.source_store_id !== this.automatic.sources.namespace || source.batch.scope_key !== "permitted-session-evidence"
      || !same(source.batch.method, DESCRIPTIVE_METHOD)) throw new Error("Evaluator preparation source must be a permitted Stage 3 batch")
    const batch = this.automatic.history.freeze({ owner_session: actor.session_id, scope_key: SCOPE,
      source_store_id: source.batch.source_store_id, method: evaluatorMethod(method), members: source.members,
      boundary: { ...source.batch.boundary, preparation_source_batch: source.batch.id, preparation_budget_policy: digest(budget) } })
    const header = manifest(batch, source.batch.id), manifestSHA = digest({ ...header, members: source.members }, populationBudget())
    let origin = actor
    try { origin = this.store.reviews.getRequest(actor, evaluatorRequestID(batch)).requester }
    catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "not-authorized") throw error }
    const mapped = this.automatic.history.prepareEvaluatorRequest(batch.id, actor.session_id, method, origin,
      (id, origin) => request(batch, source.batch.id, method, budget, manifestSHA, id, origin))
    const saved = this.checked(mapped, actor.session_id)
    const { requester: _requester, ...review } = saved.request.review_request
    const frozen = this.store.reviews.freezeEvaluatorPreparation(mapped.requester, review)
    if (frozen.status === "conflict") throw new Error("Evaluator preparation review request conflict")
    this.store.reviews.prepareIssue(actor, mapped.request_id, { kind: "initial" })
    if (batch.published_state !== "complete") this.automatic.history.block(batch.id, "evaluator-dispatch-unavailable")
    return this.read(actor.session_id, batch.id)
  }

  /** The registered caller must complete async source-owner validation first.
   * This method owns only the durable local preparation chain, never admission. */
  prepareRetrospective(actor: Actor, selected: RetrospectivePopulation, rawMethod: unknown, rawBudget: unknown) {
    const population = this.automatic.history.retrospectivePopulation(selected.population_id, actor.session_id)
    if (population.manifest_sha256 !== selected.manifest_sha256 || population.manifest.source_store_id !== this.automatic.sources.namespace)
      throw new Error("Retrospective preparation population mismatch")
    const method = parseEvaluatorMethod(rawMethod), budget = policy(rawBudget), members = retrospectiveMembers(population)
    const batch = this.automatic.history.freeze({ owner_session: actor.session_id, scope_key: RETROSPECTIVE_SCOPE,
      source_store_id: population.manifest.source_store_id, method: evaluatorMethod(method), members,
      boundary: retrospectiveBoundary(population, budget) })
    const header = retrospectiveManifest(batch, population), sha256 = digest({ ...header, members }, populationBudget())
    let origin = actor
    try { origin = this.store.reviews.getRequest(actor, evaluatorRequestID(batch)).requester }
    catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "not-authorized") throw error }
    const mapped = this.automatic.history.prepareEvaluatorRequest(batch.id, actor.session_id, method, origin,
      (id, originalActor) => retrospectiveRequest(batch, population, method, budget, sha256, id, originalActor))
    const saved = this.checkedRetrospective(mapped, actor.session_id)
    const { requester: _requester, ...review } = saved.request.review_request
    const frozen = this.store.reviews.freezeEvaluatorPreparation(mapped.requester, review)
    if (frozen.status === "conflict") throw new Error("Evaluator preparation review request conflict")
    this.store.reviews.prepareIssue(actor, mapped.request_id, { kind: "initial" })
    if (batch.published_state !== "complete") this.automatic.history.block(batch.id, "evaluator-dispatch-unavailable")
    return this.read(actor.session_id, batch.id)
  }

  private checkedRetrospective(record: EvaluatorPreparationRecord, owner: string) {
    const frozen = this.automatic.history.frozenPreparationPopulation(record.batch_id, owner), batch = frozen.batch
    if (!record.data || typeof record.data !== "object" || Array.isArray(record.data) || !("source" in record.data)
      || !record.data.source || typeof record.data.source !== "object" || Array.isArray(record.data.source)
      || !("population_id" in record.data.source) || typeof record.data.source.population_id !== "string"
      || !("budget_policy" in record.data)) throw new Error("Retrospective preparation unavailable")
    const population = this.automatic.history.retrospectivePopulation(record.data.source.population_id, owner)
    const members = retrospectiveMembers(population), budget = policy(record.data.budget_policy)
    if (population.manifest.source_store_id !== this.automatic.sources.namespace || batch.source_store_id !== population.manifest.source_store_id
      || !same(members, frozen.members) || !same(batch.boundary, retrospectiveBoundary(population, budget))) throw new Error("Retrospective preparation population integrity mismatch")
    const header = retrospectiveManifest(batch, population), sha256 = digest({ ...header, members }, populationBudget())
    const expected = retrospectiveRequest(batch, population, record.method, budget, sha256, record.request_id, record.requester)
    if (!same(expected, record.data)) throw new Error("Retrospective preparation request integrity mismatch")
    return { request: expected, manifest: header, members }
  }

  private checked(record: EvaluatorPreparationRecord, owner: string) {
    if (record.data && typeof record.data === "object" && "format" in record.data && record.data.format === "loom-evaluation-request/v2")
      return this.checkedRetrospective(record, owner)
    const population = this.automatic.history.preparationPopulation(record.batch_id, owner), batch = population.batch
    if (batch.source_store_id !== this.automatic.sources.namespace || batch.scope_key !== SCOPE || !record.data || typeof record.data !== "object"
      || Array.isArray(record.data) || !("budget_policy" in record.data) || !("source_batch_id" in record.data)
      || typeof record.data.source_batch_id !== "string") throw new Error("Evaluator preparation unavailable")
    const source = this.automatic.history.preparationPopulation(record.data.source_batch_id, owner)
    const budget = policy(record.data.budget_policy), header = manifest(batch, source.batch.id)
    if (source.batch.source_store_id !== batch.source_store_id || source.batch.scope_key !== "permitted-session-evidence"
      || !same(source.batch.method, DESCRIPTIVE_METHOD) || !same(source.members, population.members)
      || !same(batch.boundary, { ...source.batch.boundary, preparation_source_batch: source.batch.id, preparation_budget_policy: digest(budget) }))
      throw new Error("Evaluator preparation source boundary mismatch")
    const sha256 = digest({ ...header, members: population.members }, populationBudget())
    const expected = request(batch, source.batch.id, record.method, budget, sha256, record.request_id, record.requester)
    if (!same(expected, record.data)) throw new Error("Evaluator preparation request integrity mismatch")
    return { request: expected, manifest: header, members: population.members }
  }

  private load(owner: string, batchID: string) {
    const record = this.automatic.history.readEvaluatorRequest(batchID, owner)
    if (!record) throw new Error("Evaluator preparation unavailable")
    return { record, ...this.checked(record, owner) }
  }

  assertReview(owner: string, review: ReviewRequest): void {
    const id = review.extensions?.evaluation_batch_id
    if (typeof id !== "string") throw new Error("Evaluator preparation unavailable")
    const saved = this.load(owner, id)
    if (saved.record.request_id !== review.request_id || !same(review, saved.request.review_request))
      throw new Error("Evaluator preparation unavailable")
  }

  /** Metadata routing only; callers still authorize the population before read. */
  retrospectiveReference(owner: string, batchID: string): RetrospectiveSource | null {
    const record = this.automatic.history.readEvaluatorRequest(batchID, owner)
    if (!record) throw new Error("Evaluator preparation unavailable")
    if (record.data && typeof record.data === "object" && "format" in record.data && record.data.format === "loom-evaluation-request/v2") {
      const source = "source" in record.data ? record.data.source : undefined
      if (!source || typeof source !== "object" || !("population_id" in source) || typeof source.population_id !== "string"
        || !("manifest_sha256" in source) || typeof source.manifest_sha256 !== "string") throw new Error("Retrospective preparation unavailable")
      return { kind: "retrospective-population", format: "loom-retrospective-population/v1", population_id: source.population_id, manifest_sha256: source.manifest_sha256 }
    }
    return null
  }

  read(owner: string, batchID: string) {
    const { record, request: saved, manifest: header } = this.load(owner, batchID)
    let issue: ReturnType<Store["reviews"]["readIssue"]> | null = null
    let state: "prepared" | "incomplete" = "incomplete"
    try {
      const review = this.store.reviews.getRequest({ session_id: owner, agent: "preparation-reader" }, record.request_id)
      if (!same(review, saved.review_request)) throw new Error("Evaluator preparation review request conflict")
      issue = this.store.reviews.readIssue({ session_id: owner, agent: "preparation-reader" }, record.request_id)
      state = "prepared"
    } catch (error) {
      // A missing cross-store write is recoverable by replaying the explicit
      // preparation. Reads never fill it in or reset an existing issue claim.
      if (!(error instanceof Error) || (!("code" in error) || !["not-authorized", "issue-not-found"].includes(String(error.code)))) throw error
    }
    return { state, mode: "preparation-only", batch_id: batchID, request_id: record.request_id, review_request_id: record.request_id,
      method_id: evaluatorMethod(record.method).id, manifest_sha256: saved.manifest_sha256, manifest: header,
      request: saved, method_manifest: record.method, method_binding: "declared-not-admitted", policy_authority: "not-established",
      issue, interpretation: null, dispatch: EVALUATOR_BLOCK, automatic_model_calls: false, budget_reservation: null,
      Q4: "partial-unqualified", Q5: "unqualified-transfer-withheld", E11: "unqualified",
      qualifications: ["preparation-not-evaluator-reasoning", ...(saved.format === "loom-evaluation-request/v2"
        ? ["frozen-retrospective-membership", "current-source-authority-required", "retrospective-execution-disconnected"]
        : ["same-session-originals-only", "foreign-linked-content-not-inspected"]),
        "originating-request-independence-unknown", "method-content-not-loaded-or-attested", "no-native-recipient-or-admission"] }
  }

  /** A current assessment, never the authority-bearing admission envelope.
   * Reuse the frozen source/request and issue owners; reading cannot repair,
   * claim, reserve, release, or dispatch anything. Local identity is not a
   * native effect receipt, including after a rollback of either local store. */
  admission(owner: string, batchID: string, requestID: unknown, manifestSHA: unknown, attemptID: unknown, captureEnabled: boolean) {
    const prepared = this.read(owner, batchID)
    if (requestID !== prepared.request_id || manifestSHA !== prepared.manifest_sha256)
      throw new Error("Evaluator admission identity mismatch")
    const issue = prepared.issue
    if (!issue) throw new Error("Evaluator admission canonical issue unavailable; preparation is incomplete")
    if (attemptID !== issue.attempt.attempt_id) throw new Error("Evaluator admission issue identity mismatch")
    const consumed = issue.attempt.claimant_id !== null
    const blockers: Array<{ capability: string; state: "blocked" | "missing" | "unsupported"; reason: string }> = [
      { capability: "effective-method", state: "unsupported", reason: "effective-method-authority-unavailable" },
      { capability: "recipient", state: "unsupported", reason: "qualified-recipient-preparation-unavailable" },
      { capability: "recipient-source-access", state: "unsupported", reason: "recipient-source-authority-unavailable" },
      { capability: "model-provider-account", state: "unsupported", reason: "model-account-authority-unavailable" },
      { capability: "budget", state: prepared.request.budget_policy === null ? "missing" : "unsupported",
        reason: prepared.request.budget_policy === null ? "budget-policy-missing" : "declared-budget-policy-is-not-authority" },
      { capability: "budget-reservation", state: "unsupported", reason: "atomic-budget-owner-unavailable" },
      { capability: "native-reconciliation", state: "unsupported", reason: "native-effect-reconciliation-unavailable" },
    ]
    if (!captureEnabled) blockers.unshift({ capability: "source-processing", state: "blocked", reason: "source-processing-disabled" })
    if (prepared.request.format === "loom-evaluation-request/v2") blockers.unshift({ capability: "population-execution", state: "unsupported", reason: "retrospective-execution-disconnected" })
    if (issue.attempt.state !== "prepared") blockers.unshift({ capability: "canonical-issue", state: "blocked",
      reason: consumed ? "canonical-issue-consumed" : "canonical-issue-rejected" })
    return {
      format: "loom-evaluation-admission-assessment/v1", state: "blocked", mode: "assessment-only",
      batch_id: batchID, request_id: prepared.request_id, manifest_sha256: prepared.manifest_sha256,
      source_store_id: prepared.manifest.source_store_id, method_id: prepared.method_id,
      source_scope: prepared.request.source_scope, method_binding: prepared.method_binding,
      local_issue: { intent: issue.intent, attempt: issue.attempt },
      source_processing: captureEnabled ? "enabled" : "disabled", blockers,
      dispatch_enabled: false, automatic_model_calls: false, effect_permit: null,
      native_effect_identity: "not-established", budget_reservation: null, budget_accounting: "not-established",
      recovery: {
        state: consumed ? issue.attempt.native_outcome === "proven-non-admission"
          ? "consumed-intent-preserved" : "native-reconciliation-required"
          : issue.attempt.state === "prepared" ? "qualification-required" : "local-rejection-preserved",
        retry_authority: "unavailable", restore_reconciliation: "unsupported",
      },
      qualifications: {
        Q4: prepared.Q4, Q5: prepared.Q5, E11: prepared.E11,
        originating_request_independence: "unknown", reader_access_is_recipient_authority: false,
        local_state_proves_native_nonexecution: false,
      },
    }
  }

  members(owner: string, batchID: string, requestID: unknown, manifestSHA: unknown, after: unknown = 0, limit: unknown = 20) {
    const { record, request: saved, manifest: header, members } = this.load(owner, batchID)
    if (requestID !== record.request_id || manifestSHA !== saved.manifest_sha256) throw new Error("Evaluator preparation page identity mismatch")
    if (!Number.isSafeInteger(after) || (after as number) < 0 || (after as number) > members.length
      || !Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100) throw new Error("Invalid evaluator preparation page")
    const page = { batch_id: batchID, request_id: record.request_id, manifest_sha256: saved.manifest_sha256, manifest: header,
      items: [] as Array<EvaluationMember & { ordinal: number }>, next_after: null as number | null }
    for (let i = after as number; i < Math.min(members.length, (after as number) + (limit as number)); i++) {
      const member = members[i]!
      const item = { ...member, ordinal: i + 1 }, next = i + 1 < members.length ? i + 1 : null
      try { canonical({ ...page, items: [...page.items, item], next_after: next }, new ProcessingBudget(READ_CHARS)) }
      catch (error) {
        if (!(error instanceof ProcessingLimitError) || !page.items.length) throw error
        break
      }
      page.items.push(item)
    }
    const end = (after as number) + page.items.length
    page.next_after = end < members.length ? end : null
    return page
  }

  source(owner: string, batchID: string, requestID: unknown, manifestSHA: unknown, memberKey: unknown, sourceIndex: unknown) {
    const { record, request: saved, members } = this.load(owner, batchID)
    if (requestID !== record.request_id || manifestSHA !== saved.manifest_sha256) throw new Error("Evaluator preparation page identity mismatch")
    const member = members.find(item => item.key === memberKey)
    if (!member || !Number.isSafeInteger(sourceIndex) || (sourceIndex as number) < 0 || (sourceIndex as number) >= member.source_refs.length)
      throw new Error("Invalid evaluator preparation source selection")
    const ref = member.source_refs[sourceIndex as number]!
    if (saved.format === "loom-evaluation-request/v2") throw new Error("Retrospective originals require the asynchronous source-owner reader")
    const original = this.automatic.sources.resolve(ref, this.automatic.sources.namespace)
    if (!original) throw new Error("Evaluator preparation unavailable")
    const result = { batch_id: batchID, request_id: record.request_id, manifest_sha256: saved.manifest_sha256,
      member_key: member.key, source_index: sourceIndex, source: ref, value: original.value,
      coverage: "existing-stored-record", receiving_session: owner, native_evaluator_retrieval: "not-established" }
    canonical(result, new ProcessingBudget(READ_CHARS))
    return result
  }

  sourceView(owner: string, batchID: string, requestID: unknown, manifestSHA: unknown, memberKey: unknown, sourceIndex: unknown) {
    const source = this.retrospectiveReference(owner, batchID)
    if (!source) return this.source(owner, batchID, requestID, manifestSHA, memberKey, sourceIndex)
    const { record, request: saved, members } = this.load(owner, batchID)
    if (requestID !== record.request_id || manifestSHA !== saved.manifest_sha256) throw new Error("Evaluator preparation page identity mismatch")
    const member = members.find(item => item.key === memberKey)
    if (!member || sourceIndex !== 0) throw new Error("Invalid evaluator preparation source selection")
    return { batch_id: batchID, request_id: record.request_id, manifest_sha256: saved.manifest_sha256,
      member_key: member.key, source_index: sourceIndex, source: member.source_refs[0],
      source_owner_request: { operation: "population-source", population_id: source.population_id,
        manifest_sha256: source.manifest_sha256, member_key: member.key }, native_evaluator_retrieval: "not-established" }
  }
}
