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
    by_kind: { concern: 1, assessment: 1 } }
  const records: EngineeringHistoryView["records"] = [
    { ref: "record:concern", branch_ref: "branch:session", kind: "concern", sequence: 4,
      session_id: "session-a", agent: "reviewer", created_at: "2026-11-25T10:00:00Z", meaning: "authored",
      title: "Initial coarse failure", excerpt: "The original failure remains unexplained.", excerpt_truncated: false,
      verdict: null, verification: "authored claim; not independently verified", work_ref: null, observation: null,
      source: { store_id: "store-a", record_id: "concern", session_id: "session-a", sequence: 4, sha256: "a".repeat(64),
        tool: "loom_record", query: { operation: "query", source_session_id: "session-a", record_id: "concern" },
        authority: "reference-only; retrieval requires current source permission" }, gaps: [] },
    { ref: "record:assessment", branch_ref: "branch:session", kind: "assessment", sequence: 7,
      session_id: "session-a", agent: "reviewer", created_at: "2026-11-25T10:30:00Z", meaning: "authored",
      title: "Corrected-head partial verification", excerpt: "Both named subtests pass on the corrected head; suite coverage is separate.", excerpt_truncated: true,
      verdict: "pass", verification: "authored claim; not independently verified", work_ref: null, observation: null,
      source: { store_id: "store-a", record_id: "assessment", session_id: "session-a", sequence: 7, sha256: "b".repeat(64),
        tool: "loom_record", query: { operation: "query", source_session_id: "session-a", record_id: "assessment" },
        authority: "reference-only; retrieval requires current source permission" }, gaps: [{ code: "partial-scope", detail: "Named subtests only." }] },
  ]
  const branch: EngineeringHistoryView["branches"][number] = { ref: "branch:session", kind: "session", title: "Restore freshness",
    meaning: "observed-session-group", work_ref: null, node_id: null, session_id: "session-a", counts,
    first_sequence: 4, last_sequence: 7, historical_node: null, gaps: [{ code: "no-work-binding", detail: "No historical Plan binding is established." }],
    expand: { session_id: "session-a", branch_ref: "branch:session", through: 7 } }
  return { format: "loom-engineering-history/v1", scope: { session_id: "session-a" }, store_id: "store-a",
    boundary: { live: true, observed_through: 7, current_through: 9, membership: "append-bound only; not a frozen retrospective population" },
    intent: { title: "Restore freshness", goal: null, meaning: "session-scope", action_revision: null }, intended_plan: null,
    totals: counts, branches: [branch], selected_branch: branch, highlights: [records[0]!], records,
    relationships: [{ from: records[1]!.ref, to: records[0]!.ref, kind: "cites-observation", meaning: "authored",
      source_record_id: "assessment", target: "included", qualification: "Citation alone does not establish resolution." }],
    coverage: { ledger: "complete-within-boundary", branch_count: 3, branches_returned: 1, branches_omitted: 2,
      records_returned: 2, records_omitted: 4, next_after: 7, next_branch_offset: 1,
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
  expect(html).toContain('&quot;branch_ref&quot;: &quot;branch:session&quot;')
  expect(html).toContain('&quot;through&quot;: 7')
  expect(html).toContain('&quot;after&quot;: 7')
  expect(html).toContain('&quot;branch_offset&quot;: 1')
  expect(html.match(/id="branch-1"/g)).toHaveLength(1)
  expect(html.match(/id="record-1"/g)).toHaveLength(1)
  expect(html).toContain('href="#record-1"')
})

test("dashboard remains navigable with no Plan and distinguishes current intent from historical bindings", () => {
  const view = fixture()
  expect(renderEngineeringHistoryHTML(view)).toContain("No Plan is included in this scope. Recorded work remains navigable")
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
  expect(html).not.toContain('tabindex="-1"')
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
    expect(html.match(/<li id="relationship-\d+">/g)).toHaveLength(view.relationships.length)
    for (const [index, relationship] of view.relationships.entries()) {
      const id = `relationship-${index + 1}`
      const row = html.match(new RegExp(`<li id="${id}">([\\s\\S]*?)</li>`))![1]!
      for (const value of Object.values(relationship)) expect(row).toContain(value)
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
    expect(minimalHTML.match(/<li id="relationship-\d+">/g)).toHaveLength(minimum.relationships.length)
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
    expect(escapedHTML).toContain("&quot;&lt;&amp;")
    expect(escapedHTML.match(/<li id="relationship-\d+">/g)).toHaveLength(escaped.relationships.length)
  } finally { db.close() }
})
