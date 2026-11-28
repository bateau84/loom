import { canonical, digest, ProcessingBudget, uid, type Actor } from "./model.js"
import type { EvaluationSourceRef } from "./evaluation-store.js"
import { evaluationFrontier, evaluationTarget, type EvaluationCutoff, type EvaluationTarget } from "./evaluation-subject.js"
import type { LearningFrontier } from "./learning-sources.js"

export const RETROSPECTIVE_LIMITS = Object.freeze({ members: 20000, contributors: 2000, chars: 33554432, values: 2000000 })
/** A single population operation keeps its existing owner-resolution budget.
 * Selection reserves room for freeze revalidation and bounded readback. */
const ORIGINAL_READS = 128, ORIGINAL_FREEZE_PAGE = 20
export const RETROSPECTIVE_ORIGINAL_LIMITS = Object.freeze({ reads: ORIGINAL_READS, freezePage: ORIGINAL_FREEZE_PAGE,
  selection: (ORIGINAL_READS - ORIGINAL_FREEZE_PAGE) / 2 })
export const retrospectiveBudget = () => new ProcessingBudget(RETROSPECTIVE_LIMITS.chars, RETROSPECTIVE_LIMITS.values)
const LOCAL_VIEWS: Readonly<Record<string, string>> = { "ledger-record": "record-full", objective: "objective", "objective-link": "objective-link",
  "review-request": "review-request", "review-relationship": "review-relationship" }

/** A proposal boundary, not a permission receipt or an automatic relevance judgment. */
type SelectionBoundary = {
  question: string; through: number;
  owner_boundary: { objective_links: number | null; review_requests: number; review_relationships: number };
  owner_version: string; exclusions: Array<{ record_id: string; reason: string }>;
}
export type RetrospectiveSelection = SelectionBoundary & (
  { mode: "explicit-objective"; objective_id: string }
  | { mode: "explicit-subject"; target: EvaluationTarget; subject_id?: string; subject_sha256?: string;
      frontier: LearningFrontier; namespace_frontier?: LearningFrontier; cutoff: EvaluationCutoff })
export type RetrospectiveMember = {
  key: string; source_store_id: string; source: EvaluationSourceRef; permitted_view: string;
  availability: "available" | "missing" | "unresolved" | "unsupported";
  basis: Record<string, unknown>[]; historical_scope: Record<string, unknown> | null; qualifications: string[];
}
export type RetrospectiveManifest = {
  format: "loom-retrospective-population/v1" | "loom-retrospective-population/v2"; source_store_id: string; selection: RetrospectiveSelection;
  contributors: string[]; objective: Record<string, unknown>; coverage: Record<string, unknown>;
  qualifications: string[]; members: RetrospectiveMember[];
}
export type RetrospectivePopulation = {
  population_id: string; manifest_sha256: string; owner_session: string; frozen_by: Actor; created_at: string;
  manifest: RetrospectiveManifest;
}
export type RetrospectivePopulationRef = {
  kind: "retrospective-population"; format: "loom-retrospective-population/v1" | "loom-retrospective-population/v2";
  population_id: string; manifest_sha256: string;
}
export type RetrospectiveSources = {
  population_id: string; manifest_sha256: string; source_store_id: string; owner_session: string;
  contributors: string[]; contains_private_reviews: boolean; member_count: number;
}

const mapping = (value: unknown, name: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`Invalid retrospective ${name}`)
  return value as Record<string, unknown>
}
const keys = (value: Record<string, unknown>, expected: string[], optional: string[] = []) => {
  if (expected.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !expected.includes(key) && !optional.includes(key)))
    throw new Error("Invalid retrospective fields")
}
const string = (value: unknown, name: string, max = 200): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value))
    throw new Error(`Invalid retrospective ${name}`)
  return value
}
const count = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid retrospective boundary")
  return value
}
const hash = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid retrospective fingerprint")
  return value
}
const strings = (value: unknown, name: string, max = 2000): string[] => {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid retrospective ${name}`)
  return value.map(item => string(item, name, 8000))
}
const metadata = (value: unknown, name: string): Record<string, unknown> => {
  const result = mapping(value, name)
  // Source owners supply metadata only. Canonical serialization rejects cycles,
  // accessors and class instances; the copy cannot retain mutable caller aliases.
  return JSON.parse(canonical(result, retrospectiveBudget())) as Record<string, unknown>
}
function source(input: unknown, available: boolean): EvaluationSourceRef {
  const value = mapping(input, "source")
  keys(value, ["kind", "id", "required"], ["session_id", "message_id", "revision", "sha256"])
  if (typeof value.required !== "boolean") throw new Error("Invalid retrospective source requiredness")
  const result: EvaluationSourceRef = { kind: string(value.kind, "source kind", 100), id: string(value.id, "source ID", 1000), required: value.required }
  if (value.session_id !== undefined) result.session_id = uid(value.session_id, "retrospective source Session")
  if (value.message_id !== undefined) {
    if (result.kind !== "native-call" || !result.session_id) throw new Error("Invalid retrospective native call identity")
    result.message_id = uid(value.message_id, "retrospective source message")
  }
  if (result.kind === "native-call" && (!result.session_id || !result.message_id)) throw new Error("Incomplete retrospective native call identity")
  if (value.revision !== undefined) result.revision = string(value.revision, "source version", 200)
  if (value.sha256 !== undefined) result.sha256 = hash(value.sha256)
  if (available && (!result.revision || !result.sha256 || Object.hasOwn(LOCAL_VIEWS, result.kind) && !result.session_id))
    throw new Error("Available retrospective sources require exact identities and versions")
  return result
}
export function retrospectiveMemberKey(sourceStoreID: string, ref: EvaluationSourceRef, permittedView: string): string {
  const { required: _required, ...identity } = ref
  return "source-" + digest({ source_store_id: sourceStoreID, source: identity, permitted_view: permittedView })
}
export function parseRetrospectiveManifest(input: unknown): RetrospectiveManifest {
  // Admit the complete proposed population before allocating per-member copies.
  canonical(input, retrospectiveBudget())
  const value = mapping(input, "manifest")
  keys(value, ["format", "source_store_id", "selection", "contributors", "objective", "coverage", "qualifications", "members"])
  if (value.format !== "loom-retrospective-population/v1" && value.format !== "loom-retrospective-population/v2") throw new Error("Unsupported retrospective population format")
  const selected = mapping(value.selection, "selection")
  const subjectMode = value.format === "loom-retrospective-population/v2"
  keys(selected, ["mode", "question", "through", "owner_boundary", "owner_version", "exclusions",
    ...(subjectMode ? ["target", "frontier", "cutoff"] : ["objective_id"])], subjectMode ? ["subject_id", "subject_sha256", "namespace_frontier"] : [])
  if (selected.mode !== (subjectMode ? "explicit-subject" : "explicit-objective")) throw new Error("Unsupported retrospective selection mode")
  const boundary = mapping(selected.owner_boundary, "owner boundary")
  keys(boundary, ["objective_links", "review_requests", "review_relationships"])
  if (!Array.isArray(selected.exclusions) || selected.exclusions.length > RETROSPECTIVE_LIMITS.members) throw new Error("Invalid retrospective exclusions")
  const exclusions = selected.exclusions.map(item => {
    const excluded = mapping(item, "exclusion")
    keys(excluded, ["record_id", "reason"])
    return { record_id: uid(excluded.record_id, "excluded record"), reason: string(excluded.reason, "exclusion reason", 8000) }
  }).sort((a, b) => a.record_id.localeCompare(b.record_id))
  if (new Set(exclusions.map(item => item.record_id)).size !== exclusions.length) throw new Error("Duplicate retrospective exclusion")
  const common: SelectionBoundary = {
    question: string(selected.question, "question", 8000),
    through: count(selected.through), owner_boundary: { objective_links: boundary.objective_links === null ? null : count(boundary.objective_links),
      review_requests: count(boundary.review_requests), review_relationships: count(boundary.review_relationships) },
    owner_version: hash(selected.owner_version), exclusions,
  }
  let selection: RetrospectiveSelection
  if (subjectMode) {
    const target = evaluationTarget(selected.target), frontier = evaluationFrontier(selected.frontier), cutoffInput = mapping(selected.cutoff, "cutoff")
    const namespace = selected.namespace_frontier === undefined ? undefined : evaluationFrontier(selected.namespace_frontier)
    if (namespace && (Object.keys(frontier) as Array<keyof LearningFrontier>).some(key => frontier[key] > namespace[key]))
      throw new Error("Retrospective selection exceeds namespace frontier")
    if (namespace && target.kind !== "session" && canonical(namespace) !== canonical(frontier)) throw new Error("Retrospective namespace domain mismatch")
    let cutoff: EvaluationCutoff
    if (cutoffInput.kind === "point-in-time") { keys(cutoffInput, ["kind"]); cutoff = { kind: "point-in-time" } }
    else if (cutoffInput.kind === "recorded-completion") {
      keys(cutoffInput, ["kind", "record"])
      const ref = source(cutoffInput.record, true)
      if (ref.kind !== "ledger-record" || Number(ref.revision) !== frontier.ledger) throw new Error("Invalid recorded completion boundary")
      cutoff = { kind: "recorded-completion", record: ref }
    } else throw new Error("Invalid retrospective cutoff")
    if (namespace && cutoff.kind === "recorded-completion" && namespace.ledger !== frontier.ledger)
      throw new Error("Retrospective namespace exceeds recorded completion")
    if (frontier.ledger !== common.through || frontier.objective_links !== common.owner_boundary.objective_links
      || frontier.review_requests !== common.owner_boundary.review_requests || frontier.review_relationships !== common.owner_boundary.review_relationships)
      throw new Error("Retrospective subject frontier mismatch")
    if ((selected.subject_id === undefined) !== (selected.subject_sha256 === undefined)) throw new Error("Incomplete retrospective subject reference")
    selection = { ...common, mode: "explicit-subject", target, frontier, cutoff,
      ...(namespace ? { namespace_frontier: namespace } : {}),
      ...(selected.subject_id === undefined ? {} : { subject_id: uid(selected.subject_id, "subject_id"), subject_sha256: hash(selected.subject_sha256) }) }
  } else selection = { ...common, mode: "explicit-objective", objective_id: uid(selected.objective_id, "objective_id") }
  if (!Array.isArray(value.contributors) || value.contributors.length > RETROSPECTIVE_LIMITS.contributors) throw new Error("Invalid retrospective contributors")
  const contributors = value.contributors.map(item => uid(item, "retrospective contributor")).sort((a, b) => a.localeCompare(b))
  if (new Set(contributors).size !== contributors.length) throw new Error("Duplicate retrospective contributor")
  if (!Array.isArray(value.members) || value.members.length < (subjectMode ? 0 : 1) || value.members.length > RETROSPECTIVE_LIMITS.members) throw new Error("Invalid retrospective population size")
  const seen = new Set<string>()
  const members = value.members.map(item => {
    const member = mapping(item, "member")
    keys(member, ["key", "source_store_id", "source", "permitted_view", "availability", "basis", "historical_scope", "qualifications"])
    if (member.availability !== "available" && member.availability !== "missing" && member.availability !== "unresolved" && member.availability !== "unsupported")
      throw new Error("Invalid retrospective source availability")
    const ref = source(member.source, member.availability === "available"), sourceStoreID = uid(member.source_store_id, "source_store_id")
    const permittedView = string(member.permitted_view, "permitted view", 120), key = string(member.key, "member key", 200)
    if (Object.hasOwn(LOCAL_VIEWS, ref.kind) && (sourceStoreID !== value.source_store_id || permittedView !== LOCAL_VIEWS[ref.kind]))
      throw new Error("Retrospective local source owner or permitted view mismatch")
    if (key !== retrospectiveMemberKey(sourceStoreID, ref, permittedView)) throw new Error("Retrospective member identity mismatch")
    if (seen.has(key)) throw new Error("Duplicate retrospective evidence")
    seen.add(key)
    if (ref.session_id !== undefined && !contributors.includes(ref.session_id)) throw new Error("Retrospective source contributor missing")
    if (!Array.isArray(member.basis) || member.basis.length > 2000) throw new Error("Invalid retrospective relationship basis")
    const parsed: RetrospectiveMember = { key, source_store_id: sourceStoreID, source: ref, permitted_view: permittedView,
      availability: member.availability, basis: member.basis.map(item => metadata(item, "relationship basis")),
      historical_scope: member.historical_scope === null ? null : metadata(member.historical_scope, "historical scope"),
      qualifications: strings(member.qualifications, "member qualifications") }
    return parsed
  }).sort((a, b) => a.key.localeCompare(b.key))
  return { format: value.format, source_store_id: uid(value.source_store_id, "source_store_id"), selection, contributors,
    objective: metadata(value.objective, "objective"), coverage: metadata(value.coverage, "coverage"),
    qualifications: strings(value.qualifications, "qualifications"), members }
}
export const retrospectiveDigest = (manifest: RetrospectiveManifest): string => digest(manifest, retrospectiveBudget())

export function retrospectiveTarget(manifest: RetrospectiveManifest): EvaluationTarget {
  return manifest.selection.mode === "explicit-objective" ? { kind: "objective", id: manifest.selection.objective_id } : manifest.selection.target
}
export function retrospectiveFrontier(manifest: RetrospectiveManifest): LearningFrontier {
  return manifest.selection.mode === "explicit-subject" ? { ...manifest.selection.frontier }
    : { ledger: manifest.selection.through, objectives: 0, objective_links: manifest.selection.owner_boundary.objective_links ?? 0,
      review_requests: manifest.selection.owner_boundary.review_requests, review_relationships: manifest.selection.owner_boundary.review_relationships }
}

/** Earlier context must belong to the same typed subject and cannot include a
 * later independent owner frontier, even when its ledger cutoff is unchanged. */
export function compatibleRetrospectiveContext(current: RetrospectiveManifest, prior: RetrospectiveManifest): boolean {
  if (current.source_store_id !== prior.source_store_id || canonical(retrospectiveTarget(current)) !== canonical(retrospectiveTarget(prior))) return false
  // New Session selections distinguish owned progress from the comparable
  // namespace prefix. Never infer that wider prefix for an older saved report.
  const currentNamespace = current.selection.mode === "explicit-subject" ? current.selection.namespace_frontier : undefined
  const priorNamespace = prior.selection.mode === "explicit-subject" ? prior.selection.namespace_frontier : undefined
  const older = currentNamespace && priorNamespace ? priorNamespace : retrospectiveFrontier(prior)
  const newer = currentNamespace && priorNamespace ? currentNamespace : retrospectiveFrontier(current)
  return (Object.keys(older) as Array<keyof LearningFrontier>).every(key => older[key] <= newer[key])
}
