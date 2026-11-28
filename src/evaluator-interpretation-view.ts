import { canonical, digest, ProcessingBudget, ProcessingLimitError, uid } from "./model.js"
import type { EvaluatorExecutionSubject, EvaluatorExecutionReceipt, EvaluatorRetrievedSource } from "./evaluator-execution-contract.js"
import { evaluatorInterpretationBudget, type EvaluatorInterpretation } from "./evaluator-interpretation.js"
import type { RetrospectivePopulation } from "./retrospective-contract.js"
import { escapeRetrospectiveHTML, retrospectiveDetails, retrospectiveHTMLDocument, retrospectiveMapping } from "./retrospective-source-view.js"

export const EVALUATOR_INTERPRETATION_SECTIONS = ["overview", "trajectory", "claims", "review_coverage", "gaps", "sources", "prior_interpretations"] as const
export type EvaluatorInterpretationSection = typeof EVALUATOR_INTERPRETATION_SECTIONS[number]
export type EvaluatorInterpretationDocument = {
  report_id: string; report_sha256: string;
  body: {
    format: "loom-evaluator-publication/v1";
    binding: { subject: EvaluatorExecutionSubject; admission_sha256: string; method_sha256: string; result: NonNullable<EvaluatorExecutionReceipt["result"]> };
    retrieved: EvaluatorRetrievedSource[]; context_retrieved?: unknown[]; interpretation: EvaluatorInterpretation;
  };
  sources?: unknown[]; state?: string; qualifications?: string[]; foundation?: Record<string, unknown>;
}
export type EvaluatorInterpretationPageInput = { report_id?: unknown; report_sha256?: unknown; section?: unknown; after?: unknown; limit?: unknown }
type Navigation = { report_id: string; report_sha256: string; section: EvaluatorInterpretationSection; limit: number; after?: string }
export type EvaluatorInterpretationPage = {
  format: "loom-evaluator-interpretation-page/v1"; report_id: string; report_sha256: string;
  binding: EvaluatorInterpretationDocument["body"]["binding"]; state?: string; qualifications?: string[];
  section: EvaluatorInterpretationSection; representation: "items" | "item-fragment";
  coverage: { from: number; to: number; total: number; complete: boolean };
  items: unknown[];
  foundation?: Record<string, unknown>;
  narrative?: Array<{ section: EvaluatorInterpretationSection; items: unknown[]; total: number }>;
  evidence?: unknown[];
  evidence_omitted?: number;
  report_context?: { supersedes: number; contests: number; context: number };
  fragment?: { encoding: "canonical-json"; ordinal: number; from: number; to: number; total_characters: number; content_json: string };
  navigation: { sections: Navigation[]; next: Navigation | null };
}
// Leave space below the plugin's 262144-byte response ceiling for its navigation
// and diagnostics. Bound every presentation, including UTF-8/HTML expansion.
const PAGE_CHARS = 180000
const pageBudget = () => new ProcessingBudget(PAGE_CHARS, 200000)
function boundedPage(page: EvaluatorInterpretationPage) {
  const json = canonical(page, pageBudget())
  if ([json, renderEvaluatorInterpretationMarkdown(page), renderEvaluatorInterpretationHTML(page)]
    .some(value => Buffer.byteLength(value, "utf8") > PAGE_CHARS)) throw new ProcessingLimitError("Evaluator interpretation presentation exceeds the page byte budget")
}
const splitSurrogate = (text: string, offset: number) => offset > 0 && offset < text.length
  && /[\uD800-\uDBFF]/.test(text[offset - 1]!) && /[\uDC00-\uDFFF]/.test(text[offset]!)
const citedMembers = (interpretation: EvaluatorInterpretation): Set<string> => new Set([
  ...interpretation.trajectory.flatMap(event => event.supporting),
  ...interpretation.claims.flatMap(claim => [...claim.supporting, ...claim.contradicting]),
  ...interpretation.review_coverage.flatMap(review => review.supporting),
].filter(ref => retrospectiveMapping(ref).kind !== "prior-original").map(ref => ref.member_key))

/** This is a projection of already authorized metadata. It does not resolve a
 * source or grant inspection; population-source rechecks authority on every read. */
export function evaluatorInterpretationSources(population: RetrospectivePopulation, retrieved: EvaluatorRetrievedSource[], interpretation: EvaluatorInterpretation) {
  const cited = citedMembers(interpretation)
  const receipts = new Map<string, EvaluatorRetrievedSource[]>()
  for (const receipt of retrieved) {
    const group = receipts.get(receipt.member_key)
    if (group) group.push(receipt)
    else receipts.set(receipt.member_key, [receipt])
  }
  return population.manifest.members.map(member => ({
    member_key: member.key, source_index: 0, selected: true, retrieved: receipts.has(member.key), cited: cited.has(member.key),
    unavailable: member.availability !== "available", frozen_availability: member.availability,
    source_store_id: member.source_store_id, source: { ...member.source }, permitted_view: member.permitted_view,
    retrievals: (receipts.get(member.key) ?? []).map(({ member_key: _member, source_index: _index, ...receipt }) => ({ ...receipt })),
    qualifications: [...member.qualifications],
    inspect: { operation: "population-source", population_id: population.population_id, manifest_sha256: population.manifest_sha256, member_key: member.key },
  }))
}

function selection(value: unknown): EvaluatorInterpretationSection {
  if (value === undefined) return "overview"
  if (typeof value !== "string" || !EVALUATOR_INTERPRETATION_SECTIONS.includes(value as EvaluatorInterpretationSection)) throw new Error("Invalid Evaluator interpretation section")
  return value as EvaluatorInterpretationSection
}
function integer(value: unknown, fallback: number, max: number): number {
  const parsed = value ?? fallback
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new Error("Invalid Evaluator interpretation page limit")
  return parsed
}
function defaultSources(document: EvaluatorInterpretationDocument) {
  const interpretation = document.body.interpretation, retrieved = new Set(document.body.retrieved.map(receipt => receipt.member_key))
  const cited = citedMembers(interpretation), unavailable = new Set(interpretation.gaps.filter(gap => gap.kind === "unavailable").map(gap => gap.member_key))
  const population = document.body.binding.subject.source
  return interpretation.covered_members.map(member_key => ({ member_key, source_index: 0, selected: true,
    retrieved: retrieved.has(member_key), cited: cited.has(member_key), unavailable: unavailable.has(member_key),
    ...(population ? { inspect: { operation: "population-source", population_id: population.population_id, manifest_sha256: population.manifest_sha256, member_key } } : {}) }))
}
const referenceIdentity = (value: unknown): string => {
  const ref = retrospectiveMapping(value), context = retrospectiveMapping(ref.context)
  return canonical({ report_id: ref.report_id ?? context.report_id ?? null, report_sha256: ref.report_sha256 ?? context.report_sha256 ?? null,
    member_key: ref.member_key, source_index: ref.source_index ?? 0 })
}
const references = (value: unknown): unknown[] => {
  const entry = retrospectiveMapping(value)
  return [entry.supporting, entry.contradicting].flatMap(field => Array.isArray(field) ? field : [])
}
function supplemental(document: EvaluatorInterpretationDocument, section: EvaluatorInterpretationSection, items: unknown[]) {
  const interpretation = document.body.interpretation, narrative: NonNullable<EvaluatorInterpretationPage["narrative"]> = []
  let remaining = 20000
  if (section === "overview") for (const name of ["trajectory", "claims", "review_coverage", "gaps", "prior_interpretations"] as const) {
    const candidates = interpretation[name], selected: unknown[] = []
    for (const candidate of candidates.slice(0, name === "trajectory" ? 10 : 6)) {
      const size = canonical(candidate, evaluatorInterpretationBudget()).length
      if (size > remaining) break
      remaining -= size; selected.push(candidate)
    }
    if (candidates.length) narrative.push({ section: name, items: selected, total: candidates.length })
  }
  const selected = [...items, ...narrative.flatMap(group => group.items)]
  const wanted = new Set(selected.flatMap(references).map(referenceIdentity))
  const evidence: unknown[] = [], candidates = section === "sources" ? [] : (document.sources ?? defaultSources(document))
    .filter(value => wanted.has(referenceIdentity(value)))
  let evidenceBudget = 20000
  for (const candidate of candidates) {
    const size = canonical(candidate, evaluatorInterpretationBudget()).length
    if (size > evidenceBudget) continue
    evidenceBudget -= size; evidence.push(candidate)
  }
  const report_context = { supersedes: 0, contests: 0, context: 0 }
  for (const prior of interpretation.prior_interpretations) {
    const relation: string = prior.relation
    if (relation === "supersedes" || relation === "contests" || relation === "context") report_context[relation]++
  }
  const foundation = document.foundation
  if (foundation) canonical(foundation, new ProcessingBudget(12000, 4000))
  return { ...(foundation ? { foundation } : {}), ...(narrative.length ? { narrative } : {}),
    ...(evidence.length || candidates.length ? { evidence, evidence_omitted: candidates.length - evidence.length } : {}), report_context }
}

function sectionItems(document: EvaluatorInterpretationDocument, section: EvaluatorInterpretationSection): unknown[] {
  const interpretation = document.body.interpretation
  if (section === "overview") return [
    { entry: "conclusion", ...interpretation.conclusion },
    { entry: "coverage", covered_member_count: interpretation.covered_members.length,
      members_section: "sources", note: "Every covered frozen member is enumerated in sources. Selected, retrieved and cited are distinct facts; a citation does not prove comprehension or entailment." },
    { entry: "qualifications", ...interpretation.qualifications },
  ]
  if (section === "sources") return document.sources ?? defaultSources(document)
  return interpretation[section]
}

/** Public callers must pass through the owner's current authorization and source
 * dependency checks BEFORE this function, including when requesting counts or a
 * continuation. No content from the internal original_result_text is projected. */
export function paginateEvaluatorInterpretation(document: EvaluatorInterpretationDocument, input: EvaluatorInterpretationPageInput = {}): EvaluatorInterpretationPage {
  uid(document.report_id, "Evaluator report ID")
  if (!/^[a-f0-9]{64}$/.test(document.report_sha256) || document.body.format !== "loom-evaluator-publication/v1"
    || document.body.interpretation.format !== "loom-evaluator-interpretation/v1") throw new Error("Unsupported Evaluator publication")
  if (input.report_id !== undefined && input.report_id !== document.report_id || input.report_sha256 !== undefined && input.report_sha256 !== document.report_sha256)
    throw new Error("Evaluator interpretation page identity changed")
  const section = selection(input.section), limit = integer(input.limit, 25, 100), values = sectionItems(document, section)
  let ordinal = 0, offset = 0
  if (input.after !== undefined) {
    if (typeof input.after !== "string" || !/^[A-Za-z0-9_-]{1,4096}$/.test(input.after)) throw new Error("Invalid Evaluator interpretation cursor")
    let cursor: Record<string, unknown>
    try { cursor = JSON.parse(Buffer.from(input.after, "base64url").toString("utf8")) as Record<string, unknown> }
    catch { throw new Error("Invalid Evaluator interpretation cursor") }
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)
      || Object.keys(cursor).sort().join(",") !== "format,offset,ordinal,report_id,report_sha256,section"
      || cursor.format !== "loom-evaluator-interpretation-cursor/v1" || cursor.report_id !== document.report_id
      || cursor.report_sha256 !== document.report_sha256 || cursor.section !== section
      || typeof cursor.ordinal !== "number" || !Number.isSafeInteger(cursor.ordinal) || cursor.ordinal < 0 || cursor.ordinal >= values.length
      || typeof cursor.offset !== "number" || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0)
      throw new Error("Evaluator interpretation cursor does not match this report and section")
    ordinal = cursor.ordinal; offset = cursor.offset
  }
  const navigation = (target: EvaluatorInterpretationSection, nextOrdinal?: number, nextOffset = 0): Navigation => ({
    report_id: document.report_id, report_sha256: document.report_sha256, section: target, limit,
    ...(nextOrdinal === undefined ? {} : { after: Buffer.from(canonical({ format: "loom-evaluator-interpretation-cursor/v1",
      report_id: document.report_id, report_sha256: document.report_sha256, section: target, ordinal: nextOrdinal, offset: nextOffset })).toString("base64url") }),
  })
  const base = { format: "loom-evaluator-interpretation-page/v1" as const, report_id: document.report_id, report_sha256: document.report_sha256,
    binding: document.body.binding, ...(document.state === undefined ? {} : { state: document.state }),
    ...(document.qualifications === undefined ? {} : { qualifications: document.qualifications }), section }
  // Owner metadata is bounded independently so one item or exact fragment always
  // has room. Invalid metadata fails the read rather than silently dropping it.
  canonical(base, new ProcessingBudget(65536, 32768))
  const sections = EVALUATOR_INTERPRETATION_SECTIONS.map(section => navigation(section))
  const page = (items: unknown[], to: number, next: Navigation | null): EvaluatorInterpretationPage => ({ ...base,
    representation: "items", coverage: { from: ordinal, to, total: values.length, complete: ordinal === 0 && offset === 0 && to === values.length },
    items, ...supplemental(document, section, items), navigation: { sections, next } })
  if (values.length === 0) { const empty = page([], 0, null); boundedPage(empty); return empty }
  const items: unknown[] = []
  if (offset === 0) {
    for (let index = ordinal; index < values.length && items.length < limit; index++) {
      const candidate = page([...items, values[index]], index + 1, index + 1 < values.length ? navigation(section, index + 1) : null)
      try { boundedPage(candidate) }
      catch (error) {
        if (!(error instanceof ProcessingLimitError) || error.kind !== "capacity") throw error
        break
      }
      items.push(values[index])
    }
    if (items.length) return page(items, ordinal + items.length, ordinal + items.length < values.length ? navigation(section, ordinal + items.length) : null)
  }
  // Large source provenance is host-derived and can exceed the narrative item
  // limit. Never skip it: expose exact canonical fragments with bound offsets.
  const text = canonical(values[ordinal], evaluatorInterpretationBudget())
  if (offset >= text.length || splitSurrogate(text, offset)) throw new Error("Evaluator interpretation fragment is outside the exact item")
  let end = Math.min(offset + 16384, text.length)
  for (;;) {
    if (splitSurrogate(text, end)) end--
    if (end <= offset) throw new ProcessingLimitError("Evaluator interpretation envelope leaves no room for an exact fragment")
    const next = end < text.length ? navigation(section, ordinal, end) : ordinal + 1 < values.length ? navigation(section, ordinal + 1) : null
    const fragmented: EvaluatorInterpretationPage = { ...page([], end === text.length ? ordinal + 1 : ordinal, next), representation: "item-fragment",
      coverage: { from: ordinal, to: end === text.length ? ordinal + 1 : ordinal, total: values.length, complete: false },
      fragment: { encoding: "canonical-json", ordinal, from: offset, to: end, total_characters: text.length, content_json: text.slice(offset, end) } }
    try { boundedPage(fragmented); return fragmented }
    catch (error) {
      if (!(error instanceof ProcessingLimitError) || error.kind !== "capacity") throw error
      end = offset + Math.floor((end - offset) / 2)
    }
  }
}

const escapeHTML = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)
const markdownText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}\[\]()#+.!|\-]/g, "\\$&")
function jsonBlock(value: unknown): string {
  const text = JSON.stringify(value, null, 2)
  const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)))
  return fence + "json\n" + text + "\n" + fence
}
function summary(value: unknown): { title: string; statement?: string; details: Array<{ label: string; values: string[] }> } {
  const entry = value as Record<string, unknown>
  const title = typeof entry.claim_id === "string" ? `${String(entry.category).replaceAll("-", " ")} · ${entry.basis === "hypothesis" ? "hypothesis" : "attributed finding"}`
    : typeof entry.event_id === "string" ? "Recorded engineering step" : typeof entry.review_id === "string" ? "Review scope and coverage"
      : typeof entry.member_key === "string" ? entry.kind === undefined ? "Selected evidence" : "Evidence gap"
        : typeof entry.report_id === "string" ? entry.relation === "supersedes" ? "Earlier interpretation superseded by this report" : entry.relation === "contests" ? "Earlier interpretation contested by this report" : "Earlier interpretation retained as context"
          : entry.entry === "conclusion" ? `Conclusion · ${entry.kind === "no-change" ? "no new recommendation" : String(entry.kind).replaceAll("-", " ")}` : entry.entry === "coverage" ? "Frozen population coverage" : "Interpretation limits"
  const details: Array<{ label: string; values: string[] }> = []
  for (const [field, label] of [["limitations", "Limitations"], ["applicability", "Applicability"], ["requested", "Requested review coverage"],
    ["covered", "Actual review coverage"], ["chronology", "Chronology qualifications"]]) {
    if (Array.isArray(entry[field!]) && (entry[field!] as unknown[]).length) details.push({ label: label!, values: entry[field!] as string[] })
  }
  if (entry.recommendation && typeof entry.recommendation === "object") {
    const recommendation = entry.recommendation as Record<string, unknown>
    details.push({ label: "Proposed target", values: [String(recommendation.target)] }, { label: "Proposed mechanism", values: [String(recommendation.mechanism)] },
      { label: "Risks", values: recommendation.risks as string[] }, { label: "Validation proposal", values: recommendation.validation as string[] })
  }
  if (entry.selected === true) details.push({ label: "Evidence status", values: [
    `Selected: yes. Retrieved: ${entry.retrieved ? "yes" : "no"}. Cited: ${entry.cited ? "yes" : "no"}. Unavailable at freezing: ${entry.unavailable ? "yes" : "no"}.`,
  ] })
  if (entry.entry === "coverage") details.push({ label: "Covered frozen members", values: [String(entry.covered_member_count)] })
  if (entry.independence !== undefined) details.push({ label: "Originating intent independence", values: [String(entry.independence)] })
  return { title, ...(typeof entry.statement === "string" ? { statement: entry.statement }
    : typeof entry.reason === "string" ? { statement: entry.reason } : typeof entry.note === "string" ? { statement: entry.note } : {}), details }
}

export function renderEvaluatorInterpretationMarkdown(page: EvaluatorInterpretationPage): string {
  const lines = ["# Evaluator retrospective", "", `Report: ${markdownText(page.report_id)}`, "", `Fingerprint: ${page.report_sha256}`, "",
    `Section: ${page.section}. Items ${page.coverage.from}–${page.coverage.to} of ${page.coverage.total}.`, "",
    "This is an attributed interpretation. Evidence references establish provenance; independent review must assess the conclusions. Recommendations require separate authorization to apply.", ""]
  for (const value of page.items) {
    const item = summary(value)
    lines.push("## " + markdownText(item.title), "")
    if (item.statement) lines.push(markdownText(item.statement), "")
    for (const detail of item.details) lines.push("### " + detail.label, "", ...detail.values.map(value => "- " + markdownText(value).replace(/\n/g, "\n  ")), "")
  }
  if (page.fragment) lines.push("## Exact item fragment", "", `Concatenate content_json for item ${page.fragment.ordinal} in offset order before parsing. This page contains characters ${page.fragment.from}–${page.fragment.to} of ${page.fragment.total_characters}.`, "")
  lines.push("## Exact page and evidence navigation", "", "The structured page below preserves supporting and contradictory citations, source inspection commands, provenance and all continuation fields.", "", jsonBlock(page), "")
  return lines.join("\n")
}

function sourceLabel(value: unknown, index: number): string {
  const source = retrospectiveMapping(value), original = retrospectiveMapping(source.source)
  const kind = typeof original.kind === "string" ? original.kind.replaceAll("-", " ") : "recorded evidence"
  const label = typeof source.label === "string" && source.label.trim() ? source.label : `Evidence ${index + 1} · ${kind}`
  const excerpt = typeof source.excerpt === "string" ? source.excerpt.replace(/\s+/g, " ").trim() : ""
  return excerpt ? label + " · " + excerpt.slice(0, 100) + (excerpt.length > 100 ? "…" : "") : label
}
const evidenceAnchor = (value: unknown) => "evidence-" + digest(referenceIdentity(value)).slice(0, 24)
const listHTML = (values: unknown[], className = "") => values.length ? '<ul' + (className ? ' class="' + className + '"' : '') + '>'
  + values.map(value => '<li class="prose">' + escapeRetrospectiveHTML(value) + '</li>').join('') + '</ul>' : ''
const SECTION_LABELS: Record<EvaluatorInterpretationSection, string> = { overview: "Conclusion and scope", trajectory: "Engineering trajectory", claims: "Findings and recommendations",
  review_coverage: "Review coverage", gaps: "Missing evidence", sources: "Evidence foundation", prior_interpretations: "Earlier interpretations" }

/** A readable projection of the protected S5 page. All links are local anchors;
 * exact Loom requests remain secondary inspection details, not fake fetch UI. */
export function renderEvaluatorInterpretationHTML(page: EvaluatorInterpretationPage): string {
  const html = escapeRetrospectiveHTML
  const sources = page.section === "sources" ? page.items : page.evidence ?? []
  const sourceMap = new Map(sources.map((source, index) => [referenceIdentity(source), { source, index }]))
  const backlinks = new Map<string, Array<{ id: string; label: string }>>()
  const citationHTML = (refs: unknown[], id: string, label: string) => refs.length ? '<ul>' + refs.map(ref => {
    const key = referenceIdentity(ref), source = sourceMap.get(key)
    if (!source) return '<li>Evidence reference outside this page. Use the <a href="#report-navigation">evidence section request</a> to inspect it.'
      + retrospectiveDetails("Exact citation", ref) + '</li>'
    const links = backlinks.get(key) ?? []; if (!links.some(link => link.id === id)) links.push({ id, label }); backlinks.set(key, links)
    return '<li><a href="#' + evidenceAnchor(source.source) + '">' + html(sourceLabel(source.source, source.index)) + '</a></li>'
  }).join('') + '</ul>' : '<p>No originals are cited for this statement.</p>'
  const renderItem = (value: unknown, section: EvaluatorInterpretationSection, index: number): string => {
    const entry = retrospectiveMapping(value), item = summary(value), id = section + '-item-' + index
    const supporting = Array.isArray(entry.supporting) ? entry.supporting : [], contradicting = Array.isArray(entry.contradicting) ? entry.contradicting : []
    const prior = typeof entry.report_id === "string"
    return '<article id="' + id + '" tabindex="-1"><h3>' + html(section === "trajectory" ? `Step ${index + 1}` : item.title) + '</h3>'
      + (item.statement ? '<p class="prose">' + html(item.statement) + '</p>' : '')
      + item.details.map(detail => '<h4>' + html(detail.label) + '</h4>' + listHTML(detail.values)).join('')
      + (entry.basis === "hypothesis" ? '<p class="notice">This is a limited hypothesis, not an established observation.</p>' : '')
      + (supporting.length ? '<h4>Supporting evidence</h4>' + citationHTML(supporting, id, section === "trajectory" ? `Step ${index + 1}` : `Finding ${index + 1}`) : '')
      + (contradicting.length ? '<h4>Counterevidence and scope limits</h4><p>The report cites these sources against the claim or its scope. Missing verification may limit a conclusion without contradicting a reported pass.</p>'
        + citationHTML(contradicting, id, `Finding ${index + 1}`) : '')
      + (prior ? '<p class="meta">' + (entry.relation === "supersedes" ? 'This report explicitly declares that it supersedes the named earlier interpretation.'
        : entry.relation === "contests" ? 'This report explicitly contests the earlier interpretation; it does not erase it.' : 'Keeping an earlier report as context does not supersede or invalidate it.') + '</p>'
        + (entry.inspect ? retrospectiveDetails("Read this earlier interpretation", entry.inspect) : '') : '')
      + '</article>'
  }
  const foundation = retrospectiveMapping(page.foundation), target = retrospectiveMapping(foundation.target), subject = retrospectiveMapping(foundation.subject)
  const cutoff = retrospectiveMapping(foundation.cutoff ?? subject.cutoff), intent = retrospectiveMapping(foundation.intent)
  const question = typeof foundation.question === "string" ? foundation.question : null
  const intentText = typeof foundation.intent === "string" ? foundation.intent : typeof intent.goal === "string" ? intent.goal : typeof intent.statement === "string" ? intent.statement : null
  let content = '<header><p class="meta">Loom · Evaluator retrospective</p><p class="notice">This is an attributed interpretation of selected evidence. A citation establishes provenance; it does not independently verify the conclusion.</p></header>'
    + '<section id="scope" class="panel" tabindex="-1"><h2>Intent and scope</h2>'
    + (question ? '<h3>Evaluation question</h3><p class="prose">' + html(question) + '</p>' : '<p>The evaluation question is not included in this page. Inspect the frozen population for its authored scope.</p>')
    + (target.kind ? '<p>Selected work: ' + html(target.kind) + '. Separate goals and participating Sessions are not automatically one objective.</p>' : '')
    + (intentText ? '<h3>' + (target.kind === "action" ? 'Current authored Action context' : 'Recorded intent context') + '</h3><p class="prose">' + html(intentText) + '</p>' : '')
    + '<p>Original user intent is not independently established by this interpretation. Current authored context and an evaluation question do not reconstruct a missing original request.</p>'
    + (cutoff.kind === "recorded-completion" ? '<p>The cutoff is an exact recorded completion. That authored record does not itself establish independent acceptance.</p>' : '<p>The evidence cutoff is a point in recorded history. It does not prove that this Session, its descendants or its objectives are complete.</p>')
    + (page.report_context && Object.values(page.report_context).some(Boolean) ? '<p>Relationship to earlier reports: ' + page.report_context.supersedes + ' superseded; '
      + page.report_context.contests + ' contested; ' + page.report_context.context + ' retained as context.</p>' : '') + '</section>'
  const groups: Array<{ section: EvaluatorInterpretationSection; items: unknown[]; total: number }> = page.section === "sources" ? [] : [
    { section: page.section, items: page.items, total: page.coverage.total }, ...(page.narrative ?? [])]
  for (const group of groups) content += '<section id="section-' + group.section + '" class="panel" tabindex="-1"><h2>' + html(SECTION_LABELS[group.section]) + '</h2>'
    + '<p class="meta">Showing ' + group.items.length + ' of ' + group.total + ' items' + (group.section === page.section ? ' in this page.' : ' in this overview.') + '</p>'
    + (group.items.length ? group.items.map((value, index) => renderItem(value, group.section, index + (group.section === page.section ? page.coverage.from : 0))).join('') : '<p>No items are included here.</p>')
    + (group.items.length < group.total ? '<p>More items remain. Use the <a href="#report-navigation">' + html(SECTION_LABELS[group.section].toLowerCase()) + ' request</a> for complete readback.</p>' : '') + '</section>'
  const originalCounts = new Map<string, number>()
  const originalKey = (value: unknown) => {
    const source = retrospectiveMapping(value)
    return source.source && source.source_store_id && source.permitted_view ? canonical({ source_store_id: source.source_store_id, source: source.source, permitted_view: source.permitted_view }) : null
  }
  for (const source of sources) { const key = originalKey(source); if (key) originalCounts.set(key, (originalCounts.get(key) ?? 0) + 1) }
  if (sources.length || page.section === "sources") content += '<section id="evidence" class="panel" tabindex="-1"><h2>Evidence foundation</h2>'
    + '<p>Selected, retrieved and cited are distinct facts. Open exact originals through the supported requests; this document does not fetch them.</p>'
    + sources.map((value, index) => {
      const source = retrospectiveMapping(value), links = backlinks.get(referenceIdentity(value)) ?? [], key = originalKey(source)
      return '<article class="evidence-card" id="' + evidenceAnchor(value) + '" tabindex="-1"><h3>' + html(sourceLabel(value, index)) + '</h3>'
        + '<p class="meta">' + html(source.evidence_kind ?? 'Source reference; the authored interpretation must be assessed against its exact original.') + '</p>'
        + '<p>Selected in this population: ' + (source.selected === false ? 'no' : 'yes') + '. Retrieved: ' + (source.retrieved ? 'yes' : 'no') + '. Cited: ' + (source.cited ? 'yes' : 'no') + '.</p>'
        + (source.selected === false ? '<p>This original belongs to an earlier report context. It does not add a member to the current increment.</p>' : '')
        + (key && (originalCounts.get(key) ?? 0) > 1 ? '<p>The same exact original appears elsewhere on this page in another report context. Reusing it does not provide independent corroboration.</p>' : '')
        + (source.unavailable ? '<p class="notice">This original was unavailable when membership was frozen. Inspect the exact source request for its present status.</p>' : '')
        + (typeof source.excerpt === "string" ? '<blockquote>' + html(source.excerpt) + '</blockquote>' : '')
        + (source.inspect ? retrospectiveDetails("Read this exact original", source.inspect) : '<p>No supported original-source request accompanies this reference.</p>')
        + (links.length ? '<p class="backlinks">Used by: ' + links.map(link => '<a href="#' + link.id + '">' + html(link.label) + '</a>').join(' · ') + '</p>' : '')
        + retrospectiveDetails("Exact source identity and provenance", value) + '</article>'
    }).join('') + (page.evidence_omitted ? '<p>' + page.evidence_omitted + ' further cited sources are outside this overview. Follow the full evidence section request below.</p>' : '') + '</section>'
  if (page.fragment) content += '<section class="panel"><h2>Exact item fragment</h2><p>This fragment is not a complete item. Concatenate content_json in offset order before parsing.</p></section>'
  content += '<section id="report-navigation" class="panel" tabindex="-1"><h2>Continue reading</h2><p>These exact requests use the authorized Loom interface. They preserve the report identity and section; each read rechecks permission.</p>'
    + page.navigation.sections.map(request => retrospectiveDetails("Read " + SECTION_LABELS[request.section].toLowerCase(), request)).join('')
    + (page.navigation.next ? retrospectiveDetails("Continue this section", page.navigation.next) : '<p>This section has no further page.</p>') + '</section>'
    + retrospectiveDetails("Exact report data, identifiers and qualifications", page, "report-technical")
  const nav = '<nav aria-label="Retrospective sections"><a href="#scope">Intent and scope</a>'
    + groups.map(group => '<a href="#section-' + group.section + '">' + html(SECTION_LABELS[group.section]) + '</a>').join('')
    + (sources.length || page.section === "sources" ? '<a href="#evidence">Evidence foundation</a>' : '')
    + '<a href="#report-navigation">Continue reading</a><a href="#report-technical">Technical details</a></nav>'
  return retrospectiveHTMLDocument("Evaluator retrospective", content, nav)
}
