import { canonical, ProcessingBudget, uid, type Actor } from "./model.js"
import type { EvaluationStore, EvaluatorInterpretationRecord } from "./evaluation-store.js"
import { evaluatorInterpretationOriginals, evaluatorPriorReports, validateEvaluatorPriorOriginals, EVALUATOR_INTERPRETATION_LIMITS, type EvaluatorPublication } from "./evaluator-publication.js"
import type { EvaluatorInterpretationReader, EvaluatorPriorReportSelector } from "./evaluator-execution-contract.js"
import { evaluatorInterpretationSources, paginateEvaluatorInterpretation } from "./evaluator-interpretation-view.js"
import type { RetrospectivePopulations, RetrospectiveSourceResolver } from "./retrospective-populations.js"
import { retrospectiveBudget, compatibleRetrospectiveContext, retrospectiveTarget, type RetrospectivePopulation, type RetrospectiveSources } from "./retrospective-contract.js"
import { retrospectiveSourcePresentation, retrospectiveSourceView } from "./retrospective-source-view.js"

export const INTERPRETATION_READS = ["evaluation-interpretations", "evaluation-interpretation", "evaluation-prior-source"] as const
type Authority = {
  authorize: (actor: Actor, metadata: RetrospectiveSources) => Promise<void>;
  authorizeUnion?: (actor: Actor, metadata: RetrospectiveSources[]) => Promise<void>;
  resolve: RetrospectiveSourceResolver;
}
const same = (a: unknown, b: unknown) => canonical(a, retrospectiveBudget()) === canonical(b, retrospectiveBudget())
type ReadContext = { populations: Map<string, { metadata: RetrospectiveSources; population: RetrospectivePopulation }>;
  originals: Set<string>; dependencies: Set<string>; presentations: Map<string, ReturnType<typeof retrospectiveSourcePresentation>>;
  structuralBudget?: ProcessingBudget }
const readContext = (bounded = false): ReadContext => ({ populations: new Map(), originals: new Set(), dependencies: new Set(), presentations: new Map(),
  ...(bounded ? { structuralBudget: new ProcessingBudget(33554432, 2000000) } : {}) })
function request(input: unknown, allowed: string[]): Record<string, unknown> {
  canonical(input, new ProcessingBudget(16000, 256))
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)))
    throw new Error("Invalid evaluator context request")
  return input as Record<string, unknown>
}
function priorSelector(input: Record<string, unknown>): EvaluatorPriorReportSelector {
  if (typeof input.report_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.report_sha256)) throw new Error("Invalid prior interpretation fingerprint")
  return { report_id: uid(input.report_id, "prior report ID"), report_sha256: input.report_sha256 }
}

/** Publication and historical reads share the source-owner gates. This service
 * has no model, scheduler, import operation, reservation or inference capability. */
export class EvaluatorInterpretations {
  constructor(private readonly history: EvaluationStore, private readonly populations: RetrospectivePopulations,
    private readonly authority: Authority) {}

  private async population(actor: Actor, metadata: RetrospectiveSources, context: ReadContext, signal?: AbortSignal, owner = actor.session_id) {
    signal?.throwIfAborted()
    if (metadata.owner_session !== owner || metadata.contains_private_reviews && actor.session_id !== owner)
      throw new Error("Evaluator interpretation unavailable for this recipient")
    const cached = context.populations.get(metadata.population_id)
    if (cached) {
      if (!same(metadata, cached.metadata) || !same(metadata, this.history.retrospectiveSources(metadata.population_id, owner)))
        throw new Error("Evaluator interpretation population changed")
      return cached.population
    }
    await this.authority.authorize(actor, metadata)
    signal?.throwIfAborted()
    if (!same(metadata, this.history.retrospectiveSources(metadata.population_id, owner)))
      throw new Error("Evaluator interpretation population changed")
    const population = this.history.retrospectivePopulation(metadata.population_id, owner, context.structuralBudget)
    if (population.manifest_sha256 !== metadata.manifest_sha256) throw new Error("Evaluator interpretation population changed")
    // Reject before hydrating another candidate, not after collecting an
    // arbitrarily large list of individually bounded population manifests.
    evaluatorInterpretationOriginals([population], context)
    context.populations.set(metadata.population_id, { metadata, population })
    return population
  }
  private async sources(actor: Actor, populations: RetrospectivePopulation[], context: ReadContext, signal?: AbortSignal, owner = actor.session_id, purpose: "inspect" | "execute" = "inspect") {
    const metadata: RetrospectiveSources[] = [], currentPopulations: RetrospectivePopulation[] = []
    for (const population of populations) {
      const source = this.history.retrospectiveSources(population.population_id, owner)
      const current = await this.population(actor, source, context, signal, owner)
      if (current.manifest_sha256 !== population.manifest_sha256) throw new Error("Evaluator interpretation population changed")
      currentPopulations.push(current)
      metadata.push(source)
    }
    // Admit the complete report/list union before any original-owner read. The
    // same budget is enforced when publishing, including inherited revisions.
    evaluatorInterpretationOriginals(currentPopulations)
    await this.disclosure(actor, metadata, signal, owner)
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
      }, purpose)
      if (current.status !== "available") throw new Error("Retrospective preparation source unavailable or changed")
      if (context.presentations.size < 256) context.presentations.set(member.key, retrospectiveSourcePresentation(current.value))
      validated.add(member.key)
    }
    // Reauthorize the whole union after all original-owner awaits, including
    // uncited inputs, frozen gaps and any explicitly linked prior reports.
    await this.disclosure(actor, metadata, signal, owner)
  }
  private async disclosure(actor: Actor, metadata: RetrospectiveSources[], signal?: AbortSignal, owner = actor.session_id) {
    if (metadata.some(source => source.owner_session !== owner || source.contains_private_reviews && actor.session_id !== owner))
      throw new Error("Evaluator interpretation unavailable for this recipient")
    if (metadata.length > 1 && !this.authority.authorizeUnion) throw new Error("Evaluator interpretation union authority unavailable")
    if (this.authority.authorizeUnion) await this.authority.authorizeUnion(actor, metadata)
    else if (metadata[0]) await this.authority.authorize(actor, metadata[0])
    signal?.throwIfAborted()
    for (const source of metadata) if (!same(source, this.history.retrospectiveSources(source.population_id, owner)))
      throw new Error("Evaluator interpretation population changed")
  }
  private async records(actor: Actor, batchIDs: string[], context: ReadContext, signal?: AbortSignal, owner = actor.session_id): Promise<EvaluatorInterpretationRecord[]> {
    for (const batchID of batchIDs)
      await this.population(actor, this.history.evaluatorInterpretationSource(batchID, owner), context, signal, owner)
    return this.history.readEvaluatorInterpretations(batchIDs, owner).map(record => {
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

  private async admitUnion(recipient: Actor, owner: string, populations: RetrospectivePopulation[], context: ReadContext, signal?: AbortSignal) {
    for (const population of populations) {
      const metadata = this.history.retrospectiveSources(population.population_id, owner)
      const checked = await this.population(recipient, metadata, context, signal, owner)
      if (checked.manifest_sha256 !== population.manifest_sha256) throw new Error("Evaluator interpretation population changed")
    }
    await this.disclosure(recipient, [...context.populations.values()].map(value => value.metadata), signal, owner)
  }

  private async priorOriginal(recipient: Actor, owner: Actor, record: EvaluatorInterpretationRecord,
    input: Record<string, unknown>, context: ReadContext, purpose: "inspect" | "execute", signal?: AbortSignal) {
    const selected = priorSelector(input)
    if (record.report.id !== selected.report_id || record.report.sha256 !== selected.report_sha256)
      throw new Error("Prior interpretation identity mismatch")
    if (input.source_index !== 0) throw new Error("Unsupported prior original source index")
    const member = record.population.manifest.members.find(member => member.key === uid(input.member_key, "prior member key"))
    if (!member) throw new Error("Prior source is outside the named report's own frozen population")
    await this.admitUnion(recipient, owner.session_id, record.populations, context, signal)
    signal?.throwIfAborted()
    // Only this selected original is resolved. Authorizing all derived report
    // dependencies does not broaden this original read to those other sources.
    const resolved = await this.populations.resolve(recipient, member, async request => {
      signal?.throwIfAborted()
      const result = await this.authority.resolve(request)
      signal?.throwIfAborted()
      return result
    }, purpose)
    if (member.availability === "available" && resolved.status !== "available")
      throw new Error("Prior original unavailable or changed")
    await this.disclosure(recipient, [...context.populations.values()].map(value => value.metadata), signal, owner.session_id)
    this.currentRecords(owner, [record])
    const result = { kind: "prior-original", ...selected, population_id: record.population.population_id,
      manifest_sha256: record.population.manifest_sha256, member_key: member.key, source_index: 0,
      source: member.source, source_store_id: member.source_store_id, permitted_view: member.permitted_view,
      historical_scope: member.historical_scope, qualifications: member.qualifications, ...resolved,
      receiving_session: recipient.session_id, native_evaluator_retrieval: purpose === "execute" ? "authority-must-observe" : "not-established" }
    canonical(result, retrospectiveBudget())
    return result
  }

  /** Installed only on the restricted reader passed to an already admitted
   * execution. Owner selectors and actual receiving identity remain separate;
   * no public parameter chooses a recipient or creates a delivery receipt. */
  executionReader(owner: Actor, recipient: Actor, current: RetrospectivePopulation,
    recheck: () => Promise<void>, signal?: AbortSignal): EvaluatorInterpretationReader {
    const context = readContext(true), delivered = new Map<string, { batch_id: string; report_id: string; report_sha256: string }>()
    const begin = async (batchIDs: string[]) => {
      await recheck()
      await this.admitUnion(recipient, owner.session_id, [current], context, signal)
      for (const batchID of batchIDs) {
        const candidate = await this.population(recipient, this.history.evaluatorInterpretationSource(batchID, owner.session_id), context, signal, owner.session_id)
        if (!compatibleRetrospectiveContext(current.manifest, candidate.manifest)) {
          // Reject before hydrating an unrelated report body. A failed request
          // consumes its bounded inspection work but adds no disclosure scope.
          context.populations.delete(candidate.population_id)
          throw new Error("Prior evaluator interpretation scope or frontier mismatch")
        }
      }
      const roots = new Set([...delivered.values()].map(record => record.batch_id))
      for (const batchID of batchIDs) roots.add(batchID)
      const dependencyRecords = this.history.readEvaluatorInterpretationContext([...roots], owner.session_id)
      const byBatch = new Map(dependencyRecords.map(record => [record.batch.id, record]))
      const selected = batchIDs.map(batchID => {
        const record = byBatch.get(batchID)
        if (!record) throw new Error("Evaluator interpretation is not published")
        return record
      })
      const union = new Map([[current.population_id, current]])
      for (const record of dependencyRecords) {
        if (!compatibleRetrospectiveContext(current.manifest, record.population.manifest))
          throw new Error("Prior evaluator interpretation scope or frontier mismatch")
        for (const population of record.populations) union.set(population.population_id, population)
      }
      await this.admitUnion(recipient, owner.session_id, [...union.values()], context, signal)
      return selected
    }
    const finish = async (records: EvaluatorInterpretationRecord[]) => {
      await this.disclosure(recipient, [...context.populations.values()].map(value => value.metadata), signal, owner.session_id)
      await recheck()
      await this.disclosure(recipient, [...context.populations.values()].map(value => value.metadata), signal, owner.session_id)
      const expected = new Map(delivered)
      for (const record of records) expected.set(record.report.id, { batch_id: record.batch.id, report_id: record.report.id, report_sha256: record.report.sha256 })
      const checked = this.history.readEvaluatorInterpretationContext([...expected.values()].map(record => record.batch_id), owner.session_id)
      for (const identity of expected.values()) if (!checked.some(record => record.report.id === identity.report_id && record.report.sha256 === identity.report_sha256))
        throw new Error("Evaluator interpretation changed during read")
      for (const [key, identity] of expected) delivered.set(key, identity)
      signal?.throwIfAborted()
    }
    const exact = async (input: Record<string, unknown>) => {
      const selected = priorSelector(input)
      const records = await begin([this.history.evaluatorInterpretationBatch(selected.report_id, owner.session_id)])
      const record = records[0]!
      if (record.report.id !== selected.report_id || record.report.sha256 !== selected.report_sha256)
        throw new Error("Prior interpretation identity mismatch")
      return record
    }
    return {
      list: async (raw = {}) => {
        const input = request(raw, ["before", "limit"])
        const limit = input.limit ?? 10
        if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit >= EVALUATOR_INTERPRETATION_LIMITS.reports)
          throw new Error("Invalid evaluator context page limit")
        await recheck()
        const candidates = this.history.evaluatorInterpretationCandidates(owner.session_id,
          { before: input.before as number | undefined, limit, context: current.manifest })
        const records = await begin(candidates.items.map(row => row.id))
        const populations = new Map<string, RetrospectivePopulation>()
        for (const record of records) for (const population of record.populations) populations.set(population.population_id, population)
        await this.sources(recipient, [...populations.values()], context, signal, owner.session_id, "execute")
        await finish(records)
        const items = records.map(record => ({ kind: "prior-interpretation", report_id: record.report.id, report_sha256: record.report.sha256,
          created_at: record.report.created_at, target: retrospectiveTarget(record.population.manifest),
          question: record.population.manifest.selection.question, conclusion: record.report.body.interpretation.conclusion.kind,
          inspect: { report_id: record.report.id, report_sha256: record.report.sha256 } }))
        const page = { format: "loom-evaluator-context-list/v1", items, next_before: candidates.next_before,
          receiving_session: recipient.session_id, native_evaluator_retrieval: "authority-must-observe",
          qualification: "Every delivered list item is an explicit dependency of the final interpretation, even if uncited." }
        canonical(page, new ProcessingBudget(200000))
        return page
      },
      read: async raw => {
        const input = request(raw, ["report_id", "report_sha256", "section", "after", "limit"]), record = await exact(input)
        await this.sources(recipient, record.populations, context, signal, owner.session_id, "execute")
        await finish([record])
        return { ...this.page(record, input, context), kind: "prior-interpretation", receiving_session: recipient.session_id,
          native_evaluator_retrieval: "authority-must-observe" }
      },
      source: async raw => {
        const input = request(raw, ["report_id", "report_sha256", "member_key", "source_index"]), record = await exact(input)
        const result = await this.priorOriginal(recipient, owner, record, input, context, "execute", signal)
        await finish([record])
        return result
      },
    }
  }

  private contextSourceCards(record: EvaluatorInterpretationRecord, context: ReadContext) {
    const receipts = (record.report.body.context_retrieved ?? []).filter(receipt => receipt.kind === "prior-original")
    const reportIDs = [...new Set(receipts.map(receipt => receipt.report_id))]
    const priors = new Map(this.history.readEvaluatorInterpretations(reportIDs.map(reportID =>
      this.history.evaluatorInterpretationBatch(reportID, record.population.owner_session)), record.population.owner_session)
      .map(prior => {
        if (!prior) throw new Error("Prior interpretation changed during read")
        return [prior.report.id, prior] as const
      }))
    const seen = new Set<string>(), cited = new Set([
      ...record.report.body.interpretation.trajectory.flatMap(event => event.supporting),
      ...record.report.body.interpretation.claims.flatMap(claim => [...claim.supporting, ...claim.contradicting]),
      ...record.report.body.interpretation.review_coverage.flatMap(review => review.supporting),
    ].flatMap(ref => "kind" in ref ? [`${ref.report_id}\n${ref.report_sha256}\n${ref.member_key}`] : []))
    return receipts.flatMap(receipt => {
      const identity = `${receipt.report_id}\n${receipt.report_sha256}\n${receipt.member_key}`
      if (seen.has(identity)) return []
      seen.add(identity)
      const prior = priors.get(receipt.report_id)
      if (!prior || prior.report.sha256 !== receipt.report_sha256) throw new Error("Prior interpretation changed during read")
      const member = prior.population.manifest.members.find(member => member.key === receipt.member_key)
      if (!member) throw new Error("Prior original is outside the named report population")
      return [{ kind: "prior-original", report_id: receipt.report_id, report_sha256: receipt.report_sha256,
        member_key: member.key, source_index: 0, selected: false, retrieved: true, cited: cited.has(identity),
        source_store_id: member.source_store_id, source: member.source, permitted_view: member.permitted_view,
        frozen_availability: member.availability, unavailable: member.availability !== "available", qualifications: member.qualifications,
        ...context.presentations.get(member.key), inspect: { operation: "evaluation-prior-source", report_id: receipt.report_id,
          report_sha256: receipt.report_sha256, member_key: member.key, source_index: 0 } }]
    })
  }

  private page(record: EvaluatorInterpretationRecord, input: Record<string, unknown>, context: ReadContext) {
    const body = record.report.body
    return paginateEvaluatorInterpretation({ report_id: record.report.id, report_sha256: record.report.sha256, body,
      state: record.batch.published_state, qualifications: [...record.report.qualifications,
        "This view does not assess later revisions; inspect authorized interpretation history."],
      foundation: { ...record.population.manifest.objective, question: record.population.manifest.selection.question,
        target: retrospectiveTarget(record.population.manifest), contributors: record.population.manifest.contributors,
        ...(record.population.manifest.selection.mode === "explicit-subject" ? { cutoff: record.population.manifest.selection.cutoff,
          frontier: record.population.manifest.selection.frontier } : {}) },
      sources: [...evaluatorInterpretationSources(record.population, body.retrieved, body.interpretation).map(source =>
        ({ ...source, ...context.presentations.get(source.member_key) })), ...this.contextSourceCards(record, context)] }, input)
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
        || !compatibleRetrospectiveContext(population.manifest, prior.population.manifest))
        throw new Error("Prior evaluator interpretation scope or identity mismatch")
      validateEvaluatorPriorOriginals(body, reference, prior.population)
      for (const source of prior.populations) union.set(source.population_id, source)
    }
    await this.sources(actor, [...union.values()], context, signal)
    this.currentRecords(actor, priors)
  }

  async read(actor: Actor, input: Record<string, unknown>, signal?: AbortSignal) {
    const operation = input.operation
    const allowed = operation === "evaluation-interpretation"
      ? ["operation", "batch_id", "report_id", "report_sha256", "section", "after", "limit", "response_format"]
      : operation === "evaluation-prior-source" ? ["operation", "report_id", "report_sha256", "member_key", "source_index", "source_offset", "source_limit", "response_format"]
        : ["operation", "before", "limit", "response_format"]
    if (!(INTERPRETATION_READS as readonly unknown[]).includes(operation) || Object.keys(input).some(key => !allowed.includes(key)))
      throw new Error("Invalid evaluator interpretation read")
    if (input.response_format !== undefined && !["json", "markdown", "html"].includes(String(input.response_format)))
      throw new Error("Invalid evaluator interpretation response format")
    const context = readContext()
    if (operation === "evaluation-prior-source") {
      const selector = priorSelector(input), records = await this.records(actor,
        [this.history.evaluatorInterpretationBatch(selector.report_id, actor.session_id)], context, signal)
      const result = await this.priorOriginal(actor, actor, records[0]!, input, context, "inspect", signal)
      return retrospectiveSourceView({ ...result, read_request: { operation, ...selector,
        member_key: input.member_key, source_index: 0 } }, input)
    }
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
    // Later revision state stays private; only this report's attributable
    // authorized dependency union supplies the human-facing document.
    const page = this.page(record, input, context)
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
