import { randomUUID } from "node:crypto"
import { canonical, digest, ProcessingBudget, ProcessingLimitError } from "./model.js"
import type { SQL, Store } from "./store.js"
import { EvaluationStore, type EvaluationBatch, type EvaluationMember, type EvaluationReport, type EvaluationSourceRef } from "./evaluation-store.js"
import { LearningSources, EMPTY_LEARNING_FRONTIER, type LearningFrontier, type LearningSource } from "./learning-sources.js"
import { EvaluationSubjects, evaluationFrontier, type EvaluationTarget } from "./evaluation-subject.js"

const METHOD = "descriptive-source-analysis/v2"
const INSTRUCTIONS = "Project existing authorized ledger, authored objective links and immutable review sources into observations, not native execution attestations. Keep correction relations and historical reviewed membership distinct; a partial re-review does not clear unreviewed work. Preserve authored versus observed outcomes, source order and scope. Preserve capture-gap flags, missing continuity and bounded attribution separately from processing completeness; count unique source records, never independent gap incidents or complete native history. Deduplicate evidence, not originating goals. Tool completion is not correctness. Skills observed before or after outcomes do not establish causal effect. No model, mutation, experiment or paid dispatch. Missing original sources invalidate dependent reports. Overall completion means all frozen members were processed, never objective success."
export const DESCRIPTIVE_METHOD = { id: METHOD, instruction_sha256: digest(INSTRUCTIONS) }
export const EVALUATOR_BLOCK = Object.freeze({ state: "blocked", reasons: ["native-provenance-unqualified", "protected-recipient-transfer-unqualified", "included-usage-route-unqualified"] })
const QUALIFICATIONS = ["descriptive-not-genuine-evaluator", "native-execution-binding-unknown", "source-occurrence-not-inferred-from-ingestion", "originating-request-independence-unknown", "metadata-is-not-original-tool-content"]
type ObservationCoverage = {
  capture_gap: boolean | null; attribution: string | null; attribution_excerpted: boolean;
  finish_pairing: "paired" | "unestablished" | "not-applicable";
}
type Observation = { source: EvaluationSourceRef; category: string; recorded_at: string | null; order: number; evidence: "observed-metadata" | "authored"; detail: string; work_scope: unknown; coverage?: ObservationCoverage; objective_context?: Record<string, unknown>; review_context?: Record<string, unknown> }
type MemberBody = { method: string; scope: "provisional-session-fragment"; observations: Observation[] }
export type AutomaticResult = { state: "empty" | "complete" | "pending" | "busy"; batch_id?: string; replayed?: boolean; retry_at?: number }
const mapping = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

function observationCoverage(data: Record<string, unknown>): ObservationCoverage {
  const attribution = typeof data.attribution === "string" ? data.attribution : null
  return {
    capture_gap: typeof data.capture_gap === "boolean" ? data.capture_gap : null,
    attribution: attribution === null ? null : attribution.slice(0, 200),
    attribution_excerpted: attribution !== null && attribution.length > 200,
    finish_pairing: data.phase !== "finished" ? "not-applicable"
      : attribution === "captured-at-start" ? "paired" : "unestablished",
  }
}

function project(source: LearningSource): Observation {
  const record = source.value, data = mapping(record.data), observed = record.kind === "observation"
  if (source.ref.kind === "objective" || source.ref.kind === "objective-link") {
    const header = source.ref.kind === "objective"
    return { source: source.ref, category: header ? "authored-objective" : "objective-" + record.phase + (record.assessment ? "-" + record.assessment : ""),
      recorded_at: typeof record.recorded_at === "string" ? record.recorded_at : String(record.created_at), order: source.sequence,
      evidence: "authored", detail: "An authored relationship, not certified goal independence, native execution or verified correctness.", work_scope: null,
      objective_context: header ? { objective_id: record.id, label: record.label, unit_key: record.unit_key, originating_source_key: record.source_key }
        : { objective_id: record.objective_id, phase: record.phase, assessment: record.assessment, related_sequence: record.related_sequence,
          source_type: record.source_type, source_id: record.source_id, source_session_id: record.source_session_id, source_at_ms: record.source_at_ms,
          confidence: record.confidence, gap_reason: record.gap_reason,
          original_content: record.source_type === "ledger-record" && record.source_session_id === source.ref.session_id ? "required-original-ledger" : "not-inspected" } }
  }
  if (source.ref.kind === "review-request" || source.ref.kind === "review-relationship") {
    const header = source.ref.kind === "review-request", request = mapping(record.request)
    return { source: source.ref, category: header ? "review-request" : record.declared_verdict ? "review-declared-" + record.declared_verdict : "review-" + record.relationship,
      recorded_at: null, order: source.sequence, evidence: "authored", work_scope: null,
      detail: "Frozen requested scope and qualified associations; a partial re-review never clears unreviewed work or establishes an exact native execution.",
      review_context: header ? { request_id: request.request_id, member_count: (request.members as unknown[]).length,
        frozen_work: record.frozen_work_membership, original_mandate_source: source.ref, rechecks: request.rechecks, native_execution: "unknown", protected_delivery: "withheld" }
        : { request_id: record.request_id, member_ids: record.member_ids, relationship: record.relationship, declared_verdict: record.declared_verdict ?? null,
          verdict_scope: record.verdict_scope ?? null, supersedes: record.supersedes ?? null, relationship_attribution: record.relationship_attribution,
          source_producer: record.source_producer, native_execution: "unknown" } }
  }
  let category = "authored-record", detail = "Authored record; read the original before interpreting its content."
  if (observed) {
    category = "observed-metadata"; detail = "Bounded host observation; neither original content nor exact native review attribution."
    if (data.phase === "finished" && data.status === "error") { category = "tool-error"; detail = "The observed tool returned an error; this alone does not establish objective failure." }
    if (data.phase === "finished" && data.status === "completed") { category = "tool-completed"; detail = "The observed tool returned successfully; this is not proof of a correct result." }
    if (["skill-load-result", "companion-load-result", "agent-context-snapshot"].includes(String(data.phase))) {
      category = "practice-observation"; detail = "Instruction or skill observation; provider exposure, application and causal effect remain unknown."
    }
  } else if (record.kind === "completion") { category = "reported-completion"; detail = "The producer reported completion; independent verification is not established by this record." }
  else if (record.kind === "reopen" || record.kind === "concern") { category = "reported-concern"; detail = "An authored concern or reopening qualifies an earlier completion claim; its original scope must be checked." }
  return { source: source.ref, category, recorded_at: typeof record.created_at === "string" ? record.created_at : null,
    order: source.sequence, evidence: observed ? "observed-metadata" : "authored", detail,
    work_scope: data.work_scope ?? null, ...(observed ? { coverage: observationCoverage(data) } : {}) }
}

export const INCREMENTAL_METHOD = { id: "incremental-source-analysis/v1", instruction_sha256: digest(
  "Process bounded new eligible original sources through an established exact subject. Preserve independent owner frontiers, explicit method checkpoints, earlier concerns and exact unmatched starts. Learning-purpose sources and their causal descendants are excluded. Completed processing or idle is not completion or correctness. Exact later classification may withdraw learning activity, never erase original reports or skip unavailable engineering evidence. No model or original-conversation injection.") }
export const INCREMENTAL_SCOPE = "incremental-session-evidence/" + digest(INCREMENTAL_METHOD)
export const INCREMENTAL_RETAINED_LIMIT = 4000
const INCREMENTAL_QUALIFICATIONS = [...QUALIFICATIONS, "idle-is-not-completion", "source-frontiers-are-independent",
  "earlier-reports-remain-immutable", "retained-concerns-are-not-independent-objectives", "unsupported-native-history-is-not-crawled"]
export type IncrementOrigin = { batch_id: string; member_key: string; source_index: number }
export type RetainedObservation = { source: EvaluationSourceRef; category: string; detail: string; recorded_at: string | null; origin: IncrementOrigin }
export type IncrementRetained = { concerns: RetainedObservation[]; unfinished: RetainedObservation[] }
type IncrementObservation = Observation & { origin: IncrementOrigin; phase: string | null; paired_start_id: string | null }
export type IncrementReportBody = {
  format: "loom-incremental-learning-report/v1"; method: string; subject: { subject_id: string; sha256: string }; target: EvaluationTarget;
  previous: { batch_id: string; report_id: string; sha256: string } | null; from: LearningFrontier; through: LearningFrontier; observed: LearningFrontier;
  new_sources: number; excluded_sources: number; examined_sources: number; withdrawn_learning_sources: EvaluationSourceRef[];
  earlier_context_sources: number; observations: Record<string, number>; retained: IncrementRetained;
  processing_complete: true; objective_success: "not-assessed"; interpretation: string; qualifications: string[];
}
function incrementInteger(value: unknown, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error("Invalid incremental " + name)
  return value as number
}
const sameFrontier = (a: LearningFrontier, b: LearningFrontier) => canonical(a) === canonical(b)
const encodeFrontier = (prefix: string, frontier: LearningFrontier) => Object.fromEntries(Object.entries(frontier).map(([key, value]) => [prefix + "_" + key, value]))
function frontierFromBoundary(boundary: Record<string, number | string>, prefix: string): LearningFrontier {
  return evaluationFrontier(Object.fromEntries(Object.keys(EMPTY_LEARNING_FRONTIER).map(key => [key, boundary[prefix + "_" + key]])))
}
function parseIncrementBody(value: unknown): IncrementReportBody {
  const body = mapping(value), retained = mapping(body.retained)
  if (body.format !== "loom-incremental-learning-report/v1" || body.method !== INCREMENTAL_METHOD.id
    || !Array.isArray(retained.concerns) || !Array.isArray(retained.unfinished)
    || retained.concerns.length + retained.unfinished.length > INCREMENTAL_RETAINED_LIMIT)
    throw new Error("Incremental report body unavailable")
  evaluationFrontier(body.from); evaluationFrontier(body.through); evaluationFrontier(body.observed)
  return value as IncrementReportBody
}
function incrementObservation(source: LearningSource, origin: IncrementOrigin): IncrementObservation {
  const observation = project(source), data = mapping(source.value.data), phase = typeof data.phase === "string" ? data.phase : null
  if (source.value.kind === "qa" && (data.verdict === "pass" || data.verdict === "fail")) observation.category = "reported-verification-" + data.verdict
  const statement = [data.statement, data.summary, data.reason].find(value => typeof value === "string" && value.trim())
  if (typeof statement === "string") observation.detail = "Authored record: " + statement.slice(0, 1000)
  return { ...observation, origin, phase,
    paired_start_id: phase === "finished" && data.attribution === "captured-at-start" && typeof data.start_id === "string" ? data.start_id : null }
}
const isConcern = (category: string) => ["tool-error", "reported-concern", "reported-verification-fail", "review-declared-fail", "objective-verification-fail", "objective-outcome-fail"].includes(category)
function retainedView(item: RetainedObservation) {
  return { ...item, inspect: { operation: "learning-source", batch_id: item.origin.batch_id, member_key: item.origin.member_key, source_index: item.origin.source_index } }
}
function incrementSummary(body: IncrementReportBody, batchID: string) {
  return { ...body, retained: {
    concerns: body.retained.concerns.slice(0, 8).map(retainedView), unfinished: body.retained.unfinished.slice(0, 8).map(retainedView),
    concern_count: body.retained.concerns.length, unfinished_count: body.retained.unfinished.length,
    concerns_next: body.retained.concerns.length > 8 ? { operation: "learning-report", batch_id: batchID, section: "concerns", after: 8 } : null,
    unfinished_next: body.retained.unfinished.length > 8 ? { operation: "learning-report", batch_id: batchID, section: "unfinished", after: 8 } : null,
  }, previous: body.previous ? { ...body.previous, inspect: { operation: "learning-report", batch_id: body.previous.batch_id } } : null }
}
function boundedIncrementRead<T>(value: T): T {
  // Reserve HTML escaping/navigation space rather than measuring raw JSON alone.
  canonical(value, new ProcessingBudget(60000, 10000))
  return value
}

/** Optional deterministic preparation. This class cannot dispatch Evaluator or grant source access. */
export class AutomaticLearning {
  readonly sources: LearningSources
  readonly history: EvaluationStore
  readonly subjects: EvaluationSubjects
  private readonly worker = randomUUID()
  constructor(db: SQL, store: Store, actionDB: SQL) {
    this.sources = new LearningSources(store, actionDB, db)
    this.subjects = new EvaluationSubjects(db, this.sources)
    this.history = new EvaluationStore(db, (ref, namespace) => this.sources.resolve(ref, namespace) !== null)
  }

  private analyze(member: EvaluationMember): MemberBody {
    const observations = member.source_refs.map(ref => {
      const source = this.sources.resolve(ref, this.sources.namespace)
      if (!source) throw new Error("Original learning source unavailable")
      return project(source)
    })
    return { method: METHOD, scope: "provisional-session-fragment", observations }
  }

  /** One bounded quantum; repeated calls resume durable checkpoints without another idle event. */
  async run(session: string, authorize: () => Promise<void>, signal: AbortSignal, options?: { incremental?: boolean; max_sources?: number }): Promise<AutomaticResult> {
    if (options?.incremental) return this.runIncrement(session, authorize, signal, options.max_sources)
    signal.throwIfAborted()
    await authorize()
    signal.throwIfAborted()
    // Finish the already frozen population before selecting later arrivals.
    // A restart must not turn durable partial work into an abandoned prefix.
    let batch = this.history.nextUnfinished(session, "permitted-session-evidence")
    if (batch && canonical(batch.method) !== canonical(DESCRIPTIVE_METHOD)) {
      this.history.block(batch.id, "evaluation-method-changed")
      batch = null
    }
    if (!batch) {
      const frozen = this.sources.snapshot(session)
      if (!frozen.members.length) return { state: "empty" }
      batch = this.history.freeze({ owner_session: session, scope_key: "permitted-session-evidence", source_store_id: this.sources.namespace,
        boundary: frozen.boundary, method: DESCRIPTIVE_METHOD, members: frozen.members })
    }
    if (batch.previous_batch_id) this.history.invalidate(batch.previous_batch_id, session, "later-authorized-source-boundary")
    const acquisition = this.history.claim(batch.id, this.worker)
    if (acquisition.status === "complete") {
      if (batch.state === "incomplete") throw new Error("Completed evaluation is no longer source-retrievable")
      return { state: "complete", batch_id: batch.id, replayed: true }
    }
    if (acquisition.status === "busy") return { state: "busy", batch_id: batch.id, retry_at: acquisition.lease_until_ms }
    const claim = acquisition.claim
    const reusablePrevious = batch.previous_batch_id && canonical(this.history.get(batch.previous_batch_id, session).method) === canonical(DESCRIPTIVE_METHOD)
      ? batch.previous_batch_id : undefined
    let checkingPermission = false
    try {
      const page = this.history.members(batch.id, session, { limit: 20, pending_only: true })
      for (const member of page.items) {
        signal.throwIfAborted()
        let body: unknown
        if (reusablePrevious) {
          const prior = this.history.report(reusablePrevious, session, member.key)
          if (prior?.availability === "available" && canonical(prior.source_refs) === canonical(member.source_refs)) body = prior.body
        }
        body ??= this.analyze(member)
        this.history.checkpoint(claim, member.key, { body, dependencies: [], qualifications: QUALIFICATIONS })
      }
      if (page.next_after !== null) {
        this.history.release(claim, "bounded-quantum-complete")
        return { state: "pending", batch_id: batch.id }
      }
      // Native authorization can change while asynchronous work was in flight.
      checkingPermission = true
      await authorize()
      signal.throwIfAborted()
      checkingPermission = false
      const unique = new Map<string, Observation>()
      let after = 0
      for (;;) {
        const reports = this.history.reports(batch.id, session, { after, limit: 100 })
        for (const member of reports.items) {
          if (member.report?.availability !== "available") throw new Error("Frozen member report is unavailable")
          const body = member.report.body as MemberBody
          for (const observation of body.observations) unique.set(observation.source.kind + ":" + observation.source.id, observation)
        }
        if (reports.next_after === null) break
        after = reports.next_after
      }
      const counts: Record<string, number> = {}, evidence: Record<string, string[]> = {}
      const coverage = { complete_native_history: false, observation_records: 0, capture_gap_flagged_records: 0,
        unknown_capture_continuity_records: 0, unestablished_finish_records: 0,
        qualification: "Counts describe unique original observation records, not distinct gap incidents. Processing every frozen member does not establish complete native capture or history." }
      for (const observation of [...unique.values()].sort((a, b) => a.source.kind.localeCompare(b.source.kind) || a.order - b.order)) {
        counts[observation.category] = (counts[observation.category] ?? 0) + 1
        const sample = evidence[observation.category] ??= []
        if (sample.length < 8) sample.push(observation.source.id)
        if (observation.coverage) {
          coverage.observation_records++
          if (observation.coverage.capture_gap === true) coverage.capture_gap_flagged_records++
          if (observation.coverage.capture_gap === null) coverage.unknown_capture_continuity_records++
          if (observation.coverage.finish_pairing === "unestablished") coverage.unestablished_finish_records++
        }
      }
      const mixed = !!counts["reported-completion"] && (!!counts["tool-error"] || !!counts["reported-concern"])
      const body = { method: METHOD, scope: "permitted-session-population", objective_success: "not-assessed", genuine_evaluator: EVALUATOR_BLOCK,
        population: { complete_through_frozen_boundary: true, members: batch.member_count, source_count: unique.size, authored_objectives: counts["authored-objective"] ?? 0, independent_originating_requests: null },
        observations: counts, coverage, evidence_examples: evidence, evidence_examples_are_exhaustive: false,
        interpretation: mixed ? "Reported completion coexists with errors or concerns. These may describe correction within one goal, not independent successes or failures. Inspect the linked originals before drawing an outcome conclusion."
          : "This is a source-linked provisional description, not a judgement of engineering correctness or objective satisfaction.",
        recommendation: "No canonical change is justified by deterministic metadata analysis alone.",
        gaps: ["Original tool arguments/results and native histories were not newly collected.", "Cross-Session source access and complete objective coverage are not established.", "Practice timing and association do not establish causality."] }
      this.history.publish(claim, { body, dependencies: [], qualifications: QUALIFICATIONS })
      return { state: "complete", batch_id: batch.id }
    } catch (error) {
      try {
        if (signal.aborted || checkingPermission) this.history.release(claim, signal.aborted ? "cancelled" : "permission-unavailable")
        else this.history.block(batch.id, "original-source-or-checkpoint-unavailable", claim)
      } catch { /* A lost commit acknowledgement or newer lease must not be undone. */ }
      throw error
    }
  }
  /** Durable, bounded increments share EvaluationStore checkpoints and claims.
   * The legacy run path remains available for v1 complete-population consumers. */
  async runIncrement(session: string, authorize: () => Promise<void>, signal: AbortSignal, maxSources = 128): Promise<AutomaticResult> {
    const limit = incrementInteger(maxSources, 1, 1000, "source limit")
    signal.throwIfAborted()
    await authorize()
    signal.throwIfAborted()
    if (this.sources.isEvaluationSession(session)) return { state: "empty" }
    const head = this.history.incrementalHead(session, INCREMENTAL_SCOPE)
    const previous = this.history.incrementalHead(session, INCREMENTAL_SCOPE, true)
    const captured = this.sources.captureFrontier(session), classification = this.sources.classificationBoundary(session)
    if (head?.published_state === "complete" && head.id === previous?.id
      && sameFrontier(frontierFromBoundary(head.boundary, "through"), captured)
      && head.boundary.classification_sequence === classification)
      return { state: "complete", batch_id: head.id, replayed: true }
    let previousReport: EvaluationReport | null = null, withdrawn: EvaluationSourceRef[] = []
    let retained: IncrementRetained = { concerns: [], unfinished: [] }
    if (previous) {
      previousReport = this.history.report(previous.id, session)
      if (!previousReport) throw new Error("Committed incremental checkpoint is missing")
      if (previousReport.availability !== "available")
        previousReport = this.history.incrementalRecoveryReport(previous.id, session, ref => this.sources.isEvaluation(ref))
      const body = parseIncrementBody(previousReport.body)
      withdrawn = previousReport.source_refs.filter(ref => this.sources.isEvaluation(ref))
      retained = {
        concerns: body.retained.concerns.filter(item => !this.sources.isEvaluation(item.source)),
        unfinished: body.retained.unfinished.filter(item => !this.sources.isEvaluation(item.source)),
      }
    }
    const from = previous ? frontierFromBoundary(previous.boundary, "through") : { ...EMPTY_LEARNING_FRONTIER }
    let batch: Pick<EvaluationBatch, "id" | "source_store_id" | "boundary" | "method" | "published_state"> | null = head && head.published_state !== "complete" ? head : null
    // A classified wrapper may have been frozen before its inner purpose became
    // known. Keep that failed batch immutable; reselect from the last success
    // only when EVERY unavailable source has exact learning-purpose provenance.
    if (batch?.published_state === "blocked") {
      const frozen = this.history.frozenIncrement(batch.id, session)
      const unavailable = frozen.members.flatMap(member => member.source_refs)
        .filter(ref => this.sources.resolve(ref, frozen.source_store_id) === null)
      if (unavailable.length && unavailable.every(ref => this.sources.isEvaluation(ref))) batch = null
    }
    if (!batch) {
      const observed = captured
      if (sameFrontier(from, observed) && withdrawn.length === 0)
        return previous ? { state: "complete", batch_id: previous.id, replayed: true } : { state: "empty" }
      // Establish a durable exact subject BEFORE selecting or interpreting any
      // originals. A late append can only be considered by the next increment.
      const subject = this.subjects.establishAutomatic(session, INCREMENTAL_METHOD, from)
      const selected = this.sources.selectIncrement(session, from, subject.through, limit)
      if (sameFrontier(from, selected.through) && !withdrawn.length)
        return previous ? { state: "complete", batch_id: previous.id, replayed: true } : { state: "empty" }
      const boundary: Record<string, number | string> = {
        subject_id: subject.subject_id, subject_sha256: subject.sha256, classification_sequence: classification,
        previous_checkpoint: previous?.id ?? "", new_sources: selected.eligible,
        excluded_sources: selected.excluded, examined_sources: selected.examined,
        withdrawn_sha256: digest(withdrawn), ...encodeFrontier("from", from),
        ...encodeFrontier("through", selected.through), ...encodeFrontier("observed", subject.through),
      }
      try {
        batch = this.history.freeze({ owner_session: session, scope_key: INCREMENTAL_SCOPE, source_store_id: this.sources.namespace,
          method: INCREMENTAL_METHOD, boundary, expected_previous_batch_id: head?.id ?? null,
          // An excluded-only checkpoint records cursor progress without inventing
          // evidence or a historical objective. This member has no source refs.
          members: selected.members.length ? selected.members : [{ key: "session:" + session + ":empty", kind: "session", source_refs: [] }] })
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Incremental checkpoint changed")) return { state: "pending" }
        throw error
      }
    }
    if (!batch || batch.source_store_id !== this.sources.namespace || canonical(batch.method) !== canonical(INCREMENTAL_METHOD))
      throw new Error("Incremental method or source owner changed")
    const subject = this.subjects.read(String(batch.boundary.subject_id), session, String(batch.boundary.subject_sha256))
    if (subject.origin.kind !== "automatic-checkpoint" || canonical(subject.origin.method) !== canonical(INCREMENTAL_METHOD)
      || !sameFrontier(subject.origin.after, frontierFromBoundary(batch.boundary, "from")))
      throw new Error("Incremental subject origin mismatch")
    if (String(batch.boundary.previous_checkpoint) !== (previous?.id ?? "")) throw new Error("Incremental successful checkpoint changed")
    const acquisition = this.history.claim(batch.id, this.worker)
    if (acquisition.status === "busy") return { state: "busy", batch_id: batch.id, retry_at: acquisition.lease_until_ms }
    if (acquisition.status === "complete") return { state: "complete", batch_id: batch.id, replayed: true }
    const claim = acquisition.claim, startedAt = performance.now()
    let checkingPermission = false
    const audit = (outcome: "started" | "succeeded" | "failed" | "cancelled") => this.subjects.recordActivity({
      subject_id: subject.subject_id, actor: { session_id: session, agent: "automatic-learning" }, phase: "evaluation", outcome,
      elapsed_ms: Math.max(0, Math.floor(performance.now() - startedAt)), detail: "Bounded deterministic increment; no model dispatch or original-conversation injection.",
    })
    try {
      audit("started")
      const page = this.history.members(batch.id, session, { limit: 20, pending_only: true })
      for (const member of page.items) {
        signal.throwIfAborted()
        const observations = member.source_refs.map((ref, source_index) => {
          const original = this.sources.resolve(ref, this.sources.namespace)
          if (!original) throw new Error("Original learning source unavailable")
          return incrementObservation(original, { batch_id: batch!.id, member_key: member.key, source_index })
        })
        this.history.checkpoint(claim, member.key, { body: { method: INCREMENTAL_METHOD.id, scope: "incremental-session-fragment", observations },
          dependencies: [], qualifications: INCREMENTAL_QUALIFICATIONS })
      }
      if (page.next_after !== null) {
        this.history.release(claim, "bounded-quantum-complete")
        audit("succeeded")
        return { state: "pending", batch_id: batch.id }
      }
      checkingPermission = true
      await authorize()
      signal.throwIfAborted()
      checkingPermission = false
      const observations: IncrementObservation[] = []
      let after = 0
      for (;;) {
        const reports = this.history.reports(batch.id, session, { after, limit: 100 })
        for (const member of reports.items) {
          if (member.report?.availability !== "available") throw new Error("Frozen incremental member unavailable")
          const body = member.report.body as { observations: IncrementObservation[] }
          observations.push(...body.observations)
        }
        if (reports.next_after === null) break
        after = reports.next_after
      }
      const counts: Record<string, number> = {}, unique = new Map<string, IncrementObservation>()
      for (const observation of observations) unique.set(canonical(observation.source), observation)
      const concerns = new Map(retained.concerns.map(item => [canonical(item.source), item]))
      const unfinished = new Map(retained.unfinished.map(item => [item.source.id, item]))
      for (const observation of [...unique.values()].sort((a, b) => a.source.kind.localeCompare(b.source.kind) || a.order - b.order)) {
        counts[observation.category] = (counts[observation.category] ?? 0) + 1
        const item: RetainedObservation = { source: observation.source, category: observation.category,
          detail: observation.detail.slice(0, 300), recorded_at: observation.recorded_at, origin: observation.origin }
        if (isConcern(observation.category)) concerns.set(canonical(observation.source), item)
        if (observation.phase === "started") unfinished.set(observation.source.id, item)
        if (observation.paired_start_id !== null) unfinished.delete(observation.paired_start_id)
      }
      if (concerns.size + unfinished.size > INCREMENTAL_RETAINED_LIMIT)
        throw new ProcessingLimitError("Retained incremental work exceeds the supported bound; no checkpoint was advanced")
      retained = { concerns: [...concerns.values()], unfinished: [...unfinished.values()] }
      const context = [...retained.concerns, ...retained.unfinished].filter(item => item.origin.batch_id !== batch!.id)
      const body: IncrementReportBody = {
        format: "loom-incremental-learning-report/v1", method: INCREMENTAL_METHOD.id,
        subject: { subject_id: subject.subject_id, sha256: subject.sha256 }, target: subject.target,
        previous: previousReport ? { batch_id: previousReport.batch_id, report_id: previousReport.id, sha256: previousReport.sha256 } : null,
        from: frontierFromBoundary(batch.boundary, "from"), through: frontierFromBoundary(batch.boundary, "through"),
        observed: frontierFromBoundary(batch.boundary, "observed"), new_sources: Number(batch.boundary.new_sources),
        excluded_sources: Number(batch.boundary.excluded_sources), examined_sources: Number(batch.boundary.examined_sources),
        withdrawn_learning_sources: withdrawn, earlier_context_sources: new Set(context.map(item => canonical(item.source))).size,
        observations: counts, retained, processing_complete: true, objective_success: "not-assessed",
        interpretation: "This checkpoint describes newly eligible recorded evidence and retained concerns. Idle and completed processing do not establish engineering completion. A later passing check does not erase an unrelated earlier finding.",
        qualifications: INCREMENTAL_QUALIFICATIONS,
      }
      this.history.publish(claim, { body, dependencies: context.map(item => item.source), qualifications: INCREMENTAL_QUALIFICATIONS })
      audit("succeeded")
      return { state: "complete", batch_id: batch.id }
    } catch (error) {
      try {
        if (signal.aborted || checkingPermission) this.history.release(claim, signal.aborted ? "cancelled" : "permission-unavailable")
        else this.history.block(batch.id, "original-source-or-checkpoint-unavailable", claim)
      } catch { /* A committed checkpoint or newer lease must not be undone. */ }
      try { audit(signal.aborted ? "cancelled" : "failed") } catch { /* Preserve the original processing failure. */ }
      throw error
    }
  }

  /** Source-owned exact originals, never a transcript crawler or summary-only read. */
  incrementSource(session: string, batchID: string, memberKey: string, sourceIndex: number,
    input: { after?: number; max_chars?: number } = {}) {
    const frozen = this.history.frozenIncrement(batchID, session)
    if (frozen.source_store_id !== this.sources.namespace || canonical(frozen.method) !== canonical(INCREMENTAL_METHOD))
      throw new Error("Incremental evaluation unavailable")
    const member = frozen.members.find(item => item.key === memberKey)
    const index = incrementInteger(sourceIndex, 0, 31, "source index"), ref = member?.source_refs[index]
    if (!ref) throw new Error("Incremental original unavailable")
    const after = incrementInteger(input.after ?? 0, 0, Number.MAX_SAFE_INTEGER, "original cursor"),
      maxChars = incrementInteger(input.max_chars ?? 16000, 1, 16000, "original page")
    const original = this.sources.resolve(ref, frozen.source_store_id), serialized = original ? canonical(original.value) : null
    if (serialized !== null && after > serialized.length) throw new Error("Incremental original cursor unavailable")
    const whole = serialized !== null && after === 0 && serialized.length <= maxChars
    const end = serialized === null ? 0 : Math.min(serialized.length, after + maxChars), next = serialized !== null && end < serialized.length ? end : null
    return boundedIncrementRead({ format: "loom-incremental-learning-source/v1", batch_id: batchID, member_key: memberKey, source_index: index,
      source: ref, availability: original ? "available" : "source-unavailable", value: whole ? original!.value : null,
      fragment: original && serialized !== null && !whole ? { encoding: "canonical-json", after, text: serialized.slice(after, end), total_chars: serialized.length } : null,
      next_after: next, next: next === null ? null : { operation: "learning-source", batch_id: batchID, member_key: memberKey, source_index: index, after: next, max_chars: maxChars },
      qualification: "Recorded original; source availability does not independently establish the authored claim. Fragment cursors count UTF-16 characters of the canonical original JSON." })
  }

  incrementReport(session: string, batchID: string, input: { section?: "summary" | "concerns" | "unfinished"; after?: number; limit?: number } = {}) {
    const frozen = this.history.frozenIncrement(batchID, session), report = this.history.report(batchID, session)
    const section = input.section ?? "summary"
    if (!["summary", "concerns", "unfinished"].includes(section)) throw new Error("Invalid incremental report section")
    const after = incrementInteger(input.after ?? 0, 0, Number.MAX_SAFE_INTEGER, "report cursor"),
      limit = incrementInteger(input.limit ?? 20, 1, 100, "report page")
    const base = { format: "loom-incremental-learning-report-view/v1", batch_id: batchID,
      subject_id: frozen.boundary.subject_id, section, report_id: report?.id ?? null, report_sha256: report?.sha256 ?? null,
      availability: report?.availability ?? "not-published", navigation: { progress: { operation: "learning-progress" } } }
    if (!report || report.availability !== "available") return { ...base, body: null, items: [], next_after: null }
    const body = parseIncrementBody(report.body)
    if (section === "summary") return boundedIncrementRead({ ...base, body: incrementSummary(body, batchID), items: [], next_after: null })
    const all = body.retained[section]
    if (after > all.length) throw new Error("Incremental report cursor unavailable")
    const items: Array<ReturnType<typeof retainedView>> = []
    for (const item of all.slice(after, after + limit)) {
      const candidate = { ...base, items: [...items, retainedView(item)], count: all.length, next_after: after + items.length + 1 }
      try { boundedIncrementRead(candidate) } catch (error) { if (items.length && error instanceof ProcessingLimitError) break; throw error }
      items.push(retainedView(item))
    }
    const next = after + items.length < all.length ? after + items.length : null
    return boundedIncrementRead({ ...base, body: null, items, count: all.length, next_after: next,
      next: next === null ? null : { operation: "learning-report", batch_id: batchID, section, after: next, limit } })
  }

  incrementProgress(session: string, input: { before?: number; limit?: number } = {}) {
    const before = incrementInteger(input.before ?? Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER, "progress cursor"),
      limit = incrementInteger(input.limit ?? 5, 1, 20, "progress page")
    const observed = this.sources.captureFrontier(session), latest = this.history.latestInScope(session, INCREMENTAL_SCOPE),
      successful = this.history.latestInScope(session, INCREMENTAL_SCOPE, true)
    const committed = successful ? frontierFromBoundary(successful.boundary, "through") : { ...EMPTY_LEARNING_FRONTIER }
    const page = this.history.listScope(session, INCREMENTAL_SCOPE, { before, limit, direction: "desc" })
    const items = page.items.map(batch => ({ batch,
      inspect: { operation: "learning-report", batch_id: batch.id },
      report: this.incrementReport(session, batch.id).body ?? null }))
    const nextBefore = page.next_after
    return boundedIncrementRead({ format: "loom-incremental-learning-progress/v1", session_id: session,
      target: { kind: "session", id: session }, method: INCREMENTAL_METHOD,
      state: !latest ? "empty" : latest.state === "incomplete" || latest.published_state === "blocked" ? "blocked" : latest?.published_state === "processing" ? "processing"
        : latest?.published_state === "pending" ? "pending" : sameFrontier(observed, committed) ? "caught-up" : "pending",
      observed, committed, latest_successful_batch_id: successful?.id ?? null, latest_batch_id: latest?.id ?? null,
      inference: { state: "unavailable", reasons: EVALUATOR_BLOCK.reasons },
      items, next_before: nextBefore, next: nextBefore === null ? null : { operation: "learning-progress", before: nextBefore, limit },
      qualifications: INCREMENTAL_QUALIFICATIONS })
  }

}
