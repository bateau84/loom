import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { EngineeringHistoryQuery, EngineeringHistoryRelationship, EngineeringHistoryView } from "../src/engineering-history.js"
import { unplannedEngineeringTrajectoryFixture } from "./helpers/engineering-trajectory-fixture.js"

type Fixture = Awaited<ReturnType<typeof unplannedEngineeringTrajectoryFixture>>
const ids = (view: EngineeringHistoryView) => view.records.map(record => record.source.record_id)
const sorted = (values: Iterable<string>) => [...values].sort()
function originalsUnchanged(fixture: Fixture) {
  const rows = fixture.db.query("SELECT id,data FROM ledger").all() as Array<{ id: string; data: string }>
  expect(rows).toHaveLength(fixture.totalRecords)
  expect(rows.every(row => fixture.originalSnapshot[row.id] === row.data)).toBe(true)
}

test("large unplanned overlapping objectives retain selective shared-evidence spillover and exact original scope", async () => {
  const hashFiles = async (paths: string[]) => Object.fromEntries(await Promise.all(paths.map(async path =>
    [path, createHash("sha256").update(await readFile(path)).digest("hex") ])))
  const source_sha256 = await hashFiles(["src/engineering-history.ts", "src/engineering-trajectories.ts", "src/objectives.ts", "src/review-requests.ts", "src/plugin.ts", "src/engineering-history-dashboard.ts"])
  const qualification_sha256 = await hashFiles(["tests/helpers/registered-loom.ts", "tests/helpers/engineering-trajectory-fixture.ts", "tests/engineering-history-unplanned-native.test.ts"])
  const fixture = await unplannedEngineeringTrajectoryFixture({ mode: "connected" })
  const steps: Array<{ kind: string; query: EngineeringHistoryQuery; bytes: number; elapsed_ms: number; sha256: string }> = []
  const read = async (query: EngineeringHistoryQuery, kind: string) => {
    const started = performance.now()
    const response = await fixture.f.tools.get("history").execute({ operation: "read", ...query }, {
      sessionID: fixture.sessions.reader, agent: "author", messageID: "unplanned-qualification", id: `read-${steps.length}`, signal: new AbortController().signal,
    })
    const bytes = Buffer.byteLength(response.content, "utf8")
    expect(bytes).toBeLessThanOrEqual(262144)
    steps.push({ kind, query, bytes, elapsed_ms: performance.now() - started, sha256: createHash("sha256").update(response.content).digest("hex") })
    return JSON.parse(response.content).result as EngineeringHistoryView
  }
  try {
    const discovery = await read({ action_id: fixture.action.id, match: fixture.search, limit: 10 }, "discovery")
    expect(discovery.totals.records).toBe(24000)
    expect(ids(discovery)).toEqual([fixture.records.finding.id])
    const first = await read(discovery.records[0]!.trajectory, "records")
    expect(first.totals.records).toBe(260)
    expect(first.intended_plan).toBeNull()
    const objective = await read({ objective_id: fixture.objectives[0]!.id, related: true, limit: 50 }, "objective")
    const objectiveExpected = [...fixture.originals, ...fixture.chains.slice(0, 2).flatMap(chain => [chain[0]!, chain[1]!, chain[39]!])]
    expect(sorted(ids(objective))).toEqual(sorted(objectiveExpected.map(record => record.id)))
    // A relationship appended during this read must wait for a fresh boundary,
    // including when later pages use the independent owner/detail cursors.
    await fixture.f.invoke("objective", { operation: "link", objective_id: fixture.objectives[0]!.id, phase: "coordination",
      source_type: "ledger-record", source_id: fixture.unrelated.id, confidence: "uncertain",
      note: "Late attributed candidate; not part of the previously selected append boundary." }, fixture.sessions.reader)
    const groups = new Map<string, EngineeringHistoryQuery>()
    const reviews = new Set<string>(), relationshipIDs = new Set<string>(), edges: EngineeringHistoryRelationship[] = []
    const edgeKey = (edge: EngineeringHistoryRelationship) => JSON.stringify([edge.from, edge.to, edge.kind, edge.provenance?.owner, edge.provenance?.id])
    const collect = (page: EngineeringHistoryView) => {
      for (const group of page.connections.objectives) groups.set(group.ref, group.details)
      for (const group of page.connections.reviews) {
        reviews.add(group.request.request_id); groups.set(group.ref, group.details)
        for (const relation of group.relationships) relationshipIDs.add(relation.id)
      }
    }
    let ownerPages = 0, edgePages = 0, detailPages = 0
    const completePage = async (page: EngineeringHistoryView) => {
      collect(page)
      const pageEdges = page.relationships.map(edgeKey)
      edges.push(...page.relationships)
      let connection = page.navigation.next_connections
      while (connection) {
        const extra = await read(connection, "owner-groups"); ownerPages++
        expect(extra.mode).toBe("connections")
        expect(extra.records).toEqual([]); expect(extra.highlights).toEqual([]); expect(extra.branches).toEqual([])
        expect(extra.connections.context?.read).toEqual(page.navigation.repeat)
        expect(extra.boundary.owners).toEqual(first.boundary.owners)
        collect(extra); connection = extra.navigation.next_connections
      }
      let relationship = page.navigation.next_relationships
      while (relationship) {
        const extra = await read(relationship, "relationships"); edgePages++
        expect(extra.mode).toBe("connections")
        expect(extra.records).toEqual([]); expect(extra.highlights).toEqual([]); expect(extra.branches).toEqual([])
        expect(extra.connections.context?.read).toEqual(page.navigation.repeat)
        expect(extra.boundary.owners).toEqual(first.boundary.owners)
        pageEdges.push(...extra.relationships.map(edgeKey)); edges.push(...extra.relationships)
        relationship = extra.navigation.next_relationships
      }
      expect(pageEdges).toHaveLength(new Set(pageEdges).size)
    }
    await completePage(first)
    const found = ids(first)
    let next = first.navigation.next_records
    while (next) {
      expect(next.owner_boundary).toEqual(first.boundary.owners)
      expect(next.owner_version).toBe(first.boundary.owner_version)
      expect(next.through).toBe(24000)
      expect(next.record_id).toBe(fixture.records.finding.id)
      expect(next.limit).toBe(10)
      const page = await read(next, "records")
      expect(page.records.every(record => record.work_ref === null)).toBe(true)
      await completePage(page)
      found.push(...ids(page)); next = page.navigation.next_records
    }
    expect(found).toHaveLength(new Set(found).size)
    expect(sorted(found)).toEqual(sorted(fixture.connectedRecords.map(record => record.id)))
    expect(found).not.toContain(fixture.unrelated.id)
    expect(sorted(reviews)).toEqual(sorted(fixture.reviewIDs))
    expect(groups.size).toBe(27)
    let renderedOwner: EngineeringHistoryView | undefined
    for (const query of groups.values()) {
      let detail: EngineeringHistoryQuery | null = query
      const localRelations: string[] = [], localLinks: number[] = []
      while (detail) {
        const page = await read(detail, "owner-details"); detailPages++
        expect(page.mode).toBe("connections"); expect(page.records).toEqual([])
        expect(page.boundary.owners).toEqual(first.boundary.owners)
        for (const group of page.connections.objectives) {
          localLinks.push(...group.links.map(link => link.sequence))
          expect(group.links.some(link => link.source_id === fixture.unrelated.id)).toBe(false)
        }
        for (const group of page.connections.reviews) {
          for (const relation of group.relationships) { localRelations.push(relation.id); relationshipIDs.add(relation.id) }
          if (group.request.request_id === fixture.reviewIDs[0] && !renderedOwner) renderedOwner = page
          expect(group.request.members.every(member => member.work_ref === null)).toBe(true)
          expect(group.relationships.every(relation => relation.review_binding.status === "unknown")).toBe(true)
        }
        detail = page.navigation.next_connections
      }
      expect(localRelations).toHaveLength(new Set(localRelations).size)
      expect(localLinks).toHaveLength(new Set(localLinks).size)
    }
    expect(sorted(relationshipIDs)).toEqual(sorted(fixture.relationshipIDs))
    for (const id of fixture.relationshipIDs) expect(edges.some(edge => edge.provenance?.owner === "review" && edge.provenance.id === id)).toBe(true)
    for (const group of fixture.chains.slice(0, 6)) for (const source of group.slice(2))
      expect(edges.some(edge => edge.source_record_id === source.id && edge.kind === "cites-observation" && edge.to.endsWith(":" + group[1]!.id))).toBe(true)
    expect(ownerPages).toBeGreaterThan(0); expect(edgePages).toBeGreaterThan(0); expect(detailPages).toBeGreaterThan(groups.size)
    if (!renderedOwner) throw new Error("No bounded owner detail was available for shared presentation qualification")
    const rendering: Array<{ format: string; bytes: number }> = []
    for (const response_format of ["json", "markdown", "html"]) {
      const output = await fixture.f.tools.get("history").execute({ operation: "read", ...renderedOwner.navigation.repeat, response_format }, {
        sessionID: fixture.sessions.reader, agent: "author", messageID: "unplanned-rendering", id: response_format, signal: new AbortController().signal,
      })
      const bytes = Buffer.byteLength(output.content, "utf8"); rendering.push({ format: response_format, bytes })
      expect(bytes).toBeLessThanOrEqual(262144)
      expect(output.content).toContain("connection_cursor")
      for (const relation of renderedOwner.connections.reviews.flatMap(group => group.relationships)) expect(output.content).toContain(relation.id)
      expect(output.content).not.toContain("SYNTHETIC_PRIVATE_COMMAND")
      expect(output.content).not.toContain("SYNTHETIC_EXPORTER_OUTPUT")
    }
    const fresh = await read({ action_id: fixture.action.id, record_id: fixture.records.finding.id, related: true, limit: 1 }, "fresh-boundary")
    expect(fresh.totals.records).toBe(261)
    // The Action-root component crosses three objectives through explicitly
    // shared evidence. The separately requested objective was narrower; reuse
    // of Sessions and revision labels did not supply those associations.
    expect(objective.totals.verified_outcomes).toBeNull()
    expect(objective.totals.native_dispatches).toBeNull()
    expect(fixture.store.plan(fixture.action.id).nodes).toEqual([])
    originalsUnchanged(fixture)
    expect(fixture.f.sessionCreates).toEqual([])
    expect(fixture.f.sessionPrompts).toEqual([])
    const report = { format: "loom-unplanned-connected-history-qualification/v1", records: 24000,
      source_head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), source_sha256, qualification_sha256,
      runtime: { bun: Bun.version, node: process.versions.node },
      surrounding_evidence_groups: fixture.chains.length, reused_sessions: 16,
      objective_count: fixture.objectives.length, review_count: fixture.reviewIDs.length, review_relationship_count: fixture.relationshipIDs.length,
      core_trajectory_originals: fixture.originals.length, selected_action_component: found.length,
      shared_evidence_spillover: found.length - fixture.originals.length, selected_objective_component: objectiveExpected.length,
      discovered_reviews: reviews.size, discovered_review_relationships: relationshipIDs.size,
      owner_group_pages: ownerPages, relationship_pages: edgePages, owner_detail_pages: detailPages,
      concurrent_owner_appends: 1, pinned_continuations_exclude_late_association: true, rendering,
      selection_correct: true, full_action_enumeration: false, originals_unchanged: true,
      calls: steps.length, returned_utf8_bytes: steps.reduce((sum, step) => sum + step.bytes, 0),
      local_callback_ms: steps.reduce((sum, step) => sum + step.elapsed_ms, 0), steps,
      qualification: "Controlled registered callbacks with real source owners and simulated native host. Explicitly overlapping associations are fixture prerequisites for navigation. No unfamiliar-investigator or private operator-case claim; no inference that every connected record answers the core question." }
    if (process.env.LOOM_HISTORY_MEASURE_DIR) {
      await mkdir(process.env.LOOM_HISTORY_MEASURE_DIR, { recursive: true })
      await writeFile(join(process.env.LOOM_HISTORY_MEASURE_DIR, "unplanned-connected.json"), JSON.stringify(report, null, 2) + "\n")
    }
  } finally { await fixture.close() }
}, 180000)

test("sparse unplanned history requires explicit retrospective authoring before the full trajectory exists", async () => {
  const fixture = await unplannedEngineeringTrajectoryFixture({ mode: "sparse", records: 500 })
  const invoke = async (tool: string, input: unknown) => (await fixture.f.invoke(tool, input, fixture.sessions.reader)).result
  try {
    expect(fixture.objectives).toEqual([])
    expect(fixture.reviewIDs).toEqual([])
    const discovery = await invoke("history", { operation: "read", action_id: fixture.action.id, match: fixture.search }) as EngineeringHistoryView
    const before = await invoke("history", { operation: "read", ...discovery.records[0]!.trajectory }) as EngineeringHistoryView
    expect(ids(before)).toEqual([fixture.records.finding.id])
    expect(before.connections.objectives).toEqual([])
    expect(before.connections.reviews).toEqual([])
    // This is a mechanics discriminator, not the unfamiliar investigation. Its
    // oracle IDs are deliberately withheld from that separate participant.
    const objective = await invoke("objective", { operation: "create", source_type: "ledger-record", source_id: fixture.records.request.id,
      label: "Retrospective investigation of the restored-index anomaly" })
    const finding = await invoke("objective", { operation: "link", objective_id: objective.id, phase: "coordination", source_type: "ledger-record", source_id: fixture.records.finding.id,
      note: "Retrospective association authored after original history inspection." })
    const correction = await invoke("objective", { operation: "link", objective_id: objective.id, phase: "coordination", source_type: "ledger-record", source_id: fixture.records.correction.id,
      relation: "addresses", related_sequence: finding.sequence, note: "Attributed correction claim; not proof of historical cause or native dispatch." })
    await invoke("objective", { operation: "link", objective_id: objective.id, phase: "coordination", source_type: "ledger-record", source_id: fixture.records.recheck.id,
      relation: "assesses", related_sequence: correction.sequence, note: "Only the b2 test correction was assessed; complete release acceptance remains open." })
    for (const record of fixture.originals.filter(record => ![fixture.records.finding.id, fixture.records.correction.id, fixture.records.recheck.id].includes(record.id)))
      await invoke("objective", { operation: "link", objective_id: objective.id, phase: "coordination", source_type: "ledger-record", source_id: record.id,
        note: "Retrospective attributed association; original source and uncertainty retained." })
    const after = await invoke("history", { operation: "read", action_id: fixture.action.id, record_id: fixture.records.finding.id, related: true, limit: 50 }) as EngineeringHistoryView
    expect(sorted(ids(after))).toEqual(sorted(fixture.originals.map(record => record.id)))
    expect(after.connections.reviews).toEqual([])
    expect(after.relationships.map(relation => relation.kind)).toEqual(expect.arrayContaining(["addresses", "assesses", "paired-observation"]))
    expect(after.records.every(record => record.work_ref === null)).toBe(true)
    expect(after.totals.native_dispatches).toBeNull()
    expect(after.totals.verified_outcomes).toBeNull()
    originalsUnchanged(fixture)
  } finally { await fixture.close() }
})
