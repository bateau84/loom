import { expect, test } from "bun:test"
import { registeredLoom } from "./helpers/registered-loom.js"
import { engineeringTrajectoryFixture } from "./helpers/engineering-trajectory-fixture.js"

test("history returns callable requests for records, branches, connections and every continuation", async () => {
  const fixture = await engineeringTrajectoryFixture({ records: 240 })
  const f = fixture.f, session = fixture.sessions.reader
  const invoke = async (tool: string, input: unknown) => (await f.invoke(tool, input, session)).result
  try {
    const view = await invoke("history", { operation: "read", action_id: fixture.action.id, match: "restore", limit: 2 })
    const requests = [view.navigation.repeat, ...Object.values(view.navigation).filter(Boolean),
      ...view.branches.map((branch: any) => branch.expand),
      ...view.records.flatMap((record: any) => [record.expand, record.trajectory])]
    for (const request of requests) {
      expect(request).toHaveProperty("operation", "read")
      const read = await invoke("history", request)
      expect(read.boundary.observed_through).toBe(view.boundary.observed_through)
      expect(read.boundary.owner_version).toBe(view.boundary.owner_version)
    }
    const connected = await invoke("history", { operation: "read", objective_id: fixture.objective.id, limit: 2 })
    const connectionRequests = [
      ...connected.connections.objectives.flatMap((item: any) => [item.expand, item.details]),
      ...connected.connections.reviews.map((item: any) => item.details),
      connected.navigation.next_connections, connected.navigation.next_relationships,
    ].filter(Boolean)
    expect(connectionRequests.length).toBeGreaterThan(0)
    for (const request of connectionRequests) {
      expect(request).toHaveProperty("operation", "read")
      const page = await invoke("history", request)
      if (page.connections.context) {
        expect(page.connections.context.read).toHaveProperty("operation", "read")
        expect((await invoke("history", page.connections.context.read)).boundary).toEqual(connected.boundary)
      }
    }
    // The original reader request is already complete and must remain unchanged.
    const original = connected.records[0].source
    expect(original.query.operation).toBe("query")
    const record = await invoke("record", original.query)
    expect(record.items[0].id).toBe(original.record_id)
    expect(record.items[0]).not.toHaveProperty("navigation")
    expect(f.sessionCreates).toEqual([])
    expect(f.sessionPrompts).toEqual([])
  } finally { await fixture.close() }
})

test("objective readers return complete requests and empty exact-source lookup explains the prerequisite", async () => {
  const f = await registeredLoom()
  const invoke = async (tool: string, input: unknown) => (await f.invoke(tool, input)).result
  try {
    const source = await invoke("record", { operation: "add", session_only: true, kind: "claim", statement: "One original engineering request" })
    let first: any
    for (let i = 0; i < 21; i++) {
      const item = await invoke("objective", { operation: "create", source_type: "ledger-record", source_id: source.id,
        label: `Explicit fixture unit ${i}`, unit_key: `unit-${i}` })
      first ??= item
    }
    for (const input of [{ operation: "list" }, { operation: "find", source_type: "ledger-record", source_id: source.id }]) {
      const page = await invoke("objective", input)
      expect(page.items).toHaveLength(20)
      const second = await invoke("objective", page.navigation.next)
      expect(second.items).toHaveLength(1)
      expect(second.navigation.next).toBeNull()
    }
    for (let i = 0; i < 3; i++) {
      const record = await invoke("record", { operation: "add", session_only: true, kind: "result", statement: `Attributed result ${i}` })
      await invoke("objective", { operation: "link", objective_id: first.id, phase: "coordination",
        source_type: "ledger-record", source_id: record.id, note: `Distinct attributed association ${i}` })
    }
    const links = await invoke("objective", { operation: "read", objective_id: first.id, limit: 1 })
    expect(links.navigation.next).toMatchObject({ operation: "read", objective_id: first.id, limit: 1 })
    const next = await invoke("objective", links.navigation.next)
    expect(next.snapshot_max_sequence).toBe(links.snapshot_max_sequence)
    expect(next.entries[0].sequence).not.toBe(links.entries[0].sequence)
    const missing = await invoke("objective", { operation: "find", source_type: "ledger-record", source_id: "not-an-authored-source" })
    expect(missing.items).toEqual([])
    expect(missing.navigation.next).toBeNull()
    for (const text of ["exact source", "not a text search", "If authorized", "result.id", "missing prerequisite"])
      expect(missing.guidance).toContain(text)
    expect((await invoke("objective", { operation: "list" })).items).toHaveLength(20)
  } finally { await f.close() }
})
