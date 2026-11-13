import { randomUUID } from "node:crypto"
import { canonical, digest } from "./model.js"
import type { SQL, Store } from "./store.js"
import { EvaluationStore, type EvaluationMember, type EvaluationSourceRef } from "./evaluation-store.js"
import { LearningSources, type LearningSource } from "./learning-sources.js"

const METHOD = "descriptive-source-analysis/v1"
const INSTRUCTIONS = "Project existing authorized originals into observations, not native execution attestations. Preserve authored versus observed outcomes, source order and scope. Deduplicate evidence, not originating goals. Tool completion is not correctness. Skills observed before or after outcomes do not establish causal effect. No model, mutation, experiment or paid dispatch. Missing original sources invalidate dependent reports. Overall completion means all frozen members were processed, never objective success."
export const DESCRIPTIVE_METHOD = { id: METHOD, instruction_sha256: digest(INSTRUCTIONS) }
export const EVALUATOR_BLOCK = Object.freeze({ state: "blocked", reasons: ["native-provenance-unqualified", "protected-recipient-transfer-unqualified", "included-usage-route-unqualified"] })
const QUALIFICATIONS = ["descriptive-not-genuine-evaluator", "native-execution-binding-unknown", "source-occurrence-not-inferred-from-ingestion", "originating-request-independence-unknown", "metadata-is-not-original-tool-content"]
type Observation = { source: EvaluationSourceRef; category: string; recorded_at: string | null; order: number; evidence: "observed-metadata" | "authored"; detail: string; work_scope: unknown }
type MemberBody = { method: string; scope: "provisional-session-fragment"; observations: Observation[] }
export type AutomaticResult = { state: "empty" | "complete" | "pending" | "busy"; batch_id?: string }
const mapping = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

function project(source: LearningSource): Observation {
  const record = source.value, data = mapping(record.data), observed = record.kind === "observation"
  let category = "authored-record", detail = "Authored record; read the original before interpreting its content."
  if (observed) {
    category = "observed-metadata"; detail = "Bounded host observation; neither original content nor exact native review attribution."
    if (data.phase === "finished" && data.status === "error") { category = "tool-error"; detail = "The observed tool returned an error; this alone does not establish objective failure." }
    if (data.phase === "finished" && data.status === "completed") { category = "tool-completed"; detail = "The observed tool returned successfully; this is not proof of a correct result." }
    if (["skill-load-result", "companion-load-result", "agent-instructions"].includes(String(data.phase))) {
      category = "practice-observation"; detail = "Instruction or skill observation; provider exposure, application and causal effect remain unknown."
    }
  } else if (record.kind === "completion") { category = "reported-completion"; detail = "The producer reported completion; independent verification is not established by this record." }
  else if (record.kind === "reopen" || record.kind === "concern") { category = "reported-concern"; detail = "An authored concern or reopening qualifies an earlier completion claim; its original scope must be checked." }
  return { source: source.ref, category, recorded_at: typeof record.created_at === "string" ? record.created_at : null,
    order: source.sequence, evidence: observed ? "observed-metadata" : "authored", detail,
    work_scope: data.work_scope ?? null }
}

/** Optional deterministic preparation. This class cannot dispatch Evaluator or grant source access. */
export class AutomaticLearning {
  readonly sources: LearningSources
  readonly history: EvaluationStore
  private readonly worker = randomUUID()
  constructor(db: SQL, store: Store, actionDB: SQL) {
    this.sources = new LearningSources(store, actionDB)
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
    const frozen = this.sources.snapshot(session)
    if (!frozen.members.length) return { state: "empty" }
    const batch = this.history.freeze({ owner_session: session, scope_key: "permitted-session-evidence", source_store_id: this.sources.namespace,
      boundary: frozen.boundary, method: DESCRIPTIVE_METHOD, members: frozen.members })
    if (batch.previous_batch_id) this.history.invalidate(batch.previous_batch_id, session, "later-authorized-source-boundary")
    const acquisition = this.history.claim(batch.id, this.worker)
    if (acquisition.status !== "claimed") return { state: acquisition.status, batch_id: batch.id }
    const claim = acquisition.claim
    try {
      const page = this.history.members(batch.id, session, { limit: 20, pending_only: true })
      for (const member of page.items) {
        signal.throwIfAborted()
        let body: unknown
        if (batch.previous_batch_id) {
          const prior = this.history.report(batch.previous_batch_id, session, member.key)
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
      await authorize()
      signal.throwIfAborted()
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
      for (const observation of unique.values()) {
        counts[observation.category] = (counts[observation.category] ?? 0) + 1
        const sample = evidence[observation.category] ??= []
        if (sample.length < 8) sample.push(observation.source.id)
      }
      const mixed = !!counts["reported-completion"] && (!!counts["tool-error"] || !!counts["reported-concern"])
      const body = { method: METHOD, scope: "permitted-session-population", objective_success: "not-assessed", genuine_evaluator: EVALUATOR_BLOCK,
        population: { complete_through_frozen_boundary: true, members: batch.member_count, source_count: unique.size, independent_originating_requests: null },
        observations: counts, evidence_examples: evidence, evidence_examples_are_exhaustive: false,
        interpretation: mixed ? "Reported completion coexists with errors or concerns. These may describe correction within one goal, not independent successes or failures. Inspect the linked originals before drawing an outcome conclusion."
          : "This is a source-linked provisional description, not a judgement of engineering correctness or objective satisfaction.",
        recommendation: "No canonical change is justified by deterministic metadata analysis alone.",
        gaps: ["Original tool arguments/results and native histories were not newly collected.", "Cross-Session source access and complete objective coverage are not established.", "Practice timing and association do not establish causality."] }
      this.history.publish(claim, { body, dependencies: [], qualifications: QUALIFICATIONS })
      return { state: "complete", batch_id: batch.id }
    } catch (error) {
      try { this.history.release(claim, signal.aborted ? "cancelled" : "processing-failed") } catch { /* A lost commit acknowledgement or newer lease must not be undone. */ }
      throw error
    }
  }
}
