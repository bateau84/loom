import type {
  EngineeringHistoryBranch, EngineeringHistoryCounts, EngineeringHistoryGap,
  EngineeringHistoryRecord, EngineeringHistoryRelationship, EngineeringHistoryView,
} from "./engineering-history.js"

// This is a presentation of an already-authorized projection. It must never
// fetch sources, widen membership, infer relationships or grant source access.
const neutralize = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,
  c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
const escape = (value: unknown) => neutralize(String(value)).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
const json = (value: unknown) => neutralize(JSON.stringify(value, null, 2))
const code = (value: unknown) => `<pre><code>${escape(json(value))}</code></pre>`
const scopeRequest = (view: EngineeringHistoryView) => ({ operation: "read", ...view.scope, through: view.boundary.observed_through })
const expansion = (branch: EngineeringHistoryBranch) => ({ operation: "read", ...branch.expand })
const sourceRequest = (record: EngineeringHistoryRecord) => ({ tool: record.source.tool, arguments: record.source.query })

function includedRecords(view: EngineeringHistoryView) {
  const records = new Map<string, EngineeringHistoryRecord>()
  for (const record of [...view.highlights, ...view.records]) records.set(record.ref, record)
  return [...records.values()]
}

const countLabels: Array<[keyof EngineeringHistoryCounts, string]> = [
  ["records", "Stored records"], ["sessions", "Recorded Sessions"], ["observations", "Observations"],
  ["concerns", "Authored concerns"], ["reported_completions", "Reported completions"], ["reported_reopens", "Reported reopens"],
  ["reported_passes", "Reported passes"], ["reported_failures", "Reported failures"],
  ["reported_inconclusive", "Reported inconclusive"], ["observed_tool_errors", "Observed tool errors"], ["observation_starts", "Observation starts"],
  ["paired_finishes", "Paired finishes"], ["verified_outcomes", "Verified outcomes"], ["native_dispatches", "Native dispatches"],
]

function countsHTML(counts: EngineeringHistoryCounts) {
  return `<dl class="metrics">${countLabels.map(([key, label]) => `<div><dt>${label}</dt><dd>${counts[key] === null ? "Unknown" : escape(counts[key])}</dd></div>`).join("")}</dl>`
}

function gapsHTML(gaps: EngineeringHistoryGap[]) {
  return gaps.length ? `<ul class="gaps">${gaps.map(gap => `<li><strong>${escape(gap.code)}</strong><p>${escape(gap.detail)}</p></li>`).join("")}</ul>` : "<p>No additional gaps are reported by this projection.</p>"
}

function planHTML(plan: NonNullable<EngineeringHistoryView["intended_plan"]>) {
  const nodes = new Map(plan.nodes.map((node, index) => [node.id, { node, anchor: `plan-node-${index + 1}` }]))
  const visited = new Set<string>()
  const renderNode = (id: string): string => {
    if (visited.has(id)) return ""
    visited.add(id)
    const { node, anchor } = nodes.get(id)!
    const children = plan.nodes.filter(child => child.parent === id && !visited.has(child.id))
    return `<li><details class="card"><summary id="${anchor}"><span class="summary-title">${escape(node.title)}</span><span class="summary-meta">${escape(node.kind)} · ${escape(node.id)}</span></summary><div class="body">${node.parent ? `<p class="compact">Intended parent: ${nodes.has(node.parent) ? `<a href="#${nodes.get(node.parent)!.anchor}"><code>${escape(node.parent)}</code></a>` : `<code>${escape(node.parent)}</code> (not included in this projection)`}</p>` : "<p class=\"compact\">No intended parent is recorded for this node.</p>"}<p class="meta">Identity and title projection. Acceptance expectations and other contract fields require the exact Plan read below.</p>${children.length ? `<ul class="plan-tree">${children.map(child => renderNode(child.id)).join("")}</ul>` : ""}</div></details></li>`
  }
  const roots = plan.nodes.filter(node => !node.parent || !nodes.has(node.parent))
  const tree = roots.map(node => renderNode(node.id)).join("")
  // A projection can omit a parent. Never silently discard an included node.
  const remaining = plan.nodes.filter(node => !visited.has(node.id)).map(node => renderNode(node.id)).join("")
  return `<p>Current intended structure, revision ${plan.revision}. Historical execution bindings are shown separately within work branches.</p><p class="meta">${escape(plan.meaning)}</p><p>${plan.nodes.length} of ${plan.nodes_total} Plan nodes included; ${plan.nodes_omitted} omitted. Projection: ${escape(plan.projection)}.</p>${plan.nodes.length ? `<ul class="plan-tree">${tree}${remaining}</ul>` : "<p>No Plan node identities are included in this view.</p>"}<details><summary>Read the exact Plan revision</summary><p class="compact">This source request requires its own current permission.</p>${code(plan.read)}</details>`
}

const styles = `
:root{color-scheme:light dark;--bg:#f4f6f8;--surface:#fff;--ink:#192731;--muted:#475b6b;--line:#b9c6d0;--link:#174e84;--soft:#edf3f8;--focus:#005eb8}
*{box-sizing:border-box}html{scroll-padding-top:1rem}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1160px;margin:auto;padding:2rem 1.25rem 4rem}h1{font-size:2rem;line-height:1.2;margin:.3rem 0 .75rem}h2{font-size:1.35rem;margin:0 0 1rem}h3{font-size:1.05rem;margin:1.25rem 0 .5rem}p{margin:.5rem 0 1rem}a{color:var(--link);text-underline-offset:.16em}a:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:4px}.skip{position:absolute;top:.5rem;left:.5rem;transform:translateY(-200%);padding:.6rem;background:var(--surface);z-index:2}.skip:focus{transform:none}.eyebrow{font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:.75rem;color:var(--muted)}.subtle,.meta{color:var(--muted)}.meta{font-size:.875rem;overflow-wrap:anywhere}.notice{border-left:4px solid var(--link);padding:.8rem 1rem;background:var(--soft);margin:1.2rem 0}.notice p:last-child{margin-bottom:0}nav{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;padding:.8rem 0 1.5rem}.panel{background:var(--surface);border:1px solid var(--line);border-radius:.65rem;padding:1.25rem;margin:1rem 0;overflow-wrap:anywhere}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:1rem;margin:1rem 0}.metrics div{border-left:2px solid var(--line);padding-left:.75rem}.metrics dt{font-size:.8rem;color:var(--muted)}.metrics dd{font-weight:650;font-size:1.1rem;margin:.1rem 0}.compact{font-size:.875rem}.badge{display:inline-block;border:1px solid var(--line);border-radius:.25rem;padding:.08rem .4rem;margin:0 .25rem .35rem 0;font-size:.75rem;vertical-align:middle}.highlights{padding-left:1.25rem}.highlights li{margin:.75rem 0}.highlights p{margin:.2rem 0}.branches{display:grid;gap:.75rem}.card{border:1px solid var(--line);border-radius:.4rem;background:var(--surface);min-width:0}.card>summary{padding:.85rem 1rem;cursor:pointer}.card[open]>summary{border-bottom:1px solid var(--line);background:var(--soft)}.card .body{padding:.25rem 1rem 1rem}.summary-title{font-weight:650}.summary-meta{display:block;padding-left:1.1rem;font-size:.8rem;color:var(--muted);margin-top:.2rem}.gaps{padding-left:1.2rem}.gaps li{margin:.65rem 0}.gaps p{margin:.15rem 0}.record-text{white-space:pre-wrap;border-left:3px solid var(--line);padding:.5rem .75rem;background:var(--soft)}.pairs{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,3fr);gap:.3rem .75rem}.pairs dt{font-weight:650}.pairs dd{margin:0;overflow-wrap:anywhere}.relationships{padding-left:1.25rem}.relationships li{margin:.8rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--soft);padding:.75rem;border:1px solid var(--line);border-radius:.3rem;font-size:.8rem;max-width:100%}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.source-index{padding-left:1.25rem}.source-index li{margin:.45rem 0}footer{font-size:.85rem;color:var(--muted);padding:1rem 0}section[id],details[id],summary[id]{scroll-margin-top:1rem}
@media(max-width:600px){main{padding:1.25rem .75rem 2rem}.panel{padding:1rem}.pairs{grid-template-columns:1fr}.pairs dd{margin-bottom:.5rem}h1{font-size:1.6rem}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(prefers-color-scheme:dark){:root{--bg:#101820;--surface:#18242e;--ink:#e7eef4;--muted:#b7c9d8;--line:#657c8f;--link:#91c9ff;--soft:#223542;--focus:#91c9ff}}
@media(forced-colors:active){*{forced-color-adjust:auto}.panel,.card,.badge,pre{border:1px solid CanvasText}.notice{border-left:4px solid LinkText}a:focus-visible,summary:focus-visible{outline:3px solid Highlight}}
@media print{body{background:white;color:black}main{max-width:none;padding:0}.panel,.card{break-inside:avoid}nav,.skip{display:none}.meta,.subtle{color:black}}
.plan-tree{list-style:none;padding-left:1rem;display:grid;gap:.5rem;margin:.75rem 0}.panel>.plan-tree{padding-left:0}
`

/** Self-contained human view; native disclosure/navigation only, no JavaScript,
 * network, storage, source dereferencing or independently derived conclusions. */
export function renderEngineeringHistoryHTML(view: EngineeringHistoryView): string {
  const records = includedRecords(view)
  const recordAnchors = new Map(records.map((record, index) => [record.ref, `record-${index + 1}`]))
  const branches = [...view.branches]
  if (view.selected_branch && !branches.some(branch => branch.ref === view.selected_branch!.ref)) branches.unshift(view.selected_branch)
  const branchAnchors = new Map(branches.map((branch, index) => [branch.ref, `branch-${index + 1}`]))
  const anchors = new Map([...recordAnchors, ...branchAnchors])
  const reference = (ref: string) => anchors.has(ref) ? `<a href="#${anchors.get(ref)}"><code>${escape(ref)}</code></a>` : `<code>${escape(ref)}</code>`
  // Render each complete edge once. A dense review can cite many observations;
  // repeating that edge payload in every endpoint's disclosure makes the same
  // otherwise bounded shared view unusable in HTML even at the smallest page.
  const relations = (items: EngineeringHistoryRelationship[]) => items.length ? `<ol class="relationships">${items.map((item, index) => `<li id="relationship-${index + 1}">${reference(item.from)} <strong>${escape(item.kind)}</strong> ${reference(item.to)}<p class="meta">${escape(item.meaning)} · ${escape(item.target)} · source record ${escape(item.source_record_id)}</p><p>${escape(item.qualification)}</p></li>`).join("")}</ol>` : "<p>No typed relationships are included in this read.</p>"
  const recordRelationships = (ref: string) => {
    const indices = view.relationships.flatMap((item, index) => item.from === ref || item.to === ref ? [index + 1] : [])
    return indices.length ? `<p>${indices.length} included relationships: ${indices.map(index => `<a href="#relationship-${index}">Relationship ${index}</a>`).join(", ")}. Full identities and qualifications appear once in the relationship list below.</p>`
      : "<p>No typed relationships for this record are included in this read.</p>"
  }

  const branchHTML = (branch: EngineeringHistoryBranch) => {
    const members = records.filter(record => record.branch_ref === branch.ref)
    return `<details class="card"><summary id="${branchAnchors.get(branch.ref)}"><span class="summary-title">${escape(branch.title)}</span><span class="summary-meta">${escape(branch.meaning)} · ${branch.counts.records} records · sequences ${branch.first_sequence}–${branch.last_sequence}</span></summary><div class="body"><p class="meta">Branch reference: <code>${escape(branch.ref)}</code></p>${countsHTML(branch.counts)}${branch.work_ref ? `<h3>Historical work binding</h3>${code(branch.work_ref)}` : ""}${branch.historical_node ? `<h3>Plan node at that revision</h3>${code(branch.historical_node)}` : ""}<h3>Included records</h3>${members.length ? `<ul>${members.map(record => `<li><a href="#${recordAnchors.get(record.ref)}">${escape(record.title)}</a> <span class="meta">${escape(record.kind)} · ${escape(record.meaning)}</span></li>`).join("")}</ul>` : "<p>This overview contains no record details for this branch. Request its expansion to inspect them.</p>"}<h3>Read this branch</h3><p class="compact">Run <code>loom_history</code> with these arguments for a fresh authorized read. This document does not fetch additional history.</p>${code(expansion(branch))}<h3>Branch qualifications</h3>${gapsHTML(branch.gaps)}</div></details>`
  }
  const recordHTML = (record: EngineeringHistoryRecord) => `<details class="card"><summary id="${recordAnchors.get(record.ref)}"><span class="summary-title">${escape(record.title)}</span><span class="summary-meta">${escape(record.kind)} · ${escape(record.meaning)} · sequence ${record.sequence}</span></summary><div class="body"><p><span class="badge">${escape(record.meaning)}</span>${record.verdict ? `<span class="badge">Reported verdict: ${escape(record.verdict)}</span>` : ""}</p><p>${escape(record.verification)}</p><dl class="pairs"><dt>Author</dt><dd>${escape(record.agent)}</dd><dt>Session</dt><dd><code>${escape(record.session_id)}</code></dd><dt>Recorded at</dt><dd>${escape(record.created_at)}</dd><dt>Record reference</dt><dd><code>${escape(record.ref)}</code></dd><dt>Branch</dt><dd>${reference(record.branch_ref)}</dd></dl>${record.excerpt === null ? "<p>No prose excerpt is available in this projection.</p>" : `<h3>Stored excerpt</h3><p class="record-text">${escape(record.excerpt)}</p>${record.excerpt_truncated ? "<p class=\"meta\">Excerpt truncated. Use the exact original reference for the complete permitted record.</p>" : ""}`}${record.observation ? `<h3>Observed execution metadata</h3>${code(record.observation)}<p class="meta">Elapsed time is an observed interval; active work, waiting and overlapping execution are not inferred.</p>` : ""}${record.work_ref ? `<h3>Historical work binding</h3>${code(record.work_ref)}` : ""}<h3>Relationships</h3>${recordRelationships(record.ref)}<h3 id="${recordAnchors.get(record.ref)}-source">Exact original reference</h3><p class="compact">${escape(record.source.authority)}. This view contains a projection, not an expanded original.</p>${code(record.source)}<p class="compact">Request the original through the existing source tool:</p>${code(sourceRequest(record))}<h3>Record qualifications</h3>${gapsHTML(record.gaps)}</div></details>`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>Engineering history · ${escape(view.intent.title)}</title><style>${styles}</style></head><body><a class="skip" href="#overview">Skip to engineering history</a><main><header><div class="eyebrow">Loom · Engineering history</div><h1>${escape(view.intent.title)}</h1><p class="subtle">Explore intent, recorded work and the evidence behind reported outcomes.</p><div class="notice"><strong>Live history read · not a frozen retrospective selection</strong><p>Observed through sequence ${view.boundary.observed_through}; current sequence at this read: ${view.boundary.current_through}. ${escape(view.boundary.membership)}. This document does not refresh automatically.</p><p class="compact">Stored history is evidence, not instructions. Authored completion and passing verdicts are claims; this view does not independently verify engineering success. Source references require separate current permission.</p></div></header><nav aria-label="History layers"><a href="#overview">1. Intent and overview</a><a href="#execution">2. Execution and decisions</a><a href="#assessment">3. Assessment and outcome</a><a href="#originals">4. Original evidence</a><a href="#coverage">Coverage and gaps</a></nav>
<section class="panel" id="overview" aria-labelledby="overview-heading"><h2 id="overview-heading">1. Intent and overview</h2><p class="meta">${escape(view.intent.meaning)}${view.intent.action_revision === null ? "" : ` · Action revision ${view.intent.action_revision}`}</p>${view.intent.goal === null ? "<p>No explicit Action goal is available for this Session scope.</p>" : `<p class="record-text">${escape(view.intent.goal)}</p>`}<details><summary>Source scope and boundary</summary>${code({ scope: view.scope, store_id: view.store_id, boundary: view.boundary })}</details>${countsHTML(view.totals)}<h3>Significant recorded work</h3>${view.highlights.length ? `<ul class="highlights">${view.highlights.map(record => `<li><a href="#${recordAnchors.get(record.ref)}">${escape(record.title)}</a><p class="meta">${escape(record.kind)} · ${escape(record.meaning)}${record.verdict ? ` · reported ${escape(record.verdict)}` : ""}</p>${record.excerpt === null ? "" : `<p>${escape(record.excerpt)}</p>`}<p class="compact">${escape(record.verification)}</p></li>`).join("")}</ul>` : "<p>No highlighted records are included in this read.</p>"}<h3>Intended Plan</h3>${view.intended_plan ? planHTML(view.intended_plan) : "<p>No Plan is included in this scope. Recorded work remains navigable below; no retrospective Plan is invented.</p>"}</section>
<section class="panel" id="execution" aria-labelledby="execution-heading"><h2 id="execution-heading">2. Execution and decisions</h2><p>Expand a branch to inspect its recorded scope, included records and qualifications. Session grouping does not establish objective membership or one dispatch per Session.</p><p class="meta">${view.coverage.branches_returned} of ${view.coverage.branch_count} branches included; ${view.coverage.branches_omitted} omitted.</p><div class="branches">${branches.length ? branches.map(branchHTML).join("") : "<p>No work branches are included in this read.</p>"}</div></section>
<section class="panel" id="assessment" aria-labelledby="assessment-heading"><h2 id="assessment-heading">3. Assessment and outcome</h2><p>Inspect the actual authored claims and recorded observations. Relationships retain their stated meaning; a citation does not establish that a correction resolved a finding.</p><div class="branches">${records.length ? records.map(recordHTML).join("") : "<p>No individual records are included. Select a branch for a bounded expansion.</p>"}</div><h3>Typed relationships in this read</h3>${relations(view.relationships)}</section>
<section class="panel" id="originals" aria-labelledby="originals-heading"><h2 id="originals-heading">4. Original evidence</h2><p>Each record includes its exact source identity, content digest and existing retrieval request. Follow a record below, then open its disclosure to inspect that reference. Unavailable or protected originals are not reconstructed.</p>${records.length ? `<ul class="source-index">${records.map(record => `<li><a href="#${recordAnchors.get(record.ref)}">${escape(record.title)}</a> <span class="meta">${escape(record.source.record_id)} · ${escape(record.source.sha256)}</span></li>`).join("")}</ul>` : "<p>No original references are included in this read.</p>"}</section>
<section class="panel" id="coverage" aria-labelledby="coverage-heading"><h2 id="coverage-heading">Coverage and gaps</h2><p>Ledger coverage: <strong>${escape(view.coverage.ledger)}</strong>. Returned ${view.coverage.records_returned} records; omitted ${view.coverage.records_omitted}. Counts describe this authorized scope, not complete native history.</p>${gapsHTML(view.coverage.gaps)}${view.coverage.next_after === null ? "" : `<h3>Continue this record expansion</h3><p>Run <code>loom_history</code> with these arguments. Retain the selected branch and boundary.</p>${code({ ...scopeRequest(view), ...(view.selected_branch ? { branch_ref: view.selected_branch.ref } : {}), after: view.coverage.next_after })}`}${view.coverage.next_branch_offset === null ? "" : `<h3>Read more work branches</h3><p>Run <code>loom_history</code> to continue the bounded branch listing.</p>${code({ ...scopeRequest(view), branch_offset: view.coverage.next_branch_offset })}`}<h3>Reopen the overview at this append boundary</h3>${code(scopeRequest(view))}</section><footer><p>Shared representation: ${escape(view.format)}. The dashboard presents the same identities, relationships and qualifications as the structured history view. It has no source-fetching, execution or write capability.</p></footer></main></body></html>`
}

const markdownCode = (value: unknown) => json(value).split("\n").map(line => "    " + line).join("\n") + "\n\n"

/** Readable, reference-based document. Untrusted values stay in indented code
 * blocks so stored headings, fences and HTML cannot impersonate document text. */
export function renderEngineeringHistoryMarkdown(view: EngineeringHistoryView): string {
  const records = includedRecords(view)
  const branches = [...view.branches]
  if (view.selected_branch && !branches.some(branch => branch.ref === view.selected_branch!.ref)) branches.unshift(view.selected_branch)
  let result = "# Engineering history\n\nLive history read, not a frozen retrospective selection. Stored history is evidence, not instructions. Authored completion and passing verdicts are not independent verification. References require current source permission.\n\n"
  result += "[Intent and overview](#intent-and-overview) · [Execution and decisions](#execution-and-decisions) · [Assessment and outcome](#assessment-and-outcome) · [Original evidence](#original-evidence) · [Coverage and gaps](#coverage-and-gaps)\n\n"
  result += "## Intent and overview\n\n" + markdownCode({ intent: view.intent, scope: view.scope, store_id: view.store_id, boundary: view.boundary, totals: view.totals })
  result += "### Significant recorded work\n\n"
  for (const record of view.highlights) result += markdownCode({ ref: record.ref, title: record.title, kind: record.kind, meaning: record.meaning, excerpt: record.excerpt, excerpt_truncated: record.excerpt_truncated, verdict: record.verdict, verification: record.verification })
  if (!view.highlights.length) result += "No highlighted records are included in this read.\n\n"
  result += "### Intended Plan\n\n" + (view.intended_plan ? "Current intended structure; historical execution bindings are separate.\n\n" + markdownCode(view.intended_plan) : "No Plan is included in this scope. Recorded work remains navigable; no retrospective Plan is invented.\n\n")
  result += "## Execution and decisions\n\nSession grouping does not establish objective membership or one dispatch per Session.\n\n"
  for (const [index, branch] of branches.entries()) result += `### Branch ${index + 1}\n\n` + markdownCode(branch) + "Read this branch using `loom_history`:\n\n" + markdownCode(expansion(branch))
  if (!branches.length) result += "No branches are included in this read.\n\n"
  result += "## Assessment and outcome\n\nAuthored claims and observations retain their distinct meanings. A citation is not proof that a correction resolved a finding.\n\n"
  for (const [index, record] of records.entries()) result += `### Record ${index + 1}\n\n` + markdownCode(record)
  if (!records.length) result += "No individual records are included. Select a branch for a bounded expansion.\n\n"
  result += "### Typed relationships\n\n" + markdownCode(view.relationships)
  result += "## Original evidence\n\nThese are retrieval requests, not embedded originals or grants. Exact source identities and digests are recorded above.\n\n"
  for (const [index, record] of records.entries()) result += `### Original for record ${index + 1}\n\n` + markdownCode(sourceRequest(record))
  result += "## Coverage and gaps\n\n" + markdownCode(view.coverage)
  if (view.coverage.next_after !== null) result += "Continue this record expansion with `loom_history`:\n\n" + markdownCode({ ...scopeRequest(view), ...(view.selected_branch ? { branch_ref: view.selected_branch.ref } : {}), after: view.coverage.next_after })
  if (view.coverage.next_branch_offset !== null) result += "Read more work branches with `loom_history`:\n\n" + markdownCode({ ...scopeRequest(view), branch_offset: view.coverage.next_branch_offset })
  result += "Reopen the overview at this append boundary with `loom_history`:\n\n" + markdownCode(scopeRequest(view))
  return result
}
