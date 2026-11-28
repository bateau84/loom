import { expect, test } from "bun:test"
import { canonical, digest, ProcessingBudget } from "../src/model.js"
import type { EvaluatorRetrievedSource } from "../src/evaluator-execution-contract.js"
import { EVALUATOR_INTERPRETATION_LIMITS, parseEvaluatorInterpretation, type EvaluatorInterpretation } from "../src/evaluator-interpretation.js"
import { EVALUATOR_INTERPRETATION_SECTIONS, evaluatorInterpretationSources, paginateEvaluatorInterpretation,
  renderEvaluatorInterpretationHTML, renderEvaluatorInterpretationMarkdown, type EvaluatorInterpretationDocument,
  type EvaluatorInterpretationPageInput, type EvaluatorInterpretationSection } from "../src/evaluator-interpretation-view.js"
import { parseRetrospectiveManifest, retrospectiveDigest, type RetrospectivePopulation } from "../src/retrospective-contract.js"
import { retrospectiveActor, retrospectiveFixture } from "./helpers/retrospective-store-fixture.js"

function fixture(count = 3) {
  const manifest = parseRetrospectiveManifest(retrospectiveFixture(count))
  const population: RetrospectivePopulation = { population_id: "population-interpretation", manifest_sha256: retrospectiveDigest(manifest),
    owner_session: "investigator", frozen_by: retrospectiveActor, created_at: "2026-10-01T00:00:00.000Z", manifest }
  const retrieved: EvaluatorRetrievedSource[] = manifest.members.map((member, index) => ({ member_key: member.key, source_index: 0,
    receipt_id: "read-" + index, boundary: "native-tool-result", source_sha256: member.source.sha256! }))
  const key = manifest.members[0]!.key, supporting = [{ member_key: key, source_index: 0 as const }]
  const interpretation: EvaluatorInterpretation = { format: "loom-evaluator-interpretation/v1", covered_members: manifest.members.map(member => member.key),
    conclusion: { kind: "no-change", statement: "The scoped recovery succeeded; the available evidence does not justify changing the shared policy.", limitations: ["This is not release acceptance."] },
    trajectory: [{ event_id: "recovery", statement: "The scoped check passed after the correction.", members: [key], supporting, limitations: ["The original failure's cause is unproven."] }],
    claims: [{ claim_id: "scoped-check", kind: "verification", category: "successful-practice", basis: "supported",
      statement: "The recorded check covers the named correction.", members: [key], supporting, contradicting: [], limitations: ["A broader release check was not requested."], applicability: [], recommendation: null }],
    review_coverage: [{ review_id: "review-scoped", requested: ["Review the correction"], covered: ["Correction verification"], members: [key], supporting, limitations: ["No whole-system verdict."] }],
    gaps: [], qualifications: { chronology: ["Recorded order does not prove original user intent."], independence: "unknown" }, prior_interpretations: [] }
  return { population, retrieved, interpretation }
}
function document(input = fixture()): EvaluatorInterpretationDocument {
  return { report_id: "interpretation-" + "d".repeat(64), report_sha256: "e".repeat(64), state: "complete",
    body: { format: "loom-evaluator-publication/v1", binding: {
      subject: { source_store_id: "source-store", owner_session: "investigator", batch_id: "batch", request_id: "request", attempt_id: "attempt",
        manifest_sha256: "b".repeat(64), semantic_key: "c".repeat(64), source: { kind: "retrospective-population", format: "loom-retrospective-population/v1",
          population_id: input.population.population_id, manifest_sha256: input.population.manifest_sha256 } }, admission_sha256: "a".repeat(64), method_sha256: "b".repeat(64),
      result: { host_id: "host", session_id: "evaluator", input_id: "input", result_id: "result", sha256: "c".repeat(64) } },
      interpretation: input.interpretation, retrieved: input.retrieved }, sources: evaluatorInterpretationSources(input.population, input.retrieved, input.interpretation) }
}
function parsed(input: ReturnType<typeof fixture>) { return parseEvaluatorInterpretation(input.interpretation, input.population, input.retrieved) }
function pageItems(doc: EvaluatorInterpretationDocument, section: EvaluatorInterpretationSection, limit = 7) {
  let next: EvaluatorInterpretationPageInput | null = { section, limit }, pages = 0
  const items: unknown[] = []
  while (next) {
    const page = paginateEvaluatorInterpretation(doc, next)
    expect(page.representation).toBe("items")
    expect(page.coverage.from).toBe(items.length)
    expect(canonical(page, new ProcessingBudget(262144, 200000)).length).toBeLessThanOrEqual(262144)
    items.push(...page.items); pages++
    next = page.navigation.next
  }
  return { items, pages }
}

test("versioned interpretations preserve exact authored values and detach caller aliases", () => {
  const input = fixture(), result = parsed(input)
  expect(result).toEqual(input.interpretation)
  expect(parseEvaluatorInterpretation(JSON.stringify(input.interpretation), input.population, input.retrieved)).toEqual(result)
  input.interpretation.claims[0]!.supporting.length = 0
  expect(result.claims[0]!.supporting).toHaveLength(1)
  expect(result.qualifications.independence).toBe("unknown")
})

test("population completeness rejects omissions, foreign members and duplicate coverage", () => {
  const mutations = [
    (value: EvaluatorInterpretation) => value.covered_members.pop(),
    (value: EvaluatorInterpretation) => { value.covered_members[0] = "foreign" },
    (value: EvaluatorInterpretation) => value.covered_members.push(value.covered_members[0]!),
  ]
  for (const mutate of mutations) { const input = fixture(); mutate(input.interpretation); expect(() => parsed(input)).toThrow() }
  const sparse = fixture()
  delete sparse.interpretation.covered_members[0]
  expect(() => parsed(sparse)).toThrow("sparse")
})

test("unknown schemas, fabricated authority and accessors fail without executing authored code", () => {
  const input = fixture()
  for (const raw of [{ ...input.interpretation, format: "loom-evaluator-interpretation/v2" },
    { ...input.interpretation, source_authority: "approved" }, { ...input.interpretation, qualifications: { chronology: [], independence: "independent" } }])
    expect(() => parseEvaluatorInterpretation(raw, input.population, input.retrieved)).toThrow()
  let invoked = false
  const raw = { ...input.interpretation }
  Object.defineProperty(raw, "conclusion", { enumerable: true, get() { invoked = true; return {} } })
  expect(() => parseEvaluatorInterpretation(raw, input.population, input.retrieved)).toThrow()
  expect(invoked).toBe(false)
})

test("citations need exact trusted retrieval, frozen version and explicitly scoped members", () => {
  for (const mutate of [
    (input: ReturnType<typeof fixture>) => { input.retrieved[0]!.source_sha256 = "f".repeat(64) },
    (input: ReturnType<typeof fixture>) => { input.retrieved[0]!.member_key = "foreign" },
    (input: ReturnType<typeof fixture>) => { input.retrieved[0]!.source_index = 1 as 0 },
    (input: ReturnType<typeof fixture>) => { input.retrieved[0]!.boundary = "model-citation" as "provider-input" },
    (input: ReturnType<typeof fixture>) => { input.population.manifest.members[0]!.source.revision = "newer" },
    (input: ReturnType<typeof fixture>) => { input.population.manifest.members[0]!.availability = "missing" },
    (input: ReturnType<typeof fixture>) => { input.retrieved.push({ ...input.retrieved[0]! }) },
    (input: ReturnType<typeof fixture>) => { input.interpretation.claims[0]!.members = [input.population.manifest.members[1]!.key] },
    (input: ReturnType<typeof fixture>) => { input.retrieved.shift() },
    (input: ReturnType<typeof fixture>) => { input.interpretation.claims[0]!.supporting[0]!.source_index = 1 as 0 },
  ]) { const input = fixture(); mutate(input); expect(() => parsed(input)).toThrow() }
  const validRepeated = fixture()
  validRepeated.retrieved.push({ ...validRepeated.retrieved[0]!, receipt_id: "later-read", boundary: "provider-input" })
  expect(parsed(validRepeated)).toEqual(validRepeated.interpretation)
})

test("unsupported findings require an explicit qualified hypothesis and cannot become observed facts", () => {
  const input = fixture(), claim = input.interpretation.claims[0]!
  claim.supporting = []
  expect(() => parsed(input)).toThrow("supporting evidence")
  claim.kind = "interpretation"; claim.basis = "hypothesis"
  expect(parsed(input).claims[0]!.basis).toBe("hypothesis")
  claim.limitations = []
  expect(() => parsed(input)).toThrow("explicitly limited")
  claim.limitations = ["Unverified causal possibility."]; claim.kind = "observed"
  expect(() => parsed(input)).toThrow("explicitly limited")
})

test("duplicate identities and unqualified contradictory evidence are rejected", () => {
  for (const mutate of [
    (input: ReturnType<typeof fixture>) => input.interpretation.claims.push(structuredClone(input.interpretation.claims[0]!)),
    (input: ReturnType<typeof fixture>) => input.interpretation.trajectory.push(structuredClone(input.interpretation.trajectory[0]!)),
    (input: ReturnType<typeof fixture>) => input.interpretation.review_coverage.push(structuredClone(input.interpretation.review_coverage[0]!)),
    (input: ReturnType<typeof fixture>) => { input.interpretation.claims[0]!.supporting.push({ ...input.interpretation.claims[0]!.supporting[0]! }) },
  ]) { const input = fixture(); mutate(input); expect(() => parsed(input)).toThrow("Duplicate") }
  const input = fixture(), claim = input.interpretation.claims[0]!, contrary = input.population.manifest.members[1]!.key
  claim.members.push(contrary); claim.contradicting.push({ member_key: contrary, source_index: 0 })
  expect(parsed(input).claims[0]!.contradicting).toHaveLength(1)
  claim.limitations = []
  expect(() => parsed(input)).toThrow("Contradictory")
})

test("unavailable and never retrieved evidence remain explicit gaps and distinct source states", () => {
  const input = fixture(), unavailable = input.population.manifest.members[2]!, unretrieved = input.population.manifest.members[1]!
  unavailable.availability = "unresolved"
  input.retrieved.splice(1)
  expect(() => parsed(input)).toThrow("disclose unavailable and unretrieved")
  input.interpretation.gaps.push({ member_key: unavailable.key, kind: "unavailable", reason: "Native original was unresolved at freeze." },
    { member_key: unretrieved.key, kind: "not-retrieved", reason: "The execution did not retrieve this selected source." })
  expect(parsed(input).gaps).toHaveLength(2)
  const sources = evaluatorInterpretationSources(input.population, input.retrieved, input.interpretation)
  expect(sources[0]).toMatchObject({ selected: true, retrieved: true, cited: true, unavailable: false })
  expect(sources[1]).toMatchObject({ selected: true, retrieved: false, cited: false, unavailable: false })
  expect(sources[2]).toMatchObject({ selected: true, retrieved: false, cited: false, unavailable: true })
  expect(sources[0]!.inspect).toEqual({ operation: "population-source", population_id: input.population.population_id,
    manifest_sha256: input.population.manifest_sha256, member_key: input.population.manifest.members[0]!.key })
  input.interpretation.gaps[1]!.kind = "unavailable"
  expect(() => parsed(input)).toThrow("contradicts")
})

test("recommendations require applicability, risks and validation and preserve prior attribution", () => {
  const input = fixture(), claim = input.interpretation.claims[0]!
  input.interpretation.conclusion.kind = "recommendations"; claim.kind = "recommendation"
  claim.applicability = ["Corrections with narrowly scoped verification."]
  claim.recommendation = { target: "Verification checklist", mechanism: "State verification scope beside the result.", risks: ["Extra reporting work."],
    validation: ["Compare clarity of the next three scoped corrections."], prior_recommendations: [] }
  expect(parsed(input).claims[0]!.recommendation).toEqual(claim.recommendation)
  for (const field of ["risks", "validation"] as const) {
    const copy = structuredClone(input); copy.interpretation.claims[0]!.recommendation![field] = []
    expect(() => parsed(copy)).toThrow("applicability, risks and validation")
  }
  const noApplicability = structuredClone(input); noApplicability.interpretation.claims[0]!.applicability = []
  expect(() => parsed(noApplicability)).toThrow("applicability, risks and validation")
  const prior = { report_id: "earlier", report_sha256: "f".repeat(64), claim_id: "old-recommendation" }
  claim.recommendation.prior_recommendations.push(prior)
  expect(() => parsed(input)).toThrow("attributable prior interpretation")
  input.interpretation.prior_interpretations.push({ report_id: prior.report_id, report_sha256: prior.report_sha256, relation: "contests", reason: "Later evidence limits the earlier recommendation." })
  expect(parsed(input).prior_interpretations[0]!.relation).toBe("contests")
  input.interpretation.conclusion.kind = "no-change"
  expect(() => parsed(input)).toThrow("disagree")
})

test("explicit no-change and insufficient-evidence conclusions do not fabricate recommendations", () => {
  const input = fixture()
  expect(parsed(input).conclusion.kind).toBe("no-change")
  input.interpretation.claims = []; input.interpretation.trajectory = []; input.interpretation.review_coverage = []
  expect(() => parsed(input)).toThrow("no-change conclusion requires")
  input.interpretation.conclusion.kind = "insufficient-evidence"
  expect(parsed(input).claims).toEqual([])
  input.interpretation.conclusion.limitations = []
  expect(() => parsed(input)).toThrow("explicit limitation or source gap")
})

test("oversized narrative items fail admission instead of disappearing from readback", () => {
  const input = fixture()
  input.interpretation.claims[0]!.limitations = Array.from({ length: 10 }, () => "x".repeat(16000))
  expect(() => parsed(input)).toThrow("processing limit")
  expect(EVALUATOR_INTERPRETATION_LIMITS.itemChars).toBeLessThan(262144)
})

test("every report section retrieves completely across pages beyond 500 selected sources", () => {
  const input = fixture(517)
  input.interpretation.claims = Array.from({ length: 91 }, (_, index) => ({ ...structuredClone(input.interpretation.claims[0]!), claim_id: "claim-" + index }))
  input.interpretation.trajectory = Array.from({ length: 37 }, (_, index) => ({ ...structuredClone(input.interpretation.trajectory[0]!), event_id: "event-" + index }))
  input.interpretation.review_coverage = Array.from({ length: 23 }, (_, index) => ({ ...structuredClone(input.interpretation.review_coverage[0]!), review_id: "review-" + index }))
  input.interpretation.gaps = input.population.manifest.members.slice(0, 29).map(member => ({ member_key: member.key, kind: "coverage", reason: "The permitted owner view does not establish originating independence." }))
  input.interpretation.prior_interpretations = Array.from({ length: 17 }, (_, index) => ({ report_id: "prior-" + index, report_sha256: "f".repeat(64), relation: "contests", reason: "Later scoped evidence is available." }))
  const doc = document(input)
  expect(parsed(input)).toEqual(input.interpretation)
  for (const section of EVALUATOR_INTERPRETATION_SECTIONS) {
    const retrieved = pageItems(doc, section)
    if (section === "overview") expect(retrieved.items).toHaveLength(3)
    else if (section === "sources") { expect(retrieved.items).toEqual(doc.sources!); expect(retrieved.pages).toBeGreaterThan(70) }
    else expect(retrieved.items).toEqual(input.interpretation[section])
  }
})

test("continuations bind report identity, content fingerprint, section and valid ordinal", () => {
  const doc = document(), first = paginateEvaluatorInterpretation(doc, { section: "sources", limit: 1 }), next = first.navigation.next!
  expect(next.after).toBeDefined()
  expect(paginateEvaluatorInterpretation(doc, next).coverage.from).toBe(1)
  for (const bad of [{ ...next, section: "claims" }, { ...next, report_id: "other" }, { ...next, report_sha256: "a".repeat(64) },
    { ...next, after: "malformed-json" }, { ...next, limit: 101 }]) expect(() => paginateEvaluatorInterpretation(doc, bad)).toThrow()
  expect(() => paginateEvaluatorInterpretation({ ...doc, report_sha256: "a".repeat(64) }, { after: next.after, section: "sources" })).toThrow()
  const decoded = JSON.parse(Buffer.from(next.after!, "base64url").toString("utf8"))
  decoded.ordinal = 3
  expect(() => paginateEvaluatorInterpretation(doc, { ...next, after: Buffer.from(JSON.stringify(decoded)).toString("base64url") })).toThrow()
})

test("UTF-8 and escaped human presentations fit the public response with room for wrapper navigation", () => {
  const input = fixture()
  input.interpretation.claims = Array.from({ length: 9 }, (_, index) => ({ ...structuredClone(input.interpretation.claims[0]!),
    claim_id: "unicode-" + index, statement: "漢💡<&\"".repeat(2000) }))
  const doc = document(input), recovered: unknown[] = []
  let next: EvaluatorInterpretationPageInput | null = { section: "claims", limit: 25 }, count = 0
  while (next) {
    const page = paginateEvaluatorInterpretation(doc, next)
    expect(page.representation).toBe("items")
    for (const value of [JSON.stringify(page), renderEvaluatorInterpretationMarkdown(page), renderEvaluatorInterpretationHTML(page)])
      expect(Buffer.byteLength(value, "utf8")).toBeLessThanOrEqual(180000)
    recovered.push(...page.items); count++
    next = page.navigation.next
  }
  expect(count).toBeGreaterThan(1)
  expect(recovered).toEqual(input.interpretation.claims)
})

test("oversized host provenance is recovered exactly without skipped items or broken Unicode", () => {
  const doc = document(), large = { member_key: "source-large", qualifications: "💡 <tag> \\\"".repeat(60000) }
  doc.sources = [large, { member_key: "last-source", selected: true }]
  let next: EvaluatorInterpretationPageInput | null = { section: "sources", limit: 1 }, encoded = "", last: unknown[] = [], fragments = 0
  while (next) {
    const page = paginateEvaluatorInterpretation(doc, next)
    expect(canonical(page, new ProcessingBudget(262144, 200000)).length).toBeLessThanOrEqual(262144)
    if (page.fragment) {
      expect(page.fragment.from).toBe(encoded.length)
      encoded += page.fragment.content_json; fragments++
    } else last.push(...page.items)
    next = page.navigation.next
  }
  expect(fragments).toBeGreaterThan(2)
  expect(JSON.parse(encoded)).toEqual(large)
  expect(encoded).toBe(canonical(large, new ProcessingBudget(33554432, 2000000)))
  expect(last).toEqual([doc.sources[1]])
})

test("all representations retain the same evidence page while hostile source text remains inert", () => {
  const input = fixture(), hostile = "```\n<script>alert('evidence')</script>\n![image](https://invalid.example/leak)"
  input.interpretation.claims[0]!.statement = hostile
  const doc = document(input)
  Object.assign(doc.body, { original_result_text: "PRIVATE RAW DUPLICATE" })
  const page = paginateEvaluatorInterpretation(doc, { section: "claims" })
  const markdown = renderEvaluatorInterpretationMarkdown(page), html = renderEvaluatorInterpretationHTML(page)
  expect(markdown).toContain(JSON.stringify(page, null, 2))
  expect(markdown).toContain("````json")
  expect(markdown).toContain("&lt;script&gt;")
  expect(html).toContain("&lt;script&gt;")
  expect(html).not.toContain("<script")
  expect(html).not.toContain("<img")
  expect(html).toContain("default-src 'none'")
  expect(html).toContain("&quot;supporting&quot;")
  expect(html).toContain(input.interpretation.claims[0]!.supporting[0]!.member_key)
  expect(JSON.stringify(page)).not.toContain("PRIVATE RAW DUPLICATE")
  expect(markdown).not.toContain("PRIVATE RAW DUPLICATE")
  expect(html).not.toContain("PRIVATE RAW DUPLICATE")
  expect(digest(page.binding)).toBe(digest(doc.body.binding))
})

test("ordinary overview explains the trajectory and counterevidence through local exact-source links", () => {
  const input = fixture(), concern = input.population.manifest.members[1]!
  input.interpretation.claims[0]!.members.push(concern.key)
  input.interpretation.claims[0]!.contradicting.push({ member_key: concern.key, source_index: 0 })
  input.interpretation.claims[0]!.limitations = ["Ethernet was not retested; the recorded WiFi pass does not establish all-interface recovery."]
  const doc = document(input)
  doc.foundation = { question: "What was verified during this investigation?", target: { kind: "session", id: "ordinary" }, cutoff: { kind: "point-in-time" } }
  Object.assign(doc.sources![0]!, { label: "Reported WiFi verification", excerpt: "The scoped WiFi check was reported as passing.", evidence_kind: "Authored claim; not independently verified." })
  Object.assign(doc.sources![1]!, { label: "Ethernet verification remains missing", excerpt: "Ethernet has not been retested." })
  const before = canonical(doc.body.interpretation), page = paginateEvaluatorInterpretation(doc), rendered = renderEvaluatorInterpretationHTML(page)
  expect(page.items).toHaveLength(3)
  expect(page.narrative?.find(group => group.section === "trajectory")?.items).toHaveLength(1)
  expect(page.evidence).toHaveLength(2)
  expect(rendered).toContain("What was verified during this investigation?")
  expect(rendered).toContain("Counterevidence and scope limits")
  expect(rendered).toContain("Missing verification may limit a conclusion without contradicting a reported pass")
  expect(rendered).toContain('href="#claims-item-0"')
  expect(rendered).toContain('href="#trajectory-item-0"')
  expect(rendered).toContain('id="report-technical"')
  expect(rendered).not.toContain('id="report-technical" open')
  expect(rendered).toContain('aria-label="Retrospective sections"')
  expect(rendered).toContain("does not prove that this Session")
  expect(canonical(doc.body.interpretation)).toBe(before)
  const links = [...rendered.matchAll(/href="#([^"\s]+)"/g)].map(match => match[1])
  const ids = new Set([...rendered.matchAll(/id="([^"\s]+)"/g)].map(match => match[1]))
  expect(links.every(link => ids.has(link))).toBe(true)
})

test("bounded narrative discloses omitted entries and never consumes section continuation", () => {
  const input = fixture()
  input.interpretation.trajectory = Array.from({ length: 37 }, (_, i) => ({ ...input.interpretation.trajectory[0]!, event_id: `step-${i}` }))
  const doc = document(input), page = paginateEvaluatorInterpretation(doc), narrative = page.narrative?.find(group => group.section === "trajectory")
  expect(narrative?.total).toBe(37)
  expect(narrative?.items).toHaveLength(10)
  expect(renderEvaluatorInterpretationHTML(page)).toContain("Showing 10 of 37 items in this overview")
  expect(pageItems(doc, "trajectory").items).toEqual(input.interpretation.trajectory)
})

test("mutable Action context is labelled current and completion remains an authored cutoff", () => {
  const doc = document()
  doc.foundation = { question: "Inspect the selected work", target: { kind: "action", id: "action" },
    intent: { goal: "A later edited goal", meaning: "current-authored-action" }, cutoff: { kind: "recorded-completion" } }
  const rendered = renderEvaluatorInterpretationHTML(paginateEvaluatorInterpretation(doc))
  expect(rendered).toContain("Current authored Action context")
  expect(rendered).toContain("Original user intent is not independently established")
  expect(rendered).toContain("authored record does not itself establish independent acceptance")
})

test("reused exact originals are not presented as independent corroboration", () => {
  const doc = document(), source = doc.sources![0]!
  doc.sources = [source, { ...structuredClone(source as Record<string, unknown>), context: { report_id: "earlier", report_sha256: "a".repeat(64) }, selected: false }]
  const rendered = renderEvaluatorInterpretationHTML(paginateEvaluatorInterpretation(doc, { section: "sources" }))
  expect(rendered).toContain("Reusing it does not provide independent corroboration")
  const different = structuredClone(source) as any
  different.source.sha256 = "9".repeat(64)
  doc.sources = [source, different]
  expect(renderEvaluatorInterpretationHTML(paginateEvaluatorInterpretation(doc, { section: "sources" }))).not.toContain("Reusing it does not provide independent corroboration")
})

test("a prior-original citation does not mark a current population member cited", () => {
  const input = fixture(), current = input.population.manifest.members[0]!
  const prior = { kind: "prior-original" as const, report_id: "earlier-report", report_sha256: "b".repeat(64),
    member_key: current.key, source_index: 0 as const }
  input.interpretation.trajectory = []
  input.interpretation.review_coverage = []
  input.interpretation.claims[0]!.supporting = [prior]
  input.interpretation.prior_interpretations = [{ report_id: prior.report_id, report_sha256: prior.report_sha256,
    relation: "context", reason: "Keep the earlier verification limit available." }]
  const sources = evaluatorInterpretationSources(input.population, input.retrieved, input.interpretation)
  expect(sources.find(source => source.member_key === current.key)!.cited).toBe(false)
  const doc = document(input)
  doc.sources!.push({ ...sources[0], ...prior, selected: false, cited: true, label: "Earlier Ethernet concern",
    inspect: { operation: "evaluation-prior-source", report_id: prior.report_id, report_sha256: prior.report_sha256, member_key: prior.member_key, source_index: 0 } })
  const page = paginateEvaluatorInterpretation(doc), html = renderEvaluatorInterpretationHTML(page)
  expect(page.report_context).toEqual({ context: 1, supersedes: 0, contests: 0 })
  expect(html).toContain("Earlier Ethernet concern")
  expect(html).toContain("It does not add a member to the current increment")
  expect(html).toContain("Keeping an earlier report as context does not supersede or invalidate it")
  expect(html).toContain("evaluation-prior-source")
})
