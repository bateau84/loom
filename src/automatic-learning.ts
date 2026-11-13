import { randomUUID } from "node:crypto"
import { canonical, digest } from "./model.js"
import type { SQL, Store } from "./store.js"
import { EvaluationStore, type EvaluationMember, type EvaluationSourceRef } from "./evaluation-store.js"
import { LearningSources, type LearningSource } from "./learning-sources.js"

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

/** Optional deterministic preparation. This class cannot dispatch Evaluator or grant source access. */
export class AutomaticLearning {
  readonly sources: LearningSources
  readonly history: EvaluationStore
  private readonly worker = randomUUID()
  constructor(db: SQL, store: Store, actionDB: SQL) {
    this.sources = new LearningSources(store, actionDB, db)
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
  async run(session: string, authorize: () => Promise<void>, signal: AbortSignal): Promise<AutomaticResult> {
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
      for (const observation of unique.values()) {
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
}
