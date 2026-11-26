import type {
  EngineeringHistoryBranch, EngineeringHistoryCounts, EngineeringHistoryGap,
  EngineeringHistoryRecord, EngineeringHistoryRelationship, EngineeringHistoryView,
} from "./engineering-history.js"

// This is a presentation of an already-authorized projection. It must never
// fetch sources, widen membership, infer relationships or grant source access.
const neutralize = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,
  c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
// Untrusted values are emitted only into HTML text, never into attributes,
// styles or scripts. Quotes need no entity in text. All markup delimiters and
// control characters are still neutralized, including inside JSON code blocks.
const escape = (value: unknown) => neutralize(String(value)).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)
const json = (value: unknown) => neutralize(JSON.stringify(value, null, 2))
const code = (value: unknown) => `<pre><code>${escape(json(value))}</code></pre>`
const compactCode = (value: unknown) => `<pre><code>${escape(JSON.stringify(value))}</code></pre>`
const previewHTML = (record: EngineeringHistoryRecord) => record.excerpt === null ? ""
  : `<p>${escape(record.excerpt.slice(0, 300))}</p>${record.excerpt.length > 300 ? '<p class="meta">Preview shortened; the complete projected excerpt is in the record disclosure.</p>' : ""}`
const scopeRequest = (view: EngineeringHistoryView) => ({ operation: "read", ...view.scope,
  through: view.boundary.observed_through, limit: view.coverage.page_limit,
  ...(view.boundary.owners ? { owner_boundary: view.boundary.owners } : {}),
  ...(view.boundary.owner_version ? { owner_version: view.boundary.owner_version } : {}) })
const selectedRequest = (view: EngineeringHistoryView) => ({ operation: "read", ...view.navigation.repeat })
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
  ["capture_gap_records", "Capture gap records"], ["unestablished_finishes", "Unestablished finishes"],
  ["ambiguous_scope_records", "Ambiguous scope records"], ["unavailable_scope_records", "Unavailable scope records"],
]

function countsHTML(counts: EngineeringHistoryCounts) {
  return `<dl class="metrics">${countLabels.map(([key, label]) => `<div><dt>${label}</dt><dd>${counts[key] === null ? "Unknown" : escape(counts[key])}</dd></div>`).join("")}</dl>`
}

function gapsHTML(gaps: EngineeringHistoryGap[]) {
  return gaps.length ? `<ul class="gaps">${gaps.map(gap => `<li><strong>${escape(gap.code)}</strong><p>${escape(gap.detail)}</p></li>`).join("")}</ul>` : "<p>No additional gaps are reported by this projection.</p>"
}

function includedBranches(view: EngineeringHistoryView) {
  const branches = new Map<string, EngineeringHistoryBranch>()
  for (const branch of [...view.ancestors, ...(view.selected_branch ? [view.selected_branch] : []), ...view.branches, ...view.related_branches])
    branches.set(branch.ref, branch)
  return [...branches.values()]
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
*{box-sizing:border-box}html{scroll-padding-top:1rem}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1160px;margin:auto;padding:2rem 1.25rem 4rem}h1{font-size:2rem;line-height:1.2;margin:.3rem 0 .75rem}h2{font-size:1.35rem;margin:0 0 1rem}h3{font-size:1.05rem;margin:1.25rem 0 .5rem}p{margin:.5rem 0 1rem}a{color:var(--link);text-underline-offset:.16em}a:focus-visible,summary:focus-visible,[tabindex="-1"]:focus-visible{outline:3px solid var(--focus);outline-offset:4px}.skip{position:absolute;top:.5rem;left:.5rem;transform:translateY(-200%);padding:.6rem;background:var(--surface);z-index:2}.skip:focus{transform:none}.eyebrow{font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:.75rem;color:var(--muted)}.subtle,.meta{color:var(--muted)}.meta{font-size:.875rem;overflow-wrap:anywhere}.notice{border-left:4px solid var(--link);padding:.8rem 1rem;background:var(--soft);margin:1.2rem 0}.notice p:last-child{margin-bottom:0}nav{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;padding:.8rem 0 1.5rem}.panel{background:var(--surface);border:1px solid var(--line);border-radius:.65rem;padding:1.25rem;margin:1rem 0;overflow-wrap:anywhere}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:1rem;margin:1rem 0}.metrics div{border-left:2px solid var(--line);padding-left:.75rem}.metrics dt{font-size:.8rem;color:var(--muted)}.metrics dd{font-weight:650;font-size:1.1rem;margin:.1rem 0}.compact{font-size:.875rem}.badge{display:inline-block;border:1px solid var(--line);border-radius:.25rem;padding:.08rem .4rem;margin:0 .25rem .35rem 0;font-size:.75rem;vertical-align:middle}.highlights{padding-left:1.25rem}.highlights li{margin:.75rem 0}.highlights p{margin:.2rem 0}.branches{display:grid;gap:.75rem}.card{border:1px solid var(--line);border-radius:.4rem;background:var(--surface);min-width:0}.card>summary{padding:.85rem 1rem;cursor:pointer}.card[open]>summary{border-bottom:1px solid var(--line);background:var(--soft)}.card .body{padding:.25rem 1rem 1rem}.summary-title{font-weight:650}.summary-meta{display:block;padding-left:1.1rem;font-size:.8rem;color:var(--muted);margin-top:.2rem}.gaps{padding-left:1.2rem}.gaps li{margin:.65rem 0}.gaps p{margin:.15rem 0}.record-text{white-space:pre-wrap;border-left:3px solid var(--line);padding:.5rem .75rem;background:var(--soft)}.pairs{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,3fr);gap:.3rem .75rem}.pairs dt{font-weight:650}.pairs dd{margin:0;overflow-wrap:anywhere}.relationships{padding-left:1.25rem}.relationships li{margin:.8rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--soft);padding:.75rem;border:1px solid var(--line);border-radius:.3rem;font-size:.8rem;max-width:100%}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.source-index{padding-left:1.25rem}.source-index li{margin:.45rem 0}footer{font-size:.85rem;color:var(--muted);padding:1rem 0}[id]{scroll-margin-top:1rem}
@media(max-width:600px){main{padding:1.25rem .75rem 2rem}.panel{padding:1rem}.pairs{grid-template-columns:1fr}.pairs dd{margin-bottom:.5rem}h1{font-size:1.6rem}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(prefers-color-scheme:dark){:root{--bg:#101820;--surface:#18242e;--ink:#e7eef4;--muted:#b7c9d8;--line:#657c8f;--link:#91c9ff;--soft:#223542;--focus:#91c9ff}}
@media(forced-colors:active){*{forced-color-adjust:auto}.panel,.card,.badge,pre{border:1px solid CanvasText}.notice{border-left:4px solid LinkText}a:focus-visible,summary:focus-visible,[tabindex="-1"]:focus-visible{outline:3px solid Highlight}}
@media print{body{background:white;color:black}main{max-width:none;padding:0}.panel,.card{break-inside:avoid}nav,.skip{display:none}.meta,.subtle{color:black}}
.plan-tree{list-style:none;padding-left:1rem;display:grid;gap:.5rem;margin:.75rem 0}.panel>.plan-tree{padding-left:0}.work-children{border-left:2px solid var(--line);padding-left:1rem;margin:1rem 0;display:grid;gap:.75rem}.ancestor-path{list-style:none;padding:0;display:grid;gap:.5rem}
`

/** Self-contained human view; native disclosure/navigation only, no JavaScript,
 * network, storage, source dereferencing or independently derived conclusions. */
export function renderEngineeringHistoryHTML(view: EngineeringHistoryView): string {
  const connectionPage = view.mode === "connections", trajectory = view.mode === "trajectory", focused = trajectory || connectionPage
  const records = includedRecords(view)
  const recordGaps = new Map([...new Map(records.flatMap(record => record.gaps.map(gap => [json(gap), gap] as const))).values()]
    .map((gap, index) => [json(gap), { gap, number: index + 1 }]))
  const recordAnchors = new Map(records.map((record, index) => [record.ref, `record-${index + 1}`]))
  const branches = includedBranches(view)
  const branchAnchors = new Map(branches.map((branch, index) => [branch.ref, `branch-${index + 1}`]))
  const extraRequests = new Map<string, { anchor: string; request: object }>()
  const requestAnchors = new Map(records.map(record => {
    const branch = branches.find(branch => branch.ref === record.branch_ref && json(branch.expand) === json(record.expand))
    if (branch) return [record.ref, branchAnchors.get(branch.ref)!]
    const key = json(record.expand)
    if (!extraRequests.has(key)) extraRequests.set(key, { anchor: `work-read-${extraRequests.size + 1}`, request: { operation: "read", ...record.expand } })
    return [record.ref, extraRequests.get(key)!.anchor]
  }))
  const ownerAnchors = new Map([...view.connections.objectives.map((item, index) => [item.ref, `objective-${index + 1}`] as const),
    ...view.connections.reviews.map((item, index) => [item.ref, `review-${index + 1}`] as const)])
  const anchors = new Map([...recordAnchors, ...branchAnchors, ...ownerAnchors])
  const reference = (ref: string, compact = false) => {
    const label = compact ? escape(ref) : `<code>${escape(ref)}</code>`
    return anchors.has(ref) ? `<a href="#${anchors.get(ref)}">${label}</a>` : label
  }
  const qualifications = new Map([...new Set(view.relationships.map(item => item.qualification))]
    .map((qualification, index) => [qualification, index + 1]))
  const provenances = new Map([...new Set(view.relationships.flatMap(item => item.provenance ? [json(item.provenance)] : []))]
    .map((provenance, index) => [provenance, index + 1]))
  // Render each complete edge once. A dense review can cite many observations;
  // repeating that edge payload in every endpoint's disclosure makes the same
  // otherwise bounded shared view unusable in HTML even at the smallest page.
  const relations = (items: EngineeringHistoryRelationship[]) => items.length ? `<ol class="relationships">${items.map((item, index) => `<li id="relationship-${index + 1}" tabindex="-1">${reference(item.from, true)} <strong>${escape(item.kind)}</strong> ${reference(item.to, true)}<br>${escape(item.meaning)} · ${escape(item.target)} · source ${escape(item.source_record_id)} · <a href="#qualification-${qualifications.get(item.qualification)}">Qualification ${qualifications.get(item.qualification)}</a>${item.provenance ? ` · <a href="#provenance-${provenances.get(json(item.provenance))}">Provenance ${provenances.get(json(item.provenance))}</a>` : ""}</li>`).join("")}</ol><h3>Relationship qualifications</h3><p>Repeated qualifications share a labeled reference. Each relationship above links to its complete qualification below.</p><dl>${[...qualifications].map(([qualification, number]) => `<dt id="qualification-${number}" tabindex="-1">Qualification ${number}</dt><dd>${escape(qualification)}</dd>`).join("")}</dl>${provenances.size ? `<h3>Relationship provenance</h3><dl>${[...provenances].map(([provenance, number]) => `<dt id="provenance-${number}" tabindex="-1">Provenance ${number}</dt><dd><pre><code>${escape(provenance)}</code></pre></dd>`).join("")}</dl>` : ""}` : "<p>No typed relationships are included in this read.</p>"
  const recordRelationships = (ref: string) => {
    const indices = view.relationships.flatMap((item, index) => item.from === ref || item.to === ref ? [index + 1] : [])
    return indices.length ? `<p>${indices.length} included relationships: ${indices.map(index => `<a href="#relationship-${index}">Relationship ${index}</a>`).join(", ")}. Full identities and qualifications appear once in the relationship list and its qualification key below.</p>`
      : "<p>No typed relationships for this record are included in this read.</p>"
  }

  const branchHTML = (branch: EngineeringHistoryBranch, children = "", selected = false) => {
    const members = records.filter(record => record.branch_ref === branch.ref)
    return `<details class="card"${selected ? " open" : ""}><summary id="${branchAnchors.get(branch.ref)}"><span class="summary-title">${escape(branch.title)}</span><span class="summary-meta">${escape(branch.meaning)} · ${branch.counts.records} records · ${branch.child_count} child groups · sequences ${branch.first_sequence}–${branch.last_sequence}</span></summary><div class="body"><p class="meta">Branch reference: <code>${escape(branch.ref)}</code></p>${branch.parent_ref ? `<p class="compact">Recorded parent: ${reference(branch.parent_ref)}</p>` : "<p class=\"compact\">Top-level recorded group in this scope.</p>"}${countsHTML(branch.counts)}${branch.historical_scope ? `<h3>Historical revisions</h3>${code(branch.historical_scope)}` : ""}${branch.work_ref ? `<h3>Historical work binding</h3>${code(branch.work_ref)}` : ""}${branch.historical_node ? `<h3>Plan node at that revision</h3>${code(branch.historical_node)}` : ""}${children ? `<h3>Returned child groups</h3><div class="work-children">${children}</div>` : ""}<h3>Included records</h3>${members.length ? `<ul>${members.map(record => `<li><a href="#${recordAnchors.get(record.ref)}">${escape(record.title)}</a> <span class="meta">${escape(record.kind)} · ${escape(record.meaning)}</span></li>`).join("")}</ul>` : "<p>This view contains no record details for this group. Use its expansion request to inspect the next level or its records.</p>"}<h3>Read this branch</h3><p class="compact">Run <code>loom_history</code> with these arguments for a fresh authorized read. This document does not fetch additional history.</p>${code(expansion(branch))}<h3>Branch qualifications</h3>${gapsHTML(branch.gaps)}</div></details>`
  }
  const listedBranches = view.branches.filter(branch => branch.ref !== view.selected_branch?.ref)
  const matchingLeaves = view.mode === "discovery"
  const selectedMatches = matchingLeaves && view.branches.some(branch => branch.ref === view.selected_branch?.ref)
  const branchCards = listedBranches.map(branch => branchHTML(branch)).join("")
  const matchingCards = `${selectedMatches ? branchHTML(view.selected_branch!, "", true) : ""}${branchCards}`
  const executionTree = matchingLeaves
    ? `${view.selected_branch && !selectedMatches ? branchHTML(view.selected_branch, "", true) : ""}<h3>Matching leaf groups</h3>${matchingCards || "<p>No matching leaf groups are included in this read.</p>"}`
    : view.selected_branch ? branchHTML(view.selected_branch, branchCards, true) : branchCards
  const groupingDescription = matchingLeaves
    ? "Matching leaves may be deeper descendants of the selected group. Recorded parent references preserve their actual hierarchy; expand a leaf to inspect its complete ancestor path."
    : "Returned child groups are indented beneath the selected group."
  const ancestors = view.ancestors.filter(branch => branch.ref !== view.selected_branch?.ref && !listedBranches.some(item => item.ref === branch.ref))
  const related = view.related_branches.filter(branch => !ancestors.some(item => item.ref === branch.ref)
    && branch.ref !== view.selected_branch?.ref && !listedBranches.some(item => item.ref === branch.ref))
  const recordHTML = (record: EngineeringHistoryRecord) => `<details class="card"><summary id="${recordAnchors.get(record.ref)}"><span class="summary-title">${escape(record.title)}</span><span class="summary-meta">${escape(record.kind)} · ${escape(record.meaning)} · sequence ${record.sequence}</span></summary><div class="body"><p><span class="badge">${escape(record.meaning)}</span>${record.verdict ? `<span class="badge">Reported verdict: ${escape(record.verdict)}</span>` : ""}</p><p>${escape(record.verification)}</p><dl class="pairs"><dt>Author</dt><dd>${escape(record.agent)}</dd><dt>Session</dt><dd><code>${escape(record.session_id)}</code></dd><dt>Recorded at</dt><dd>${escape(record.created_at)}</dd><dt>Record reference</dt><dd><code>${escape(record.ref)}</code></dd><dt>Branch</dt><dd>${reference(record.branch_ref)}</dd>${record.fingerprint ? `<dt>Authored fingerprint</dt><dd><code>${escape(record.fingerprint)}</code></dd>` : ""}</dl><p class="compact">Read this record's work group: <a href="#${requestAnchors.get(record.ref)}">exact <code>loom_history</code> arguments</a>.</p>${record.excerpt === null ? "<p>No prose excerpt is available in this projection.</p>" : `<h3>Stored excerpt</h3><p class="record-text">${escape(record.excerpt)}</p>${record.excerpt_truncated ? "<p class=\"meta\">Excerpt truncated. Use the exact original reference for the complete permitted record.</p>" : ""}`}${record.observation ? `<h3>Observed execution metadata</h3>${code(record.observation)}<p class="meta">Elapsed time is an observed interval; active work, waiting and overlapping execution are not inferred.</p>` : ""}${record.work_ref ? `<h3>Historical work binding</h3>${code(record.work_ref)}` : ""}<h3>Related trajectory</h3><p class="compact">Follow explicit relationships with the preserved source boundaries:</p>${compactCode({ operation: "read", ...record.trajectory })}<h3>Relationships</h3>${recordRelationships(record.ref)}<h3 id="${recordAnchors.get(record.ref)}-source" tabindex="-1">Exact original reference</h3>${code({ ...record.source, query: undefined })}<p class="compact">Request the original through the existing source tool:</p>${code(sourceRequest(record))}<h3>Record qualifications</h3>${record.gaps.length ? `<ul class="gaps">${record.gaps.map(gap => `<li><a href="#record-gap-${recordGaps.get(json(gap))!.number}">${escape(gap.code)}</a></li>`).join("")}</ul>` : "<p>No additional record qualifications.</p>"}</div></details>`


  const connectionHTML = `${view.connections.objectives.map(item => `<details class="card"><summary id="${ownerAnchors.get(item.ref)}"><span class="summary-title">${escape(item.objective.label)}</span><span class="summary-meta">Objective · authored associations · ${item.links.length} links included · ${item.links_omitted} omitted</span></summary><div class="body"><p class="meta">${escape(item.ref)}</p><p>Phases, confidence and judgments are attributed interpretations. Original source verification and the current status of each association remain separate.</p>${code({ objective: item.objective, links: item.links, links_omitted: item.links_omitted })}<h3>Explore this objective</h3><p class="compact">Follow the objective’s recorded connections within the preserved authorized scope.</p>${code({ operation: "read", ...item.expand })}<h3>Read objective association pages</h3>${code({ operation: "read", ...item.details })}<h3>Original objective owner</h3>${code(item.source)}</div></details>`).join("")}${view.connections.reviews.map(item => `<details class="card"><summary id="${ownerAnchors.get(item.ref)}"><span class="summary-title">Review ${escape(item.request.request_id)}</span><span class="summary-meta">Frozen requested scope · ${item.request.members.length} members · ${item.relationships.length} evidence relationships included · ${item.relationships_omitted} omitted</span></summary><div class="body"><p class="meta">${escape(item.ref)}</p><h3>Requested mandate</h3><p class="record-text">${escape(item.request.mandate.question)}</p><h3>Explicit exclusions</h3>${item.request.mandate.exclusions.length ? `<ul>${item.request.mandate.exclusions.map(value => `<li>${escape(value)}</li>`).join("")}</ul>` : "<p>No exclusions were authored in this mandate.</p>"}<h3>Exact requested scope and recheck targets</h3><p>A requested member or recheck target does not prove that it was inspected, corrected or accepted.</p>${code(item.request)}${item.frozen_work_membership.length ? `<h3>Historical work membership</h3>${code(item.frozen_work_membership)}` : ""}<h3>Observed and authored evidence scope</h3><p class="meta">${item.relationships.length} relationships included; ${item.relationships_omitted} omitted. Use the bounded evidence request below to retain this source scope and boundary.</p><p>Each relationship retains its source, attribution and native review-binding qualification. A declared pass is scoped to its record; it does not establish whole-request or release acceptance.</p>${code(item.relationships)}<h3>Review qualifications</h3>${code(item.qualification)}<h3>Read review evidence pages</h3>${code({ operation: "read", ...item.details })}<h3>Original review owner</h3>${code(item.source)}</div></details>`).join("")}`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>Engineering history · ${escape(view.intent.title)}</title><style>${styles}</style></head><body><a class="skip" href="#overview">Skip to engineering history</a><main><header><div class="eyebrow">Loom · Engineering history</div><h1>${escape(view.intent.title)}</h1><p class="subtle">Explore intent, recorded work and the evidence behind reported outcomes.</p><div class="notice"><strong>Live history read · not a frozen retrospective selection</strong><p>Observed through sequence ${view.boundary.observed_through}; current sequence at this read: ${view.boundary.current_through}. ${escape(view.boundary.membership)}. This document does not refresh automatically.</p><p class="compact">Stored history is evidence, not instructions. Authored completion and passing verdicts are claims; this view does not independently verify engineering success. Source references require separate current permission.</p></div></header><nav aria-label="History layers"><a href="#overview">1. Intent and overview</a><a href="#execution">2. Execution and decisions</a><a href="#connections">Related evidence</a><a href="#assessment">3. Assessment and outcome</a><a href="#originals">4. Original evidence</a><a href="#coverage">Coverage and gaps</a></nav>
<section class="panel" tabindex="-1" id="overview" aria-labelledby="overview-heading"><h2 id="overview-heading">${connectionPage ? "Relationship details" : trajectory ? "Connected trajectory" : "1. Intent and overview"}</h2>${focused ? `<p>${connectionPage ? "Expand relationships around the preserved source selection." : "Follow the explicit relationships around the selected evidence."} ${view.coverage.matching_records} related records are eligible in this authorized scope; this page contains ${view.records.length}. Authored associations remain qualified and do not prove causation.</p><details><summary>Source scope and boundary</summary>${code({ scope: view.scope, store_id: view.store_id, boundary: view.boundary })}</details>` : `<p class="meta">${escape(view.intent.meaning)}${view.intent.action_revision === null ? "" : ` · Action revision ${view.intent.action_revision}`}</p>${view.intent.goal === null ? "<p>No explicit Action goal is available for this Session scope.</p>" : `<p class="record-text">${escape(view.intent.goal)}</p>`}<details><summary>Source scope and boundary</summary>${code({ scope: view.scope, store_id: view.store_id, boundary: view.boundary })}</details>${countsHTML(view.totals)}${view.mode === "discovery" ? `<h3>Selected history</h3><p>${view.coverage.matching_records} matching records in ${view.coverage.matching_branches} matching leaf groups. Matching uses recorded text and metadata; it does not establish resolution.</p>${code(view.selection)}<p class="compact">Repeat this selection with <code>loom_history</code>:</p>${code(selectedRequest(view))}` : ""}<h3>Significant recorded work</h3>${view.highlights.length ? `<ul class="highlights">${view.highlights.map(record => `<li><a href="#${recordAnchors.get(record.ref)}">${escape(record.title)}</a><p class="meta">${escape(record.kind)} · ${escape(record.meaning)}${record.verdict ? ` · reported ${escape(record.verdict)}` : ""}</p>${previewHTML(record)}<p class="compact">${escape(record.verification)}</p></li>`).join("")}</ul>` : "<p>No highlighted records are included in this read.</p>"}<h3>Intended Plan</h3>${view.intended_plan ? planHTML(view.intended_plan) : "<p>No current Plan projection is included in this read. Recorded work remains navigable below; no retrospective Plan is invented.</p>"}`}</section>
<section class="panel" tabindex="-1" id="execution" aria-labelledby="execution-heading"><h2 id="execution-heading">2. Execution and decisions</h2>${focused ? "<p>This focused selection includes the related evidence groups below. Individual work-group requests remain available for deeper historical context.</p>" : `<p>Open a group to inspect its scope and copy the exact request for the next level. ${groupingDescription} Session and message grouping does not establish objective membership or one dispatch per Session.</p><p class="meta">${view.coverage.branches_returned} of ${view.coverage.branch_count} branches included; ${view.coverage.branches_omitted} omitted.</p>${ancestors.length ? `<h3>Path to selected work</h3><ol class="ancestor-path">${ancestors.map(branch => `<li>${branchHTML(branch)}</li>`).join("")}</ol>` : ""}<div class="branches">${executionTree || "<p>No work branches are included in this read.</p>"}</div>${related.length ? `<h3>Related recorded groups</h3><p class="meta">${view.related_branches.length} related groups included; ${view.coverage.related_branches_omitted} omitted.</p>${view.coverage.related_branches_omitted ? "<p>Use discovery with the recorded node or source Session to locate additional eligible groups. Omitted fingerprint associations are not absent history.</p>" : ""}<p>These groups share a recorded fingerprint with the selected work. Shared fingerprints and chronology do not prove correction or resolution; read the records and qualifications.</p><div class="branches">${related.map(branch => branchHTML(branch)).join("")}</div>` : ""}`}${extraRequests.size ? `<h3>Additional work-group requests</h3><p>These requests retain the exact recorded group for included records whose group details are outside this page. Each request requires a fresh authorized read.</p>${[...extraRequests.values()].map((item, index) => `<h4 id="${item.anchor}" tabindex="-1">Work group request ${index + 1}</h4>${code(item.request)}`).join("")}` : ""}</section>
<section class="panel" tabindex="-1" id="connections" aria-labelledby="connections-heading"><h2 id="connections-heading">Related evidence groups</h2><p>Objective and review owners retain their own authority. Read the requested scope separately from the evidence that was observed, cited or claimed to have been inspected.</p>${view.connections.context ? `<h3>Selected source context</h3>${code(view.connections.context.record_refs)}<p>Return to the preserved record selection with <code>loom_history</code>:</p>${code({ operation: "read", ...view.connections.context.read })}` : ""}<div class="branches">${connectionHTML || "<p>No objective or caller-owned review details are included in this read. This does not establish that no objective or review existed.</p>"}</div><details><summary>Relationship coverage and access</summary>${code(view.connections.coverage)}${gapsHTML(view.connections.gaps.filter(item => !view.coverage.gaps.some(gap => gap.code === item.code && gap.detail === item.detail)))}</details></section>
<section class="panel" tabindex="-1" id="assessment" aria-labelledby="assessment-heading"><h2 id="assessment-heading">3. Assessment and outcome</h2><p>Inspect the actual authored claims and recorded observations. Relationships retain their stated meaning; a citation does not establish that a correction resolved a finding.</p><div class="branches">${records.length ? records.map(recordHTML).join("") : "<p>No individual records are included. Select a branch for a bounded expansion.</p>"}</div>${recordGaps.size ? `<h3>Record qualification key</h3><dl>${[...recordGaps.values()].map(({ gap, number }) => `<dt id="record-gap-${number}" tabindex="-1">${escape(gap.code)}</dt><dd>${escape(gap.detail)}</dd>`).join("")}</dl>` : ""}<h3>Typed relationships in this read</h3>${relations(view.relationships)}</section>
<section class="panel" tabindex="-1" id="originals" aria-labelledby="originals-heading"><h2 id="originals-heading">4. Original evidence</h2><p>Each record includes its exact source identity, content digest and existing retrieval request. Follow a record below to reveal and focus its exact reference, including when its disclosure is closed. Unavailable or protected originals are not reconstructed.</p>${records.length ? `<ul class="source-index">${records.map(record => `<li><a href="#${recordAnchors.get(record.ref)}-source">${escape(record.title)}</a> <span class="meta">${escape(record.source.record_id)} · ${escape(record.source.sha256)}</span></li>`).join("")}</ul>` : "<p>No original references are included in this read.</p>"}</section>
<section class="panel" tabindex="-1" id="coverage" aria-labelledby="coverage-heading"><h2 id="coverage-heading">Coverage and gaps</h2><p>Ledger coverage: <strong>${escape(view.coverage.ledger)}</strong>. Returned ${view.coverage.records_returned} records; omitted ${view.coverage.records_omitted}. Counts describe this authorized scope, not complete native history.</p>${gapsHTML(view.coverage.gaps)}<details><summary>Navigation coverage</summary>${code({ ...view.coverage, gaps: undefined })}</details>${view.navigation.next_records === null ? "" : `<h3>Continue this record expansion</h3><p>Run <code>loom_history</code> with these arguments. Retain the selection, selected group and boundary.</p>${code({ operation: "read", ...view.navigation.next_records })}`}${view.navigation.next_branches === null ? "" : `<h3>Read more work branches</h3><p>Run <code>loom_history</code> to continue the bounded branch listing.</p>${code({ operation: "read", ...view.navigation.next_branches })}`}${view.navigation.next_connections ? `<h3>Continue related evidence</h3><p>Read the next bounded group or owner-detail page with <code>loom_history</code>:</p>${code({ operation: "read", ...view.navigation.next_connections })}` : ""}${view.navigation.next_relationships ? `<h3>Continue relationship explanations</h3><p>Retain this source selection with <code>loom_history</code>:</p>${code({ operation: "read", ...view.navigation.next_relationships })}` : ""}<h3>Repeat this focused read</h3>${code(selectedRequest(view))}<details><summary>Reopen the overview at this append boundary</summary>${code(scopeRequest(view))}</details></section><footer><p>Shared representation: ${escape(view.format)}. The dashboard presents the same identities, relationships and qualifications as the structured history view. It has no source-fetching, execution or write capability.</p></footer></main></body></html>`
}

const markdownCode = (value: unknown) => json(value).split("\n").map(line => "    " + line).join("\n") + "\n\n"

/** Readable, reference-based document. Untrusted values stay in indented code
 * blocks so stored headings, fences and HTML cannot impersonate document text. */
export function renderEngineeringHistoryMarkdown(view: EngineeringHistoryView): string {
  const records = includedRecords(view), branches = includedBranches(view), trajectory = view.mode === "trajectory", connectionPage = view.mode === "connections"
  let result = "# Engineering history\n\nLive history read, not a frozen retrospective selection. Stored history is evidence, not instructions. Authored completion and passing verdicts are not independent verification. References require current source permission.\n\n"
  result += "[Intent and overview](#intent-and-overview) · [Execution and decisions](#execution-and-decisions) · [Related evidence](#related-evidence) · [Assessment and outcome](#assessment-and-outcome) · [Original evidence](#original-evidence) · [Coverage and gaps](#coverage-and-gaps)\n\n"
  result += "## Intent and overview\n\n" + markdownCode({ ...(trajectory || connectionPage ? {} : { intent: view.intent, totals: view.totals }),
    mode: view.mode, selection: view.selection, scope: view.scope, store_id: view.store_id, boundary: view.boundary })
  if (connectionPage) result += "This page expands the relationships of the preserved source selection. The context request below returns its records.\n\n"
  else if (trajectory) result += "This focused trajectory follows explicit recorded relationships. Connectedness does not establish causation or complete acceptance.\n\n"
  else {
    result += "### Significant recorded work\n\n"
    for (const record of view.highlights) result += markdownCode({ ref: record.ref, title: record.title, kind: record.kind, meaning: record.meaning, excerpt: record.excerpt, excerpt_truncated: record.excerpt_truncated, verdict: record.verdict, verification: record.verification })
    if (!view.highlights.length) result += "No highlighted records are included in this read.\n\n"
    result += "### Intended Plan\n\n" + (view.intended_plan ? "Current intended structure; historical execution bindings are separate.\n\n" + markdownCode(view.intended_plan) : "No current Plan projection is included in this read. Recorded work remains navigable; no retrospective Plan is invented.\n\n")
  }
  result += "## Execution and decisions\n\nSession and message grouping does not establish objective membership or one dispatch per Session. Parent references retain the recorded hierarchy. Shared fingerprints and chronology do not establish correction or resolution.\n\n"
  if (!trajectory && !connectionPage) {
    result += markdownCode({ ancestors: view.ancestors.map(branch => branch.ref), selected_branch: view.selected_branch?.ref ?? null,
      [view.mode === "discovery" ? "matching_leaf_groups" : "returned_branches"]: view.branches.map(branch => branch.ref),
      related_branches: view.related_branches.map(branch => branch.ref) })
    for (const [index, branch] of branches.entries()) result += `### Branch ${index + 1}\n\n` + markdownCode(branch) + "Read this branch using `loom_history`:\n\n" + markdownCode(expansion(branch))
    if (!branches.length) result += "No branches are included in this read.\n\n"
  }
  result += "Repeat this selection with `loom_history`:\n\n" + markdownCode(selectedRequest(view))
  result += "## Related evidence\n\nObjective associations are attributed interpretations. Review mandates preserve exact requested membership and exclusions; requested membership and recheck targets do not establish observed execution or coverage. Native review binding remains separately qualified.\n\n"
  if (view.connections.context) result += "Selected source references:\n\n" + markdownCode(view.connections.context.record_refs)
    + "Return to the source selection with `loom_history`:\n\n" + markdownCode({ operation: "read", ...view.connections.context.read })
  for (const [index, item] of view.connections.objectives.entries()) result += `### Objective ${index + 1}\n\n`
    + markdownCode(item) + "Follow this objective within the preserved authorized scope using `loom_history`:\n\n"
    + markdownCode({ operation: "read", ...item.expand })
    + "Read this objective's bounded association pages with `loom_history`:\n\n" + markdownCode({ operation: "read", ...item.details })
  for (const [index, item] of view.connections.reviews.entries()) result += `### Review ${index + 1}: requested and evidenced scope\n\n`
    + "The exact mandate, members, exclusions and requested rechecks are preserved below. Individual observed/authored evidence relationships remain distinct from the requested scope and from complete release acceptance.\n\n"
    + markdownCode(item) + "Read this review's bounded evidence pages with `loom_history`:\n\n" + markdownCode({ operation: "read", ...item.details })
  result += "Relationship coverage and access:\n\n" + markdownCode({ coverage: view.connections.coverage, gaps: view.connections.gaps })
  result += "## Assessment and outcome\n\nAuthored claims and observations retain their distinct meanings. A citation is not proof that a correction resolved a finding. Each record includes a complete request for following its explicit relationships.\n\n"
  for (const [index, record] of records.entries()) {
    const { expand, trajectory: related, ...details } = record
    result += `### Record ${index + 1}\n\n` + markdownCode(details)
      + "Read this record's work group using `loom_history`:\n\n" + markdownCode({ operation: "read", ...expand })
      + "Follow its related trajectory using `loom_history`:\n\n" + markdownCode({ operation: "read", ...related })
  }
  if (!records.length) result += connectionPage ? "Record bodies remain available through the preserved source selection.\n\n" : "No individual records are included. Select a branch for a bounded expansion.\n\n"
  result += "### Typed relationships\n\n" + markdownCode(view.relationships)
  result += "## Original evidence\n\nThese are retrieval requests, not embedded originals or grants. Exact source identities and digests are recorded above.\n\n"
  for (const [index, record] of records.entries()) result += `### Original for record ${index + 1}\n\n` + markdownCode(sourceRequest(record))
  result += "## Coverage and gaps\n\n" + markdownCode(view.coverage)
  if (view.navigation.next_records) result += "Continue this record expansion with `loom_history`:\n\n" + markdownCode({ operation: "read", ...view.navigation.next_records })
  if (view.navigation.next_branches) result += "Read more work branches with `loom_history`:\n\n" + markdownCode({ operation: "read", ...view.navigation.next_branches })
  if (view.navigation.next_connections) result += "Continue related evidence groups or owner detail with `loom_history`:\n\n" + markdownCode({ operation: "read", ...view.navigation.next_connections })
  if (view.navigation.next_relationships) result += "Continue relationship explanations with `loom_history`:\n\n" + markdownCode({ operation: "read", ...view.navigation.next_relationships })
  result += "Reopen the overview at this append boundary with `loom_history`:\n\n" + markdownCode(scopeRequest(view))
  return result
}
