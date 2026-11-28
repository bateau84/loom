import { createHash } from "node:crypto"
import { canonical, digest } from "./model.js"
import type { EvaluatorExecutionAdmission, EvaluatorExecutionReceipt, EvaluatorExecutionSubject, EvaluatorOriginalResult,
  EvaluatorRetrievedContext, EvaluatorRetrievedSource } from "./evaluator-execution-contract.js"
import { parseEvaluatorInterpretation, parseEvaluatorContextReceipts, type EvaluatorInterpretation } from "./evaluator-interpretation.js"
import { retrospectiveBudget, retrospectiveMemberKey, RETROSPECTIVE_ORIGINAL_LIMITS, type RetrospectivePopulation } from "./retrospective-contract.js"

export const INTERPRETATION_QUALIFICATIONS = ["Machine-validated publication; reasoning quality and review independence are not established."]
// One interpretation may inherit the existing bounded 32-report history. Its
// original-validation budget admits the union of 32 maximum public selections;
// this does not enlarge ordinary population operations or inference budgets.
const INTERPRETATION_REPORTS = 32
export const EVALUATOR_INTERPRETATION_LIMITS = Object.freeze({ reports: INTERPRETATION_REPORTS,
  originals: INTERPRETATION_REPORTS * RETROSPECTIVE_ORIGINAL_LIMITS.selection, dependencies: 100000 })

/** Count exact available originals, not aliases, repeated report references or
 * frozen gaps. Member identities bind namespace, version and permitted view.
 * Publication and readback use the same bounds; no successful prefix is valid. */
export function evaluatorInterpretationOriginals(populations: Iterable<RetrospectivePopulation>,
  budget = { originals: new Set<string>(), dependencies: new Set<string>() }): Set<string> {
  const { originals, dependencies } = budget
  for (const population of populations) for (const member of population.manifest.members) {
    dependencies.add(member.key)
    if (dependencies.size > EVALUATOR_INTERPRETATION_LIMITS.dependencies)
      throw new Error("Evaluator interpretation dependency union exceeds 100000 sources; narrow the publication dependency union or reduce the report-list limit")
    if (member.availability !== "available" || !["native-message", "native-call", "external-ref"].includes(member.source.kind)) continue
    originals.add(member.key)
    if (originals.size > EVALUATOR_INTERPRETATION_LIMITS.originals)
      throw new Error(`Evaluator interpretation exceeds ${EVALUATOR_INTERPRETATION_LIMITS.originals} unique pinned native/external originals; narrow the publication dependency union or reduce the report-list limit`)
  }
  return originals
}
export type EvaluatorPublication = {
  format: "loom-evaluator-publication/v1";
  binding: { subject: EvaluatorExecutionSubject; admission_sha256: string; method_sha256: string;
    result: NonNullable<EvaluatorExecutionReceipt["result"]> };
  original_result_text: string;
  retrieved: EvaluatorRetrievedSource[];
  context_retrieved?: EvaluatorRetrievedContext[];
  interpretation: EvaluatorInterpretation;
}
export const evaluatorInterpretationID = (binding: EvaluatorPublication["binding"]) => "interpretation-" + digest({
  format: "loom-evaluator-report-id/v1", admission_sha256: binding.admission_sha256, result: binding.result,
})
export const evaluatorMemberInterpretationID = (reportID: string, memberKey: string) => "interpretation-member-" + digest({
  format: "loom-evaluator-member-id/v1", report_id: reportID, member_key: memberKey,
})
const same = (a: unknown, b: unknown) => canonical(a, retrospectiveBudget()) === canonical(b, retrospectiveBudget())
const fields = (value: unknown, names: string[]): value is Record<string, unknown> => !!value && typeof value === "object"
  && !Array.isArray(value) && Object.keys(value).sort().join() === names.sort().join()

/** Pure integrity check, not an execution authority or a public import route.
 * The caller obtains the original only from its trusted execution owner. */
export function evaluatorPublication(admission: EvaluatorExecutionAdmission, receipt: EvaluatorExecutionReceipt,
  original: EvaluatorOriginalResult, population: RetrospectivePopulation): EvaluatorPublication {
  canonical(original, retrospectiveBudget())
  if (receipt.execution !== "completed" || receipt.budget !== "settled" || !receipt.fenced || !receipt.usage || !receipt.result)
    throw new Error("Evaluator publication requires a completed result with authoritative accounting")
  const subject = admission.grant.subject
  if (!subject.source || subject.source.population_id !== population.population_id
    || subject.source.manifest_sha256 !== population.manifest_sha256 || subject.owner_session !== population.owner_session
    || subject.source_store_id !== population.manifest.source_store_id)
    throw new Error("Evaluator publication population binding mismatch")
  const hasContext = Object.hasOwn(original, "context_retrieved")
  if (!fields(original, ["format", "admission_sha256", "result", "text", "retrieved", ...(hasContext ? ["context_retrieved"] : [])])
    || original.format !== "loom-evaluator-result/v1" || original.admission_sha256 !== digest(admission)
    || !same(original.result, receipt.result) || typeof original.text !== "string"
    || createHash("sha256").update(original.text, "utf8").digest("hex") !== receipt.result.sha256)
    throw new Error("Evaluator original result integrity mismatch")
  const context = hasContext ? parseEvaluatorContextReceipts(original.context_retrieved) : undefined
  const interpretation = parseEvaluatorInterpretation(original.text, population, original.retrieved, context)
  return { format: "loom-evaluator-publication/v1", binding: { subject, admission_sha256: digest(admission),
    method_sha256: digest(admission.grant.method), result: receipt.result }, original_result_text: original.text,
    retrieved: structuredClone(original.retrieved), ...(context ? { context_retrieved: context } : {}), interpretation }
}

/** Revalidate the retained raw result against its immutable native result hash,
 * then reproduce its interpretation. Rehashed body edits cannot change claims
 * while retaining that original result identity. */
export function validateEvaluatorPublication(raw: unknown, admission: EvaluatorExecutionAdmission,
  receipt: EvaluatorExecutionReceipt, population: RetrospectivePopulation): EvaluatorPublication {
  canonical(raw, retrospectiveBudget())
  const hasContext = !!raw && typeof raw === "object" && Object.hasOwn(raw, "context_retrieved")
  if (!fields(raw, ["format", "binding", "original_result_text", "retrieved", "interpretation", ...(hasContext ? ["context_retrieved"] : [])])
    || raw.format !== "loom-evaluator-publication/v1"
    || !fields(raw.binding, ["subject", "admission_sha256", "method_sha256", "result"]))
    throw new Error("Invalid evaluator publication envelope")
  const body = raw as unknown as EvaluatorPublication
  const checked = evaluatorPublication(admission, receipt, { format: "loom-evaluator-result/v1",
    admission_sha256: body.binding.admission_sha256, result: body.binding.result,
    text: body.original_result_text, retrieved: body.retrieved,
    ...(hasContext ? { context_retrieved: body.context_retrieved! } : {}) }, population)
  if (!same(body, checked)) throw new Error("Evaluator publication provenance mismatch")
  return checked
}

/** A context report may itself inherit many populations. A named earlier
 * original must belong to that report's OWN population; inherited aliases
 * cannot turn an unrelated member into evidence for the named report. */
export function validateEvaluatorPriorOriginals(body: EvaluatorPublication,
  reference: { report_id: string; report_sha256: string }, population: RetrospectivePopulation): void {
  for (const receipt of body.context_retrieved ?? []) {
    if (receipt.report_id !== reference.report_id) continue
    if (receipt.report_sha256 !== reference.report_sha256) throw new Error("Prior original report identity mismatch")
    if (receipt.kind !== "prior-original") continue
    const member = population.manifest.members.find(member => member.key === receipt.member_key)
    if (!member || member.availability !== "available" || receipt.source_index !== 0 || !member.source.revision
      || receipt.source_sha256 !== member.source.sha256
      || member.key !== retrospectiveMemberKey(member.source_store_id, member.source, member.permitted_view))
      throw new Error("Prior original receipt does not identify the named report's own frozen available original")
  }
}

/** Unique referenced reports. A recommendation link also inherits its prior
 * report's whole disclosure dependency union, including uncited inputs. */
export function evaluatorPriorReports(interpretation: EvaluatorInterpretation) {
  const found = new Map<string, { report_id: string; report_sha256: string }>()
  for (const reference of [...interpretation.prior_interpretations,
    ...interpretation.claims.flatMap(claim => claim.recommendation?.prior_recommendations ?? [])]) {
    const old = found.get(reference.report_id)
    if (old && old.report_sha256 !== reference.report_sha256) throw new Error("Conflicting prior interpretation identity")
    found.set(reference.report_id, { report_id: reference.report_id, report_sha256: reference.report_sha256 })
  }
  if (found.size > EVALUATOR_INTERPRETATION_LIMITS.reports) throw new Error("Evaluator interpretation history exceeds 32 reports")
  return [...found.values()]
}
