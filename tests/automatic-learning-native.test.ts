import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { Learning } from "../src/learning.js"
import { Store } from "../src/store.js"
import { workReference } from "../src/collaboration.js"

function fixture() {
  const action = new Database(":memory:"), derived = new Database(":memory:")
  const store = new Store(action), learning = new Learning(derived, store, action)
  const actor = { session_id: "owner", agent: "coder" }
  return { action, derived, store, learning, actor, close: () => { derived.close(); action.close() } }
}

test("automatic processing discovers original observations, publishes once, and never calls a model", async () => {
  const f = fixture()
  try {
    const record = f.store.observe(f.actor, undefined, { phase: "finished", tool: "test", status: "error" })
    let checks = 0
    const authorize = async () => { checks++ }
    const first = await f.learning.automatic.run("owner", authorize, new AbortController().signal)
    expect(first.state).toBe("complete")
    expect(checks).toBeGreaterThanOrEqual(2)
    const report = f.learning.automatic.history.report(first.batch_id!, "owner")!
    expect(report.availability).toBe("available")
    expect(report.source_refs.some(ref => ref.id === record.id)).toBe(true)
    expect(report.body).toMatchObject({ method: "descriptive-source-analysis/v2", objective_success: "not-assessed", genuine_evaluator: { state: "blocked" }, population: { source_count: 1, independent_originating_requests: null } })
    const again = await f.learning.automatic.run("owner", authorize, new AbortController().signal)
    expect(again.batch_id).toBe(first.batch_id)
    expect(f.learning.automatic.history.list("owner").items).toHaveLength(1)
  } finally { f.close() }
})

test("native source authorization is required before any snapshot or report", async () => {
  const f = fixture()
  try {
    f.store.observe(f.actor, undefined, { phase: "finished", status: "error" })
    await expect(f.learning.automatic.run("owner", async () => { throw new Error("denied") }, new AbortController().signal)).rejects.toThrow("denied")
    expect(f.learning.automatic.history.list("owner").items).toHaveLength(0)
  } finally { f.close() }
})

test("permission withdrawal at publication keeps a resumable checkpoint, not a completed batch", async () => {
  const f = fixture()
  try {
    f.store.observe(f.actor, undefined, { phase: "finished", status: "error" })
    let checks = 0
    await expect(f.learning.automatic.run("owner", async () => { if (++checks === 2) throw new Error("revoked") }, new AbortController().signal)).rejects.toThrow("revoked")
    const batch = f.learning.automatic.history.list("owner").items[0]!
    expect(batch).toMatchObject({ state: "pending", processed_count: 1, report_id: null })
    const resumed = await new Learning(f.derived, f.store, f.action).automatic.run("owner", async () => {}, new AbortController().signal)
    expect(resumed).toEqual({ state: "complete", batch_id: batch.id })
  } finally { f.close() }
})

test("source ownership is enforced and removed originals withhold derived report bodies", async () => {
  const f = fixture()
  try {
    const record = f.store.observe(f.actor, undefined, { phase: "finished", status: "error" })
    expect(await f.learning.automatic.run("unrelated", async () => {}, new AbortController().signal)).toEqual({ state: "empty" })
    const result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    expect(() => f.learning.automatic.history.report(result.batch_id!, "unrelated")).toThrow("unavailable")
    f.action.query("DELETE FROM ledger WHERE id=?").run(record.id)
    expect(f.learning.automatic.history.get(result.batch_id!, "owner").state).toBe("incomplete")
    expect(f.learning.automatic.history.report(result.batch_id!, "owner")).toMatchObject({ availability: "source-unavailable", body: null })
  } finally { f.close() }
})

test("late contradictory observations create attributable revisions, not independent outcomes", async () => {
  const f = fixture()
  try {
    const action = f.store.create("Fix", "One originating goal", f.actor)
    const plan = f.store.savePlan(action.id, 0, [{ id: "task", kind: "task", title: "Fix" }], f.actor)
    f.store.collaboration.complete(f.actor, { work_ref: workReference(action, plan, "task"), statement: "Local work is done" })
    const first = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    f.store.observe(f.actor, undefined, { phase: "finished", status: "error" })
    const second = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    expect(second.batch_id).not.toBe(first.batch_id)
    expect(f.learning.automatic.history.get(first.batch_id!, "owner").state).toBe("stale")
    expect(f.learning.automatic.history.get(second.batch_id!, "owner")).toMatchObject({ revision: 2, previous_batch_id: first.batch_id })
    const report = f.learning.automatic.history.report(second.batch_id!, "owner")!
    expect(report.body).toMatchObject({ observations: { "reported-completion": 1, "tool-error": 1 }, population: { independent_originating_requests: null } })
    expect(JSON.stringify(report.body)).toContain("correction within one goal")
  } finally { f.close() }
})

test("cancelled processing cannot publish an overall report", async () => {
  const f = fixture()
  try {
    f.store.observe(f.actor, undefined, { phase: "finished", status: "error" })
    const controller = new AbortController()
    let n = 0
    await expect(f.learning.automatic.run("owner", async () => { if (++n === 2) controller.abort() }, controller.signal)).rejects.toThrow()
    expect(f.learning.automatic.history.list("owner").items[0]).toMatchObject({ state: "pending", report_id: null })
  } finally { f.close() }
})

test("new evidence cannot abandon a partially processed frozen batch", async () => {
  const f = fixture()
  try {
    for (let i = 0; i < 641; i++) f.store.observe(f.actor, undefined, { phase: "finished", status: "completed", sequence: i })
    const first = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    expect(first.state).toBe("pending")
    f.store.observe(f.actor, undefined, { phase: "finished", status: "error" })
    const resumed = await new Learning(f.derived, f.store, f.action).automatic.run("owner", async () => {}, new AbortController().signal)
    expect(resumed).toEqual({ state: "complete", batch_id: first.batch_id })
    expect(f.learning.automatic.history.report(first.batch_id!, "owner")!.body).toMatchObject({ population: { source_count: 641 } })
    const next = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    expect(next.batch_id).not.toBe(first.batch_id)
  } finally { f.close() }
})

test("automatic reconstruction preserves correction links under one authored objective", async () => {
  const f = fixture()
  try {
    const original = f.store.record(f.actor, undefined, { kind: "result", statement: "Original requested change" })
    const objective = f.learning.objectives.create(f.actor, f.learning.objectives.ledgerSource(original.id), "One goal")
    const failed = f.store.record(f.actor, undefined, { kind: "result", statement: "Verification failed" })
    const check = f.learning.objectives.link(f.actor, { objective_id: objective.id, phase: "verification", assessment: "fail", source: f.learning.objectives.ledgerSource(failed.id) })
    const correction = f.store.record(f.actor, undefined, { kind: "result", statement: "Corrective dispatch" })
    f.learning.objectives.link(f.actor, { objective_id: objective.id, phase: "corrective-dispatch", related_sequence: check.sequence, source: f.learning.objectives.ledgerSource(correction.id) })
    const result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    const report = f.learning.automatic.history.report(result.batch_id!, "owner")!
    expect(report.body).toMatchObject({ population: { authored_objectives: 1, independent_originating_requests: null }, observations: { "objective-verification-fail": 1, "objective-corrective-dispatch": 1 } })
    const members = f.learning.automatic.history.reports(result.batch_id!, "owner")
    const body = members.items.find(item => item.kind === "objective")!.report!.body
    expect(JSON.stringify(body)).toContain('"related_sequence":' + check.sequence)
    expect(report.source_refs.filter(ref => ref.kind === "ledger-record")).toHaveLength(3)
  } finally { f.close() }
})

test("automatic synthesis covers 501 authored objectives without counting one shared request 501 times", async () => {
  const f = fixture()
  try {
    const original = f.store.record(f.actor, undefined, { kind: "result", statement: "One request with many declared work units" })
    const source = f.learning.objectives.ledgerSource(original.id)
    for (let i = 0; i < 501; i++) f.learning.objectives.create(f.actor, source, "Authored work unit " + i, "unit-" + i)
    let result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal), quanta = 1
    expect(result.state).toBe("pending")
    while (result.state === "pending" && quanta++ < 100) result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    expect(result.state).toBe("complete")
    const report = f.learning.automatic.history.report(result.batch_id!, "owner")!
    expect(report.body).toMatchObject({ population: { authored_objectives: 501, independent_originating_requests: null, complete_through_frozen_boundary: true } })
    expect(report.source_refs.filter(ref => ref.kind === "ledger-record")).toHaveLength(1)
    expect(report.source_refs.filter(ref => ref.kind === "objective")).toHaveLength(501)
  } finally { f.close() }
}, 30000)

test("foreign objective originals are withheld and do not become an omniscient worker input", async () => {
  const f = fixture()
  try {
    const other = { session_id: "other", agent: "coder" }
    const secret = f.store.record(other, undefined, { kind: "result", statement: "PRIVATE ORIGINAL" })
    f.learning.objectives.create(other, f.learning.objectives.ledgerSource(secret.id), "Private objective")
    const declared = f.learning.objectives.create(f.actor, f.learning.objectives.ledgerSource(secret.id), "Continuation with an inaccessible source", "continuation")
    const result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    const report = f.learning.automatic.history.report(result.batch_id!, "owner")!
    expect(report.source_refs.some(ref => ref.kind === "ledger-record" && ref.id === secret.id)).toBe(false)
    expect(report.source_refs.filter(ref => ref.kind === "objective").map(ref => ref.id)).toEqual([declared.id])
    expect(JSON.stringify(report)).not.toContain("PRIVATE ORIGINAL")
    const members = f.learning.automatic.history.reports(result.batch_id!, "owner")
    expect(JSON.stringify(members)).toContain('"original_content":"not-inspected"')
  } finally { f.close() }
})

test("automatic review reconstruction keeps A and partial B coverage distinct", async () => {
  const f = fixture()
  try {
    const action = f.store.create("Requested objective", "Deliver the original outcome", f.actor)
    const a = f.store.savePlan(action.id, 0, Array.from({ length: 100 }, (_, i) => ({ id: "task-" + i, kind: "task", title: "A " + i })), f.actor)
    const review = (id: string, plan: typeof a, count: number): any => ({ format: "loom-review-request/v1", request_id: id,
      mandate: { question: "Inspect original correctness", dimensions: ["correctness"], criteria: [{ text: "Original error contract", source_ref: "BR-004" }], mode: "independent", inclusions: [], exclusions: [] },
      intended_recipient: { agent: "reviewer", session_id: null }, rechecks: [],
      members: plan.nodes.slice(0, count).map((node, i) => ({ member_id: "member-" + i, work_ref: workReference(action, plan, node.id), producing_attempt_refs: [], artifact_refs: [], prior_review_request_id: null, membership_source_refs: [], gaps: [] })) })
    f.store.reviews.freeze(f.actor, review("R1", a, 100))
    const fail = f.store.record(f.actor, undefined, { kind: "qa", verdict: "fail", statement: "Failure in A" })
    f.store.reviews.relate(f.actor, "R1", { relationship: "finding", source_record_id: fail.id, member_ids: ["member-0"] })
    const b = f.store.savePlan(action.id, 1, a.nodes.map(node => ({ ...node, title: "B " + node.id })), f.actor)
    f.store.reviews.freeze(f.actor, review("R2", b, 10))
    const pass = f.store.record(f.actor, undefined, { kind: "qa", verdict: "pass", statement: "Ten selected tasks in B" })
    f.store.reviews.relate(f.actor, "R2", { relationship: "finding", source_record_id: pass.id, member_ids: Array.from({ length: 10 }, (_, i) => "member-" + i) })
    const result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    const report = f.learning.automatic.history.report(result.batch_id!, "owner")!
    expect(report.body).toMatchObject({ observations: { "review-request": 2, "review-declared-fail": 1, "review-declared-pass": 1 }, objective_success: "not-assessed" })
    const all = f.learning.automatic.history.reports(result.batch_id!, "owner").items.flatMap(item => (item.report!.body as any).observations)
    const first = all.find((observation: any) => observation.source.kind === "review-request" && observation.source.id === "R1")
    const second = all.find((observation: any) => observation.source.kind === "review-request" && observation.source.id === "R2")
    expect(first.review_context.member_count).toBe(100)
    expect(second.review_context.member_count).toBe(10)
    expect(first.review_context.frozen_work.every((item: any) => item.selection.plan_revision === 1)).toBe(true)
    expect(second.review_context.frozen_work.every((item: any) => item.selection.plan_revision === 2)).toBe(true)
    expect(first.review_context.native_execution).toBe("unknown")
    f.action.query("DELETE FROM review_relationships WHERE request_id='R1'").run()
    expect(f.learning.automatic.history.report(result.batch_id!, "owner")!.availability).toBe("source-unavailable")
  } finally { f.close() }
})

test("large published reports expose every original through bounded public source pages", async () => {
  const f = fixture()
  const { registerAutomaticLearning } = await import("../src/learning-runtime.js")
  const runtime = await registerAutomaticLearning({ session: { hook: async () => ({ dispose: async () => {} }) } } as any,
    { learning: f.learning, ledgerPath: "unused", learningPath: "unused", signal: new AbortController().signal,
      getConfig: async () => { throw new Error("readback must not start discovery") }, checkedSession: async () => { throw new Error("readback caller owns permission") }, warn: () => {} })
  try {
    for (let i = 0; i < 2001; i++) f.store.observe(f.actor, undefined, { phase: "finished", status: "completed", call_id: "source-" + i })
    let result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    while (result.state === "pending") result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    const report = runtime.read({ operation: "evaluation", batch_id: result.batch_id }, "owner", true) as any
    expect(report.report.source_ref_count).toBe(2001)
    expect(report.report.source_refs.length).toBeLessThanOrEqual(50)
    const ids = new Set<string>()
    let after = 0
    for (;;) {
      const page = runtime.read({ operation: "evaluation-sources", batch_id: result.batch_id, after, limit: 200 }, "owner", true) as any
      for (const item of page.items) { expect(item.available).toBe(true); ids.add(item.id) }
      if (page.next_after === null) break
      after = page.next_after
    }
    expect(ids.size).toBe(2001)
  } finally { await runtime.dispose(); f.close() }
}, 30000)

test("legal large frozen review remains fully retrievable through stable public observation pages", async () => {
  const f = fixture()
  const { registerAutomaticLearning } = await import("../src/learning-runtime.js")
  const runtime = await registerAutomaticLearning({ session: { hook: async () => ({ dispose: async () => {} }) } } as any,
    { learning: f.learning, ledgerPath: "unused", learningPath: "unused", signal: new AbortController().signal,
      getConfig: async () => { throw new Error("readback must not start discovery") },
      checkedSession: async () => { throw new Error("readback caller owns permission") }, warn: () => {} })
  const requestID = "stage3-large-review"
  const memberIDs = Array.from({ length: 100 }, (_, i) => "member-" + String(i).padStart(3, "0") + "-" + "m".repeat(109))
  try {
    const action = f.store.create("Large original review scope", "Check frozen work", f.actor)
    const plan = f.store.savePlan(action.id, 0, Array.from({ length: 100 }, (_, i) => ({
      id: "task-" + i, kind: "task" as const, title: "Artifact " + i,
      outcome: "Original acceptance contract " + "a".repeat(1500),
    })), f.actor)
    const frozen: any = { format: "loom-review-request/v1", request_id: requestID,
      mandate: { question: "Inspect exactly this frozen authored population", dimensions: ["correctness"],
        criteria: [{ text: "Retain findings and source identity", source_ref: null }],
        mode: "independent", inclusions: [], exclusions: [] },
      intended_recipient: { agent: "reviewer", session_id: null },
      members: memberIDs.map((member_id, i) => ({
        member_id, work_ref: workReference(action, plan, "task-" + i), producing_attempt_refs: [],
        artifact_refs: [{ locator: "/private/artifact-" + i + "-" + "a".repeat(350),
          version: { kind: "sha256", value: String(i).padStart(64, "0") }, content_ref: null }],
        prior_review_request_id: null, membership_source_refs: [], gaps: [{ reason: "source-missing", source_ref: null }],
      })), rechecks: [] }
    f.store.reviews.freeze(f.actor, frozen)
    for (let i = 0; i < 16; i++) {
      const record = f.store.record(f.actor, undefined, { kind: "qa", verdict: "fail", statement: "Authored finding " + i })
      f.store.reviews.relate(f.actor, requestID, { relationship: "finding", source_record_id: record.id, member_ids: memberIDs })
    }
    let result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    while (result.state === "pending") result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    expect(result.state).toBe("complete")
    const stored = f.learning.automatic.history.reports(result.batch_id!, "owner", { limit: 100 }).items
    const oversized = stored.find(member => member.key === "review:" + requestID + ":0")!
    expect(oversized).toBeDefined()
    const original = (oversized.report!.body as { observations: unknown[] }).observations
    expect(JSON.stringify(oversized.report!.body).length).toBeGreaterThan(262144)

    const single = runtime.read({ operation: "evaluation", batch_id: result.batch_id, member_key: oversized.key }, "owner", true) as any
    expect(single.report).toMatchObject({ id: oversized.report!.id, availability: "available",
      body: null, body_paginated: true, observation_count: original.length,
      observations_operation: "evaluation-observations" })

    const listed = new Set<string>()
    let memberAfter = 0
    do {
      const page = runtime.read({ operation: "evaluation-members", batch_id: result.batch_id, after: memberAfter, limit: 100 }, "owner", true) as any
      expect(page.items.length).toBeGreaterThan(0)
      for (const item of page.items) { expect(listed.has(item.key)).toBe(false); listed.add(item.key) }
      const target = page.items.find((item: any) => item.key === oversized.key)
      if (target) expect(target.report).toMatchObject({ body: null, body_paginated: true, observation_count: original.length })
      if (page.next_after === null) break
      expect(page.next_after).toBeGreaterThan(memberAfter)
      memberAfter = page.next_after
    } while (true)
    expect(listed.size).toBe(stored.length)

    const obtained: unknown[] = []
    let after = 0
    do {
      const page = runtime.read({ operation: "evaluation-observations", batch_id: result.batch_id,
        member_key: oversized.key, report_id: oversized.report!.id, after, limit: 200 }, "owner", true) as any
      expect(page).toMatchObject({ report_id: oversized.report!.id, report_sha256: oversized.report!.sha256,
        availability: "available", observation_count: original.length })
      expect(page.items.length).toBeGreaterThan(0)
      obtained.push(...page.items)
      if (page.next_after === null) break
      expect(page.next_after).toBeGreaterThan(after)
      after = page.next_after
    } while (true)
    expect(obtained).toEqual(original)
    expect(new Set((obtained as any[]).map(x => x.source.kind + ":" + x.source.id)).size).toBe(original.length)
    expect(() => runtime.read({ operation: "evaluation-observations", batch_id: result.batch_id, member_key: oversized.key,
      report_id: "wrong-id" }, "owner", true)).toThrow("identity unavailable")
    expect(() => runtime.read({ operation: "evaluation-observations", batch_id: result.batch_id, member_key: oversized.key,
      report_id: oversized.report!.id }, "foreign", true)).toThrow("unavailable")
    expect(() => runtime.read({ operation: "evaluation-observations", batch_id: result.batch_id, member_key: oversized.key,
      report_id: oversized.report!.id, after: -1 }, "owner", true)).toThrow("Invalid evaluation observation cursor")

    f.action.query("DELETE FROM review_relationships WHERE request_id=?").run(requestID)
    const invalidated = runtime.read({ operation: "evaluation-observations", batch_id: result.batch_id,
      member_key: oversized.key, report_id: oversized.report!.id }, "owner", true) as any
    expect(invalidated).toMatchObject({ availability: "source-unavailable", observation_count: null,
      items: [], next_after: null })
  } finally { await runtime.dispose(); f.close() }
}, 60000)

test("combined member readback stays bounded even when each stored member fits alone", async () => {
  const f = fixture()
  const { registerAutomaticLearning } = await import("../src/learning-runtime.js")
  const runtime = await registerAutomaticLearning({ session: { hook: async () => ({ dispose: async () => {} }) } } as any,
    { learning: f.learning, ledgerPath: "unused", learningPath: "unused", signal: new AbortController().signal,
      getConfig: async () => { throw new Error("readback must not start discovery") },
      checkedSession: async () => { throw new Error("readback caller owns permission") }, warn: () => {} })
  try {
    for (let i = 0; i < 128; i++)
      f.store.observe(f.actor, undefined, { phase: "finished", status: "completed", work_scope: { label: "x".repeat(3000) }, call_id: "large-" + i })
    let result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    while (result.state === "pending") result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    const stored = f.learning.automatic.history.reports(result.batch_id!, "owner", { limit: 100 }).items
    expect(stored.length).toBeGreaterThan(2)
    for (const item of stored) expect(JSON.stringify(item.report!.body).length).toBeLessThan(262144)
    const seen = new Set<string>()
    expect(stored.reduce((size, member) => size + JSON.stringify(member.report!.body).length, 0)).toBeGreaterThan(262144)
    let after = 0, pages = 0
    do {
      const page = runtime.read({ operation: "evaluation-members", batch_id: result.batch_id, after, limit: 100 }, "owner", true) as any
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(262144)
      pages++
      expect(page.items.length).toBeGreaterThan(0)
      for (const item of page.items) {
        expect(seen.has(item.key)).toBe(false)
        seen.add(item.key)
        if (item.report.body_paginated) {
          const observationPage = runtime.read({ operation: "evaluation-observations", batch_id: result.batch_id,
            member_key: item.key, report_id: item.report.id }, "owner", true) as any
          expect(observationPage.items.length).toBeGreaterThan(0)
        }
      }
      if (page.next_after === null) break
      expect(page.next_after).toBeGreaterThan(after)
      after = page.next_after
    } while (true)
    expect(seen.size).toBe(stored.length)
    expect(pages).toBeGreaterThan(1)
  } finally { await runtime.dispose(); f.close() }
}, 30000)

test("native agent context observations remain practices, not causal success credit", async () => {
  const f = fixture()
  try {
    f.store.record(f.actor, undefined, { kind: "qa", verdict: "pass", statement: "Reported pass before observing instructions" })
    const practice = f.store.observe(f.actor, undefined, { phase: "agent-context-snapshot", agent_id: "coder", content_sha256: "a".repeat(64) })
    const result = await f.learning.automatic.run("owner", async () => {}, new AbortController().signal)
    const report = f.learning.automatic.history.report(result.batch_id!, "owner")!
    expect(report.body).toMatchObject({ observations: { "practice-observation": 1 }, objective_success: "not-assessed" })
    const observations = (f.learning.automatic.history.reports(result.batch_id!, "owner").items[0]!.report!.body as any).observations
    expect(observations.find((item: any) => item.source.id === practice.id).detail).toContain("causal effect remain unknown")
  } finally { f.close() }
})
