import { randomUUID } from "node:crypto"
import { canonical, digest, type Actor } from "./model.js"
import { INCREMENTAL_METHOD, INCREMENTAL_SCOPE, type AutomaticLearning, type IncrementReportBody } from "./automatic-learning.js"
import type { IncrementalInterpretationConfig } from "./config.js"
import type { EvaluationMember, EvaluationSourceRef } from "./evaluation-store.js"
import { evaluationFrontier } from "./evaluation-subject.js"
import { EMPTY_LEARNING_FRONTIER, type LearningFrontier } from "./learning-sources.js"
import { evaluatorMethod, parseEvaluatorMethod, parseEvaluatorPolicy } from "./evaluator-method.js"
import type { EvaluatorPreparation } from "./evaluator-preparation.js"
import type { EvaluatorExecution, EvaluatorExecutionPins } from "./evaluator-execution.js"
import type { RetrospectivePopulations, RetrospectiveSourceResolver } from "./retrospective-populations.js"

/** These are planning bounds, not inference permission or a token allowance.
 * Source delivery and inference remain bounded by the existing qualified owner. */
export const INCREMENTAL_INTERPRETATION_LIMITS = Object.freeze({ checkpoints: 64, originals: 5000 })
export const incrementalInterpretationScope = (method: NonNullable<IncrementalInterpretationConfig["method"]>) =>
  "incremental-interpretation/" + digest(evaluatorMethod(method))
export type IncrementalInterpretationAccess = {
  authorize: () => Promise<void>;
  resolve: RetrospectiveSourceResolver;
}
type Metadata = NonNullable<ReturnType<AutomaticLearning["history"]["incrementalHead"]>>
type InterpretationRef = { sequence: number; frontier: LearningFrontier; batch_id: string; report_id: string; report_sha256: string }
type Checkpoint = {
  format: "loom-incremental-interpretation-checkpoint/v1";
  kind: "interpreted" | "no-eligible-change";
  from_sequence: number; through_sequence: number; through: LearningFrontier;
  namespace_through?: LearningFrontier;
  subject: { subject_id: string; sha256: string };
  source_batches: Array<{ batch_id: string; report_id: string; sha256: string }>;
  new_sources: number; earlier_context_sources: number;
  interpretation: InterpretationRef | null;
  previous_interpretation: InterpretationRef | null;
  processing_complete: true; objective_success: "not-assessed";
}
export type IncrementalInterpretationResult = {
  state: "disabled" | "empty" | "caught-up" | "waiting" | "pending" | "blocked" | "complete";
  reason: string | null; batch_id?: string; replayed?: boolean; retry_at?: number;
  interpretation?: InterpretationRef | null;
}
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error("Invalid incremental interpretation boundary")
  return value as number
}
const parsed = <T>(value: unknown): T => {
  if (typeof value !== "string") throw new Error("Incremental interpretation boundary unavailable")
  return JSON.parse(value) as T
}
const frontier = (row: Metadata, key: string) => evaluationFrontier(parsed(row.boundary[key]))
const throughSequence = (row: Metadata | null) => row ? integer(row.boundary.through_sequence, 1) : 0
const pins = (row: Metadata): EvaluatorExecutionPins => {
  const keys = ["prepared_batch_id", "request_id", "manifest_sha256", "attempt_id"] as const
  if (keys.some(key => typeof row.boundary[key] !== "string" || !row.boundary[key])) throw new Error("Incremental interpretation preparation unavailable")
  return { batch_id: row.boundary.prepared_batch_id as string, request_id: row.boundary.request_id as string,
    manifest_sha256: row.boundary.manifest_sha256 as string, attempt_id: row.boundary.attempt_id as string }
}
const configMethod = (config: IncrementalInterpretationConfig) => config.method ? parseEvaluatorMethod(config.method) : null
const qualifications = ["idle-is-not-engineering-completion", "method-specific-successful-checkpoints",
  "prepared-input-is-not-inference-authority", "earlier-reports-remain-immutable", "no-original-conversation-injection",
  "inference-uses-existing-qualified-source-route-and-budget-owners", "context-is-delivered-only-through-authorized-S5-readers",
  "model-conclusions-and-source-availability-require-authorized-S5-inspection"]

/** A bounded consumer of Stage 3 opportunities. This owns neither a scheduler
 * nor an evidence database. Its pending plans and committed cursor are ordinary
 * EvaluationStore batches. Production deliberately omits execution integration. */
export class IncrementalInterpretation {
  constructor(private readonly automatic: AutomaticLearning, private readonly populations: RetrospectivePopulations,
    private readonly preparation: EvaluatorPreparation, private readonly execution?: EvaluatorExecution,
    private readonly clock = Date.now) {}

  private heads(session: string, config: IncrementalInterpretationConfig) {
    const method = configMethod(config), scope = method ? incrementalInterpretationScope(method) : null
    return { method, scope, head: scope ? this.automatic.history.incrementalHead(session, scope) : null,
      complete: scope ? this.automatic.history.incrementalHead(session, scope, true) : null }
  }
  private lastInterpretation(row: Metadata | null): InterpretationRef | null {
    if (!row) return null
    const previous = parsed<InterpretationRef | null>(row.boundary.previous_interpretation)
    if (row.published_state !== "complete" || row.boundary.kind === "no-eligible-change") return previous
    const prepared = pins(row), record = this.automatic.history.readEvaluatorInterpretation(prepared.batch_id, row.owner_session)
    if (!record) throw new Error("Committed incremental interpretation publication unavailable")
    return { sequence: throughSequence(row), frontier: frontier(row, "through_frontier"), batch_id: prepared.batch_id,
      report_id: record.report.id, report_sha256: record.report.sha256 }
  }

  /** Status and navigation only. The S5 reader independently authorizes its
   * complete source union before disclosing any model conclusion. */
  progress(session: string, config: IncrementalInterpretationConfig) {
    const { method, head, complete } = this.heads(session, config), sequence = throughSequence(complete)
    const current = this.automatic.history.incrementalHead(session, INCREMENTAL_SCOPE, true)
    const pending = head && head.id !== complete?.id ? head : null
    // A status read is not permission to hydrate an earlier S5 report, including
    // its protected report identity/fingerprint. The existing prepared batch is
    // only a selector for the separately authorized interpretation endpoint.
    const previous = complete ? parsed<InterpretationRef | null>(complete.boundary.previous_interpretation) : null
    const interpretation = complete?.boundary.kind === "interpreted"
      ? { sequence, frontier: frontier(complete, "through_frontier"), batch_id: pins(complete).batch_id }
      : previous ? { sequence: previous.sequence, frontier: previous.frontier, batch_id: previous.batch_id } : null
    const state = !config.enabled ? "disabled" : !method || !config.budget_policy ? "blocked" : pending ? pending.state === "blocked" ? "blocked" : "pending"
      : !current ? "empty" : current.sequence <= sequence ? "caught-up" : "waiting"
    return { format: "loom-incremental-interpretation-progress/v1", enabled: config.enabled,
      configured: !!method && !!config.budget_policy, method: method ? { id: evaluatorMethod(method).id,
        model: { provider_id: method.model.provider_id, model_id: method.model.model_id } } : null,
      state, reason: !config.enabled ? "incremental-interpretation-disabled" : !method ? "method-not-configured"
        : !config.budget_policy ? "resource-policy-not-configured" : pending && !this.execution ? "evaluator-execution-authority-unavailable" : pending?.blocked_reason ?? null,
      processed: complete ? { sequence, frontier: frontier(complete, "through_frontier"), batch_id: complete.id } : null,
      interpreted: interpretation ? { ...interpretation, inspect: { operation: "evaluation-interpretation", batch_id: interpretation.batch_id } } : null,
      pending: pending ? { batch_id: pending.id,
        from_sequence: integer(pending.boundary.from_sequence, 0), through_sequence: throughSequence(pending),
        preparation: pending.boundary.kind === "no-eligible-change" ? null : { batch_id: pins(pending).batch_id,
          inspect: { operation: "evaluation-preparation", batch_id: pins(pending).batch_id } } } : null,
      execution_authority: this.execution ? "consumer-connected-not-admitted" : "unavailable", qualifications }
  }

  private async checked(actor: Actor, access: IncrementalInterpretationAccess, signal: AbortSignal) {
    signal.throwIfAborted(); await access.authorize(); signal.throwIfAborted()
    if (this.automatic.sources.isEvaluationSession(actor.session_id)) throw new Error("Learning activity cannot become an incremental engineering subject")
  }
  private previousBody(session: string, row: Metadata): IncrementReportBody {
    let report = this.automatic.history.report(row.id, session)
    // A late, exact learning-purpose receipt may withdraw an original. It does
    // not license skipping a missing engineering source or rewriting its report.
    if (report?.availability !== "available") report = this.automatic.history.incrementalRecoveryReport(row.id, session,
      ref => this.automatic.sources.isEvaluation(ref))
    if (!report) throw new Error("Increment source checkpoint unavailable")
    return this.automatic.checkedIncrementReport(session, row.id, report)
  }
  private async plan(actor: Actor, config: IncrementalInterpretationConfig, access: IncrementalInterpretationAccess, signal: AbortSignal,
    state: ReturnType<IncrementalInterpretation["heads"]>): Promise<Metadata | IncrementalInterpretationResult> {
    const { method, scope, complete, head } = state
    if (!method || !scope || !config.budget_policy) throw new Error("Incremental interpretation is not configured")
    integer(config.min_sources, 1, 1000); integer(config.max_age_ms, 0, 86400000); integer(config.min_interval_ms, 0, 86400000)
    const after = throughSequence(complete), window = this.automatic.history.incrementalWindow(actor.session_id, INCREMENTAL_SCOPE,
      { after, limit: INCREMENTAL_INTERPRETATION_LIMITS.checkpoints })
    if (!window.items.length) return { state: complete ? "caught-up" : "empty", reason: null, replayed: true }
    const total = window.items.reduce((sum, item) => sum + integer(item.boundary.new_sources, 0), 0)
    const now = this.clock(), oldest = Date.parse(window.items[0]!.created_at)
    const lastModel = this.lastInterpretation(complete)
    // Null-evidence bookkeeping never dispatches. Otherwise coalesce a bounded
    // oldest prefix by volume OR age; a sustained stream cannot reset this age.
    if (total && total < config.min_sources && now < oldest + config.max_age_ms)
      return { state: "waiting", reason: "coalescing-new-evidence", retry_at: oldest + config.max_age_ms }
    const lastPublication = lastModel ? this.automatic.history.readEvaluatorInterpretation(lastModel.batch_id, actor.session_id) : null
    const interval = lastPublication ? Date.parse(lastPublication.report.created_at) + config.min_interval_ms : 0
    if (total && now < interval)
      return { state: "waiting", reason: "minimum-interpretation-interval", retry_at: interval }

    const sources = new Map<string, EvaluationSourceRef>(), selected: Metadata[] = [], sourceBatches: Checkpoint["source_batches"] = []
    let retained: EvaluationSourceRef[] = [], lastBody: IncrementReportBody | null = null, newCount = 0
    for (const row of window.items) {
      const frozen = this.automatic.history.frozenIncrement(row.id, actor.session_id)
      if (canonical(frozen.method) !== canonical(INCREMENTAL_METHOD) || frozen.published_state !== "complete")
        throw new Error("Incremental interpretation source method mismatch")
      const body = this.previousBody(actor.session_id, row)
      const refs = frozen.members.flatMap(member => member.source_refs).filter(ref => !this.automatic.sources.isEvaluation(ref))
      const next = new Map(sources)
      for (const ref of refs) next.set(canonical(ref), ref)
      const context = [...body.retained.concerns, ...body.retained.unfinished].map(item => item.source)
        .filter(ref => !this.automatic.sources.isEvaluation(ref))
      const union = new Set([...next.keys(), ...context.map(ref => canonical(ref))])
      if (union.size > INCREMENTAL_INTERPRETATION_LIMITS.originals) {
        if (!selected.length) throw new Error("Incremental interpretation source/context bound exceeded; no evidence was discarded")
        break
      }
      const report = this.automatic.history.incrementalRecoveryReport(row.id, actor.session_id, ref => this.automatic.sources.isEvaluation(ref))
      sources.clear(); for (const [key, ref] of next) sources.set(key, ref)
      newCount += refs.length; retained = context; lastBody = body; selected.push(row)
      sourceBatches.push({ batch_id: row.id, report_id: report.id, sha256: report.sha256 })
    }
    if (!lastBody || !selected.length) throw new Error("Incremental interpretation prefix unavailable")
    const earlierContext = retained.filter(ref => !sources.has(canonical(ref)))
    for (const ref of retained) sources.set(canonical(ref), ref)
    const last = selected.at(-1)!, from = complete ? frontier(complete, "through_frontier") : { ...EMPTY_LEARNING_FRONTIER }
    // Establish the exact processed checkpoint, not its broader observed upper
    // frontier. A later concurrent append is outside this population forever.
    await this.checked(actor, access, signal)
    const subject = this.automatic.subjects.establishAutomatic(actor.session_id, evaluatorMethod(method), from,
      lastBody.through, lastBody.namespace_through ?? lastBody.through)
    const budget = parseEvaluatorPolicy(config.budget_policy), refs = [...sources.values()]
    let populationID = "", populationSHA = "", preparedPins: EvaluatorExecutionPins | null = null
    const kind = newCount || lastBody.withdrawn_learning_sources.length ? "interpreted" : "no-eligible-change"
    // Withdrawal with no remaining original has no legal S5 population. It is
    // committed as explicit no-inference bookkeeping, never an interpretation.
    const infer = kind === "interpreted" && refs.length > 0
    if (infer) {
      const manifest = this.populations.fromSources(subject, refs)
      manifest.coverage = { ...manifest.coverage, incremental: { from_sequence: after, through_sequence: last.sequence,
        source_batches: sourceBatches, new_sources: newCount, earlier_context_sources: earlierContext.length,
        previous_interpretation: lastModel ? { ...lastModel, relation: "context" } : null,
        question: "Update the current interpretation using this new evidence, retained unresolved work, and selectively authorized earlier reports. Corrections remain part of their original trajectory." } }
      const population = this.automatic.history.freezeRetrospective(actor, manifest)
      await this.populations.validateForPreparation(actor, population, access.resolve)
      await this.checked(actor, access, signal)
      const prepared = this.preparation.prepareRetrospective(actor, population, method, budget)
      if (!prepared.issue || prepared.state !== "prepared") throw new Error("Incremental interpretation preparation incomplete")
      preparedPins = { batch_id: prepared.batch_id, request_id: prepared.request_id, manifest_sha256: prepared.manifest_sha256,
        attempt_id: prepared.issue.attempt.attempt_id }
      populationID = population.population_id; populationSHA = population.manifest_sha256
    }
    const members: EvaluationMember[] = []
    for (let index = 0; index < refs.length; index += 32) members.push({ key: "increment:" + index / 32,
      kind: "session", source_refs: refs.slice(index, index + 32) })
    if (!members.length) members.push({ key: "increment:empty", kind: "session", source_refs: [] })
    await this.checked(actor, access, signal)
    const batch = this.automatic.history.freeze({ owner_session: actor.session_id, source_store_id: this.automatic.sources.namespace,
      scope_key: scope, method: evaluatorMethod(method), members, expected_previous_batch_id: head?.id ?? null,
      boundary: { kind: infer ? "interpreted" : "no-eligible-change", from_sequence: after, through_sequence: last.sequence,
        from_frontier: canonical(from), through_frontier: canonical(lastBody.through), subject_id: subject.subject_id, subject_sha256: subject.sha256,
        namespace_through: canonical(subject.namespace_frontier ?? lastBody.namespace_through ?? lastBody.through),
        source_batches: canonical(sourceBatches), new_sources: newCount, earlier_context_sources: earlierContext.length,
        previous_interpretation: canonical(lastModel), population_id: populationID, population_sha256: populationSHA,
        prepared_batch_id: preparedPins?.batch_id ?? "", request_id: preparedPins?.request_id ?? "",
        manifest_sha256: preparedPins?.manifest_sha256 ?? "", attempt_id: preparedPins?.attempt_id ?? "",
        method_manifest: canonical(method), budget_policy: canonical(budget) } })
    this.automatic.subjects.recordActivity({ subject_id: subject.subject_id, actor, phase: "preparation", outcome: "succeeded",
      detail: infer ? "Prepared one bounded exact increment; inference still requires qualified execution authority." : "No eligible change requires inference; retained only a deterministic coverage checkpoint." })
    return this.automatic.history.incrementalHead(actor.session_id, scope)!.id === batch.id
      ? this.automatic.history.incrementalHead(actor.session_id, scope)! : { state: "pending", reason: "concurrent-checkpoint" }
  }

  private async commit(actor: Actor, row: Metadata, interpreted: InterpretationRef | null,
    access: IncrementalInterpretationAccess, signal: AbortSignal): Promise<IncrementalInterpretationResult> {
    await this.checked(actor, access, signal)
    const frozen = this.automatic.history.frozenIncrement(row.id, actor.session_id)
    const claim = this.automatic.history.claim(row.id, "incremental-interpretation-" + randomUUID())
    if (claim.status === "complete") return { state: "complete", reason: null, batch_id: row.id, replayed: true, interpretation: interpreted }
    if (claim.status === "busy") return { state: "pending", reason: "checkpoint-claimed", batch_id: row.id, retry_at: claim.lease_until_ms }
    const body: Checkpoint = { format: "loom-incremental-interpretation-checkpoint/v1", kind: row.boundary.kind as Checkpoint["kind"],
      from_sequence: integer(row.boundary.from_sequence, 0), through_sequence: throughSequence(row), through: frontier(row, "through_frontier"),
      ...(typeof row.boundary.namespace_through === "string" ? { namespace_through: evaluationFrontier(parsed(row.boundary.namespace_through)) } : {}),
      subject: { subject_id: String(row.boundary.subject_id), sha256: String(row.boundary.subject_sha256) },
      source_batches: parsed(row.boundary.source_batches), new_sources: integer(row.boundary.new_sources, 0),
      earlier_context_sources: integer(row.boundary.earlier_context_sources, 0), interpretation: interpreted,
      previous_interpretation: parsed(row.boundary.previous_interpretation), processing_complete: true, objective_success: "not-assessed" }
    try {
      for (const member of frozen.members) this.automatic.history.checkpoint(claim.claim, member.key,
        { body: { format: "loom-incremental-interpretation-member/v1", checkpoint: row.id, interpretation: interpreted }, dependencies: [], qualifications })
      await this.checked(actor, access, signal)
      if (interpreted) {
        const current = this.automatic.history.readEvaluatorInterpretation(interpreted.batch_id, actor.session_id)
        if (!current || current.report.id !== interpreted.report_id || current.report.sha256 !== interpreted.report_sha256)
          throw new Error("S5 publication changed before incremental checkpoint")
      }
      this.automatic.history.publish(claim.claim, { body, dependencies: [], qualifications })
      return { state: "complete", reason: null, batch_id: row.id, interpretation: interpreted }
    } catch (error) {
      try { this.automatic.history.release(claim.claim, signal.aborted ? "cancelled" : "checkpoint-publication-failed") } catch { /* A committed publication is immutable, including a lost ACK. */ }
      throw error
    }
  }

  private continuation(actor: Actor, row: Metadata, config: IncrementalInterpretationConfig,
    result: IncrementalInterpretationResult): IncrementalInterpretationResult {
    const latest = this.automatic.history.incrementalHead(actor.session_id, INCREMENTAL_SCOPE, true)
    return result.state === "complete" && latest && latest.sequence > throughSequence(row)
      ? { ...result, retry_at: this.clock() + Math.max(1, row.boundary.kind === "interpreted" ? config.min_interval_ms : 0) } : result
  }

  /** Invoked only by the established Stage 3 opportunity loop. A pending exact
   * request is recovered before considering newly appended evidence. */
  async opportunity(actor: Actor, config: IncrementalInterpretationConfig, access: IncrementalInterpretationAccess,
    signal: AbortSignal): Promise<IncrementalInterpretationResult> {
    if (!config.enabled) return { state: "disabled", reason: "incremental-interpretation-disabled" }
    if (!config.method || !config.budget_policy) return { state: "blocked", reason: !config.method ? "method-not-configured" : "resource-policy-not-configured" }
    await this.checked(actor, access, signal)
    const state = this.heads(actor.session_id, config)
    const planned = state.head && state.head.id !== state.complete?.id ? state.head : await this.plan(actor, config, access, signal, state)
    if (!("boundary" in planned)) return planned
    const row = planned
    const subject = this.automatic.subjects.read(String(row.boundary.subject_id), actor.session_id, String(row.boundary.subject_sha256))
    const through = frontier(row, "through_frontier"), namespace = typeof row.boundary.namespace_through === "string"
      ? evaluationFrontier(parsed(row.boundary.namespace_through)) : through
    if (subject.origin.kind !== "automatic-checkpoint" || canonical(subject.origin.method) !== canonical(row.method)
      || canonical(subject.origin.after) !== canonical(frontier(row, "from_frontier")) || canonical(subject.through) !== canonical(through)
      || subject.namespace_frontier && (typeof row.boundary.namespace_through !== "string" || canonical(subject.namespace_frontier) !== canonical(namespace))
      || canonical(this.automatic.sources.namespaceThrough(actor.session_id, through, namespace)) !== canonical(namespace))
      throw new Error("Incremental interpretation namespace checkpoint changed")
    if (row.boundary.kind === "no-eligible-change") return this.continuation(actor, row, config, await this.commit(actor, row, null, access, signal))
    if (!this.execution) return { state: "blocked", reason: "evaluator-execution-authority-unavailable", batch_id: row.id }
    const retry = Date.parse(row.updated_at) + integer(config.min_interval_ms, 0, 86400000)
    if (row.state === "blocked" && this.clock() < retry) return { state: "waiting", reason: row.blocked_reason, batch_id: row.id, retry_at: retry }
    const selected = pins(row), start = this.clock()
    const population = this.automatic.history.retrospectivePopulation(String(row.boundary.population_id), actor.session_id)
    if (population.manifest_sha256 !== row.boundary.population_sha256) throw new Error("Incremental interpretation population changed")
    // This also repairs an interrupted preparation write, with the exact saved
    // method and policy. Current configuration never replaces pending inputs.
    await this.populations.validateForPreparation(actor, population, access.resolve)
    await this.checked(actor, access, signal)
    const prepared = this.preparation.prepareRetrospective(actor, population, parsed(row.boundary.method_manifest), parsed(row.boundary.budget_policy))
    if (prepared.batch_id !== selected.batch_id || prepared.request_id !== selected.request_id || prepared.manifest_sha256 !== selected.manifest_sha256
      || prepared.issue?.attempt.attempt_id !== selected.attempt_id) throw new Error("Incremental interpretation preparation changed")
    this.automatic.subjects.recordActivity({ subject_id: String(row.boundary.subject_id), actor, phase: "evaluation", outcome: "started",
      detail: "Attempted the existing qualified execution consumer for the retained exact increment." })
    try {
      const saved = this.automatic.history.readExecution(selected.batch_id, actor.session_id)
      const resumeReservation = saved?.receipts.at(-1)?.execution === "reserved" && !prepared.issue?.attempt.claimant_id
      const completed = saved && !resumeReservation ? await this.execution.recover(actor, selected) : await this.execution.execute(actor, selected, signal)
      signal.throwIfAborted()
      if (completed.receipt.execution !== "completed" || completed.receipt.budget !== "settled") {
        this.automatic.subjects.recordActivity({ subject_id: String(row.boundary.subject_id), actor, phase: "evaluation", outcome: "failed",
          elapsed_ms: Math.max(0, this.clock() - start), detail: "Execution remains " + completed.receipt.execution + "; cursor and frozen input retained." })
        const reason = "evaluator-execution-" + completed.receipt.execution
        try { this.automatic.history.block(row.id, reason) } catch { /* Another checkpoint claimant owns its current state. */ }
        const settling = ["reserved", "admitted", "unknown"].includes(completed.receipt.execution)
          || completed.receipt.execution === "completed"
        return { state: "blocked", reason, batch_id: row.id,
          ...(settling ? { retry_at: this.clock() + Math.max(1000, config.min_interval_ms) } : {}) }
      }
      const publication = await this.execution.publish(actor, selected, signal)
      const interpreted: InterpretationRef = { sequence: throughSequence(row), frontier: frontier(row, "through_frontier"),
        batch_id: selected.batch_id, report_id: publication.report_id, report_sha256: publication.report_sha256 }
      const committed = await this.commit(actor, row, interpreted, access, signal)
      this.automatic.subjects.recordActivity({ subject_id: String(row.boundary.subject_id), actor, phase: "publication", outcome: "succeeded",
        elapsed_ms: Math.max(0, this.clock() - start), detail: "S5 interpretation published and the method checkpoint committed outside the engineering conversation." })
      return this.continuation(actor, row, config, committed)
    } catch (error) {
      this.automatic.subjects.recordActivity({ subject_id: String(row.boundary.subject_id), actor, phase: "evaluation", outcome: signal.aborted ? "cancelled" : "failed",
        elapsed_ms: Math.max(0, this.clock() - start), detail: "Interpretation did not commit: " + (error instanceof Error ? error.message : String(error)).slice(0, 1000) })
      if (signal.aborted) throw error
      const reason = error instanceof Error ? error.message.slice(0, 500) : "incremental-interpretation-failed"
      try { this.automatic.history.block(row.id, reason) } catch { /* A successful concurrent/lost-ACK publication stays committed. */ }
      return { state: "blocked", reason, batch_id: row.id, retry_at: this.clock() + Math.max(1000, config.min_interval_ms) }
    }
  }
}
