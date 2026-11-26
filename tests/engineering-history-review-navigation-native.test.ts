import { expect, test } from "bun:test"
import type { EngineeringHistoryView } from "../src/engineering-history.js"
import { canonical } from "../src/model.js"
import { workReference } from "../src/collaboration.js"
import { engineeringTrajectoryFixture } from "./helpers/engineering-trajectory-fixture.js"

test("pending reviews follow frozen prior-review membership without a separate recheck or evidence", async () => {
  const f = await engineeringTrajectoryFixture({ records: 240 })
  try {
    const pending = { ...f.reviews.original, request_id: "pending-prior-only",
      members: f.reviews.original.members.map(member => ({ ...member, work_ref: null,
        producing_attempt_refs: [], artifact_refs: [], prior_review_request_id: f.reviews.original.request_id })), rechecks: [] }
    await f.f.invoke("review", { operation: "freeze", request: pending }, f.sessions.reader)
    const later = { ...pending, request_id: "pending-prior-chain",
      members: pending.members.map(member => ({ ...member, prior_review_request_id: pending.request_id })) }
    await f.f.invoke("review", { operation: "freeze", request: later }, f.sessions.reader)
    const view = (await f.f.invoke("history", { operation: "read", action_id: f.action.id,
      record_id: f.records.finding.id, related: true, limit: 50 }, f.sessions.reader)).result as EngineeringHistoryView
    expect(view.connections.reviews.map(group => group.request.request_id)).toEqual([
      f.reviews.original.request_id, f.reviews.scoped.request_id, pending.request_id, later.request_id,
    ])
    for (const request of [pending, later]) {
      const group = view.connections.reviews.find(group => group.request.request_id === request.request_id)!
      expect(canonical(group.request.members)).toBe(canonical(request.members))
      expect(group.relationships).toEqual([])
      expect(group.qualification.native_review_binding.status).toBe("unknown")
      expect(view.relationships).toContainEqual(expect.objectContaining({ from: group.ref,
        kind: "requested-prior-review", meaning: "authored", source_record_id: null }))
    }
    expect(f.f.sessionPrompts).toEqual([])
  } finally { await f.close() }
})

test("pending exact WorkRef scope is navigable without claiming actual inspection", async () => {
  const f = await engineeringTrajectoryFixture({ records: 240 })
  try {
    const pending = { ...f.reviews.scoped, request_id: "pending-work-only",
      members: f.reviews.scoped.members.map(member => ({ ...member, producing_attempt_refs: [],
        prior_review_request_id: null })), rechecks: [] }
    await f.f.invoke("review", { operation: "freeze", request: pending }, f.sessions.reader)
    const earlier = { ...pending, request_id: "different-historical-work",
      members: pending.members.map(member => ({ ...member, work_ref: f.work.original })) }
    await f.f.invoke("review", { operation: "freeze", request: earlier }, f.sessions.reader)
    const view = (await f.f.invoke("history", { operation: "read", action_id: f.action.id,
      record_id: f.observations.afterIndex.finish.id, limit: 50 }, f.sessions.reader)).result as EngineeringHistoryView
    const group = view.connections.reviews.find(group => group.request.request_id === pending.request_id)
    expect(group).toBeDefined()
    expect(group!.relationships).toEqual([])
    expect(group!.qualification.native_review_binding.status).toBe("unknown")
    expect(view.relationships).toContainEqual(expect.objectContaining({ from: group!.ref,
      kind: "requested-work-member", meaning: "authored", source_record_id: f.observations.afterIndex.finish.id }))
    expect(view.connections.reviews.some(group => group.request.request_id === earlier.request_id)).toBe(false)
    expect(view.totals.verified_outcomes).toBeNull()
  } finally { await f.close() }
})

test("high review fan-out supplies independent bounded discovery before any IDs are preknown", async () => {
  const f = await engineeringTrajectoryFixture({ records: 240 })
  try {
    for (let index = 0; index < 8; index++) {
      const request = { ...f.reviews.original, request_id: `fanout-review-${index}`,
        members: f.reviews.original.members.map(member => ({ ...member, work_ref: null,
          producing_attempt_refs: [], prior_review_request_id: null })), rechecks: [] }
      await f.f.invoke("review", { operation: "freeze", request }, f.sessions.reader)
      await f.f.invoke("review", { operation: "relate", request_id: request.request_id,
        relationship: "finding", source_record_id: f.records.initialInterpretation.id,
        member_ids: [request.members[0]!.member_id] }, f.sessions.reader)
    }
    const view = (await f.f.invoke("history", { operation: "read", action_id: f.action.id,
      record_id: f.records.initialInterpretation.id, limit: 1 }, f.sessions.reader)).result as EngineeringHistoryView
    expect(view.connections.coverage.reviews_omitted).toBeGreaterThan(5)
    expect(view.navigation).toHaveProperty("next_connections", expect.anything())
    expect(view.connections.coverage.relationships_omitted).toBeGreaterThan(0)
    expect(view.navigation).toHaveProperty("next_relationships", expect.anything())
  } finally { await f.close() }
})

test("Action overview discovers pending requested work without a ledger counterpart through bounded groups", async () => {
  const f = await engineeringTrajectoryFixture({ records: 240 })
  try {
    const work = workReference(f.store.action(f.action.id), f.store.plan(f.action.id), "broader")
    const pendingIDs = new Set<string>()
    for (let index = 0; index < 7; index++) {
      const request = { ...f.reviews.scoped, request_id: `pending-no-ledger-${index}`,
        members: f.reviews.scoped.members.map(member => ({ ...member, work_ref: work,
          producing_attempt_refs: [], prior_review_request_id: null })), rechecks: [] }
      await f.f.invoke("review", { operation: "freeze", request }, f.sessions.reader)
      pendingIDs.add(request.request_id)
    }
    const first = (await f.f.invoke("history", { operation: "read", action_id: f.action.id, limit: 1 }, f.sessions.reader)).result as EngineeringHistoryView
    const requestIDs: string[] = []
    let page = first
    let pages = 0
    while (true) {
      expect(++pages).toBeLessThanOrEqual(9)
      expect(page.connections.gaps.some(gap => gap.code === "review-requested-action-scope")).toBe(true)
      for (const group of page.connections.reviews) {
        requestIDs.push(group.request.request_id)
        if (!pendingIDs.has(group.request.request_id)) continue
        expect(group.relationships).toEqual([])
        expect(group.qualification.native_review_binding.status).toBe("unknown")
        expect(page.relationships.some(edge => edge.from === group.ref || edge.to === group.ref)).toBe(false)
      }
      if (!page.navigation.next_connections) break
      page = (await f.f.invoke("history", { operation: "read", ...page.navigation.next_connections }, f.sessions.reader)).result as EngineeringHistoryView
      expect(page.mode).toBe("connections")
      expect(page.records).toEqual([]); expect(page.highlights).toEqual([])
      expect(page.connections.context!.read).toEqual(first.navigation.repeat)
    }
    expect(requestIDs).toHaveLength(9)
    expect(new Set(requestIDs)).toEqual(new Set([f.reviews.original.request_id, f.reviews.scoped.request_id, ...pendingIDs]))
    for (const selection of [{ record_id: f.records.finding.id }, { record_id: f.records.finding.id, related: true }, { match: "restore" }]) {
      const focused = (await f.f.invoke("history", { operation: "read", action_id: f.action.id, ...selection, limit: 50 }, f.sessions.reader)).result as EngineeringHistoryView
      expect(focused.connections.reviews.some(group => pendingIDs.has(group.request.request_id))).toBe(false)
      expect(focused.connections.gaps.some(gap => gap.code === "review-requested-action-scope")).toBe(false)
    }
    const other = (await f.f.invoke("history", { operation: "read", action_id: f.action.id, limit: 50 }, "other-reader")).result as EngineeringHistoryView
    expect(other.connections.reviews).toEqual([])
  } finally { await f.close() }
})

test("frozen requested descendants remain navigable after the current Plan changes", async () => {
  const f = await engineeringTrajectoryFixture({ records: 240 })
  try {
    const phase = workReference(f.store.action(f.action.id), f.store.plan(f.action.id), "release")
    const pending = { ...f.reviews.scoped, request_id: "pending-frozen-phase",
      members: f.reviews.scoped.members.map(member => ({ ...member, work_ref: phase,
        producing_attempt_refs: [], prior_review_request_id: null })), rechecks: [] }
    await f.f.invoke("review", { operation: "freeze", request: pending }, f.sessions.reader)
    await f.f.invoke("plan", { operation: "save", action_id: f.action.id, expected_revision: 2,
      nodes: [{ id: "new-phase", kind: "phase", title: "Unrelated current Plan" }] }, f.sessions.reader)
    const view = (await f.f.invoke("history", { operation: "read", action_id: f.action.id,
      record_id: f.observations.afterIndex.finish.id, limit: 20 }, f.sessions.reader)).result as EngineeringHistoryView
    const group = view.connections.reviews.find(group => group.request.request_id === pending.request_id)
    expect(group).toBeDefined()
    expect(group!.frozen_work_membership[0]!.constituents.map(ref => ref.node_id)).toEqual(["release", "broader", "ordered-test"])
    expect(group!.relationships).toEqual([])
    const edges = view.relationships.filter(edge => edge.from === group!.ref && edge.kind === "requested-work-member")
    expect(edges.map(edge => edge.source_record_id)).toContain(f.observations.afterIndex.finish.id)
    expect(edges.map(edge => edge.source_record_id)).not.toContain(f.observations.original.finish.id)
    expect(edges.every(edge => edge.meaning === "authored")).toBe(true)
    expect(group!.qualification.native_review_binding.status).toBe("unknown")
  } finally { await f.close() }
})

test("connection requests retain their selection and reject changed selectors or caller authority", async () => {
  const f = await engineeringTrajectoryFixture({ records: 240 })
  try {
    const first = (await f.f.invoke("history", { operation: "read", action_id: f.action.id,
      record_id: f.records.initialInterpretation.id, limit: 1 }, f.sessions.reader)).result as EngineeringHistoryView
    const query = first.connections.objectives[0]!.details
    const read = (input: object, session = f.sessions.reader) => f.f.invoke("history", { operation: "read", ...input }, session)
    const page = (await read(query)).result as EngineeringHistoryView
    expect(page.mode).toBe("connections")
    expect(page.records).toEqual([]); expect(page.highlights).toEqual([]); expect(page.branches).toEqual([])
    expect(page.connections.context!.read).toEqual(first.navigation.repeat)
    for (const change of [{ limit: 2 }, { record_id: f.records.correctionReport.id }, { related: true },
      { owner_version: "a".repeat(64) }, { through: undefined }])
      await expect(read({ ...query, ...change })).rejects.toThrow()
    await expect(read(query, "different-reader")).rejects.toThrow()
    for (const response_format of ["json", "markdown", "html"]) {
      f.f.permission.error = new Error("source permission revoked")
      await expect(read({ ...query, response_format })).rejects.toThrow("source permission revoked")
      f.f.permission.error = undefined
      const output = await f.f.tools.get("history").execute({ operation: "read", ...query, response_format }, {
        sessionID: f.sessions.reader, agent: "author", messageID: "cursor-render", id: "cursor-render", signal: new AbortController().signal,
      })
      expect(output.content).toContain(page.navigation.next_connections!.connection_cursor!)
      if (response_format !== "json") {
        expect(output.content).not.toContain("Significant recorded work")
        expect(output.content).not.toContain("Intended Plan")
      }
    }
  } finally { await f.close() }
})

test("pruning a mixed-scope dependency also removes its disconnected prior-only context", async () => {
  const f = await engineeringTrajectoryFixture({ records: 240 })
  try {
    const actor = { session_id: f.sessions.reader, agent: "author" }
    const input = { operation: "read", action_id: f.action.id, record_id: f.records.finding.id, related: true, limit: 20 }
    const before = (await f.f.invoke("history", input, f.sessions.reader)).result as EngineeringHistoryView
    const orphan = { ...f.reviews.original, request_id: "withheld-orphan",
      mandate: { ...f.reviews.original.mandate, question: "WITHHELD ORPHAN MANDATE" },
      members: f.reviews.original.members.map(member => ({ ...member, work_ref: null })), rechecks: [] }
    f.store.reviews.freeze(actor, orphan)
    const other = f.store.create("Outside Action", "Outside requested scope", actor)
    const plan = f.store.savePlan(other.id, 0, [{ id: "outside-task", kind: "task", title: "Outside subject" }])
    const mixed = { ...f.reviews.original, request_id: "withheld-mixed",
      members: [{ ...f.reviews.original.members[0]!, prior_review_request_id: orphan.request_id },
        { ...f.reviews.original.members[0]!, member_id: "outside-member", work_ref: workReference(other, plan, "outside-task") }] }
    f.store.reviews.freeze(actor, mixed)
    f.store.reviews.freeze(actor, { ...orphan, request_id: "withheld-successor",
      members: orphan.members.map(member => ({ ...member, prior_review_request_id: mixed.request_id })) })
    const after = (await f.f.invoke("history", input, f.sessions.reader)).result as EngineeringHistoryView
    expect(after.boundary.owners).toEqual(before.boundary.owners)
    expect(after.boundary.owner_version).toBe(before.boundary.owner_version)
    for (const hidden of [orphan.request_id, mixed.request_id, "withheld-successor", "WITHHELD ORPHAN MANDATE", other.id])
      expect(JSON.stringify(after)).not.toContain(hidden)
  } finally { await f.close() }
})

test("a valid large review relationship set is hashed by its owner and exhaustible in bounded pages", async () => {
  const f = await engineeringTrajectoryFixture({ records: 240 })
  try {
    const actor = { session_id: f.sessions.reader, agent: "author" }
    const request = { ...f.reviews.original, request_id: "large-relationship-population",
      members: f.reviews.original.members.map(member => ({ ...member, work_ref: null })), rechecks: [] }
    f.store.reviews.freeze(actor, request)
    const ids = new Set<string>()
    let selected = ""
    for (let index = 0; index < 1800; index++) {
      const record = f.store.record(actor, { action_id: f.action.id }, { kind: "concern", statement: `Recorded review finding ${index}` })
      if (!selected) selected = record.id
      ids.add(f.store.reviews.relate(actor, request.request_id, { relationship: "finding", source_record_id: record.id,
        member_ids: [request.members[0]!.member_id] }).id)
    }
    const owner = f.store.reviews.historySnapshot(actor, { action_id: f.action.id }).requests.find(item => item.request.request_id === request.request_id)!
    expect(Buffer.byteLength(JSON.stringify(owner), "utf8")).toBeGreaterThan(1024 * 1024)
    const minimum = (await f.f.invoke("history", { operation: "read", action_id: f.action.id,
      record_id: selected, limit: 1 }, f.sessions.reader)).result as EngineeringHistoryView
    expect(minimum.connections.reviews[0]!.source.sha256).toBe(owner.content_digest)
    const initial = (await f.f.invoke("history", { operation: "read", ...minimum.navigation.repeat, limit: 50 }, f.sessions.reader)).result as EngineeringHistoryView
    let query = initial.connections.reviews[0]!.details as EngineeringHistoryView["navigation"]["next_connections"]
    const returned: string[] = []
    let pages = 0
    while (query) {
      expect(++pages).toBeLessThanOrEqual(18)
      const response = await f.f.invoke("history", { operation: "read", ...query }, f.sessions.reader)
      const page = response.result as EngineeringHistoryView
      expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThanOrEqual(262144)
      const group = page.connections.reviews[0]!
      expect(group.source.sha256).toBe(owner.content_digest)
      returned.push(...group.relationships.map(relation => relation.id))
      query = page.navigation.next_connections
    }
    expect(returned).toHaveLength(ids.size)
    expect(new Set(returned)).toEqual(ids)
    expect(pages).toBe(18)
  } finally { await f.close() }
}, 60000)
