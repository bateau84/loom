import { canonical, ProcessingBudget, ProcessingLimitError, uid } from "./model.js"
import type { EvaluatorExecutionSubject, EvaluatorExecutionReceipt, EvaluatorRetrievedSource } from "./evaluator-execution-contract.js"
import { evaluatorInterpretationBudget, type EvaluatorInterpretation } from "./evaluator-interpretation.js"
import type { RetrospectivePopulation } from "./retrospective-contract.js"

export const EVALUATOR_INTERPRETATION_SECTIONS = ["overview", "trajectory", "claims", "review_coverage", "gaps", "sources", "prior_interpretations"] as const
export type EvaluatorInterpretationSection = typeof EVALUATOR_INTERPRETATION_SECTIONS[number]
export type EvaluatorInterpretationDocument = {
  report_id: string; report_sha256: string;
  body: {
    format: "loom-evaluator-publication/v1";
    binding: { subject: EvaluatorExecutionSubject; admission_sha256: string; method_sha256: string; result: NonNullable<EvaluatorExecutionReceipt["result"]> };
    retrieved: EvaluatorRetrievedSource[]; interpretation: EvaluatorInterpretation;
  };
  sources?: unknown[]; state?: string; qualifications?: string[];
}
export type EvaluatorInterpretationPageInput = { report_id?: unknown; report_sha256?: unknown; section?: unknown; after?: unknown; limit?: unknown }
type Navigation = { report_id: string; report_sha256: string; section: EvaluatorInterpretationSection; limit: number; after?: string }
export type EvaluatorInterpretationPage = {
  format: "loom-evaluator-interpretation-page/v1"; report_id: string; report_sha256: string;
  binding: EvaluatorInterpretationDocument["body"]["binding"]; state?: string; qualifications?: string[];
  section: EvaluatorInterpretationSection; representation: "items" | "item-fragment";
  coverage: { from: number; to: number; total: number; complete: boolean };
  items: unknown[];
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
].map(ref => ref.member_key))

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
    items, navigation: { sections, next } })
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
  const title = typeof entry.claim_id === "string" ? `Claim ${entry.claim_id}: ${entry.kind} / ${entry.category} (${entry.basis})`
    : typeof entry.event_id === "string" ? `Trajectory ${entry.event_id}` : typeof entry.review_id === "string" ? `Review coverage ${entry.review_id}`
      : typeof entry.member_key === "string" ? `${entry.kind === undefined ? "Source" : "Gap"} ${entry.member_key}`
        : typeof entry.report_id === "string" ? `Prior interpretation ${entry.report_id} (${entry.relation})`
          : entry.entry === "conclusion" ? `Conclusion: ${entry.kind}` : entry.entry === "coverage" ? "Frozen population coverage" : "Qualifications"
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

export function renderEvaluatorInterpretationHTML(page: EvaluatorInterpretationPage): string {
  const articles = page.items.map(value => {
    const item = summary(value)
    return '<article><h2>' + escapeHTML(item.title) + '</h2>' + (item.statement ? '<p class="prose">' + escapeHTML(item.statement) + '</p>' : '')
      + item.details.map(detail => '<h3>' + escapeHTML(detail.label) + '</h3><ul>'
        + detail.values.map(value => '<li class="prose">' + escapeHTML(value) + '</li>').join('') + '</ul>').join('') + '</article>'
  }).join('')
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'
    + '<title>Evaluator retrospective</title><style>body{font:1rem/1.6 system-ui;margin:1.5rem;max-width:90rem}pre,.prose{white-space:pre-wrap;overflow-wrap:anywhere}article{border-top:1px solid #888;padding-top:1rem}h1{font-size:1.8rem}h2{font-size:1.35rem}h3{font-size:1.1rem}</style></head><body><main>'
    + '<h1>Evaluator retrospective</h1><dl><dt>Report</dt><dd>' + escapeHTML(page.report_id) + '</dd><dt>Fingerprint</dt><dd>' + escapeHTML(page.report_sha256)
    + '</dd><dt>Section</dt><dd>' + escapeHTML(page.section) + '</dd><dt>Item coverage</dt><dd>' + page.coverage.from + '–' + page.coverage.to + ' of ' + page.coverage.total + '</dd></dl>'
    + '<p>This is an attributed interpretation. Evidence references establish provenance; independent review must assess the conclusions. Recommendations require separate authorization to apply.</p>'
    + articles + (page.fragment ? '<h2>Exact item fragment</h2><p>Concatenate content_json in offset order before parsing. This fragment is not a complete item.</p>' : '')
    + '<h2>Exact page and evidence navigation</h2><p>Supporting and contradictory citations, source inspection commands, provenance and continuation fields are preserved below.</p><pre>'
    + escapeHTML(JSON.stringify(page, null, 2)) + '</pre></main></body></html>'
}
