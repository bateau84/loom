import { canonical, digest, ProcessingBudget, ProcessingLimitError, uid, type Actor } from "./model.js"
import { RECORD_KINDS, type Store } from "./store.js"
import type { AutomaticLearning } from "./automatic-learning.js"
import type { EvaluationSourceRef } from "./evaluation-store.js"
import type { EngineeringHistoryQuery, EngineeringHistoryRecord, EngineeringHistoryRelationship, EngineeringHistoryView } from "./engineering-history.js"
import type { EngineeringHistoryOwners } from "./engineering-trajectories.js"
import type { ObjectiveIndex } from "./objectives.js"
import { evaluationFrontier, evaluationTarget, type EvaluationCutoff, type EvaluationSubject, type EvaluationTarget } from "./evaluation-subject.js"
import type { LearningFrontier } from "./learning-sources.js"
import { parseRetrospectiveManifest, retrospectiveDigest, retrospectiveMemberKey, retrospectiveBudget,
  type RetrospectiveManifest, type RetrospectiveMember, type RetrospectivePopulation, type RetrospectiveSelection } from "./retrospective-contract.js"

export type RetrospectiveSourceRequest = {
  source_store_id: string; source: EvaluationSourceRef; permitted_view: string;
  recipient_session_id: string; purpose: "preview" | "inspect" | "prepare" | "execute";
}
export type RetrospectiveSourceResolution = {
  source_store_id: string; source: EvaluationSourceRef; permitted_view: string; recipient_session_id: string;
  status: "available" | "missing" | "changed" | "unresolved" | "unsupported"; value?: Record<string, unknown>;
  gap?: { code: string; detail: string };
}
/** The owner must await its actual inspection/recipient-policy checks. An exact
 * source return authorizes this reader only, never a future Evaluator recipient. */
export type RetrospectiveSourceResolver = (request: RetrospectiveSourceRequest) => Promise<RetrospectiveSourceResolution>
export type RetrospectiveOriginalDescriptor = { source_store_id: string; permitted_view: string; source?: EvaluationSourceRef }
export type RetrospectiveOriginalSelector = (source: EvaluationSourceRef) => RetrospectiveOriginalDescriptor | undefined
export type RetrospectiveHistory = {
  query: EngineeringHistoryQuery; view: EngineeringHistoryView; owners: EngineeringHistoryOwners;
  associations?: ReturnType<ObjectiveIndex["retrospectiveSources"]>; contributors: string[];
}
export type RetrospectiveProposal = {
  question: string; exclusions: Array<{ record_id: string; reason: string }>;
  through?: number; owner_boundary?: RetrospectiveSelection["owner_boundary"]; owner_version?: string;
} & ({ mode: "explicit-objective"; objective_id: string } | { mode: "explicit-subject"; target: EvaluationTarget;
  subject_id?: string; subject_sha256?: string; frontier?: LearningFrontier; namespace_frontier?: LearningFrontier; cutoff?: EvaluationCutoff })
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
  if (!object(raw) || Object.keys(raw).some(key => !["mode", "objective_id", "target", "subject_id", "subject_sha256", "frontier", "namespace_frontier", "cutoff", "question", "exclusions", "through", "owner_boundary", "owner_version"].includes(key)))
    throw new Error("Invalid retrospective selection")
  const subjectMode = raw.mode === "explicit-subject" || raw.target !== undefined
  if (raw.mode !== undefined && raw.mode !== (subjectMode ? "explicit-subject" : "explicit-objective")) throw new Error("Unsupported retrospective selection policy")
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
  let proposal: RetrospectiveProposal
  if (subjectMode) {
    if (raw.objective_id !== undefined || (raw.subject_id === undefined) !== (raw.subject_sha256 === undefined)) throw new Error("Invalid retrospective subject selection")
    proposal = { mode: "explicit-subject", target: evaluationTarget(raw.target), question: raw.question, exclusions: selected }
    if (raw.subject_id !== undefined) {
      proposal.subject_id = uid(raw.subject_id, "subject_id")
      if (typeof raw.subject_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.subject_sha256)) throw new Error("Invalid retrospective subject fingerprint")
      proposal.subject_sha256 = raw.subject_sha256
    }
    if (raw.frontier !== undefined) proposal.frontier = evaluationFrontier(raw.frontier)
    if (raw.namespace_frontier !== undefined) proposal.namespace_frontier = evaluationFrontier(raw.namespace_frontier)
    if (raw.cutoff !== undefined) {
      if (!object(raw.cutoff) || !["point-in-time", "recorded-completion"].includes(String(raw.cutoff.kind))) throw new Error("Invalid retrospective cutoff")
      proposal.cutoff = JSON.parse(canonical(raw.cutoff)) as EvaluationCutoff
    }
  } else {
    if (["subject_id", "subject_sha256", "frontier", "namespace_frontier", "cutoff"].some(key => raw[key] !== undefined)) throw new Error("Invalid legacy retrospective selection")
    proposal = { mode: "explicit-objective", objective_id: uid(raw.objective_id, "objective_id"), question: raw.question, exclusions: selected }
  }
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

export function subjectSelection(subject: EvaluationSubject, ownerVersion = digest({ frontier: subject.through })): Extract<RetrospectiveSelection, { mode: "explicit-subject" }> {
  return { mode: "explicit-subject", target: subject.target, subject_id: subject.subject_id, subject_sha256: subject.sha256,
    question: subject.question, through: subject.through.ledger, frontier: subject.through, cutoff: subject.cutoff,
    ...(subject.namespace_frontier ? { namespace_frontier: subject.namespace_frontier } : {}),
    owner_boundary: { objective_links: subject.through.objective_links, review_requests: subject.through.review_requests,
      review_relationships: subject.through.review_relationships }, owner_version: ownerVersion, exclusions: [] }
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
  } else if (!["missing", "changed", "unresolved", "unsupported"].includes(result.status) || result.value !== undefined)
    throw new Error("Invalid retrospective source-owner result")
  if (result.gap !== undefined && (result.status === "available" || !object(result.gap)
    || typeof result.gap.code !== "string" || result.gap.code.length > 120
    || typeof result.gap.detail !== "string" || result.gap.detail.length > 2000))
    throw new Error("Invalid retrospective source-owner gap")
  return result
}

/** Selection and readback reuse the original owners. Only manifest metadata is
 * persisted by EvaluationStore; no source bytes, model clients or dispatch path. */
export class RetrospectivePopulations {
  constructor(private readonly automatic: AutomaticLearning, private readonly store: Store) {}

  async preview(actor: Actor, proposal: RetrospectiveProposal, history: RetrospectiveHistory, resolver: RetrospectiveSourceResolver,
    selectOriginal: RetrospectiveOriginalSelector = () => undefined): Promise<RetrospectiveManifest> {
    const { owners, associations } = history
    if (history.query.through === undefined) throw new Error("Retrospective source boundary unavailable")
    const objectiveID = proposal.mode === "explicit-objective" ? proposal.objective_id : proposal.target.kind === "objective" ? proposal.target.id : undefined
    const objective = objectiveID ? owners.objectives?.objectives.find(item => item.id === objectiveID) : undefined
    if (objectiveID && (!associations || !owners.objectives || !objective)) throw new Error("Retrospective objective owner unavailable")
    let selection: RetrospectiveSelection
    if (proposal.mode === "explicit-objective") selection = { ...proposal, through: history.query.through, owner_boundary: owners.boundary, owner_version: owners.version }
    else {
      const subject = proposal.subject_id ? this.automatic.subjects.read(proposal.subject_id, actor.session_id, proposal.subject_sha256) : null
      if (subject && (canonical(subject.target) !== canonical(proposal.target) || subject.question !== proposal.question)) throw new Error("Retrospective subject mismatch")
      if (!subject && proposal.cutoff?.kind === "recorded-completion") {
        const completion = this.automatic.sources.recordedCompletion(proposal.target, proposal.cutoff.record.id)
        if (canonical(completion.ref) !== canonical(proposal.cutoff.record) || completion.sequence !== history.query.through)
          throw new Error("Recorded completion original does not match the preview boundary")
      }
      const frontier = subject?.through ?? proposal.frontier ?? { ...this.automatic.sources.targetFrontier(proposal.target), ledger: history.query.through,
        objective_links: owners.boundary.objective_links ?? 0, review_requests: owners.boundary.review_requests, review_relationships: owners.boundary.review_relationships }
      if (frontier.ledger !== history.query.through || owners.boundary.objective_links !== frontier.objective_links
        || owners.boundary.review_requests !== frontier.review_requests || owners.boundary.review_relationships !== frontier.review_relationships)
        throw new Error("Retrospective source owners exceed the established subject")
      if (subject && proposal.namespace_frontier && canonical(proposal.namespace_frontier) !== canonical(subject.namespace_frontier ?? frontier))
        throw new Error("Retrospective namespace frontier differs from the established subject")
      // Preview uses the ceiling captured before shared-history discovery. A
      // legacy or caller-supplied boundary without one is kept conservative.
      const namespace = subject ? subject.namespace_frontier : proposal.namespace_frontier ?? frontier
      selection = { mode: "explicit-subject", target: proposal.target, question: proposal.question, through: history.query.through,
        owner_boundary: owners.boundary, owner_version: owners.version, exclusions: proposal.exclusions, frontier,
        ...(namespace ? { namespace_frontier: namespace } : {}),
        cutoff: subject?.cutoff ?? proposal.cutoff ?? { kind: "point-in-time" },
        ...(subject ? { subject_id: subject.subject_id, subject_sha256: subject.sha256 } : {}) }
    }
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
    // Session and Action overview highlights are representative, never the
    // selected population. The shared discovery model pages every record.
    if (proposal.mode === "explicit-subject" && page.mode === "overview")
      page = read({ ...history.query, record_kinds: [...RECORD_KINDS], limit: 50 })
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
    const activityExcluded = new Set([...records.values()].filter(record => this.automatic.sources.isEvaluation({ kind: "ledger-record",
      id: record.source.record_id, session_id: record.session_id, revision: String(record.sequence), sha256: record.source.sha256, required: true })).map(record => record.source.record_id))
    for (const id of activityExcluded) excluded.add(id)
    const includedRefs = new Set([...records.values()].filter(record => !excluded.has(record.source.record_id)).map(record => record.ref))
    const allRefs = new Set([...records.values()].map(record => record.ref))
    for (const [key, relation] of relationships) if (allRefs.has(relation.to))
      relationships.set(key, { ...relation, target: includedRefs.has(relation.to) ? "included" : "in-scope-not-included" })
    const members = new Map<string, RetrospectiveMember>(), contributors = new Set(history.contributors)
    const add = (source: EvaluationSourceRef, view: string, availability: RetrospectiveMember["availability"], basis: Record<string, unknown>[],
      historical_scope: Record<string, unknown> | null, qualifications: string[], sourceStoreID = this.automatic.sources.namespace) => {
      const key = retrospectiveMemberKey(sourceStoreID, source, view), prior = members.get(key)
      if (source.session_id) contributors.add(source.session_id)
      const uniqueBasis = [...new Map([...(prior?.basis ?? []), ...basis].map(item => [fingerprint(item), item])).entries()]
        .sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => item)
      members.set(key, { key, source_store_id: sourceStoreID, source, permitted_view: view, availability,
        basis: uniqueBasis, historical_scope, qualifications: [...new Set([...(prior?.qualifications ?? []), ...qualifications])].sort() })
    }
    const original = async (kind: string, id: string, session: string, expected?: EvaluationSourceRef) => ownerRead({
      source_store_id: this.automatic.sources.namespace, source: expected ?? { kind, id, session_id: session, required: true },
      permitted_view: LOCAL_VIEWS[kind]!, recipient_session_id: actor.session_id, purpose: "preview",
    }, resolver)
    if (objective) {
      const objectiveSource = await original("objective", objective.id, objective.author_session)
      if (objectiveSource.status !== "available") throw new Error("Retrospective objective original unavailable")
      add(objectiveSource.source, "objective", "available", [{ kind: "selected-objective", question: proposal.question }], null,
        ["authored-objective-identity; originating-request independence unknown"])
    }
    const links = new Map<number, Record<string, unknown>>()
    for (const ref of associations?.links ?? []) {
      const source = await original("objective-link", String(ref.sequence), ref.author_session)
      if (source.status !== "available" || !source.value) throw new Error("Retrospective association original unavailable")
      links.set(ref.sequence, source.value)
      const projection = owners.objectives!.links.find(link => link.sequence === ref.sequence)
      add(source.source, "objective-link", "available", [{ kind: "authored-objective-association", objective_id: objective!.id,
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
          meaning: record.meaning, verification: record.verification, observation: record.observation,
          ...(proposal.mode === "explicit-subject" ? { title: record.title, excerpt: record.excerpt, excerpt_truncated: record.excerpt_truncated,
            recorded_at: record.created_at, sequence: record.sequence } : {}) },
        record.gaps.map(gap => gap.code === "relationships-omitted"
          ? "relationships-omitted in initial history page; returned continuations are exhausted; references beyond bounded owner resolution remain unqualified"
          : gap.code + ": " + gap.detail))
    }
    // Keep the authored association separately from the selected original. Only
    // a NEW preview can establish the original's identity/version/permitted view.
    // Existing reference-only frozen members never acquire a new identity here.
    for (const [sequence, link] of links) {
      if (typeof link.source_type !== "string" || typeof link.source_id !== "string") throw new Error("Invalid retrospective association source")
      if (link.source_type === "ledger-record" && (records.has(link.source_id) || excluded.has(link.source_id))) continue
      const source: EvaluationSourceRef = { kind: link.source_type, id: link.source_id, required: true,
        ...(typeof link.source_session_id === "string" ? { session_id: link.source_session_id } : {}),
        ...(link.source_type === "native-call" && typeof link.source_message_id === "string" ? { message_id: link.source_message_id } : {}) }
      const basis = [{ kind: "authored-source-reference", objective_id: objective!.id, association_sequence: sequence,
        declared_source: source,
        source_message_id: link.source_message_id ?? null, verification: link.verification, phase: link.phase,
        confidence: link.confidence, gap_reason: link.gap_reason ?? null }]
      const descriptor = selectOriginal(source)
      if (descriptor) {
        const selectedSource = descriptor.source ?? source
        const resolved = await ownerRead({ ...descriptor, source: selectedSource, recipient_session_id: actor.session_id, purpose: "preview" }, resolver)
        add(resolved.status === "available" ? resolved.source : selectedSource, descriptor.permitted_view,
          resolved.status === "changed" ? "unresolved" : resolved.status, basis, null,
          ["authored relationship retained; source retrieval does not establish causation or objective independence",
            "original is only the selected owner representation; inspect its coverage and provenance",
            ...(resolved.status === "available" ? [] : [resolved.gap ? resolved.gap.code + ": " + resolved.gap.detail : "original unavailable during selection"]),
            "no recipient execution or protected transfer authority established"], descriptor.source_store_id)
        continue
      }
      add(source, link.source_type === "ledger-record" ? "record-full" : "reference-only",
        link.source_type === "ledger-record" || link.source_type === "unavailable" ? "missing" : "unsupported",
        basis, null,
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
    return parseRetrospectiveManifest({ format: proposal.mode === "explicit-objective" ? "loom-retrospective-population/v1" : "loom-retrospective-population/v2", source_store_id: this.automatic.sources.namespace,
      selection, contributors: [...contributors], objective: objective ? copy(objective) : { target: proposal.mode === "explicit-subject" ? proposal.target : null,
        intent: history.view.intent, original_intent: "not-independently-established", historical_objective_membership: "unknown; no objective was created" }, members: [...members.values()],
      coverage: { objective_count: objective ? 1 : null, source_records: records.size - excluded.size, selected_candidates: records.size,
        excluded_records: excluded.size, complete_selected_membership: true, complete_objective_history: "unknown",
        relationship_basis: "all returned relationship continuations exhausted for every selected record page; references outside owner resolution remain unqualified",
        selection_basis: objective ? "one authored objective and checked forward originals; not the complete connected Action graph" : "explicit ordinary work scope; separate goals and unknown relationships remain distinct",
        sessions: [...new Set([...records.values()].filter(record => !excluded.has(record.source.record_id)).map(record => record.session_id))].sort(),
        gaps: [...coverageGaps.values()].filter(gap => !["live-not-frozen", "branches-omitted", "ledger-coverage-only"].includes(gap.code)),
        review_access: "requester-owned complete mandates only; other reviews remain unqualified",
        exclusions: selection.exclusions, ...(proposal.mode === "explicit-subject" ? { learning_activity_excluded: activityExcluded.size,
          completion: selection.mode === "explicit-subject" ? selection.cutoff : null } : {}),
        exclusion_effect: excluded.size ? "explicit supporting-basis gaps; excluded originals are not population members" : "none" },
      qualifications: ["explicit investigator selection; relevance to question is authored, not automatically inferred",
        "frozen membership is not retention or immutability of originals", "original coverage is limited to each selected source-owner view; native full history remains unavailable",
        "no inferred independent objective count", "preparation grants no recipient release or execution permit",
        "original-source modification/replacement semantics remain unresolved"] })
  }

  /** Exact committed increment sources, not a new history discovery. The caller
   * supplies a subject established before deterministic processing began. */
  fromSources(subject: EvaluationSubject, refs: EvaluationSourceRef[]): RetrospectiveManifest {
    const retained = this.automatic.subjects.read(subject.subject_id, subject.owner_session, subject.sha256)
    if (canonical(retained) !== canonical(subject) || refs.length > 20000) throw new Error("Increment subject unavailable")
    const budget = retrospectiveBudget(), members = new Map<string, RetrospectiveMember>(), contributors = new Set<string>()
    const axes: Readonly<Record<string, keyof LearningFrontier>> = { "ledger-record": "ledger", objective: "objectives", "objective-link": "objective_links",
      "review-request": "review_requests", "review-relationship": "review_relationships" }
    for (const ref of refs) {
      const axis = axes[ref.kind], position = Number(ref.revision)
      if (!axis || !ref.session_id || !Number.isSafeInteger(position) || position < 1 || position > subject.through[axis])
        throw new Error("Increment source exceeds established subject")
      const source = this.automatic.sources.resolve(ref, subject.source_store_id)
      if (!source) throw new Error("Increment original unavailable")
      canonical(source.value, budget)
      if (subject.target.kind === "session" && ref.session_id !== subject.target.id
        || subject.target.kind === "action" && ref.kind === "ledger-record" && source.value.action_id !== subject.target.id)
        throw new Error("Increment source is outside its typed subject")
      const permitted_view = LOCAL_VIEWS[ref.kind]!, key = retrospectiveMemberKey(subject.source_store_id, ref, permitted_view)
      contributors.add(ref.session_id)
      members.set(key, { key, source_store_id: subject.source_store_id, source: ref, permitted_view, availability: "available",
        basis: [{ kind: "committed-increment-original", subject_id: subject.subject_id }], historical_scope: null,
        qualifications: ["Exact original retained by the committed increment; not an independently authored objective or verified outcome."] })
    }
    return parseRetrospectiveManifest({ format: "loom-retrospective-population/v2", source_store_id: subject.source_store_id,
      selection: subjectSelection(subject), contributors: [...contributors], objective: { target: subject.target, question: subject.question,
        original_intent: "not-independently-established", historical_objective_membership: "not-inferred" }, members: [...members.values()],
      coverage: { source_records: members.size, complete_selected_membership: true, complete_objective_history: "unknown",
        selection_basis: "exact successful increment sources; no whole-history rediscovery", completion: subject.cutoff },
      qualifications: ["Accumulated interpretation is outside the original conversation.", "Idle and checkpoint completion do not imply engineering completion.",
        "Original availability and protected disclosure are rechecked by their existing owners."] })
  }

  async resolve(actor: Actor, member: RetrospectiveMember, resolver: RetrospectiveSourceResolver, purpose: "inspect" | "prepare" | "execute" = "inspect") {
    if (member.source_store_id === this.automatic.sources.namespace && this.automatic.sources.isEvaluation(member.source))
      return { status: "changed" as const, gap: { code: "learning-activity-excluded", detail: "This exact original is now causally identified as learning activity. Historical membership is retained, but dependent interpretation is withheld." } }
    if (member.availability !== "available") return { status: member.availability,
      gap: { code: "unresolved-at-freeze", detail: "No original version was selected. A fresh preview and explicit freeze are required to establish a new source identity." } }
    if (purpose === "execute" && ["native-message", "native-call"].includes(member.source.kind)
        && member.source.session_id !== actor.session_id) return { status: "unsupported" as const,
      gap: { code: "unsupported-source-release", detail: "A fresh Evaluator cannot inherit another Session's native original access." } }
    const result = await ownerRead({ source_store_id: member.source_store_id, source: member.source, permitted_view: member.permitted_view,
      recipient_session_id: actor.session_id, purpose }, resolver)
    return { status: result.status, ...(result.status === "available" ? { value: result.value } : {}), ...(result.gap ? { gap: result.gap } : {}) }
  }

  async validateForPreparation(actor: Actor, population: RetrospectivePopulation, resolver: RetrospectiveSourceResolver) {
    return this.validateSources(actor, population, resolver, "prepare")
  }

  /** The same frozen-availability rule applies to a qualified execution
   * recipient. This checks originals, never grants population disclosure. */
  async validateSources(actor: Actor, population: RetrospectivePopulation, resolver: RetrospectiveSourceResolver, purpose: "prepare" | "execute" | "inspect") {
    for (const member of population.manifest.members) {
      const current = await this.resolve(actor, member, resolver, purpose)
      // Unknown originals recorded at freeze remain declared gaps. A previously
      // available original cannot be silently replaced or waived by preparation.
      if (member.availability === "available" && current.status !== "available") throw new Error("Retrospective preparation source unavailable or changed")
    }
  }

  async page(actor: Actor, manifest: RetrospectiveManifest, resolver: RetrospectiveSourceResolver,
    input: { after?: unknown; limit?: unknown; population?: RetrospectivePopulation } = {}) {
    const after = pageInteger(input.after, 0, 0, manifest.members.length), limit = pageInteger(input.limit, 20, 1, 50)
    const { members, ...header } = manifest, sha256 = retrospectiveDigest(manifest), frozen = input.population
    const items: Array<RetrospectiveMember & { ordinal: number; current: { status: string; gap?: { code: string; detail: string } }; inspect: Record<string, unknown> | null }> = []
    const query = frozen ? { operation: "population", population_id: frozen.population_id, manifest_sha256: sha256 }
      : { operation: "preview-population", selection: manifest.selection }
    const result = { format: "loom-retrospective-population-view/v1", state: frozen ? "frozen" : "preview",
      population_id: frozen?.population_id ?? null, manifest_sha256: sha256, manifest: header, member_count: members.length,
      owner_session: frozen?.owner_session ?? actor.session_id, frozen_by: frozen?.frozen_by ?? null, created_at: frozen?.created_at ?? null,
      items, navigation: { repeat: { ...query, after, limit }, next: null as Record<string, unknown> | null },
      freeze: frozen || !members.length || manifest.selection.mode === "explicit-subject" && !manifest.selection.subject_id ? null
        : { operation: "freeze-population", selection: manifest.selection, preview_sha256: sha256 },
      ...(!members.length ? { freeze_unavailable: "No eligible evidence exists within this boundary. The read-only preview remains available; a later increment needs a new subject." } : {}),
      ...(manifest.selection.mode === "explicit-subject" && manifest.selection.subject_id && actor.session_id === frozen?.owner_session
        ? { activity: { operation: "subject-activities", subject_id: manifest.selection.subject_id, subject_sha256: manifest.selection.subject_sha256 } }
        : manifest.selection.mode === "explicit-subject" && manifest.selection.subject_id && !frozen
          ? { activity: { operation: "subject-activities", subject_id: manifest.selection.subject_id, subject_sha256: manifest.selection.subject_sha256 } } : {}),
      ...(manifest.selection.mode === "explicit-subject" && !manifest.selection.subject_id ? { establish: { operation: "establish-subject",
        target: manifest.selection.target, question: manifest.selection.question, cutoff: manifest.selection.cutoff.kind === "recorded-completion"
          ? { kind: "recorded-completion", record_id: manifest.selection.cutoff.record.id } : { kind: "point-in-time" } } } : {}),
      availability_scope: "current page only; frozen membership and qualifications remain unchanged", execution_permit: null }
    for (let index = after; index < Math.min(members.length, after + limit); index++) {
      const member = members[index]!, resolved = await this.resolve(actor, member, resolver)
      const item = { ...member, ordinal: index + 1, current: { status: resolved.status, ...(resolved.gap ? { gap: resolved.gap } : {}) }, inspect: frozen ? { operation: "population-source",
        population_id: frozen.population_id, manifest_sha256: sha256, member_key: member.key }
        : { operation: "preview-source", selection: manifest.selection, preview_sha256: sha256, member_key: member.key } }
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
