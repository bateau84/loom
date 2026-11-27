import { canonical, digest, ProcessingBudget, ProcessingLimitError, uid, type Actor } from "./model.js"
import type { Store } from "./store.js"
import type { AutomaticLearning } from "./automatic-learning.js"
import type { EvaluationSourceRef } from "./evaluation-store.js"
import type { EngineeringHistoryQuery, EngineeringHistoryRecord, EngineeringHistoryRelationship, EngineeringHistoryView } from "./engineering-history.js"
import type { EngineeringHistoryOwners } from "./engineering-trajectories.js"
import type { ObjectiveIndex } from "./objectives.js"
import { parseRetrospectiveManifest, retrospectiveDigest, retrospectiveMemberKey, retrospectiveBudget,
  type RetrospectiveManifest, type RetrospectiveMember, type RetrospectivePopulation, type RetrospectiveSelection } from "./retrospective-contract.js"

export type RetrospectiveSourceRequest = {
  source_store_id: string; source: EvaluationSourceRef; permitted_view: string;
  recipient_session_id: string; purpose: "preview" | "inspect" | "prepare";
}
export type RetrospectiveSourceResolution = {
  source_store_id: string; source: EvaluationSourceRef; permitted_view: string; recipient_session_id: string;
  status: "available" | "missing" | "changed" | "unsupported"; value?: Record<string, unknown>;
}
/** The owner must await its actual inspection/recipient-policy checks. An exact
 * source return authorizes this reader only, never a future Evaluator recipient. */
export type RetrospectiveSourceResolver = (request: RetrospectiveSourceRequest) => Promise<RetrospectiveSourceResolution>
export type RetrospectiveHistory = {
  query: EngineeringHistoryQuery; view: EngineeringHistoryView; owners: EngineeringHistoryOwners;
  associations?: ReturnType<ObjectiveIndex["retrospectiveSources"]>; contributors: string[];
}
export type RetrospectiveProposal = {
  objective_id: string; question: string; exclusions: Array<{ record_id: string; reason: string }>;
  mode: "explicit-objective"; through?: number; owner_boundary?: RetrospectiveSelection["owner_boundary"]; owner_version?: string;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const fingerprint = (value: unknown) => digest(value, retrospectiveBudget())
const copy = (value: unknown): Record<string, unknown> => {
  if (!object(value)) throw new Error("Invalid retrospective metadata")
  return JSON.parse(canonical(value, retrospectiveBudget())) as Record<string, unknown>
}
const LOCAL_VIEWS: Readonly<Record<string, string>> = { "ledger-record": "record-full", objective: "objective", "objective-link": "objective-link",
  "review-request": "review-request", "review-relationship": "review-relationship" }
const pageInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const result = value ?? fallback
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < min || result > max) throw new Error("Invalid retrospective page")
  return result
}
export function retrospectiveProposal(raw: unknown): RetrospectiveProposal {
  if (!object(raw) || Object.keys(raw).some(key => !["mode", "objective_id", "question", "exclusions", "through", "owner_boundary", "owner_version"].includes(key)))
    throw new Error("Invalid retrospective selection")
  if (raw.mode !== undefined && raw.mode !== "explicit-objective") throw new Error("Unsupported retrospective selection policy")
  if (typeof raw.question !== "string" || !raw.question.trim() || raw.question.length > 8000 || /[\u0000-\u001f]/.test(raw.question))
    throw new Error("Retrospective selection requires a bounded evaluation question")
  const exclusions = raw.exclusions ?? []
  if (!Array.isArray(exclusions) || exclusions.length > 2000) throw new Error("Invalid retrospective exclusions")
  const selected = exclusions.map(value => {
    if (!object(value) || Object.keys(value).sort().join() !== "reason,record_id" || typeof value.reason !== "string"
      || !value.reason.trim() || value.reason.length > 8000 || /[\u0000-\u001f]/.test(value.reason)) throw new Error("Invalid retrospective exclusion")
    return { record_id: uid(value.record_id, "excluded record"), reason: value.reason }
  }).sort((a, b) => a.record_id.localeCompare(b.record_id))
  if (new Set(selected.map(value => value.record_id)).size !== selected.length) throw new Error("Duplicate retrospective exclusion")
  const proposal: RetrospectiveProposal = { mode: "explicit-objective", objective_id: uid(raw.objective_id, "objective_id"), question: raw.question, exclusions: selected }
  if (raw.through !== undefined) proposal.through = pageInteger(raw.through, 0, 0, Number.MAX_SAFE_INTEGER)
  if (raw.owner_boundary !== undefined) {
    const b = raw.owner_boundary
    if (!object(b) || Object.keys(b).sort().join() !== "objective_links,review_relationships,review_requests") throw new Error("Invalid retrospective owner boundary")
    proposal.owner_boundary = { objective_links: b.objective_links === null ? null : pageInteger(b.objective_links, 0, 0, Number.MAX_SAFE_INTEGER),
      review_requests: pageInteger(b.review_requests, 0, 0, Number.MAX_SAFE_INTEGER), review_relationships: pageInteger(b.review_relationships, 0, 0, Number.MAX_SAFE_INTEGER) }
  }
  if (raw.owner_version !== undefined) {
    if (typeof raw.owner_version !== "string" || !/^[a-f0-9]{64}$/.test(raw.owner_version) || !proposal.owner_boundary) throw new Error("Invalid retrospective owner version")
    proposal.owner_version = raw.owner_version
  }
  return proposal
}

async function ownerRead(request: RetrospectiveSourceRequest, resolver: RetrospectiveSourceResolver): Promise<RetrospectiveSourceResolution> {
  const result = await resolver(request)
  if (result.source_store_id !== request.source_store_id || result.permitted_view !== request.permitted_view
    || result.recipient_session_id !== request.recipient_session_id || result.source.kind !== request.source.kind
    || result.source.id !== request.source.id || result.source.session_id !== request.source.session_id
    || result.source.message_id !== request.source.message_id)
    throw new Error("Retrospective source-owner binding mismatch")
  if (result.status === "available") {
    if (!result.value || !result.source.revision || !result.source.sha256 || fingerprint(result.value) !== result.source.sha256)
      throw new Error("Retrospective source-owner version mismatch")
    if (request.source.revision !== undefined && request.source.revision !== result.source.revision
      || request.source.sha256 !== undefined && request.source.sha256 !== result.source.sha256)
      return { ...request, status: "changed" }
  } else if (!["missing", "changed", "unsupported"].includes(result.status) || result.value !== undefined)
    throw new Error("Invalid retrospective source-owner result")
  return result
}

/** Selection and readback reuse the original owners. Only manifest metadata is
 * persisted by EvaluationStore; no source bytes, model clients or dispatch path. */
export class RetrospectivePopulations {
  constructor(private readonly automatic: AutomaticLearning, private readonly store: Store) {}

  async preview(actor: Actor, proposal: RetrospectiveProposal, history: RetrospectiveHistory, resolver: RetrospectiveSourceResolver): Promise<RetrospectiveManifest> {
    const { owners, associations } = history
    if (!associations || !owners.objectives || history.query.through === undefined) throw new Error("Retrospective objective owner unavailable")
    const objective = owners.objectives.objectives.find(item => item.id === proposal.objective_id)
    if (!objective) throw new Error("Retrospective objective unavailable")
    const selection: RetrospectiveSelection = { ...proposal, through: history.query.through, owner_boundary: owners.boundary, owner_version: owners.version }
    const records = new Map<string, EngineeringHistoryRecord>(), relationships = new Map<string, EngineeringHistoryRelationship>()
    const coverageGaps = new Map<string, EngineeringHistoryView["coverage"]["gaps"][number]>()
    const addPage = (page: EngineeringHistoryView) => {
      for (const record of page.records) records.set(record.source.record_id, record)
      for (const relation of page.relationships) {
        // Inclusion is relative to the history page, not part of edge identity.
        const { target: _target, ...identity } = relation
        relationships.set(fingerprint(identity), relation)
      }
      for (const gap of page.coverage.gaps) coverageGaps.set(fingerprint(gap), gap)
    }
    let page = history.view, reads = 0
    const read = (query: EngineeringHistoryQuery) => {
      if (++reads > 20000) throw new Error("Retrospective membership exceeds the bounded source read")
      return this.store.engineeringHistory.read(query, owners)
    }
    for (;;) {
      addPage(page)
      // Each record page has its own relationship continuation. Exhaust it before
      // advancing the record cursor, including dense edges on later pages.
      let next = page.navigation.next_relationships
      while (next) {
        const related = read(next); addPage(related); next = related.navigation.next_relationships
      }
      if (!page.navigation.next_records) break
      page = read(page.navigation.next_records)
    }
    if (records.size !== history.view.coverage.matching_records) throw new Error("Retrospective selected membership is incomplete")
    const excluded = new Set(selection.exclusions.map(item => item.record_id))
    if (selection.exclusions.some(item => !records.has(item.record_id))) throw new Error("Retrospective exclusion is outside the selected objective")
    const includedRefs = new Set([...records.values()].filter(record => !excluded.has(record.source.record_id)).map(record => record.ref))
    const allRefs = new Set([...records.values()].map(record => record.ref))
    for (const [key, relation] of relationships) if (allRefs.has(relation.to))
      relationships.set(key, { ...relation, target: includedRefs.has(relation.to) ? "included" : "in-scope-not-included" })
    const members = new Map<string, RetrospectiveMember>(), contributors = new Set(history.contributors)
    const add = (source: EvaluationSourceRef, view: string, availability: RetrospectiveMember["availability"], basis: Record<string, unknown>[],
      historical_scope: Record<string, unknown> | null, qualifications: string[]) => {
      const key = retrospectiveMemberKey(this.automatic.sources.namespace, source, view), prior = members.get(key)
      if (source.session_id) contributors.add(source.session_id)
      const uniqueBasis = [...new Map([...(prior?.basis ?? []), ...basis].map(item => [fingerprint(item), item])).entries()]
        .sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item)
      members.set(key, { key, source_store_id: this.automatic.sources.namespace, source, permitted_view: view, availability,
        basis: uniqueBasis, historical_scope, qualifications: [...new Set([...(prior?.qualifications ?? []), ...qualifications])].sort() })
    }
    const original = async (kind: string, id: string, session: string, expected?: EvaluationSourceRef) => ownerRead({
      source_store_id: this.automatic.sources.namespace, source: expected ?? { kind, id, session_id: session, required: true },
      permitted_view: LOCAL_VIEWS[kind]!, recipient_session_id: actor.session_id, purpose: "preview",
    }, resolver)
    const objectiveSource = await original("objective", objective.id, objective.author_session)
    if (objectiveSource.status !== "available") throw new Error("Retrospective objective original unavailable")
    add(objectiveSource.source, "objective", "available", [{ kind: "selected-objective", question: proposal.question }], null,
      ["authored-objective-identity; originating-request independence unknown"])
    const links = new Map<number, Record<string, unknown>>()
    for (const ref of associations.links) {
      const source = await original("objective-link", String(ref.sequence), ref.author_session)
      if (source.status !== "available" || !source.value) throw new Error("Retrospective association original unavailable")
      links.set(ref.sequence, source.value)
      const projection = owners.objectives.links.find(link => link.sequence === ref.sequence)
      add(source.source, "objective-link", "available", [{ kind: "authored-objective-association", objective_id: objective.id,
        association: projection ? copy(projection) : { sequence: ref.sequence, source_availability: "unresolved; original association remains inspectable" } }], null,
      ["authored relationship, not observed causation", ...(projection ? [] : ["associated original unavailable or unresolved within the selected boundary"])])
    }
    for (const record of records.values()) {
      if (excluded.has(record.source.record_id)) continue
      const expected: EvaluationSourceRef = { kind: "ledger-record", id: record.source.record_id, session_id: record.session_id,
        revision: String(record.source.sequence), sha256: record.source.sha256, required: true }
      const source = await original("ledger-record", expected.id, record.session_id, expected)
      if (source.status !== "available") throw new Error("Retrospective original changed during preview; restart selection")
      const basis = [...relationships.values()].filter(relation => relation.from === record.ref || relation.to === record.ref)
        .map(relation => ({ kind: "history-relationship", relationship: copy(relation),
          excluded_endpoint: selection.exclusions.some(item => relation.from.endsWith(":" + encodeURIComponent(item.record_id)) || relation.to.endsWith(":" + encodeURIComponent(item.record_id))) }))
      add(expected, "record-full", "available", basis.length ? basis : [{ kind: "checked-forward-original", membership: "supporting original; not inferred objective membership" }],
        { work_ref: record.work_ref, observation_scope: record.observation?.work_scope ?? null, record_kind: record.kind,
          meaning: record.meaning, verification: record.verification, observation: record.observation },
        record.gaps.map(gap => gap.code === "relationships-omitted"
          ? "relationships-omitted in initial history page; returned continuations are exhausted; references beyond bounded owner resolution remain unqualified"
          : gap.code + ": " + gap.detail))
    }
    // All original associations are retained, including explicit missing/native/
    // external references. They remain authored identity claims, not fetched data.
    for (const [sequence, link] of links) {
      if (typeof link.source_type !== "string" || typeof link.source_id !== "string") throw new Error("Invalid retrospective association source")
      if (link.source_type === "ledger-record" && (records.has(link.source_id) || excluded.has(link.source_id))) continue
      const source: EvaluationSourceRef = { kind: link.source_type, id: link.source_id, required: true,
        ...(typeof link.source_session_id === "string" ? { session_id: link.source_session_id } : {}),
        ...(link.source_type === "native-call" && typeof link.source_message_id === "string" ? { message_id: link.source_message_id } : {}) }
      add(source, link.source_type === "ledger-record" ? "record-full" : "reference-only",
        link.source_type === "ledger-record" || link.source_type === "unavailable" ? "missing" : "unsupported",
        [{ kind: "authored-source-reference", objective_id: objective.id, association_sequence: sequence,
          source_message_id: link.source_message_id ?? null, verification: link.verification, phase: link.phase,
          confidence: link.confidence, gap_reason: link.gap_reason ?? null }], null,
        ["original source/version not resolved; identity is an authored reference", "no source release or recipient authority established"])
    }
    for (const review of owners.reviews?.requests ?? []) {
      const request = review.request, source = await original("review-request", request.request_id, request.requester.session_id)
      if (source.status !== "available") throw new Error("Retrospective review original unavailable")
      add(source.source, "review-request", "available", [{ kind: "complete-frozen-review-mandate", request: copy(request),
        frozen_work_membership: review.frozen_work_membership, qualification: review.qualification }], null,
        ["requester-owned complete scope; no native review binding or inspection inferred"])
      for (const relation of review.relationships) {
        const related = await original("review-relationship", relation.id, request.requester.session_id)
        if (related.status !== "available") throw new Error("Retrospective review relationship unavailable")
        add(related.source, "review-relationship", "available", [{ kind: "review-relationship", relationship: copy(relation) }], null,
          ["original relationship attribution retained; requested scope is separate from observed inspection"])
      }
    }
    return parseRetrospectiveManifest({ format: "loom-retrospective-population/v1", source_store_id: this.automatic.sources.namespace,
      selection, contributors: [...contributors], objective: copy(objective), members: [...members.values()],
      coverage: { objective_count: 1, source_records: records.size - excluded.size, selected_candidates: records.size,
        excluded_records: excluded.size, complete_selected_membership: true, complete_objective_history: "unknown",
        relationship_basis: "all returned relationship continuations exhausted for every selected record page; references outside owner resolution remain unqualified",
        selection_basis: "one authored objective and checked forward originals; not the complete connected Action graph",
        sessions: [...new Set([...records.values()].filter(record => !excluded.has(record.source.record_id)).map(record => record.session_id))].sort(),
        gaps: [...coverageGaps.values()].filter(gap => !["live-not-frozen", "branches-omitted", "ledger-coverage-only"].includes(gap.code)),
        review_access: "requester-owned complete mandates only; other reviews remain unqualified",
        exclusions: selection.exclusions, exclusion_effect: excluded.size ? "explicit supporting-basis gaps; excluded originals are not population members" : "none" },
      qualifications: ["explicit investigator selection; relevance to question is authored, not automatically inferred",
        "frozen membership is not retention or immutability of originals", "native/full-history and external originals remain separate owner dependencies",
        "no inferred independent objective count", "preparation grants no recipient release or execution permit",
        "original-source modification/replacement semantics remain unresolved"] })
  }

  async resolve(actor: Actor, member: RetrospectiveMember, resolver: RetrospectiveSourceResolver, purpose: "inspect" | "prepare" = "inspect") {
    if (member.availability !== "available") return { status: member.availability === "missing" ? "missing" as const : "unsupported" as const }
    const result = await ownerRead({ source_store_id: member.source_store_id, source: member.source, permitted_view: member.permitted_view,
      recipient_session_id: actor.session_id, purpose }, resolver)
    return { status: result.status, ...(result.status === "available" ? { value: result.value } : {}) }
  }

  async validateForPreparation(actor: Actor, population: RetrospectivePopulation, resolver: RetrospectiveSourceResolver) {
    for (const member of population.manifest.members) {
      const current = await this.resolve(actor, member, resolver, "prepare")
      // Unknown originals recorded at freeze remain declared gaps. A previously
      // available original cannot be silently replaced or waived by preparation.
      if (member.availability === "available" && current.status !== "available") throw new Error("Retrospective preparation source unavailable or changed")
    }
  }

  async page(actor: Actor, manifest: RetrospectiveManifest, resolver: RetrospectiveSourceResolver,
    input: { after?: unknown; limit?: unknown; population?: RetrospectivePopulation } = {}) {
    const after = pageInteger(input.after, 0, 0, manifest.members.length), limit = pageInteger(input.limit, 20, 1, 50)
    const { members, ...header } = manifest, sha256 = retrospectiveDigest(manifest), frozen = input.population
    const items: Array<RetrospectiveMember & { ordinal: number; current: { status: string }; inspect: Record<string, unknown> | null }> = []
    const query = frozen ? { operation: "population", population_id: frozen.population_id, manifest_sha256: sha256 }
      : { operation: "preview-population", selection: manifest.selection }
    const result = { format: "loom-retrospective-population-view/v1", state: frozen ? "frozen" : "preview",
      population_id: frozen?.population_id ?? null, manifest_sha256: sha256, manifest: header, member_count: members.length,
      owner_session: frozen?.owner_session ?? actor.session_id, frozen_by: frozen?.frozen_by ?? null, created_at: frozen?.created_at ?? null,
      items, navigation: { repeat: { ...query, after, limit }, next: null as Record<string, unknown> | null },
      freeze: frozen ? null : { operation: "freeze-population", selection: manifest.selection, preview_sha256: sha256 },
      availability_scope: "current page only; frozen membership and qualifications remain unchanged", execution_permit: null }
    for (let index = after; index < Math.min(members.length, after + limit); index++) {
      const member = members[index]!, resolved = await this.resolve(actor, member, resolver)
      const item = { ...member, ordinal: index + 1, current: { status: resolved.status }, inspect: frozen ? { operation: "population-source",
        population_id: frozen.population_id, manifest_sha256: sha256, member_key: member.key } : null }
      const next = index + 1 < members.length ? { ...query, after: index + 1, limit } : null
      try {
        const text = canonical({ ...result, items: [...items, item], navigation: { ...result.navigation, next } }, new ProcessingBudget(180000))
        if (Buffer.byteLength(text, "utf8") > 180000) throw new ProcessingLimitError("Retrospective page exceeds response budget")
      } catch (error) { if (!(error instanceof ProcessingLimitError) || !items.length) throw error; break }
      items.push(item)
    }
    const end = after + items.length
    result.navigation.next = end < members.length ? { ...query, after: end, limit } : null
    return result
  }
}
export type RetrospectivePopulationView = Awaited<ReturnType<RetrospectivePopulations["page"]>>
