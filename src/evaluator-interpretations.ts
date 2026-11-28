import { canonical, ProcessingBudget, uid, type Actor } from "./model.js"
import type { EvaluationStore, EvaluatorInterpretationRecord } from "./evaluation-store.js"
import { evaluatorInterpretationOriginals, evaluatorPriorReports, type EvaluatorPublication } from "./evaluator-publication.js"
import { evaluatorInterpretationSources, paginateEvaluatorInterpretation } from "./evaluator-interpretation-view.js"
import type { RetrospectivePopulations, RetrospectiveSourceResolver } from "./retrospective-populations.js"
import { retrospectiveBudget, type RetrospectivePopulation, type RetrospectiveSources } from "./retrospective-contract.js"

export const INTERPRETATION_READS = ["evaluation-interpretations", "evaluation-interpretation"] as const
type Authority = {
  authorize: (actor: Actor, metadata: RetrospectiveSources) => Promise<void>;
  authorizeUnion?: (actor: Actor, metadata: RetrospectiveSources[]) => Promise<void>;
  resolve: RetrospectiveSourceResolver;
}
const same = (a: unknown, b: unknown) => canonical(a, retrospectiveBudget()) === canonical(b, retrospectiveBudget())
type ReadContext = { populations: Map<string, { metadata: RetrospectiveSources; population: RetrospectivePopulation }>;
  originals: Set<string>; dependencies: Set<string> }
const readContext = (): ReadContext => ({ populations: new Map(), originals: new Set(), dependencies: new Set() })

/** Publication and historical reads share the source-owner gates. This service
 * has no model, scheduler, import operation, reservation or inference capability. */
export class EvaluatorInterpretations {
  constructor(private readonly history: EvaluationStore, private readonly populations: RetrospectivePopulations,
    private readonly authority: Authority) {}

  private async population(actor: Actor, metadata: RetrospectiveSources, context: ReadContext, signal?: AbortSignal) {
    signal?.throwIfAborted()
    if (metadata.owner_session !== actor.session_id) throw new Error("Evaluator interpretation unavailable")
    const cached = context.populations.get(metadata.population_id)
    if (cached) {
      if (!same(metadata, cached.metadata) || !same(metadata, this.history.retrospectiveSources(metadata.population_id, actor.session_id)))
        throw new Error("Evaluator interpretation population changed")
      return cached.population
    }
    await this.authority.authorize(actor, metadata)
    signal?.throwIfAborted()
    if (!same(metadata, this.history.retrospectiveSources(metadata.population_id, actor.session_id)))
      throw new Error("Evaluator interpretation population changed")
    const population = this.history.retrospectivePopulation(metadata.population_id, actor.session_id)
    if (population.manifest_sha256 !== metadata.manifest_sha256) throw new Error("Evaluator interpretation population changed")
    // Reject before hydrating another candidate, not after collecting an
    // arbitrarily large list of individually bounded population manifests.
    evaluatorInterpretationOriginals([population], context)
    context.populations.set(metadata.population_id, { metadata, population })
    return population
  }
  private async sources(actor: Actor, populations: RetrospectivePopulation[], context: ReadContext, signal?: AbortSignal) {
    const metadata: RetrospectiveSources[] = [], currentPopulations: RetrospectivePopulation[] = []
    for (const population of populations) {
      const source = this.history.retrospectiveSources(population.population_id, actor.session_id)
      const current = await this.population(actor, source, context, signal)
      if (current.manifest_sha256 !== population.manifest_sha256) throw new Error("Evaluator interpretation population changed")
      currentPopulations.push(current)
      metadata.push(source)
    }
    // Admit the complete report/list union before any original-owner read. The
    // same budget is enforced when publishing, including inherited revisions.
    evaluatorInterpretationOriginals(currentPopulations)
    const validated = new Set<string>()
    for (const population of currentPopulations) for (const member of population.manifest.members) {
      // The frozen member key binds namespace, full source version and view.
      // A context belongs to this recipient and this one inspect operation.
      // Retain only successful identities, never the original byte payloads.
      if (member.availability !== "available" || validated.has(member.key)) continue
      const current = await this.populations.resolve(actor, member, async request => {
        signal?.throwIfAborted()
        const result = await this.authority.resolve(request)
        signal?.throwIfAborted()
        return result
      }, "inspect")
      if (current.status !== "available") throw new Error("Retrospective preparation source unavailable or changed")
      validated.add(member.key)
    }
    // Reauthorize the whole union after all original-owner awaits, including
    // uncited inputs, frozen gaps and any explicitly linked prior reports.
    await this.disclosure(actor, metadata, signal)
  }
  private async disclosure(actor: Actor, metadata: RetrospectiveSources[], signal?: AbortSignal) {
    if (metadata.length > 1 && !this.authority.authorizeUnion) throw new Error("Evaluator interpretation union authority unavailable")
    if (this.authority.authorizeUnion) await this.authority.authorizeUnion(actor, metadata)
    else if (metadata[0]) await this.authority.authorize(actor, metadata[0])
    signal?.throwIfAborted()
    for (const source of metadata) if (!same(source, this.history.retrospectiveSources(source.population_id, actor.session_id)))
      throw new Error("Evaluator interpretation population changed")
  }
  private async records(actor: Actor, batchIDs: string[], context: ReadContext, signal?: AbortSignal): Promise<EvaluatorInterpretationRecord[]> {
    for (const batchID of batchIDs)
      await this.population(actor, this.history.evaluatorInterpretationSource(batchID, actor.session_id), context, signal)
    return this.history.readEvaluatorInterpretations(batchIDs, actor.session_id).map(record => {
      if (!record) throw new Error("Evaluator interpretation is not published")
      return record
    })
  }
  private currentRecords(actor: Actor, records: EvaluatorInterpretationRecord[]): EvaluatorInterpretationRecord[] {
    return this.history.readEvaluatorInterpretations(records.map(record => record.batch.id), actor.session_id).map((current, index) => {
      const prior = records[index]!
      if (!current || current.report.id !== prior.report.id || current.report.sha256 !== prior.report.sha256)
        throw new Error("Evaluator interpretation changed during read")
      return current
    })
  }

  /** Called only by the existing execution consumer, after trusted original
   * recovery. The store repeats all synchronous provenance/union checks. */
  async authorizePublication(actor: Actor, population: RetrospectivePopulation, body: EvaluatorPublication, signal?: AbortSignal) {
    const context = readContext(), union = new Map([[population.population_id, population]])
    const references = evaluatorPriorReports(body.interpretation)
    const priors = await this.records(actor, references.map(reference => this.history.evaluatorInterpretationBatch(reference.report_id, actor.session_id)), context, signal)
    for (let index = 0; index < references.length; index++) {
      const reference = references[index]!, prior = priors[index]!
      if (prior.report.sha256 !== reference.report_sha256
        || prior.population.manifest.source_store_id !== population.manifest.source_store_id
        || prior.population.manifest.selection.objective_id !== population.manifest.selection.objective_id)
        throw new Error("Prior evaluator interpretation scope or identity mismatch")
      for (const source of prior.populations) union.set(source.population_id, source)
    }
    await this.sources(actor, [...union.values()], context, signal)
    this.currentRecords(actor, priors)
  }

  async read(actor: Actor, input: Record<string, unknown>, signal?: AbortSignal) {
    const operation = input.operation
    const allowed = operation === "evaluation-interpretation"
      ? ["operation", "batch_id", "report_id", "report_sha256", "section", "after", "limit", "response_format"]
      : ["operation", "before", "limit", "response_format"]
    if (!(INTERPRETATION_READS as readonly unknown[]).includes(operation) || Object.keys(input).some(key => !allowed.includes(key)))
      throw new Error("Invalid evaluator interpretation read")
    if (input.response_format !== undefined && !["json", "markdown", "html"].includes(String(input.response_format)))
      throw new Error("Invalid evaluator interpretation response format")
    const context = readContext()
    if (operation === "evaluation-interpretations") {
      if (input.response_format !== undefined && input.response_format !== "json")
        throw new Error("Interpretation lists use JSON; open a report for Markdown or HTML")
      const candidates = this.history.evaluatorInterpretationCandidates(actor.session_id, { before: input.before as number | undefined, limit: input.limit as number | undefined })
      const records = await this.records(actor, candidates.items.map(row => row.id), context, signal)
      const union = new Map<string, RetrospectivePopulation>()
      for (const record of records) for (const population of record.populations) union.set(population.population_id, population)
      await this.sources(actor, [...union.values()], context, signal)
      const current = this.currentRecords(actor, records), items = []
      for (const record of current) {
        const row = record.batch
        items.push({ batch_id: row.id, report_id: record.report.id, report_sha256: record.report.sha256,
          population_id: record.population.population_id, manifest_sha256: record.population.manifest_sha256,
          method_id: record.batch.method.id, state: record.batch.published_state, revision_status: "not-assessed-by-this-view", created_at: record.report.created_at,
          conclusion: record.report.body.interpretation.conclusion.kind,
          inspect: { operation: "evaluation-interpretation", batch_id: row.id, report_id: record.report.id, report_sha256: record.report.sha256 } })
      }
      const page = { format: "loom-evaluator-interpretations/v1", items, next_before: candidates.next_before,
        navigation: { next: candidates.next_before === null ? null : { operation, before: candidates.next_before, limit: input.limit ?? 20 } } }
      canonical(page, new ProcessingBudget(200000))
      return page
    }
    const batchID = uid(input.batch_id, "batch_id"), records = await this.records(actor, [batchID], context, signal)
    await this.sources(actor, records[0]!.populations, context, signal)
    const record = this.currentRecords(actor, records)[0]!
    const body = record.report.body
    const page = paginateEvaluatorInterpretation({ report_id: record.report.id, report_sha256: record.report.sha256, body,
      // A generic stale flag can reveal a later protected interpretation. The
      // immutable publication is readable under its own union; authorized later
      // reports disclose their attributable revision links separately.
      state: record.batch.published_state, qualifications: [...record.report.qualifications,
        "This view does not assess later revisions; inspect authorized interpretation history."],
      sources: evaluatorInterpretationSources(record.population, body.retrieved, body.interpretation) }, input)
    const items = page.section === "prior_interpretations" ? page.items.map(item => {
      const prior = item as { report_id: string; report_sha256: string }
      return { ...prior, inspect: { operation, batch_id: this.history.evaluatorInterpretationBatch(prior.report_id, actor.session_id),
        report_id: prior.report_id, report_sha256: prior.report_sha256 } }
    }) : page.items
    return { ...page, items, batch_id: batchID, revision_status: "not-assessed-by-this-view", navigation: { ...page.navigation,
      sections: page.navigation.sections.map(section => ({ operation, batch_id: batchID, ...section })),
      next: page.navigation.next ? { operation, batch_id: batchID, ...page.navigation.next } : null } }
  }
}
