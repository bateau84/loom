import { expect, test } from "bun:test"
import type { EngineeringHistoryView } from "../src/engineering-history.js"
import { engineeringTrajectoryFixture } from "./helpers/engineering-trajectory-fixture.js"

test("a pending recheck retains its exact mandate before it produces evidence", async () => {
  const fixture = await engineeringTrajectoryFixture({ records: 240 })
  try {
    const pending = { ...fixture.reviews.scoped, request_id: "pending-scoped-recheck",
      members: fixture.reviews.scoped.members.map(member => ({ ...member, producing_attempt_refs: [] })) }
    await fixture.f.invoke("review", { operation: "freeze", request: pending }, fixture.sessions.reader)
    const original = (await fixture.f.invoke("review", { operation: "read", request_id: pending.request_id }, fixture.sessions.reader)).result
    const view = (await fixture.f.invoke("history", { operation: "read", action_id: fixture.action.id,
      record_id: fixture.records.finding.id, related: true, limit: 50 }, fixture.sessions.reader)).result as EngineeringHistoryView
    const group = view.connections.reviews.find(item => item.request.request_id === pending.request_id)!
    expect(group).toBeDefined()
    expect(group.request).toEqual({ ...original.request, members: original.members })
    expect(group.request.members[0]!.work_ref).toEqual(fixture.work.corrected)
    expect(group.request.mandate.exclusions).toContain("complete issue 182 release acceptance")
    expect(group.relationships).toEqual([])
    expect(group.relationships_omitted).toBe(0)
    expect(view.connections.coverage.reviews_omitted).toBe(0)
    expect(view.connections.reviews).toHaveLength(3)
    expect(view.relationships.some(edge => edge.from === group.ref && edge.kind === "requested-recheck-target"
      && edge.source_record_id === fixture.records.correctionReport.id)).toBe(true)
    expect(view.relationships.some(edge => edge.from === group.ref && edge.kind === "requested-recheck"
      && edge.meaning === "authored")).toBe(true)
    expect(view.totals.verified_outcomes).toBeNull()
    expect(fixture.f.sessionPrompts).toEqual([])
  } finally { await fixture.close() }
})
