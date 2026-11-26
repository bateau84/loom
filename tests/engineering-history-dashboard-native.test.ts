import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { renderEngineeringHistoryHTML, renderEngineeringHistoryMarkdown } from "../src/engineering-history-dashboard.js"
import { ENGINEERING_HISTORY_LIMITS } from "../src/engineering-history.js"
import type { EngineeringHistoryCounts, EngineeringHistoryView } from "../src/engineering-history.js"
import { Store } from "../src/store.js"

function fixture(): EngineeringHistoryView {
  const counts: EngineeringHistoryCounts = { records: 2, sessions: 1, observations: 0, concerns: 1,
    reported_completions: 0, reported_reopens: 0, reported_passes: 1, reported_failures: 0, reported_inconclusive: 0, observed_tool_errors: 0,
    observation_starts: 0, paired_finishes: 0, verified_outcomes: null, native_dispatches: null,
    capture_gap_records: 0, unestablished_finishes: 0, ambiguous_scope_records: 0, unavailable_scope_records: 0,
    by_kind: { concern: 1, assessment: 1 } }
  const records: EngineeringHistoryView["records"] = [
    { ref: "record:concern", branch_ref: "branch:session", kind: "concern", sequence: 4,
      session_id: "session-a", agent: "reviewer", created_at: "2026-11-25T10:00:00Z", meaning: "authored",
      title: "Initial coarse failure", excerpt: "The original failure remains unexplained.", excerpt_truncated: false,
      verdict: null, verification: "authored claim; not independently verified", work_ref: null, observation: null,
      fingerprint: null, expand: { session_id: "session-a", record_id: "concern", through: 7 },
      trajectory: { session_id: "session-a", record_id: "concern", related: true, through: 7 },
      source: { store_id: "store-a", record_id: "concern", session_id: "session-a", sequence: 4, sha256: "a".repeat(64),
        tool: "loom_record", query: { operation: "query", source_session_id: "session-a", record_id: "concern" },
        authority: "reference-only; retrieval requires current source permission" }, gaps: [] },
    { ref: "record:assessment", branch_ref: "branch:session", kind: "assessment", sequence: 7,
      session_id: "session-a", agent: "reviewer", created_at: "2026-11-25T10:30:00Z", meaning: "authored",
      title: "Corrected-head partial verification", excerpt: "Both named subtests pass on the corrected head; suite coverage is separate.", excerpt_truncated: true,
      verdict: "pass", verification: "authored claim; not independently verified", work_ref: null, observation: null,
      fingerprint: null, expand: { session_id: "session-a", record_id: "assessment", through: 7 },
      trajectory: { session_id: "session-a", record_id: "assessment", related: true, through: 7 },
      source: { store_id: "store-a", record_id: "assessment", session_id: "session-a", sequence: 7, sha256: "b".repeat(64),
        tool: "loom_record", query: { operation: "query", source_session_id: "session-a", record_id: "assessment" },
        authority: "reference-only; retrieval requires current source permission" }, gaps: [{ code: "partial-scope", detail: "Named subtests only." }] },
  ]
  const branch: EngineeringHistoryView["branches"][number] = { ref: "branch:session", kind: "session", title: "Restore freshness",
    meaning: "observed-session-group", work_ref: null, node_id: null, session_id: "session-a", counts,
    parent_ref: null, child_count: 0, historical_scope: null,
    first_sequence: 4, last_sequence: 7, historical_node: null, gaps: [{ code: "no-work-binding", detail: "No historical Plan binding is established." }],
    expand: { session_id: "session-a", branch_ref: "branch:session", through: 7 } }
  return { format: "loom-engineering-history/v1", scope: { session_id: "session-a" }, store_id: "store-a",
    boundary: { live: true, observed_through: 7, current_through: 9, membership: "append-bound only; not a frozen retrospective population" },
    intent: { title: "Restore freshness", goal: null, meaning: "session-scope", action_revision: null }, intended_plan: null,
    mode: "branch", selection: {}, ancestors: [], related_branches: [],
    connections: { objectives: [], reviews: [], coverage: { objectives_omitted: 0, reviews_omitted: 0, relationships_omitted: 0, page: "summary",
      review_access: "caller-owned only; prepared evaluations excluded", membership: "explicit source associations; not inferred causation" }, gaps: [] },
    navigation: { repeat: { session_id: "session-a", branch_ref: "branch:session", through: 7, limit: 20 },
      next_records: { session_id: "session-a", branch_ref: "branch:session", through: 7, limit: 20, after: 7 },
      next_branches: { session_id: "session-a", branch_ref: "branch:session", through: 7, limit: 20, branch_offset: 1 }, next_connections: null, next_relationships: null },
    totals: counts, branches: [branch], selected_branch: branch, highlights: [records[0]!], records,
    relationships: [{ from: records[1]!.ref, to: records[0]!.ref, kind: "cites-observation", meaning: "authored",
      source_record_id: "assessment", target: "included", qualification: "Citation alone does not establish resolution." }],
    coverage: { ledger: "complete-within-boundary", branch_count: 3, total_branch_count: 3, branches_returned: 1, branches_omitted: 2,
      related_branches_omitted: 0,
      page_limit: 20,
      records_returned: 2, records_omitted: 4, next_after: 7, next_branch_offset: 1, matching_records: 6, matching_branches: 3,
      gaps: [{ code: "native-originals-unavailable", detail: "Native originals require a supported authorized source." }] } }
}

test("dashboard preserves shared identities, authored outcomes, gaps and bounded expansion requests", () => {
  const view = fixture(), html = renderEngineeringHistoryHTML(view)
  expect(html).toContain("Live history read · not a frozen retrospective selection")
  expect(html).toContain("Observed through sequence 7; current sequence at this read: 9")
  expect(html).toContain("Verified outcomes</dt><dd>Unknown")
  expect(html).toContain("Native dispatches</dt><dd>Unknown")
  expect(html).toContain("Reported passes</dt><dd>1")
  expect(html).toContain("Reported reopens</dt><dd>0")
  expect(html).toContain("Observed tool errors</dt><dd>0")
  expect(html).toContain("Reported verdict: pass")
  expect(html).toContain("authored claim; not independently verified")
  expect(html).toContain("Citation alone does not establish resolution.")
  expect(html).toContain("1 of 3 branches included; 2 omitted")
  expect(html).toContain("Returned 2 records; omitted 4")
  expect(html).toContain("native-originals-unavailable")
  expect(html).toContain("Excerpt truncated.")
  for (const record of view.records) {
    expect(html).toContain(record.ref)
    expect(html).toContain(record.source.sha256)
    expect(html).toContain(record.source.record_id)
  }
  expect(html).toContain('"branch_ref": "branch:session"')
  expect(html).toContain('"through": 7')
  expect(html).toContain('"after": 7')
  expect(html).toContain('"branch_offset": 1')
  expect(html.match(/id="branch-1"/g)).toHaveLength(1)
  expect(html.match(/id="record-1"/g)).toHaveLength(1)
  expect(html).toContain('href="#record-1"')
})

test("HTML preserves omitted related-group coverage from real historical definitions", () => {
  const db = new Database(":memory:"), store = new Store(db), author = { session_id: "source", agent: "author" }
  try {
    const action = store.create("Stable work contract", "Preserve revision uncertainty", author)
    for (let revision = 0; revision < 22; revision++) {
      store.savePlan(action.id, revision, [{ id: "task", kind: "task", title: "The same recorded task" }], author)
      if (!revision) store.select(author.session_id, { action_id: action.id, node_id: "task" })
      store.startObservation(author, { phase: "started", tool: "read" })
    }
    const result = store.record(author, { action_id: action.id, node_id: "task" }, { kind: "result", statement: "Authored report without a unique revision" })
    const view = store.engineeringHistory.read({ action_id: action.id, record_id: result.id })
    expect(view.related_branches).toHaveLength(20)
    expect(view.coverage.related_branches_omitted).toBe(2)
    const html = renderEngineeringHistoryHTML(view), markdown = renderEngineeringHistoryMarkdown(view)
    expect(html).toContain("20 related groups included; 2 omitted")
    expect(html).toContain("locate additional eligible groups")
    expect(html).toContain('"related_branches_omitted": 2')
    expect(markdown).toContain('"related_branches_omitted": 2')
  } finally { db.close() }
})

test("dashboard remains navigable with no Plan and distinguishes current intent from historical bindings", () => {
  const view = fixture()
  expect(renderEngineeringHistoryHTML(view)).toContain("No current Plan projection is included in this read. Recorded work remains navigable")
  view.intent = { title: "Correction", goal: "Preserve restore freshness", meaning: "current-authored-action", action_revision: 6 }
  view.intended_plan = { revision: 4, nodes: [{ id: "new-task", kind: "task", title: "Current renamed work" }], nodes_total: 3, nodes_omitted: 2,
    projection: "identity-and-title", read: { tool: "loom_plan", query: { operation: "read", action_id: "action-a", revision: 4 } },
    meaning: "current-intended-structure; not historical execution membership" }
  view.branches[0]!.historical_node = { id: "old-task", kind: "task", title: "Original investigation" }
  const html = renderEngineeringHistoryHTML(view)
  expect(html).toContain("Current intended structure, revision 4")
  expect(html).toContain("current-intended-structure; not historical execution membership")
  expect(html).toContain("Plan node at that revision")
  expect(html).toContain("Original investigation")
  expect(html).toContain("Current renamed work")
  expect(html).toContain("Action revision 6")
  expect(html).toContain("1 of 3 Plan nodes included; 2 omitted")
  expect(html).toContain("Read the exact Plan revision")
})

test("dashboard treats stored prose, identities and links as inert text", () => {
  const view = fixture(), hostile = '</style><script>alert("leak")</script><img src="https://private.invalid/a">\u202e'
  view.intent.title = hostile
  view.intent.goal = hostile
  view.branches[0]!.title = hostile
  view.branches[0]!.ref = hostile
  view.branches[0]!.expand.branch_ref = hostile
  view.records[0]!.title = hostile
  view.records[0]!.excerpt = hostile
  view.records[0]!.source.record_id = hostile
  view.coverage.gaps.push({ code: hostile, detail: hostile })
  const html = renderEngineeringHistoryHTML(view)
  expect(html).not.toContain("<script")
  expect(html).not.toContain("<img")
  expect(html).not.toContain("\u202e")
  expect(html).toContain("&lt;script&gt;")
  expect(html).toContain("\\u202e")
  expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
  for (const href of html.matchAll(/href="([^"]*)"/g)) expect(href[1]!.startsWith("#")).toBe(true)
  expect(html.match(/<style>/g)).toHaveLength(1)
  expect(html.match(/<\/style>/g)).toHaveLength(1)
})

test("projected Plan preserves included parent hierarchy and identifies missing parents without inventing nodes", () => {
  const view = fixture()
  view.intended_plan = { revision: 4, nodes: [
    { id: "parent", kind: "phase", title: "Accepted milestone" },
    { id: "child", kind: "task", parent: "parent", title: "Scoped task" },
    { id: "partial", kind: "task", parent: "not-included", title: "Partial branch" },
  ], nodes_total: 7, nodes_omitted: 4, projection: "identity-and-title",
    read: { tool: "loom_plan", query: { operation: "read", action_id: "action-a", revision: 4 } },
    meaning: "current-intended-structure; not historical execution membership" }
  const html = renderEngineeringHistoryHTML(view)
  expect(html).toContain('Intended parent: <a href="#plan-node-1"><code>parent</code></a>')
  expect(html).toContain('Intended parent: <code>not-included</code> (not included in this projection)')
  expect(html).toContain("3 of 7 Plan nodes included; 4 omitted")
  for (const id of ["plan-node-1", "plan-node-2", "plan-node-3"]) expect(html.match(new RegExp(`id="${id}"`, "g"))).toHaveLength(1)
  expect(html).not.toContain('id="plan-node-4"')
})

test("selected hierarchy preserves parent navigation, exact requests and qualified related groups", () => {
  const view = fixture(), selected = view.selected_branch!
  const parent = { ...selected, ref: "branch:parent", title: "Historical release phase", kind: "historical-node" as const,
    meaning: "historical-plan-structure" as const, child_count: 1,
    expand: { session_id: "session-a", branch_ref: "branch:parent", through: 7 } }
  const child = { ...selected, ref: "branch:child", title: "Recorded message", kind: "message" as const,
    meaning: "observed-message-group" as const, parent_ref: selected.ref,
    expand: { session_id: "session-a", branch_ref: "branch:child", through: 7 } }
  const related = { ...selected, ref: "branch:related", title: "Separate historical binding",
    gaps: [{ code: "same-fingerprint-not-resolution", detail: "The shared fingerprint does not establish resolution." }],
    expand: { session_id: "session-a", branch_ref: "branch:related", through: 7 } }
  selected.parent_ref = parent.ref
  selected.child_count = 1
  view.ancestors = [parent]
  view.branches = [child]
  view.related_branches = [related]
  const html = renderEngineeringHistoryHTML(view), markdown = renderEngineeringHistoryMarkdown(view)
  expect(html).toContain("Path to selected work")
  expect(html).toContain('<details class="card" open><summary id="branch-2">')
  expect(html).toContain('<div class="work-children"><details class="card"><summary id="branch-3">')
  expect(html).toContain('Recorded parent: <a href="#branch-1">')
  expect(html).toContain("Related recorded groups")
  for (const branch of [parent, selected, child, related]) {
    expect(html).toContain(branch.ref)
    expect(markdown).toContain(JSON.stringify(branch.ref))
  }
  expect(html).toContain(related.gaps[0]!.detail)
  expect(markdown).toContain(related.gaps[0]!.detail)
})

test("filtered historical descendants are presented as matching leaves rather than immediate children", () => {
  const db = new Database(":memory:"), store = new Store(db), author = { session_id: "source", agent: "author" }
  try {
    const action = store.create("Nested historical work", "Preserve recorded ancestry during discovery", author)
    store.savePlan(action.id, 0, [
      { id: "phase", kind: "phase", title: "Release phase" },
      { id: "wave", kind: "wave", parent: "phase", title: "Verification wave" },
      { id: "task", kind: "task", parent: "wave", title: "Restore task" },
      { id: "subtask", kind: "subtask", parent: "task", title: "Freshness subtask" },
    ], author)
    store.select(author.session_id, { action_id: action.id, node_id: "subtask" })
    const observation = store.startObservation(author, { phase: "started", tool: "needle-tool" })
    const record = store.engineeringHistory.read({ action_id: action.id, record_id: observation.id })
    const phase = record.ancestors.find(branch => branch.node_id === "phase")!
    const immediate = store.engineeringHistory.read(phase.expand)
    expect(immediate.branches[0]!.node_id).toBe("wave")
    expect(immediate.branches[0]!.parent_ref).toBe(phase.ref)
    expect(renderEngineeringHistoryHTML(immediate)).toContain('<h3>Returned child groups</h3><div class="work-children">')

    const filtered = store.engineeringHistory.read({ ...phase.expand, match: "needle-tool" })
    expect(filtered.mode).toBe("discovery")
    expect(filtered.selected_branch!.ref).toBe(phase.ref)
    expect(filtered.branches).toHaveLength(1)
    const leaf = filtered.branches[0]!
    expect(leaf.node_id).toBe("subtask")
    expect(leaf.parent_ref).not.toBe(phase.ref)
    const html = renderEngineeringHistoryHTML(filtered), markdown = renderEngineeringHistoryMarkdown(filtered)
    expect(html).toContain("Matching leaf groups")
    expect(html).toContain("Matching leaves may be deeper descendants of the selected group.")
    expect(html).not.toContain("Returned child groups")
    expect(html).not.toContain('<div class="work-children">')
    expect(html).toContain(`Recorded parent: <code>${leaf.parent_ref}</code>`)
    expect(markdown).toContain('"matching_leaf_groups": [')
    expect(markdown).not.toContain('"returned_children":')
    const expanded = store.engineeringHistory.read(leaf.expand)
    expect(expanded.ancestors.map(branch => branch.node_id)).toEqual([null, "phase", "wave", "task"])
    const selectedLeaf = store.engineeringHistory.read({ ...leaf.expand, match: "needle-tool" })
    expect(selectedLeaf.branches.map(branch => branch.ref)).toEqual([leaf.ref])
    const leafHTML = renderEngineeringHistoryHTML(selectedLeaf)
    expect(leafHTML).toContain("Matching leaf groups")
    expect(leafHTML).not.toContain("No matching leaf groups are included")
    expect(leafHTML.match(/<span class="summary-title">Freshness subtask<\/span>/g)).toHaveLength(1)
    const noMatch = store.engineeringHistory.read({ ...leaf.expand, match: "absent-tool" })
    expect(noMatch.coverage.matching_records).toBe(0)
    expect(renderEngineeringHistoryHTML(noMatch)).toContain("No matching leaf groups are included")
  } finally { db.close() }
})

test("discovery continuations retain the complete normalized selection and append boundary", () => {
  const view = fixture()
  view.mode = "discovery"
  view.selected_branch = null
  view.selection = { match: "freshness regression", record_kinds: ["qa", "assessment"], verdict: "fail",
    source_session_id: "session-a", node_id: "old-task", plan_revision: 2, has_gaps: true }
  view.navigation = { repeat: { ...view.scope, through: 7, limit: 20, ...view.selection },
    next_records: { ...view.scope, through: 7, limit: 20, ...view.selection, after: 7 },
    next_branches: { ...view.scope, through: 7, limit: 20, ...view.selection, branch_offset: 1 }, next_connections: null, next_relationships: null }
  const html = renderEngineeringHistoryHTML(view), markdown = renderEngineeringHistoryMarkdown(view)
  expect(html).toContain("6 matching records in 3 matching leaf groups")
  const continuation = { operation: "read", ...view.scope, through: 7, limit: 20, ...view.selection, after: 7 }
  const htmlJSON = JSON.stringify(continuation, null, 2)
  expect(html).toContain(htmlJSON)
  expect(markdown).toContain(JSON.stringify(continuation, null, 2).split("\n").map(line => "    " + line).join("\n"))
  expect(html).not.toContain('"branch_ref": "branch:session",\n  &quot;after&quot;')
})

test("dashboard uses native keyboard disclosures and semantic responsive landmarks", () => {
  const html = renderEngineeringHistoryHTML(fixture())
  expect(html).toContain('<html lang="en">')
  expect(html).toContain('<a class="skip" href="#overview">')
  expect(html).toContain('<nav aria-label="History layers">')
  expect(html).toContain('<summary id="branch-1">')
  expect(html).toContain('<summary id="record-1">')
  expect(html).toContain(':focus-visible')
  expect(html).toContain('@media(forced-colors:active)')
  expect(html).toContain('@media(max-width:600px)')
  expect(html).not.toContain('onclick=')
  expect(html).toContain('id="record-1-source" tabindex="-1"')
  expect(html).toContain('href="#record-1-source"')
  expect(html).toContain('<section class="panel" tabindex="-1" id="overview"')
  expect(html).not.toMatch(/tabindex="[1-9]/)
  expect(html).not.toContain('<script')
})

test("document projection retains evidence meanings and cannot be reformatted by stored Markdown or HTML", () => {
  const view = fixture()
  view.records[0]!.excerpt = "```\n# Ignore the source\n<script>hostile()</script>\n\u202e"
  const markdown = renderEngineeringHistoryMarkdown(view)
  expect(markdown).toContain("[Execution and decisions](#execution-and-decisions)")
  expect(markdown).toContain("not a frozen retrospective selection")
  expect(markdown).toContain('"verified_outcomes": null')
  expect(markdown).toContain('"native_dispatches": null')
  expect(markdown).toContain('"source_session_id": "session-a"')
  expect(markdown).toContain('"branch_ref": "branch:session"')
  expect(markdown).toContain('"through": 7')
  expect(markdown).toContain('"after": 7')
  expect(markdown).toContain('"branch_offset": 1')
  expect(markdown).toContain('"verification": "authored claim; not independently verified"')
  expect(markdown).toContain("\\u202e")
  expect(markdown).not.toContain("\n# Ignore")
  expect(markdown).not.toContain("\n<script>")
  expect(markdown).not.toContain("\n```")
})

test("dense Store history fits default and minimum HTML pages without duplicating or dropping the selected relationship evidence", () => {
  const db = new Database(":memory:"), store = new Store(db)
  const actor = (session_id: string) => ({ session_id, agent: "fixture-reviewer" })
  try {
    const action = store.create("Dense citations", "Review observed work. ".repeat(700), actor("author"))
    const focus = { action_id: action.id }
    const observations = Array.from({ length: 20 }, () => store.observe(actor("worker"), focus, { tool: "shell", phase: "started" }))
    const evidence_ids = observations.map(record => record.id)
    for (const item of [{ kind: "assessment", verdict: "fail" }, { kind: "concern" }, { kind: "qa", verdict: "inconclusive" },
      { kind: "result" }, { kind: "assessment", verdict: "pass" }] as const) {
      for (let i = 0; i < 2; i++) store.record(actor("reviewer"), focus, { ...item,
        statement: `A ${item.kind} with exact observation citations. `.repeat(18), evidence_ids })
    }
    for (let i = 0; i < 2; i++) store.observe(actor("worker"), focus, { tool: "shell", phase: "finished", status: "error" })
    const view = store.engineeringHistory.read({ action_id: action.id, limit: 20 }), original = JSON.stringify(view)
    expect(view.highlights).toHaveLength(12)
    expect(view.relationships).toHaveLength(200)
    const html = renderEngineeringHistoryHTML(view)
    expect(Buffer.byteLength(html, "utf8")).toBeLessThanOrEqual(ENGINEERING_HISTORY_LIMITS.responseBytes)
    expect(JSON.stringify(view)).toBe(original)
    expect(html.match(/<li id="relationship-\d+" tabindex="-1">/g)).toHaveLength(view.relationships.length)
    for (const [index, relationship] of view.relationships.entries()) {
      const id = `relationship-${index + 1}`
      const row = html.match(new RegExp(`<li id="${id}" tabindex="-1">([\\s\\S]*?)</li>`))![1]!
      const { qualification, ...identity } = relationship
      for (const value of Object.values(identity)) if (typeof value === "string") expect(row).toContain(value)
      if (relationship.provenance) expect(html).toContain(JSON.stringify(relationship.provenance, null, 2))
      const qualificationNumber = [...new Set(view.relationships.map(item => item.qualification))].indexOf(qualification) + 1
      expect(row).toContain(`href="#qualification-${qualificationNumber}"`)
      expect(html).toContain(`<dt id="qualification-${qualificationNumber}" tabindex="-1">Qualification ${qualificationNumber}</dt><dd>${qualification}</dd>`)
      expect(html.match(new RegExp(`id="${id}"`, "g"))).toHaveLength(1)
      expect(html).toContain(`href="#${id}"`)
    }
    for (const record of view.highlights) {
      expect(html).toContain(record.ref)
      expect(html).toContain(record.source.sha256)
    }
    expect(html).toContain("20 included relationships:")
    expect(html).toContain("Full identities and qualifications appear once")
    const minimum = store.engineeringHistory.read({ action_id: action.id, limit: 1 })
    const minimalHTML = renderEngineeringHistoryHTML(minimum)
    expect(Buffer.byteLength(minimalHTML, "utf8")).toBeLessThanOrEqual(ENGINEERING_HISTORY_LIMITS.responseBytes)
    expect(minimalHTML.match(/<li id="relationship-\d+" tabindex="-1">/g)).toHaveLength(minimum.relationships.length)
    expect(minimum.relationships.length).toBeGreaterThan(0)

    // Escaping expands legal prose. The minimum shared page must remain useful
    // even when its Action goal and representative excerpts need HTML entities.
    store.update(action.id, action.revision, { goal: "&".repeat(16000) })
    for (const item of [{ kind: "assessment", verdict: "fail" }, { kind: "concern" }, { kind: "qa", verdict: "inconclusive" },
      { kind: "result" }, { kind: "assessment", verdict: "pass" }] as const)
      store.record(actor("reviewer"), focus, { ...item, statement: '"<&'.repeat(200), evidence_ids })
    const escaped = store.engineeringHistory.read({ action_id: action.id, limit: 1 })
    const escapedHTML = renderEngineeringHistoryHTML(escaped)
    expect(Buffer.byteLength(escapedHTML, "utf8")).toBeLessThanOrEqual(ENGINEERING_HISTORY_LIMITS.responseBytes)
    expect(escapedHTML).toContain("&amp;".repeat(16000))
    expect(escapedHTML).toContain('"&lt;&amp;')
    expect(escapedHTML).toContain("Preview shortened; the complete projected excerpt is in the record disclosure.")
    for (const record of escaped.highlights) if (record.excerpt !== null)
      expect(escapedHTML).toContain(record.excerpt.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!))
    expect(escapedHTML.match(/<li id="relationship-\d+" tabindex="-1">/g)).toHaveLength(escaped.relationships.length)
  } finally { db.close() }
})
