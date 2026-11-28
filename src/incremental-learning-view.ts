import { ProcessingLimitError } from "./model.js"
import { escapeRetrospectiveHTML as html, retrospectiveDetails, retrospectiveHTMLDocument, retrospectiveMapping as map } from "./retrospective-source-view.js"

const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null
const bodyOf = (value: unknown) => { const record = map(value), report = map(record.report); return map(record.body ?? report.body ?? record.report ?? value) }
const OWNER_LABELS: Record<string, string> = { ledger: "Engineering records", objectives: "Authored objectives", objective_links: "Objective relationships", review_requests: "Review requests", review_relationships: "Review relationships" }
const STATE_LABELS: Record<string, string> = { empty: "No eligible evidence processed yet", pending: "New evidence is waiting", blocked: "Processing needs attention",
  "caught-up": "Processed through the observed boundary", processing: "An increment is being processed", complete: "Increment processing complete", incomplete: "Increment processing incomplete" }
const INFERENCE_LABELS: Record<string, string> = { disabled: "Model interpretation is disabled", empty: "No model interpretation has been published",
  "caught-up": "Interpretation covers the processed boundary", waiting: "Waiting for eligible evidence", pending: "Interpretation is pending",
  blocked: "Interpretation is blocked", unavailable: "Model execution is unavailable" }
const REASON_LABELS: Record<string, string> = {
  "incremental-interpretation-disabled": "Automatic model interpretation is switched off in the current configuration.",
  "method-not-configured": "Choose a pinned interpretation method and model before requesting model interpretation.",
  "resource-policy-not-configured": "Interpretation needs a configured resource policy before it can run.",
  "evaluator-execution-authority-unavailable": "The host has no qualified authority to run an Evaluator. Saved deterministic learning remains available.",
  "native-provenance-unqualified": "The host has not established the required native execution provenance.",
  "protected-recipient-transfer-unqualified": "Protected evidence delivery to the intended Evaluator has not been qualified.",
  "included-usage-route-unqualified": "The configured model route has not established the required usage and billing guarantees.",
  "coalescing-new-evidence": "Waiting briefly to combine new evidence into one bounded interpretation.",
  "minimum-interpretation-interval": "Waiting for the configured interval before the next model interpretation.",
  "original-source-or-checkpoint-unavailable": "A required original or checkpoint is unavailable. The successful evidence boundary has not advanced.",
  "checkpoint-claimed": "Another worker currently holds this increment; processing will retry after its lease.",
  "concurrent-checkpoint": "Another checkpoint committed first; processing will continue from that saved boundary.",
}
const reasonLabel = (value: unknown): string => REASON_LABELS[String(value)] ?? (typeof value === "string" && /\s/.test(value)
  ? value : "Processing cannot advance yet. The exact reason is retained in the technical details.")
const bounded = (content: string) => {
  if (Buffer.byteLength(content, "utf8") > 240000) throw new ProcessingLimitError("Incremental learning presentation exceeds the page byte budget")
  return content
}
function boundaries(value: unknown): string {
  const fields = Object.entries(map(value)).filter(([, value]) => typeof value === "number" || value === null)
  return fields.length ? '<dl>' + fields.map(([name, value]) => '<dt>' + html(OWNER_LABELS[name] ?? name) + '</dt><dd>' + html(value === null ? "Not established" : value) + '</dd>').join('') + '</dl>' : '<p>No source-owner frontier is included in this view.</p>'
}
function requestFor(item: Record<string, unknown>): unknown {
  if (item.inspect) return item.inspect
  const origin = map(item.origin)
  return origin.batch_id && origin.member_key ? { operation: "learning-source", batch_id: origin.batch_id, member_key: origin.member_key, source_index: origin.source_index ?? 0 } : null
}
function retainedHTML(items: unknown[], empty: string): string {
  if (!items.length) return '<p>' + html(empty) + '</p>'
  return '<ul>' + items.map(value => {
    const item = map(value), request = requestFor(item), statement = text(item.excerpt) ?? text(item.statement) ?? text(item.detail) ?? "Retained evidence reference; inspect its original for the content."
    return '<li><p class="prose">' + html(statement) + '</p>'
      + (item.recorded_at ? '<p class="meta">Recorded: ' + html(item.recorded_at) + '</p>' : '')
      + '<p class="meta">Carried from its original evidence context. Retention does not independently verify the finding.</p>'
      + (request ? retrospectiveDetails("Read the linked original", request) : '<p>No exact source request accompanies this item.</p>')
      + retrospectiveDetails("Exact retained evidence and provenance", value) + '</li>'
  }).join('') + '</ul>'
}
function retainedCoverage(retained: Record<string, unknown>): string {
  return '<p class="meta">Retained concern coverage: ' + html(array(retained.concerns).length) + ' shown of ' + html(retained.concern_count ?? array(retained.concerns).length)
    + '; recorded starts without a paired finish: ' + html(array(retained.unfinished).length) + ' shown of ' + html(retained.unfinished_count ?? array(retained.unfinished).length) + '.</p>'
    + (retained.concerns_next ? retrospectiveDetails("Continue retained concerns", retained.concerns_next) : '')
    + (retained.unfinished_next ? retrospectiveDetails("Continue unmatched starts", retained.unfinished_next) : '')
}
function reportHTML(value: unknown, index: number): string {
  const item = map(value), batch = map(item.batch), report = map(item.report), body = bodyOf(value), retained = map(body.retained)
  const concerns = array(retained.concerns), unfinished = array(retained.unfinished)
  const counts = map(body.observations), inspect = item.inspect ?? (batch.id ? { operation: "learning-report", batch_id: batch.id } : null)
  const previous = map(body.previous)
  return '<article id="increment-' + index + '" class="panel" tabindex="-1"><h3>Saved increment' + (typeof batch.revision === 'number' ? ' ' + batch.revision : '') + '</h3>'
    + (batch.created_at ? '<p class="meta">Saved: ' + html(batch.created_at) + '</p>' : '')
    + (batch.state || report.availability ? '<p>Status: ' + html(STATE_LABELS[String(batch.state)] ?? batch.state ?? report.availability) + '.</p>' : '')
    + (report.availability && report.availability !== "available" ? '<p class="notice">The saved report is currently unavailable. Its protected source dependencies must be checked before conclusions can be disclosed.</p>' : '')
    + (body.new_sources !== undefined ? '<p>' + html(body.new_sources) + ' new eligible sources; ' + html(body.excluded_sources ?? 0) + ' learning or otherwise excluded sources.</p>' : '')
    + (body.earlier_context_sources !== undefined ? '<p>Earlier sources selected as context: ' + html(body.earlier_context_sources) + '. Carried concerns are retained separately below.</p>' : '')
    + '<p>Processing this increment does not establish engineering success or objective completion.</p>'
    + (Object.keys(counts).length ? '<details><summary>Recorded event categories</summary><dl>' + Object.entries(counts).map(([key, value]) => '<dt>' + html(key.replaceAll("-", " ")) + '</dt><dd>' + html(value) + '</dd>').join('') + '</dl></details>' : '')
    + (concerns.length ? '<h4>Findings retained across increments</h4>' + retainedHTML(concerns, "") : '')
    + (unfinished.length ? '<h4>Recorded work without a paired finish</h4>' + retainedHTML(unfinished, "") : '')
    + (body.retained ? retainedCoverage(retained) : '<p class="notice">This increment has no available published report in the current view.</p>')
    + (inspect ? retrospectiveDetails("Read this increment and its evidence", inspect) : '')
    + (previous.batch_id ? retrospectiveDetails("Read the immutable previous increment", previous.inspect ?? { operation: "learning-report", batch_id: previous.batch_id }) : '')
    + retrospectiveDetails("Exact increment metadata", { batch, report_id: report.id ?? batch.report_id, report_sha256: report.sha256, from: body.from, through: body.through, subject: body.subject }) + '</article>'
}

/** Views accept the already-authorized progress/report model. They neither
 * advance a cursor nor collect evidence; exact requests use the same owners. */
export function renderIncrementalLearningHTML(value: unknown): string {
  const view = map(value), body = bodyOf(value), progress = view.format === "loom-incremental-learning-progress/v1", retained = map(body.retained)
  const items = array(view.items), inference = map(view.inference), navigation = map(view.navigation)
  const status = STATE_LABELS[String(view.state)] ?? "Saved learning evidence"
  let content = '<p class="notice">Learning reports are kept outside the original conversation. An idle opportunity or a caught-up cursor is not proof that the Session, its running descendants or its objectives are complete.</p>'
  if (progress) content += '<section id="progress" class="panel" tabindex="-1"><h2>' + html(status) + '</h2><p>Each increment selects new eligible evidence after the last successfully committed boundary. Failed or cancelled work does not silently advance that checkpoint.</p>'
    + '<h3>Last successfully committed evidence</h3>' + boundaries(view.committed)
    + '<h3>Latest observed evidence</h3>' + boundaries(view.observed)
    + '<p class="meta">These are independent source-owner sequence positions, not counts of independent goals.</p>'
    + '<h3>Model interpretation</h3><p>' + html(INFERENCE_LABELS[String(inference.state)] ?? inference.state ?? "Availability is not included in this view.") + '</p>'
    + (inference.reason ? '<p class="notice">' + html(reasonLabel(inference.reason)) + '</p>' : '')
    + (array(inference.reasons).length ? '<ul>' + array(inference.reasons).map(reason => '<li>' + html(reasonLabel(reason)) + '</li>').join('') + '</ul>' : '')
    + '<p>Deterministic processing can continue without model inference. A configured model does not grant execution authority.</p>'
    + (map(inference.interpreted).inspect ? '<h3>Latest evidence-linked interpretation</h3><p>The saved interpretation has its own evidence boundary. Opening it rechecks the original-source permissions; a caught-up interpretation does not establish objective completion.</p>'
      + retrospectiveDetails("Read the current interpretation and its evidence", map(inference.interpreted).inspect) : '<p>No current interpretation request is included here. The deterministic reports below remain available independently.</p>')
    + (map(inference.pending).batch_id ? '<p>A bounded interpretation is pending. It has not replaced the last successfully published interpretation.</p>' : '')
    + (array(inference.qualifications).length ? '<details><summary>Interpretation availability and qualifications</summary><ul>' + array(inference.qualifications).map(reason => '<li>' + html(reason) + '</li>').join('') + '</ul></details>' : '') + '</section>'
    + '<section id="increments" tabindex="-1"><h2>Accumulated learning</h2><p>Newest increments appear first. Their saved numbers stay the same when navigating to earlier pages.</p>' + (items.length ? items.map(reportHTML).join('') : '<p>No saved increments are included in this page.</p>') + '</section>'
  else content += '<section id="progress" class="panel" tabindex="-1"><h2>Saved increment</h2>'
    + (view.availability && view.availability !== "available" ? '<p class="notice">The saved report is ' + html(view.availability) + '. No engineering conclusion can be inferred from the unavailable report.</p>' : '')
    + '<p>New eligible sources: ' + html(body.new_sources ?? "Not included in this section") + '. Earlier sources selected as context: ' + html(body.earlier_context_sources ?? "Not included") + '.</p>'
    + '<h3>Evidence processed through</h3>' + boundaries(body.through ?? view.through)
    + '<p>Reported processing completion is distinct from engineering completion. Earlier reports remain immutable.</p></section>'
    + '<section id="concerns" class="panel" tabindex="-1"><h2>Retained findings and concerns</h2>'
    + retainedHTML(array(retained.concerns).length ? array(retained.concerns) : view.section === "concerns" ? items : [], "No retained concerns are included in this page. Consult coverage and the exact continuation before inferring that none remain.")
    + '</section><section id="unfinished" class="panel" tabindex="-1"><h2>Recorded work without a paired finish</h2>'
    + retainedHTML(array(retained.unfinished).length ? array(retained.unfinished) : view.section === "unfinished" ? items : [], "No unmatched recorded starts are included here. This is not a statement that all work or descendants have completed.") + '</section>'
    + (body.retained ? retainedCoverage(retained) : '')
    + (map(body.previous).batch_id ? retrospectiveDetails("Read the immutable previous increment", { operation: "learning-report", batch_id: map(body.previous).batch_id }) : '')
  content += '<section id="learning-navigation" class="panel" tabindex="-1"><h2>Continue inspection</h2><p>Use these requests through the authorized Loom interface. Rendering this page performs no mutation.</p>'
    + retrospectiveDetails("Supported read requests and page coverage", { navigation, next: view.next, next_before: view.next_before, next_after: view.next_after, count: view.count, coverage: view.coverage }) + '</section>'
    + retrospectiveDetails("Exact learning report and technical metadata", value, "learning-technical")
  const nav = '<nav aria-label="Learning sections"><a href="#progress">Evidence coverage</a>'
    + (progress ? '<a href="#increments">Accumulated learning</a>' : '<a href="#concerns">Retained findings</a><a href="#unfinished">Unfinished work</a>')
    + '<a href="#learning-navigation">Continue inspection</a><a href="#learning-technical">Technical details</a></nav>'
  return bounded(retrospectiveHTMLDocument(progress ? "Session learning progress" : "Saved learning increment", content, nav, "learning"))
}

export function renderIncrementalLearningMarkdown(value: unknown): string {
  const view = map(value), body = bodyOf(value), progress = view.format === "loom-incremental-learning-progress/v1", retained = map(body.retained)
  const lines = ["# " + (progress ? "Session learning progress" : "Saved learning increment"), "",
    "Learning stays outside the original conversation. Processing progress and idle opportunities do not establish engineering or objective completion.", "",
    progress ? "Status: " + (STATE_LABELS[String(view.state)] ?? "Saved evidence") : "New eligible sources: " + String(body.new_sources ?? "Not included in this section"), ""]
  for (const [label, values] of [["Retained findings", array(retained.concerns)], ["Recorded work without a paired finish", array(retained.unfinished)]] as const) {
    if (!values.length) continue
    lines.push("## " + label, "")
    for (const value of values) { const item = map(value); lines.push("    " + (text(item.excerpt) ?? text(item.statement) ?? text(item.detail) ?? "Retained evidence reference").replaceAll("\n", "\n    "), "") }
  }
  const exact = JSON.stringify(value, null, 2), fence = "`".repeat(Math.max(3, ...[...exact.matchAll(/`+/g)].map(match => match[0].length + 1)))
  lines.push("## Exact evidence, coverage and supported requests", "", fence + "json", exact, fence, "")
  return bounded(lines.join("\n"))
}
