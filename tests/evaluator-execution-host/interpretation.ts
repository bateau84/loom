/** TEST ONLY: structured scripted results emitted at the actual provider boundary.
 * These examples qualify result validation/publication mechanics, never reasoning.
 */
type Original = { member_key: string; status: string; source: { kind: string }; value?: unknown }
type Prior = { report_id: string; report_sha256: string; claim_id: string }

export function scriptedInterpretation(sourceText: string, mode: string, prior?: Prior): string {
  if (!["recommendations", "no-change", "malformed", "unsupported", "unknown-member", "unavailable-citation", "revision"].includes(mode))
    throw new Error("Unknown structured fixture result mode")
  if (mode === "malformed") return '{"format":"loom-evaluator-interpretation/v1",'
  const delivery = JSON.parse(sourceText) as { originals: Original[] }
  const available = delivery.originals.filter(original => original.status === "available")
  const match = (text: string) => {
    const original = available.find(original => original.source.kind === "ledger-record"
      && JSON.stringify(original.value).includes(text))
    if (!original) throw new Error("Structured fixture original is absent: " + text)
    return original
  }
  if (!available.length) throw new Error("Structured fixture needs actual retrieved original evidence")
  const failed = match("Synthetic attempt 0 verification: fail"), passed = match("Synthetic attempt 1 verification: pass")
  const ref = (original: Original) => ({ member_key: original.member_key, source_index: 0 as const })
  const claim = (claim_id: string, kind: string, category: string, statement: string,
    sources: Original[], basis = "supported") => ({ claim_id, kind, category, basis, statement,
    members: sources.map(source => source.member_key), supporting: sources.map(ref), contradicting: [] as ReturnType<typeof ref>[],
    limitations: ["Synthetic authored evidence qualifies publication mechanics only; independent truth is unproven."],
    applicability: ["This exact frozen synthetic engineering objective."], recommendation: null as null | {
      target: string; mechanism: string; risks: string[]; validation: string[]; prior_recommendations: Prior[] } })
  const claims = [
    claim("failed-verification", "observed", "finding", "The first authored verification records fail.", [failed]),
    claim("successful-verification", "verification", "successful-practice", "The second authored verification records pass.", [passed]),
    claim("retained-evidence", "interpretation", "successful-practice",
      "Retaining both verification outcomes makes the correction inspectable.", [failed, passed]),
    claim("possible-rework", "interpretation", "avoidable-failure",
      "The first failed attempt may identify avoidable rework; its cause remains uncertain.", [failed], "hypothesis"),
    claim("exploration", "interpretation", "necessary-exploration",
      "The failed attempt may have helped narrow the correction.", [failed], "hypothesis"),
    claim("recovery", "authored", "recovery", "The authored evidence records a corrected passing attempt.", [passed]),
  ]
  for (const [claimID, statement, target, mechanism] of [
    ["preserve-failed-verification", "Preserve failed verification alongside the correction.",
      "Objective verification records", "Retain the original failed evidence and link the corrected verification."],
    ["validate-correction", "Validate the correction against the original failed scope.",
      "Correction validation", "Rerun the original failing check and record its exact scope with the outcome."],
  ]) {
    const recommendation = claim(claimID!, "recommendation", "finding", statement!, [failed, passed])
    recommendation.recommendation = { target: target!, mechanism: mechanism!,
      risks: ["A passing authored result can be mistaken for independent verification."],
      validation: ["Have an independent reviewer compare both original records and rerun the stated failing check."],
      prior_recommendations: [] }
    claims.push(recommendation)
  }
  const value = {
    format: "loom-evaluator-interpretation/v1", covered_members: delivery.originals.map(original => original.member_key),
    conclusion: { kind: mode === "no-change" ? "no-change" : "recommendations",
      statement: mode === "no-change" ? "No practice change is justified by this bounded synthetic evidence."
        : "Preserve failed evidence and verify corrections against the original scope.",
      limitations: ["SCRIPTED PUBLICATION MECHANICS ONLY; genuine Evaluator reasoning is unproven.",
        "Missing historical originals and independent review constrain these conclusions."] },
    trajectory: [
      { event_id: "first-verification", statement: "The first authored verification failed.", members: [failed.member_key],
        supporting: [ref(failed)], limitations: ["Order is asserted by the synthetic original's attempt number."] },
      { event_id: "corrected-verification", statement: "A later authored verification passed.", members: [passed.member_key],
        supporting: [ref(passed)], limitations: ["A passing assertion is not independent reproduction."] },
    ],
    claims: mode === "no-change" ? claims.filter(item => item.kind !== "recommendation") : claims,
    review_coverage: [],
    gaps: delivery.originals.filter(original => original.status !== "available").map(original => ({
      member_key: original.member_key, kind: "unavailable", reason: "The frozen population explicitly has no available original." })),
    qualifications: { chronology: ["Attempt order follows authored fixture statements; elapsed time and causality are unknown."],
      independence: "unknown" },
    prior_interpretations: [] as Array<{ report_id: string; report_sha256: string; relation: string; reason: string }>,
  }
  if (mode === "unsupported") value.claims[0]!.supporting = []
  if (mode === "unknown-member") value.claims[0]!.supporting[0]!.member_key = "not-a-frozen-member"
  if (mode === "unavailable-citation") {
    const unavailable = delivery.originals.find(original => original.status !== "available")!
    value.claims[0]!.members = [unavailable.member_key]
    value.claims[0]!.supporting = [ref(unavailable)]
  }
  if (mode === "revision") {
    if (!prior) throw new Error("Scripted revision needs the prior published identity, not an imported report")
    const later = match("Contradictory follow-up verification: fail")
    value.conclusion.statement = "Later contradictory verification limits the earlier passing conclusion and requires renewed validation."
    value.prior_interpretations.push({ report_id: prior.report_id, report_sha256: prior.report_sha256,
      relation: "contests", reason: "The new frozen population includes an authored failing follow-up after the earlier pass." })
    const contradiction = claim("contradictory-follow-up", "observed", "finding",
      "A later authored follow-up verification records fail despite the earlier passing assertion.", [later])
    contradiction.contradicting = [ref(passed)]
    contradiction.members.push(passed.member_key)
    value.claims.push(contradiction)
    const recommendation = value.claims.find(item => item.claim_id === "validate-correction")!
    recommendation.recommendation!.prior_recommendations = [prior]
    recommendation.supporting.push(ref(later))
    recommendation.members.push(later.member_key)
  }
  return JSON.stringify(value)
}
