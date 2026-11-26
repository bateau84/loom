import { digest, ProcessingLimitError, uid } from "./model.js"
import type { WorkRef } from "./collaboration.js"
import type { ObjectiveHistorySnapshot } from "./objectives.js"
import type { ReviewHistorySnapshot } from "./review-requests.js"
import type { EngineeringHistoryGap, EngineeringHistoryOwnerBoundary, EngineeringHistoryQuery,
  EngineeringHistoryRelationship, EngineeringHistoryScope } from "./engineering-history.js"

/** Authorized, insertion-bound snapshots supplied by the existing owners. This
 * transient projection has no persistence, source reader or execution authority. */
export type EngineeringHistoryOwners = {
  objectives?: ObjectiveHistorySnapshot; reviews?: ReviewHistorySnapshot;
  record_ids?: string[];
  boundary: EngineeringHistoryOwnerBoundary; version: string;
}
type Objective = ObjectiveHistorySnapshot["objectives"][number]
type ObjectiveLink = ObjectiveHistorySnapshot["links"][number]
type Review = ReviewHistorySnapshot["requests"][number]
export type EngineeringHistoryConnections = {
  objectives: Array<{ ref: string; objective: Objective; links: ObjectiveLink[]; links_omitted: number;
    expand: EngineeringHistoryQuery; details: EngineeringHistoryQuery;
    source: { tool: "loom_objective"; query: { operation: "read"; objective_id: string }; sha256: string } }>;
  reviews: Array<{ ref: string; request: Review["request"]; frozen_work_membership: Review["frozen_work_membership"];
    relationships: Review["relationships"]; relationships_omitted: number; qualification: Review["qualification"]; details: EngineeringHistoryQuery;
    source: { tool: "loom_review"; query: { operation: "read"; request_id: string }; sha256: string } }>;
  coverage: { objectives_omitted: number; reviews_omitted: number; relationships_omitted: number;
    page: "summary" | ConnectionPosition["kind"];
    review_access: "caller-owned only; prepared evaluations excluded"; membership: "explicit source associations; not inferred causation" };
  gaps: EngineeringHistoryGap[];
  context?: { record_refs: string[]; read: EngineeringHistoryQuery };
}
type ConnectionPosition = { kind: "groups"; offset: number } | { kind: "relationships"; offset: number }
  | { kind: "objective-links"; offset: number; owner_id: string } | { kind: "review-relationships"; offset: number; owner_id: string }
type RecordIdentity = { id: string; seq: number; work_ref?: WorkRef | null }
type Edge = EngineeringHistoryRelationship
const LIMITS = { edges: 200000, connected: 10000 }
const gap = (code: string, detail: string): EngineeringHistoryGap => ({ code, detail })
const edgeKey = (edge: Edge) => JSON.stringify([edge.from, edge.to, edge.kind, edge.provenance?.owner, edge.provenance?.id])

function connectionPosition(value: string | undefined, binding: string): ConnectionPosition | undefined {
  if (value === undefined) return undefined
  const invalid = () => new Error("History connection cursor is invalid or belongs to another selection; use the returned request")
  if (typeof value !== "string" || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid()
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) } catch { throw invalid() }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid()
  const data = parsed as Record<string, unknown>
  if (data.version !== 1 || data.binding !== binding || typeof data.offset !== "number"
    || !Number.isSafeInteger(data.offset) || data.offset < 0 || data.offset > LIMITS.edges) throw invalid()
  const kind = data.kind, offset = data.offset
  if (kind === "groups" || kind === "relationships") {
    if (Object.keys(data).sort().join(",") !== "binding,kind,offset,version") throw invalid()
    return { kind, offset }
  }
  if (kind !== "objective-links" && kind !== "review-relationships"
    || Object.keys(data).sort().join(",") !== "binding,kind,offset,owner_id,version") throw invalid()
  return { kind, offset, owner_id: uid(data.owner_id, "connection owner") }
}

/** A per-read adjacency projection over explicit source relationships. A path is
 * navigational relevance with its recorded qualifications, never causal proof. */
export class EngineeringConnections {
  private readonly edges: Edge[] = []
  private readonly neighbors = new Map<string, Set<string>>()
  private readonly recordIDs = new Map<string, string>()
  private readonly objectiveRefs = new Map<string, string>()
  private readonly reviewRefs = new Map<string, string>()
  private readonly workRecords = new Map<string, string[]>()
  private readonly identities = new Set<string>()
  private readonly referenceGaps = new Map<string, { unresolved: number; omitted: number }>()
  constructor(private readonly storeID: string, private readonly scope: EngineeringHistoryScope,
    private readonly owners: EngineeringHistoryOwners | undefined, private readonly records: Map<string, RecordIdentity>) {
    for (const [id, record] of records) {
      this.recordIDs.set(this.recordRef(id), id)
      if (record.work_ref) {
        const key = digest(record.work_ref), ids = this.workRecords.get(key) ?? []
        ids.push(id); this.workRecords.set(key, ids)
      }
    }
    for (const objective of owners?.objectives?.objectives ?? []) this.objectiveRefs.set(objective.id, this.ownerRef("objective", objective.id))
    for (const item of owners?.reviews?.requests ?? []) this.reviewRefs.set(item.request.request_id, this.ownerRef("review", item.request.request_id))
    this.objectiveEdges()
    this.reviewEdges()
  }
  private recordRef(id: string) { return `loom-record:${encodeURIComponent(this.storeID)}:${encodeURIComponent(id)}` }
  private ownerRef(owner: string, id: string) { return `loom-${owner}:${encodeURIComponent(this.storeID)}:${encodeURIComponent(id)}` }
  private add(edge: Edge) {
    const key = JSON.stringify([edge.from, edge.to, edge.kind, edge.provenance?.owner, edge.provenance?.id])
    if (this.identities.has(key)) return
    if (this.edges.length >= LIMITS.edges) throw new ProcessingLimitError("History relationship projection exceeds its bounded read; narrow the source scope")
    this.identities.add(key); this.edges.push(edge)
    for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const set = this.neighbors.get(from) ?? new Set<string>()
      set.add(to); this.neighbors.set(from, set)
    }
  }
  addRecord(from: string, to: string, kind: string, meaning: "observed" | "authored", qualification: string) {
    if (!this.records.has(from) || !this.records.has(to) || from === to) return
    this.add({ from: this.recordRef(from), to: this.recordRef(to), kind, meaning, source_record_id: from,
      target: "in-scope-not-included", qualification, provenance: { owner: "ledger", id: from } })
  }
  recordReferences(recordID: string, unresolved: number, omitted: number) {
    if (unresolved || omitted) this.referenceGaps.set(recordID, { unresolved, omitted })
  }
  /** Ordinary pages retain their existing per-source bound; all relationship
   * pages share the same resolved ledger edges and source qualifications. */
  projectLedgerRelationships(selected: Set<string>, perRecordLimit: number): EngineeringHistoryRelationship[] {
    const refs = new Set([...selected].map(id => this.recordRef(id)))
    return [...selected].flatMap(id => this.edges.filter(edge => edge.provenance?.owner === "ledger" && edge.source_record_id === id)
      .slice(0, perRecordLimit).map(edge => ({ ...edge, target: refs.has(edge.to) ? "included" as const : "in-scope-not-included" as const })))
  }
  recordGaps(recordID: string, projected: EngineeringHistoryRelationship[]): EngineeringHistoryGap[] {
    const references = this.edges.filter(edge => edge.provenance?.owner === "ledger" && edge.source_record_id === recordID)
    const key = (edge: Edge) => JSON.stringify([edge.from, edge.to, edge.kind])
    const returned = new Set(projected.filter(edge => edge.provenance?.owner === "ledger" && edge.source_record_id === recordID).map(key))
    const counts = this.referenceGaps.get(recordID)
    const omitted = (counts?.omitted ?? 0) + references.filter(edge => !returned.has(key(edge))).length
    return [...(counts?.unresolved ? [gap("relationships-unresolved", `${counts.unresolved} authored relationship references could not be resolved inside this selected source scope and boundary. No outside target identities or existence claims are disclosed.`)] : []),
      ...(omitted ? [gap("relationships-omitted", `${omitted} additional authored relationship references are omitted from this bounded projection; follow the returned relationship continuation for resolved references, or inspect the exact source record for references beyond this bounded resolution.`)] : [])]
  }
  private objectiveEdges() {
    const snapshot = this.owners?.objectives
    if (!snapshot) return
    const bySequence = new Map(snapshot.links.map(link => [link.sequence, link]))
    for (const link of snapshot.links) {
      if (link.source_type !== "ledger-record" || !this.records.has(link.source_id)) continue
      const objective = this.objectiveRefs.get(link.objective_id)
      if (!objective) continue
      const provenance: NonNullable<Edge["provenance"]> = { owner: "objective", id: `${link.objective_id}:${link.sequence}`,
        author_session: link.author_session, author_agent: link.author_agent, confidence: link.confidence,
        association_status: link.current_relationship, source_verification: link.verification, recorded_at: link.recorded_at }
      const meaning = link.confidence === "uncertain" ? "candidate" : "authored"
      this.add({ from: objective, to: this.recordRef(link.source_id), kind: "objective-association", meaning,
        source_record_id: link.source_id, target: "in-scope-not-included", provenance,
        qualification: `Authored ${link.phase}; association ${link.current_relationship}. Source resolution is not native provenance or correctness.` })
      const prior = link.related_sequence === null ? undefined : bySequence.get(link.related_sequence)
      if (!prior || prior.objective_id !== link.objective_id || prior.source_type !== "ledger-record" || !this.records.has(prior.source_id)) continue
      if (prior.source_id === link.source_id) continue
      const kind = link.phase === "link-correction" ? "corrects-objective-association" : link.relation ?? "authored-phase-association"
      this.add({ from: this.recordRef(link.source_id), to: this.recordRef(prior.source_id), kind, meaning,
        source_record_id: link.source_id, target: "in-scope-not-included", provenance,
        qualification: link.phase === "link-correction"
          ? "This sourced confirm/reject judgment corrects the objective association. It does not change the truth or original meaning of the underlying engineering claim."
          : link.relation ? `Authored '${link.relation}', with original confidence retained; not independent verification or release acceptance.`
            : `The author connected these sources under phase '${link.phase}'. No stronger correction, verification or causal meaning is inferred.` })
    }
  }
  private reviewEdges() {
    const requests = this.owners?.reviews?.requests ?? []
    const relations = new Map(requests.flatMap(item => item.relationships.map(relation => [relation.id, relation] as const)))
    for (const item of requests) {
      const request = item.request, ref = this.reviewRefs.get(request.request_id)!
      for (const relation of item.relationships) {
        if (!this.records.has(relation.source_record_id)) continue
        const source = this.recordRef(relation.source_record_id)
        const provenance: NonNullable<Edge["provenance"]> = { owner: "review", id: relation.id,
          author_session: relation.author.session_id, author_agent: relation.author.agent }
        this.add({ from: ref, to: source, kind: `review-${relation.relationship}`,
          meaning: relation.relationship_attribution.status === "established" ? "observed" : "authored", source_record_id: relation.source_record_id,
          target: "in-scope-not-included", provenance,
          qualification: relation.relationship === "retrieved"
            ? "The qualified source-return receipt establishes retrieval of the identified source at its stated boundary. It does not establish inspection, complete mandate coverage or native review invocation."
            : "The relationship is authored; its original attribution and unknown native review binding remain controlling. A declared pass applies only to its stated scope." })
        if (relation.supersedes) {
          const prior = relations.get(relation.supersedes)
          if (prior && prior.request_id === request.request_id && this.records.has(prior.source_record_id)) this.add({
            from: source, to: this.recordRef(prior.source_record_id), kind: "review-correction", meaning: "authored",
            source_record_id: relation.source_record_id, target: "in-scope-not-included", provenance,
            qualification: "The author recorded a correction to this exact earlier review relationship. The original record and requested members remain unchanged; no successful recheck is inferred." })
        }
      }
      for (const member of request.members) {
        const provenance: NonNullable<Edge["provenance"]> = { owner: "review", id: `${request.request_id}:${member.member_id}`,
          author_session: request.requester.session_id, author_agent: request.requester.agent }
        for (const id of member.producing_attempt_refs) if (this.records.has(id)) this.add({
          from: ref, to: this.recordRef(id), kind: "requested-producing-attempt", meaning: "authored", source_record_id: id,
          target: "in-scope-not-included", provenance,
          qualification: "This frozen review member explicitly requested the identified producing attempt. Membership is requested scope, not proof that the review inspected or verified it." })
        const requestedWork = item.frozen_work_membership.find(work => work.member_id === member.member_id)
        for (const constituent of requestedWork?.constituents ?? []) for (const id of this.workRecords.get(digest(constituent)) ?? []) this.add({
          from: ref, to: this.recordRef(id), kind: "requested-work-member", meaning: "authored", source_record_id: id,
          target: "in-scope-not-included", provenance,
          qualification: "The record has an exact established historical WorkRef in this member's frozen requested population. Requested work membership does not establish a producing attempt, inspection, verification or acceptance. Current Plan structure and contextual ancestors or dependencies do not add membership." })
        const prior = member.prior_review_request_id === null ? undefined : this.reviewRefs.get(member.prior_review_request_id)
        if (prior) this.add({ from: ref, to: prior, kind: "requested-prior-review", meaning: "authored", source_record_id: null,
          target: "in-scope-not-included", provenance,
          qualification: "The frozen member explicitly names this prior review as requested scope. It does not establish that the later review inspected or verified the prior review or its findings." })
      }
      for (const recheck of request.rechecks) {
        const original = this.reviewRefs.get(recheck.request_id)
        if (original) this.add({ from: ref, to: original, kind: "requested-recheck", meaning: "authored", source_record_id: null,
          target: "in-scope-not-included", provenance: { owner: "review", id: request.request_id,
            author_session: request.requester.session_id, author_agent: request.requester.agent },
          qualification: "The later mandate requested a recheck of named prior relationships. Actual retrieved/cited/claimed-inspected scope and declared outcomes are separate evidence." })
        for (const id of recheck.finding_ids) {
          const target = relations.get(id)
          if (target?.request_id === recheck.request_id && this.records.has(target.source_record_id)) this.add({
            from: ref, to: this.recordRef(target.source_record_id), kind: "requested-recheck-target", meaning: "authored",
            source_record_id: target.source_record_id, target: "in-scope-not-included", provenance: { owner: "review", id },
            qualification: "This exact finding/correction relationship was a requested recheck target. This edge alone does not say that it was actually inspected or resolved." })
        }
      }
    }
  }
  reachable(recordID?: string, objectiveID?: string): Set<string> {
    const seed = recordID ? this.recordRef(recordID) : objectiveID ? this.objectiveRefs.get(objectiveID) : undefined
    if (!seed) throw new Error("History trajectory seed is unavailable in the selected scope")
    const seen = new Set([seed]), queue = [seed]
    for (let i = 0; i < queue.length; i++) {
      for (const target of this.neighbors.get(queue[i]) ?? []) if (!seen.has(target)) {
        if (seen.size >= LIMITS.connected) throw new ProcessingLimitError("Connected history exceeds 10000 identities; select a narrower Session or objective scope")
        seen.add(target); queue.push(target)
      }
    }
    return new Set([...seen].flatMap(ref => { const id = this.recordIDs.get(ref); return id ? [id] : [] }))
  }
  private applicable(selected: Set<string>, actionOverview: boolean) {
    const objectiveIDs = new Set((this.owners?.objectives?.links ?? []).filter(link => selected.has(link.source_id)).map(link => link.objective_id))
    if ("objective_id" in this.scope) objectiveIDs.add(this.scope.objective_id)
    const objectives = (this.owners?.objectives?.objectives ?? []).filter(item => objectiveIDs.has(item.id))
    // A pending recheck can name a correction without having produced any
    // evidence of its own. Include its exact mandate through that explicit
    // target, then retain the original mandate along requested-recheck edges.
    // Both snapshots have already passed requester and complete-scope checks.
    const availableReviews = new Set(this.reviewRefs.values())
    // The Action owner can admit a frozen requested WorkRef before any ledger
    // record carries it. Root discovery inventories those mandates without
    // inventing a record edge; focused reads still require explicit adjacency.
    const applicableReviews = new Set<string>(actionOverview ? availableReviews : [])
    for (const id of selected) for (const ref of this.neighbors.get(this.recordRef(id)) ?? []) {
      if (availableReviews.has(ref)) applicableReviews.add(ref)
    }
    const pendingReviews = [...applicableReviews]
    for (let i = 0; i < pendingReviews.length; i++) for (const ref of this.neighbors.get(pendingReviews[i]) ?? []) {
      if (availableReviews.has(ref) && !applicableReviews.has(ref)) {
        applicableReviews.add(ref); pendingReviews.push(ref)
      }
    }
    const reviews = (this.owners?.reviews?.requests ?? []).filter(item =>
      applicableReviews.has(this.reviewRefs.get(item.request.request_id)!))
    return { objectives, reviews, reviewRefs: applicableReviews }
  }

  /** One bound continuation protocol covers owner discovery, graph explanations
   * and original owner detail. Cursors select pages; current grants and owner
   * snapshots still control every read. There is no retained graph or cursor store. */
  page(selected: Set<string>, limit: number, query: EngineeringHistoryQuery, ordinaryRecordLimit: number | null,
    actionOverview: boolean) {
    const { connection_cursor, ...base } = query
    const binding = digest({ store_id: this.storeID, query: base, selected: [...selected].sort() })
    const position = connectionPosition(connection_cursor, binding)
    const request = (page: ConnectionPosition): EngineeringHistoryQuery => ({ ...base,
      connection_cursor: Buffer.from(JSON.stringify({ version: 1, binding, ...page })).toString("base64url") })
    const applicable = this.applicable(selected, actionOverview), reviewLimit = Math.min(limit, 5), detailLimit = limit * 2
    const gaps = [gap("relationship-meaning", "Paths follow explicit recorded associations in either direction. Authored, candidate and rejected associations remain qualified; connectedness is not causation, correctness or release acceptance."),
      gap("review-owner-boundary", "Only applicable caller-owned review requests are eligible. Other private and prepared-evaluation requests are not inventoried; absent review detail does not prove that no review happened."),
      ...(actionOverview ? [gap("review-requested-action-scope", "Action overview includes caller-owned mandates admitted by their frozen requested scope, even without a matching eligible ledger original. Inclusion establishes requested scope, not inspection, an attempt, verification or an outcome.")] : []),
      ...(!this.owners?.objectives ? [gap("objective-owner-unavailable", "Objective relationships were not expanded because their source owner is unavailable.")] : this.owners.objectives.gaps),
      ...(this.owners?.reviews?.gaps ?? [])]
    const empty = (): EngineeringHistoryConnections => ({ objectives: [], reviews: [], gaps,
      coverage: { objectives_omitted: 0, reviews_omitted: 0, relationships_omitted: 0, page: position?.kind ?? "summary",
        review_access: "caller-owned only; prepared evaluations excluded", membership: "explicit source associations; not inferred causation" },
      ...(position ? { context: { record_refs: [...selected].map(id => this.recordRef(id)), read: base } } : {}) })
    const objectiveGroup = (objective: Objective, offset: number, complete: boolean): EngineeringHistoryConnections["objectives"][number] => {
      const links = (this.owners?.objectives?.links ?? []).filter(link => link.objective_id === objective.id
        && (complete || selected.has(link.source_id) || "objective_id" in this.scope && link.source_type !== "ledger-record"))
      const seed = links.find(link => selected.has(link.source_id))?.source_id
      return { ref: this.objectiveRefs.get(objective.id)!, objective, links: links.slice(offset, offset + detailLimit),
        links_omitted: Math.max(0, links.length - offset - detailLimit),
        expand: { ...this.scope, ...(seed ? { record_id: seed } : {}), related: true, through: base.through, limit,
          ...(base.owner_boundary ? { owner_boundary: base.owner_boundary, owner_version: base.owner_version } : {}) },
        details: request({ kind: "objective-links", owner_id: objective.id, offset: 0 }),
        source: { tool: "loom_objective", query: { operation: "read", objective_id: objective.id }, sha256: digest(objective) } }
    }
    const reviewGroup = (item: Review, offset: number, complete: boolean): EngineeringHistoryConnections["reviews"][number] => {
      const relevant = complete ? item.relationships : item.relationships.filter(relation => selected.has(relation.source_record_id))
      const relationships = relevant.slice(offset, offset + detailLimit)
      return { ref: this.reviewRefs.get(item.request.request_id)!, request: item.request,
        frozen_work_membership: item.frozen_work_membership, relationships,
        relationships_omitted: complete ? Math.max(0, relevant.length - offset - detailLimit) : item.relationships.length - relationships.length,
        qualification: item.qualification, details: request({ kind: "review-relationships", owner_id: item.request.request_id, offset: 0 }),
        source: { tool: "loom_review", query: { operation: "read", request_id: item.request.request_id }, sha256: item.content_digest } }
    }
    const groups = (offset: number) => {
      const result = empty(), objectiveOffset = offset * limit, reviewOffset = offset * reviewLimit
      if (offset && objectiveOffset >= applicable.objectives.length && reviewOffset >= applicable.reviews.length)
        throw new Error("History connection group page is outside this selection")
      result.objectives = applicable.objectives.slice(objectiveOffset, objectiveOffset + limit).map(item => objectiveGroup(item, 0, false))
      result.reviews = applicable.reviews.slice(reviewOffset, reviewOffset + reviewLimit).map(item => reviewGroup(item, 0, false))
      result.coverage.objectives_omitted = Math.max(0, applicable.objectives.length - objectiveOffset - result.objectives.length)
      result.coverage.reviews_omitted = Math.max(0, applicable.reviews.length - reviewOffset - result.reviews.length)
      return result
    }
    const first = groups(0)
    const selectedRefs = new Set([...selected].map(id => this.recordRef(id)))
    const eligible = this.edges.filter(edge => selectedRefs.has(edge.from) || selectedRefs.has(edge.to)
      || edge.provenance?.owner === "review" && applicable.reviewRefs.has(edge.from) && applicable.reviewRefs.has(edge.to))
    eligible.sort((a, b) => Number(a.kind === "objective-association") - Number(b.kind === "objective-association"))
    const initial = ordinaryRecordLimit === null ? eligible.slice(0, limit * 6)
      : [...this.projectLedgerRelationships(selected, ordinaryRecordLimit), ...eligible.filter(edge => edge.provenance?.owner !== "ledger").slice(0, limit * 4)]
    const initialIDs = new Set(initial.map(edgeKey)), remaining = eligible.filter(edge => !initialIDs.has(edgeKey(edge)))
    let connections = first, relationships = initial
    let next_connections: EngineeringHistoryQuery | null = null, next_relationships: EngineeringHistoryQuery | null = null
    if (!position || position.kind === "groups") {
      const offset = position?.offset ?? 0
      connections = offset ? groups(offset) : first
      if (connections.coverage.objectives_omitted || connections.coverage.reviews_omitted)
        next_connections = request({ kind: "groups", offset: offset + 1 })
      if (position) relationships = []
      else {
        connections.coverage.relationships_omitted = remaining.length
        if (remaining.length) next_relationships = request({ kind: "relationships", offset: 0 })
      }
    } else if (position.kind === "relationships") {
      if (position.offset >= remaining.length) throw new Error("History relationship page is outside this selection")
      connections = empty()
      relationships = remaining.slice(position.offset, position.offset + limit * 6)
      connections.coverage.relationships_omitted = Math.max(0, remaining.length - position.offset - relationships.length)
      if (connections.coverage.relationships_omitted)
        next_relationships = request({ kind: "relationships", offset: position.offset + relationships.length })
    } else {
      connections = empty(); relationships = []
      let total: number
      if (position.kind === "objective-links") {
        const objective = applicable.objectives.find(item => item.id === position.owner_id)
        if (!objective) throw new Error("History connection owner is unavailable in this selection")
        total = this.owners?.objectives?.links.filter(link => link.objective_id === objective.id).length ?? 0
        connections.objectives = [objectiveGroup(objective, position.offset, true)]
      } else {
        const review = applicable.reviews.find(item => item.request.request_id === position.owner_id)
        if (!review) throw new Error("History connection owner is unavailable in this selection")
        total = review.relationships.length
        connections.reviews = [reviewGroup(review, position.offset, true)]
      }
      if (position.offset && position.offset >= total) throw new Error("History connection detail page is outside this selection")
      if (position.offset + detailLimit < total) next_connections = request({ ...position, offset: position.offset + detailLimit })
    }
    const included = new Set([...selectedRefs, ...connections.objectives.map(item => item.ref), ...connections.reviews.map(item => item.ref)])
    relationships = relationships.map(edge => ({ ...edge, target: included.has(edge.to) ? "included" : "in-scope-not-included" }))
    return { connections, relationships, next_connections, next_relationships }
  }
}
