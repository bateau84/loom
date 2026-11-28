import { canonical, ProcessingBudget, uid } from "./model.js"
import type { EvaluatorRetrievedContext, EvaluatorRetrievedSource } from "./evaluator-execution-contract.js"
import { retrospectiveMemberKey, type RetrospectivePopulation } from "./retrospective-contract.js"

/** Serialization limits, not a model budget or an assertion of reasoning quality. */
export const EVALUATOR_INTERPRETATION_LIMITS = Object.freeze({ chars: 33554432, values: 2000000, items: 20000, itemChars: 65536 })
export const evaluatorInterpretationBudget = () => new ProcessingBudget(EVALUATOR_INTERPRETATION_LIMITS.chars, EVALUATOR_INTERPRETATION_LIMITS.values)
export type EvaluatorSourceIndexRef = { member_key: string; source_index: 0 } | {
  kind: "prior-original"; report_id: string; report_sha256: string; member_key: string; source_index: 0;
}
export type EvaluatorPriorInterpretation = { report_id: string; report_sha256: string; relation: "supersedes" | "contests" | "context"; reason: string }
export type EvaluatorPriorRecommendation = { report_id: string; report_sha256: string; claim_id: string }
export type EvaluatorInterpretationClaim = {
  claim_id: string; kind: "observed" | "authored" | "interpretation" | "verification" | "recommendation";
  category: "finding" | "successful-practice" | "avoidable-failure" | "necessary-exploration" | "recovery";
  basis: "supported" | "hypothesis"; statement: string; members: string[];
  supporting: EvaluatorSourceIndexRef[]; contradicting: EvaluatorSourceIndexRef[];
  limitations: string[]; applicability: string[];
  recommendation: null | { target: string; mechanism: string; risks: string[]; validation: string[]; prior_recommendations: EvaluatorPriorRecommendation[] };
}
export type EvaluatorInterpretation = {
  format: "loom-evaluator-interpretation/v1"; covered_members: string[];
  conclusion: { kind: "recommendations" | "no-change" | "insufficient-evidence"; statement: string; limitations: string[] };
  trajectory: Array<{ event_id: string; statement: string; members: string[]; supporting: EvaluatorSourceIndexRef[]; limitations: string[] }>;
  claims: EvaluatorInterpretationClaim[];
  review_coverage: Array<{ review_id: string; requested: string[]; covered: string[]; members: string[]; supporting: EvaluatorSourceIndexRef[]; limitations: string[] }>;
  gaps: Array<{ member_key: string; kind: "unavailable" | "not-retrieved" | "coverage"; reason: string }>;
  qualifications: { chronology: string[]; independence: "unknown" };
  prior_interpretations: EvaluatorPriorInterpretation[];
}

function object(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`Invalid Evaluator interpretation ${label}`)
  if (Reflect.ownKeys(value).length !== fields.length) throw new Error(`Invalid Evaluator interpretation ${label} fields`)
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error(`Invalid Evaluator interpretation ${label} fields`)
  }
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max = 16000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw new Error(`Invalid Evaluator interpretation ${label}`)
  return value
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid Evaluator interpretation report fingerprint")
  return value
}
function array(value: unknown, label: string, max: number = EVALUATOR_INTERPRETATION_LIMITS.items): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid Evaluator interpretation ${label}`)
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) throw new Error(`Invalid Evaluator interpretation sparse ${label}`)
  return value
}
const strings = (value: unknown, label: string): string[] => array(value, label, 200).map(item => text(item, label))
function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`Unsupported Evaluator interpretation ${label}`)
  return value as T
}
function unique<T>(items: T[], key: (item: T) => string, label: string): T[] {
  if (new Set(items.map(key)).size !== items.length) throw new Error(`Duplicate Evaluator interpretation ${label}`)
  return items
}
function item<T>(value: T): T {
  // Every narrative item fits in a bounded reader page. Reject, never truncate.
  canonical(value, new ProcessingBudget(EVALUATOR_INTERPRETATION_LIMITS.itemChars, 32768))
  return value
}

/** Validate model-authored structure against the frozen population and trusted
 * result-owner retrieval receipts. This establishes referential fidelity only;
 * citations cannot establish entailment, causal correctness or independence.
 * Publication, prior-report authority and current disclosure belong to the owner. */
export function parseEvaluatorInterpretation(raw: unknown, population: RetrospectivePopulation,
  retrieved: EvaluatorRetrievedSource[], contextRetrieved: EvaluatorRetrievedContext[] = []): EvaluatorInterpretation {
  if (typeof raw === "string" && raw.length > EVALUATOR_INTERPRETATION_LIMITS.chars) throw new Error("Evaluator interpretation exceeds the result limit")
  const input: unknown = typeof raw === "string" ? JSON.parse(raw) : raw
  canonical(input, evaluatorInterpretationBudget())
  const value = object(input, ["format", "covered_members", "conclusion", "trajectory", "claims", "review_coverage", "gaps", "qualifications", "prior_interpretations"], "result")
  if (value.format !== "loom-evaluator-interpretation/v1") throw new Error("Unsupported Evaluator interpretation format")
  const members = new Map(population.manifest.members.map(member => [member.key, member]))
  if (members.size !== population.manifest.members.length || members.size === 0) throw new Error("Invalid frozen Evaluator population")
  const memberKey = (rawKey: unknown): string => {
    const key = text(rawKey, "member key", 200)
    if (!members.has(key)) throw new Error("Evaluator interpretation names a member outside the frozen population")
    return key
  }
  const memberKeys = (rawKeys: unknown, allowEmpty = false): string[] => {
    const keys = unique(array(rawKeys, "members").map(memberKey), key => key, "member")
    if (!allowEmpty && !keys.length) throw new Error("Evaluator interpretation requires an explicit member scope")
    return keys
  }
  const covered_members = memberKeys(value.covered_members)
  if (covered_members.length !== members.size) throw new Error("Evaluator interpretation must account for the complete frozen population")
  const retrievals = array(retrieved, "retrieval receipts", 100000).map(input => {
    const receipt = object(input, ["member_key", "source_index", "receipt_id", "boundary", "source_sha256"], "retrieval receipt")
    const member_key = memberKey(receipt.member_key), member = members.get(member_key)!
    if (receipt.source_index !== 0 || member.availability !== "available" || !member.source.revision || !member.source.sha256
      || member.key !== retrospectiveMemberKey(member.source_store_id, member.source, member.permitted_view)
      || receipt.source_sha256 !== member.source.sha256) throw new Error("Evaluator retrieval does not identify the available frozen original")
    const boundary = choice(receipt.boundary, ["native-tool-result", "provider-input"] as const, "retrieval boundary")
    return { member_key, receipt_id: uid(receipt.receipt_id, "retrieval receipt ID"), boundary }
  })
  unique(retrievals, receipt => `${receipt.member_key}\n${receipt.receipt_id}\n${receipt.boundary}`, "retrieval receipt")
  const retrievedKeys = new Set(retrievals.map(receipt => receipt.member_key))
  const contextReceipts = parseEvaluatorContextReceipts(contextRetrieved)
  const priorOriginals = new Set(contextReceipts.filter(receipt => receipt.kind === "prior-original")
    .map(receipt => `${receipt.report_id}\n${receipt.report_sha256}\n${receipt.member_key}`))
  const refs = (input: unknown, scope: string[]): EvaluatorSourceIndexRef[] => unique(array(input, "citations").map(input => {
    if (input && typeof input === "object" && Object.getOwnPropertyDescriptor(input, "kind")?.value === "prior-original") {
      const ref = object(input, ["kind", "report_id", "report_sha256", "member_key", "source_index"], "prior original citation")
      const report_id = uid(ref.report_id, "prior report ID"), report_sha256 = hash(ref.report_sha256)
      const member_key = text(ref.member_key, "prior member key", 200)
      if (ref.source_index !== 0 || !priorOriginals.has(`${report_id}\n${report_sha256}\n${member_key}`))
        throw new Error("Prior original citation requires an exact trusted context retrieval")
      return { kind: "prior-original" as const, report_id, report_sha256, member_key, source_index: 0 as const }
    }
    const ref = object(input, ["member_key", "source_index"], "citation"), member_key = memberKey(ref.member_key)
    if (ref.source_index !== 0) throw new Error("Unsupported Evaluator interpretation source index")
    if (!retrievedKeys.has(member_key)) throw new Error("Evaluator citation requires an actual retrieval of the frozen available original")
    if (!scope.includes(member_key)) throw new Error("Evaluator citation is outside the claim's member scope")
    return { member_key, source_index: 0 as const }
  }), ref => "kind" in ref ? `${ref.report_id}\n${ref.report_sha256}\n${ref.member_key}` : ref.member_key, "citation")
  const conclusionInput = object(value.conclusion, ["kind", "statement", "limitations"], "conclusion")
  const conclusion = item({ kind: choice(conclusionInput.kind, ["recommendations", "no-change", "insufficient-evidence"] as const, "conclusion kind"),
    statement: text(conclusionInput.statement, "conclusion"), limitations: strings(conclusionInput.limitations, "conclusion limitations") })
  const trajectory = unique(array(value.trajectory, "trajectory").map(input => {
    const event = object(input, ["event_id", "statement", "members", "supporting", "limitations"], "trajectory event")
    const members = memberKeys(event.members, true), supporting = refs(event.supporting, members)
    if (!supporting.length) throw new Error("Evaluator trajectory requires supporting evidence")
    return item({ event_id: uid(event.event_id, "trajectory event ID"), statement: text(event.statement, "trajectory statement"),
      members, supporting, limitations: strings(event.limitations, "trajectory limitations") })
  }), event => event.event_id, "trajectory event ID")
  const claims = unique(array(value.claims, "claims").map(input => {
    const claim = object(input, ["claim_id", "kind", "category", "basis", "statement", "members", "supporting", "contradicting", "limitations", "applicability", "recommendation"], "claim")
    const kind = choice(claim.kind, ["observed", "authored", "interpretation", "verification", "recommendation"] as const, "claim kind")
    const category = choice(claim.category, ["finding", "successful-practice", "avoidable-failure", "necessary-exploration", "recovery"] as const, "claim category")
    const basis = choice(claim.basis, ["supported", "hypothesis"] as const, "claim basis")
    const members = memberKeys(claim.members, true), supporting = refs(claim.supporting, members), contradicting = refs(claim.contradicting, members)
    if (!members.length && ![...supporting, ...contradicting].some(ref => "kind" in ref))
      throw new Error("Evaluator claim requires a current member scope or retrieved prior original")
    const limitations = strings(claim.limitations, "claim limitations"), applicability = strings(claim.applicability, "claim applicability")
    if (basis === "supported" && !supporting.length) throw new Error("Supported Evaluator claim requires supporting evidence")
    if (basis === "hypothesis" && (!["interpretation", "recommendation"].includes(kind) || !limitations.length))
      throw new Error("Evaluator hypothesis must be an explicitly limited interpretation or recommendation")
    if (contradicting.length && !limitations.length) throw new Error("Contradictory Evaluator evidence requires an explicit limitation")
    let recommendation: EvaluatorInterpretationClaim["recommendation"] = null
    if (kind === "recommendation") {
      const proposed = object(claim.recommendation, ["target", "mechanism", "risks", "validation", "prior_recommendations"], "recommendation")
      const risks = strings(proposed.risks, "recommendation risks"), validation = strings(proposed.validation, "recommendation validation")
      if (!applicability.length || !risks.length || !validation.length) throw new Error("Evaluator recommendation requires applicability, risks and validation")
      const prior_recommendations = unique(array(proposed.prior_recommendations, "prior recommendations", 32).map(input => {
        const prior = object(input, ["report_id", "report_sha256", "claim_id"], "prior recommendation")
        return { report_id: uid(prior.report_id, "prior report ID"), report_sha256: hash(prior.report_sha256), claim_id: uid(prior.claim_id, "prior claim ID") }
      }), prior => `${prior.report_id}\n${prior.claim_id}`, "prior recommendation")
      recommendation = { target: text(proposed.target, "recommendation target"), mechanism: text(proposed.mechanism, "recommendation mechanism"), risks, validation, prior_recommendations }
    } else if (claim.recommendation !== null) throw new Error("Only an Evaluator recommendation may contain a change proposal")
    return item({ claim_id: uid(claim.claim_id, "claim ID"), kind, category, basis, statement: text(claim.statement, "claim statement"),
      members, supporting, contradicting, limitations, applicability, recommendation })
  }), claim => claim.claim_id, "claim ID")
  const review_coverage = unique(array(value.review_coverage, "review coverage").map(input => {
    const review = object(input, ["review_id", "requested", "covered", "members", "supporting", "limitations"], "review coverage")
    const members = memberKeys(review.members, true), supporting = refs(review.supporting, members)
    if (!supporting.length) throw new Error("Evaluator review coverage requires supporting evidence")
    return item({ review_id: uid(review.review_id, "review ID"), requested: strings(review.requested, "requested review coverage"),
      covered: strings(review.covered, "actual review coverage"), members, supporting, limitations: strings(review.limitations, "review limitations") })
  }), review => review.review_id, "review ID")
  const gaps = unique(array(value.gaps, "gaps").map(input => {
    const gap = object(input, ["member_key", "kind", "reason"], "gap"), member_key = memberKey(gap.member_key)
    const kind = choice(gap.kind, ["unavailable", "not-retrieved", "coverage"] as const, "gap kind")
    const available = members.get(member_key)!.availability === "available"
    if (kind === "unavailable" && available || kind === "not-retrieved" && (!available || retrievedKeys.has(member_key)))
      throw new Error("Evaluator gap contradicts frozen availability or actual retrieval")
    return item({ member_key, kind, reason: text(gap.reason, "gap reason") })
  }), gap => `${gap.member_key}\n${gap.kind}`, "gap")
  const gapKeys = new Set(gaps.map(gap => `${gap.member_key}\n${gap.kind}`))
  for (const member of members.values()) {
    const kind = member.availability !== "available" ? "unavailable" : !retrievedKeys.has(member.key) ? "not-retrieved" : null
    if (kind && !gapKeys.has(`${member.key}\n${kind}`)) throw new Error("Evaluator interpretation must disclose unavailable and unretrieved evidence")
  }
  const qualificationInput = object(value.qualifications, ["chronology", "independence"], "qualifications")
  if (qualificationInput.independence !== "unknown") throw new Error("Evaluator interpretation cannot establish independent originating intent")
  const qualifications = item({ chronology: strings(qualificationInput.chronology, "chronology qualifications"), independence: "unknown" as const })
  const prior_interpretations = unique(array(value.prior_interpretations, "prior interpretations", 32).map(input => {
    const prior = object(input, ["report_id", "report_sha256", "relation", "reason"], "prior interpretation")
    return item({ report_id: uid(prior.report_id, "prior report ID"), report_sha256: hash(prior.report_sha256),
      relation: choice(prior.relation, ["supersedes", "contests", "context"] as const, "prior relation"), reason: text(prior.reason, "prior interpretation reason") })
  }), prior => prior.report_id, "prior interpretation")
  for (const claim of claims) for (const prior of claim.recommendation?.prior_recommendations ?? [])
    if (!prior_interpretations.some(report => report.report_id === prior.report_id && report.report_sha256 === prior.report_sha256))
      throw new Error("Prior recommendation requires the exact attributable prior interpretation")
  for (const receipt of contextReceipts)
    if (!prior_interpretations.some(prior => prior.report_id === receipt.report_id && prior.report_sha256 === receipt.report_sha256))
      throw new Error("Every delivered context report and original requires an explicit prior interpretation dependency")
  const recommendations = claims.filter(claim => claim.kind === "recommendation")
  if ((conclusion.kind === "recommendations") !== (recommendations.length > 0)) throw new Error("Evaluator conclusion and recommendation claims disagree")
  if (conclusion.kind === "no-change" && !claims.some(claim => claim.basis === "supported") && !trajectory.length && !review_coverage.length)
    throw new Error("Evaluator no-change conclusion requires an evidence-backed finding; use insufficient-evidence for an ungrounded result")
  if (conclusion.kind === "insufficient-evidence" && !conclusion.limitations.length && !gaps.length)
    throw new Error("Insufficient Evaluator evidence requires an explicit limitation or source gap")
  return { format: value.format, covered_members, conclusion, trajectory, claims, review_coverage, gaps, qualifications, prior_interpretations }
}

/** Validate trusted delivery receipt syntax separately from prior-population
 * membership. The publication owner checks the latter against the named
 * report's own frozen population, not its inherited dependency union. */
export function parseEvaluatorContextReceipts(input: unknown): EvaluatorRetrievedContext[] {
  const receipts = array(input, "context retrieval receipts", 100000).map((input): EvaluatorRetrievedContext => {
    const kind = input && typeof input === "object" ? Object.getOwnPropertyDescriptor(input, "kind")?.value : undefined
    if (kind !== "prior-interpretation" && kind !== "prior-original") throw new Error("Invalid Evaluator context receipt kind")
    const receipt = object(input, ["kind", "report_id", "report_sha256", "receipt_id", "boundary",
      ...(kind === "prior-original" ? ["member_key", "source_index", "source_sha256"] : [])], "context retrieval receipt")
    const base = { report_id: uid(receipt.report_id, "prior report ID"), report_sha256: hash(receipt.report_sha256),
      receipt_id: uid(receipt.receipt_id, "context receipt ID"), boundary: choice(receipt.boundary, ["native-tool-result", "provider-input"] as const, "context retrieval boundary") }
    if (kind === "prior-interpretation") return { kind: "prior-interpretation", ...base }
    if (receipt.source_index !== 0) throw new Error("Unsupported prior original source index")
    return { kind: "prior-original", ...base, member_key: text(receipt.member_key, "prior member key", 200), source_index: 0 as const,
      source_sha256: hash(receipt.source_sha256) }
  })
  return unique(receipts, receipt => `${receipt.kind}\n${receipt.report_id}\n${receipt.kind === "prior-original" ? receipt.member_key : ""}\n${receipt.receipt_id}\n${receipt.boundary}`, "context retrieval receipt")
}
