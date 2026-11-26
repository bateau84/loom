import { digest, ProcessingLimitError } from "./model.js"
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
    expand: EngineeringHistoryQuery; source: { tool: "loom_objective"; query: { operation: "read"; objective_id: string }; sha256: string } }>;
  reviews: Array<{ ref: string; request: Review["request"]; frozen_work_membership: Review["frozen_work_membership"];
    relationships: Review["relationships"]; relationships_omitted: number; qualification: Review["qualification"];
    source: { tool: "loom_review"; query: { operation: "read"; request_id: string }; sha256: string } }>;
  coverage: { objectives_omitted: number; reviews_omitted: number; relationships_omitted: number;
    review_access: "caller-owned only; prepared evaluations excluded"; membership: "explicit source associations; not inferred causation" };
  gaps: EngineeringHistoryGap[];
}
type RecordIdentity = { id: string; seq: number }
type Edge = EngineeringHistoryRelationship
const LIMITS = { edges: 200000, connected: 10000 }
const gap = (code: string, detail: string): EngineeringHistoryGap => ({ code, detail })

/** A per-read adjacency projection over explicit source relationships. A path is
 * navigational relevance with its recorded qualifications, never causal proof. */
export class EngineeringConnections {
  private readonly edges: Edge[] = []
  private readonly neighbors = new Map<string, Set<string>>()
  private readonly recordIDs = new Map<string, string>()
  private readonly objectiveRefs = new Map<string, string>()
  private readonly reviewRefs = new Map<string, string>()
  private readonly identities = new Set<string>()
  constructor(private readonly storeID: string, private readonly scope: EngineeringHistoryScope,
    private readonly owners: EngineeringHistoryOwners | undefined, private readonly records: Map<string, RecordIdentity>) {
    for (const id of records.keys()) this.recordIDs.set(this.recordRef(id), id)
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
      for (const member of request.members) for (const id of member.producing_attempt_refs) if (this.records.has(id)) this.add({
        from: ref, to: this.recordRef(id), kind: "requested-producing-attempt", meaning: "authored", source_record_id: id,
        target: "in-scope-not-included", provenance: { owner: "review", id: `${request.request_id}:${member.member_id}`,
          author_session: request.requester.session_id, author_agent: request.requester.agent },
        qualification: "This frozen review member explicitly requested the identified producing attempt. Membership is requested scope, not proof that the review inspected or verified it." })
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
  project(selected: Set<string>, limit: number, query: EngineeringHistoryQuery): EngineeringHistoryConnections {
    const objectiveIDs = new Set((this.owners?.objectives?.links ?? []).filter(link => selected.has(link.source_id)).map(link => link.objective_id))
    if ("objective_id" in this.scope) objectiveIDs.add(this.scope.objective_id)
    const objectiveCandidates = (this.owners?.objectives?.objectives ?? []).filter(item => objectiveIDs.has(item.id))
    const objectives = objectiveCandidates.slice(0, limit).map(objective => {
      const links = this.owners!.objectives!.links.filter(link => link.objective_id === objective.id && (selected.has(link.source_id)
        || "objective_id" in this.scope && link.source_type !== "ledger-record"))
      return { ref: this.objectiveRefs.get(objective.id)!, objective, links: links.slice(0, limit * 2), links_omitted: Math.max(0, links.length - limit * 2),
        // Stay inside the selected scope/bounds. A separate objective-scoped
        // read is explicit; a group expansion never silently broadens authority.
        expand: { ...query, ...(links.find(link => selected.has(link.source_id)) ? { record_id: links.find(link => selected.has(link.source_id))!.source_id } : {}), related: true },
        source: { tool: "loom_objective" as const, query: { operation: "read" as const, objective_id: objective.id }, sha256: digest(objective) } }
    })
    // A pending recheck can name a correction without having produced any
    // evidence of its own. Include its exact mandate through that explicit
    // target, then retain the original mandate along requested-recheck edges.
    // Both snapshots have already passed requester and complete-scope checks.
    const availableReviews = new Set(this.reviewRefs.values()), applicableReviews = new Set<string>()
    for (const id of selected) for (const ref of this.neighbors.get(this.recordRef(id)) ?? []) {
      if (availableReviews.has(ref)) applicableReviews.add(ref)
    }
    const pendingReviews = [...applicableReviews]
    for (let i = 0; i < pendingReviews.length; i++) for (const ref of this.neighbors.get(pendingReviews[i]) ?? []) {
      if (availableReviews.has(ref) && !applicableReviews.has(ref)) {
        applicableReviews.add(ref); pendingReviews.push(ref)
      }
    }
    const reviewCandidates = (this.owners?.reviews?.requests ?? []).filter(item =>
      applicableReviews.has(this.reviewRefs.get(item.request.request_id)!))
    const reviews = reviewCandidates.slice(0, Math.min(limit, 5)).map(item => {
      const relevant = item.relationships.filter(relation => selected.has(relation.source_record_id))
      const relationships = relevant.slice(0, limit * 2)
      return { ref: this.reviewRefs.get(item.request.request_id)!, request: item.request,
        frozen_work_membership: item.frozen_work_membership, relationships,
        relationships_omitted: item.relationships.length - relationships.length, qualification: item.qualification,
        source: { tool: "loom_review" as const, query: { operation: "read" as const, request_id: item.request.request_id }, sha256: digest(item) } }
    })
    return { objectives, reviews, coverage: { objectives_omitted: objectiveCandidates.length - objectives.length,
      reviews_omitted: reviewCandidates.length - reviews.length, relationships_omitted: 0,
      review_access: "caller-owned only; prepared evaluations excluded", membership: "explicit source associations; not inferred causation" },
      gaps: [gap("relationship-meaning", "Paths follow explicit recorded associations in either direction. Authored, candidate and rejected associations remain qualified; connectedness is not causation, correctness or release acceptance."),
        gap("review-owner-boundary", "Only applicable caller-owned review requests are eligible. Other private and prepared-evaluation requests are not inventoried; absent review detail does not prove that no review happened."),
        ...(!this.owners?.objectives ? [gap("objective-owner-unavailable", "Objective relationships were not expanded because their source owner is unavailable.")] : this.owners.objectives.gaps),
        ...(this.owners?.reviews?.gaps ?? [])] }
  }
  projectRelationships(selected: Set<string>, groups: EngineeringHistoryConnections, limit: number, ownersOnly = false): EngineeringHistoryRelationship[] {
    const selectedRefs = new Set([...selected].map(id => this.recordRef(id)))
    const included = new Set(selectedRefs)
    for (const item of [...groups.objectives, ...groups.reviews]) included.add(item.ref)
    const eligible = this.edges.filter(edge => (!ownersOnly || edge.provenance?.owner !== "ledger")
      && (selectedRefs.has(edge.from) || selectedRefs.has(edge.to)
        || this.reviewRefs.has(edge.provenance?.id ?? "") && included.has(edge.from) && included.has(edge.to)))
    // Inter-record explanations precede membership fan-out. Page omissions are
    // explicit; the bounded original-owner request remains available on groups.
    eligible.sort((a, b) => Number(a.kind === "objective-association") - Number(b.kind === "objective-association"))
    groups.coverage.relationships_omitted = Math.max(0, eligible.length - limit)
    return eligible.slice(0, limit).map(edge => ({ ...edge, target: included.has(edge.to) ? "included" : "in-scope-not-included" }))
  }
}
