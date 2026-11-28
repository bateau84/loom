import { test, expect, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { Learning } from "../src/learning.js"
import { Store } from "../src/store.js"
import { INCREMENTAL_METHOD, INCREMENTAL_SCOPE, type IncrementReportBody } from "../src/automatic-learning.js"
import { canonical } from "../src/model.js"

function fixture() {
  const action = new Database(":memory:"), derived = new Database(":memory:"), store = new Store(action)
  const learning = new Learning(derived, store, action), actor = { session_id: "ordinary", agent: "coder" }
  const run = (limit = 128, authorize: () => Promise<void> = async () => {}, signal = new AbortController().signal) =>
    learning.automatic.run(actor.session_id, authorize, signal, { incremental: true, max_sources: limit })
  const body = (id: string) => learning.automatic.history.report(id, actor.session_id)!.body as IncrementReportBody
  return { action, derived, store, learning, actor, run, body, close: () => { derived.close(); action.close() } }
}

test("ordinary Session increments process bounded new originals once and unchanged idle creates nothing", async () => {
  const f = fixture()
  try {
    const records = Array.from({ length: 5 }, (_, i) => f.store.record(f.actor, undefined, { kind: "result", statement: "Engineering change " + i }))
    const before = f.derived.query("SELECT COUNT(*) AS n FROM sqlite_schema").get()
    expect(f.learning.automatic.incrementProgress(f.actor.session_id)).toMatchObject({ state: "empty", items: [] })
    expect(f.derived.query("SELECT COUNT(*) AS n FROM sqlite_schema").get()).toEqual(before)
    const a = await f.run(2), b = await f.run(2), c = await f.run(2)
    expect([a.state, b.state, c.state]).toEqual(["complete", "complete", "complete"])
    expect([f.body(a.batch_id!).new_sources, f.body(b.batch_id!).new_sources, f.body(c.batch_id!).new_sources]).toEqual([2, 2, 1])
    const selected = [a, b, c].flatMap(x => f.learning.automatic.history.frozenIncrement(x.batch_id!, f.actor.session_id).members.flatMap(m => m.source_refs.map(r => r.id)))
    expect(selected.sort()).toEqual(records.map(r => r.id).sort())
    expect(new Set(selected).size).toBe(5)
    const count = () => f.derived.query("SELECT COUNT(*) AS n FROM learning_subject_subjects").get()
    const subjects = count()
    for (let i = 0; i < 5; i++) expect(await f.run(2)).toEqual({ state: "complete", batch_id: c.batch_id, replayed: true })
    expect(count()).toEqual(subjects)
    expect(f.learning.automatic.history.listScope(f.actor.session_id, INCREMENTAL_SCOPE).items).toHaveLength(3)
    expect(f.learning.automatic.incrementProgress(f.actor.session_id)).toMatchObject({ state: "caught-up", latest_successful_batch_id: c.batch_id })
    expect(f.action.query("SELECT COUNT(*) AS n FROM ledger").get()).toEqual({ n: 5 })
    expect(f.derived.query("SELECT COUNT(*) AS n FROM learning_objectives").get()).toEqual({ n: 0 })
  } finally { f.close() }
})

test("earlier concern survives a later pass; only an exactly paired finish clears an unfinished start", async () => {
  const f = fixture()
  try {
    const concern = f.store.record(f.actor, undefined, { kind: "concern", statement: "Ethernet has not been checked" })
    const start = f.store.observe(f.actor, undefined, { phase: "started", message_id: "m1", call_id: "work1" })
    const first = await f.run(), original = canonical(f.learning.automatic.history.report(first.batch_id!, f.actor.session_id))
    f.store.record(f.actor, undefined, { kind: "qa", verdict: "pass", statement: "WiFi was reported as passing after correction" })
    f.store.observe(f.actor, undefined, { phase: "finished", status: "completed", message_id: "m1", call_id: "work1", attribution: "unestablished" })
    const second = await f.run()
    expect(f.body(second.batch_id!).retained.concerns.map(x => x.source.id)).toEqual([concern.id])
    expect(f.body(second.batch_id!).retained.concerns[0]!.detail).toContain("Ethernet has not been checked")
    expect(f.body(second.batch_id!).retained.unfinished.map(x => x.source.id)).toEqual([start.id])
    f.store.observe(f.actor, undefined, { phase: "finished", status: "completed", start_id: start.id, attribution: "captured-at-start" })
    const third = await f.run(), body = f.body(third.batch_id!)
    expect(body.retained.unfinished).toEqual([])
    expect(body.retained.concerns).toHaveLength(1)
    expect(body.objective_success).toBe("not-assessed")
    expect(body.earlier_context_sources).toBe(1)
    expect(canonical(f.learning.automatic.history.report(first.batch_id!, f.actor.session_id))).toBe(original)
    const origin = body.retained.concerns[0]!.origin
    expect(f.learning.automatic.incrementSource(f.actor.session_id, origin.batch_id, origin.member_key, origin.source_index)).toMatchObject({ source: { id: concern.id }, value: concern })
  } finally { f.close() }
})

test("partial member checkpoints survive restart and concurrent append cannot enter the already frozen increment", async () => {
  const f = fixture()
  try {
    for (let i = 0; i < 641; i++) f.store.observe(f.actor, undefined, { phase: "finished", status: "completed", call_id: "work-" + i })
    const first = await f.run(1000)
    expect(first.state).toBe("pending")
    const frozen = f.learning.automatic.history.frozenIncrement(first.batch_id!, f.actor.session_id)
    const late = f.store.record(f.actor, undefined, { kind: "concern", statement: "New work after the frozen boundary" })
    const resumed = new Learning(f.derived, f.store, f.action)
    const done = await resumed.automatic.run(f.actor.session_id, async () => {}, new AbortController().signal, { incremental: true, max_sources: 1000 })
    expect(done).toEqual({ state: "complete", batch_id: first.batch_id })
    expect(resumed.automatic.history.frozenIncrement(first.batch_id!, f.actor.session_id)).toEqual({ ...frozen, published_state: "complete" })
    expect(f.body(first.batch_id!).new_sources).toBe(641)
    expect(f.body(first.batch_id!).retained.concerns.some(x => x.source.id === late.id)).toBe(false)
    const next = await f.run(1000)
    expect(f.body(next.batch_id!).new_sources).toBe(1)
    expect(f.body(next.batch_id!).retained.concerns[0]!.source.id).toBe(late.id)
  } finally { f.close() }
})

test("cancelled publication resumes the same increment and does not advance the successful cursor", async () => {
  const f = fixture()
  try {
    f.store.record(f.actor, undefined, { kind: "result", statement: "Original work" })
    const controller = new AbortController(); let checks = 0
    await expect(f.run(128, async () => { if (++checks === 2) controller.abort() }, controller.signal)).rejects.toThrow()
    const head = f.learning.automatic.history.latestInScope(f.actor.session_id, INCREMENTAL_SCOPE)!
    expect(head).toMatchObject({ published_state: "pending", processed_count: 1, report_id: null })
    expect(f.learning.automatic.history.latestInScope(f.actor.session_id, INCREMENTAL_SCOPE, true)).toBeNull()
    const done = await f.run()
    expect(done.batch_id).toBe(head.id)
    expect(f.body(done.batch_id!).new_sources).toBe(1)
  } finally { f.close() }
})

test("concurrent processors share exact frozen work and only one publishes", async () => {
  const f = fixture()
  let release!: () => void, reached!: () => void
  const held = new Promise<void>(r => { release = r }), paused = new Promise<void>(r => { reached = r })
  try {
    f.store.record(f.actor, undefined, { kind: "result", statement: "A selected change" })
    let checks = 0
    const first = f.run(128, async () => { if (++checks === 2) { reached(); await held } })
    await paused
    const second = new Learning(f.derived, f.store, f.action)
    const competing = await second.automatic.runIncrement(f.actor.session_id, async () => {}, new AbortController().signal)
    expect(competing.state).toBe("busy")
    release()
    expect((await first).batch_id).toBe(competing.batch_id)
    expect(f.learning.automatic.history.listScope(f.actor.session_id, INCREMENTAL_SCOPE).items).toHaveLength(1)
    expect(f.derived.query("SELECT COUNT(*) AS n FROM learning_evaluation_reports WHERE member_key IS NULL").get()).toEqual({ n: 1 })
  } finally { release(); f.close() }
})

test("unavailable original concern blocks further progress without discarding it or skipping the cursor", async () => {
  const f = fixture()
  try {
    const concern = f.store.record(f.actor, undefined, { kind: "concern", statement: "Required earlier evidence" })
    const first = await f.run()
    f.action.query("DELETE FROM ledger WHERE id=?").run(concern.id)
    f.store.record(f.actor, undefined, { kind: "result", statement: "Later work cannot make missing evidence disappear" })
    await expect(f.run()).rejects.toThrow("retained learning source unavailable")
    expect(f.learning.automatic.history.latestInScope(f.actor.session_id, INCREMENTAL_SCOPE, true)!.id).toBe(first.batch_id!)
    expect(f.learning.automatic.history.listScope(f.actor.session_id, INCREMENTAL_SCOPE).items).toHaveLength(1)
    expect(f.learning.automatic.history.report(first.batch_id!, f.actor.session_id)!.availability).toBe("source-unavailable")
  } finally { f.close() }
})

test("late retrieval classification withdraws only its exact call without rewriting original reports", async () => {
  const f = fixture()
  try {
    const retrieval = f.store.observe(f.actor, undefined, { phase: "finished", status: "error", tool: "codemode", message_id: "shared", call_id: "retrieval" })
    const engineering = f.store.observe(f.actor, undefined, { phase: "finished", status: "error", tool: "shell", message_id: "shared", call_id: "engineering" })
    const first = await f.run(), before = f.derived.query("SELECT body_json,sha256 FROM learning_evaluation_reports WHERE batch_id=? AND slot='overall'").get(first.batch_id!)
    f.learning.automatic.subjects.recordActivity({ actor: f.actor, invocation: { session_id: f.actor.session_id, message_id: "shared", call_id: "retrieval" }, phase: "evidence-retrieval", outcome: "failed", detail: "Supported retrieval was denied", elapsed_ms: 10 })
    expect(f.learning.automatic.history.report(first.batch_id!, f.actor.session_id)!.availability).toBe("source-unavailable")
    const corrected = await f.run(), body = f.body(corrected.batch_id!)
    expect(body.new_sources).toBe(0)
    expect(body.withdrawn_learning_sources.map(x => x.id)).toEqual([retrieval.id])
    expect(body.retained.concerns.map(x => x.source.id)).toEqual([engineering.id])
    expect(f.derived.query("SELECT body_json,sha256 FROM learning_evaluation_reports WHERE batch_id=? AND slot='overall'").get(first.batch_id!)).toEqual(before)
    expect((await f.run()).replayed).toBe(true)
  } finally { f.close() }
})

test("a bounded failed batch reclassified as learning can be replaced; generic source loss cannot", async () => {
  const f = fixture()
  try {
    const work = f.store.observe(f.actor, undefined, { phase: "finished", status: "error", tool: "codemode", message_id: "m", call_id: "read" })
    const original = f.learning.automatic.sources.resolve.bind(f.learning.automatic.sources)
    const fail = spyOn(f.learning.automatic.sources, "resolve").mockImplementation((ref, ns) => ref.id === work.id ? null : original(ref, ns))
    await expect(f.run()).rejects.toThrow("source unavailable")
    const blocked = f.learning.automatic.history.latestInScope(f.actor.session_id, INCREMENTAL_SCOPE)!
    expect(blocked.published_state).toBe("blocked")
    fail.mockRestore()
    f.learning.automatic.subjects.recordActivity({ actor: f.actor, invocation: { session_id: f.actor.session_id, message_id: "m", call_id: "read" }, phase: "evidence-retrieval", outcome: "failed" })
    const result = await f.run()
    expect(result.batch_id).not.toBe(blocked.id)
    expect(f.body(result.batch_id!).new_sources).toBe(0)
    expect(f.body(result.batch_id!).excluded_sources).toBe(1)
    expect(f.learning.automatic.history.get(blocked.id, f.actor.session_id).published_state).toBe("blocked")
  } finally { f.close() }
})

test("increment source read resolves only the selected original and rejects foreign owner and forged position", async () => {
  const f = fixture()
  try {
    f.store.record(f.actor, undefined, { kind: "result", statement: "First original" })
    f.store.record(f.actor, undefined, { kind: "result", statement: "Second original" })
    const completed = await f.run(), members = f.learning.automatic.history.frozenIncrement(completed.batch_id!, f.actor.session_id).members
    const original = f.learning.automatic.sources.resolve.bind(f.learning.automatic.sources), read: string[] = []
    const probe = spyOn(f.learning.automatic.sources, "resolve").mockImplementation((ref, namespace) => { read.push(ref.id); return original(ref, namespace) })
    try {
      expect(f.learning.automatic.incrementSource(f.actor.session_id, completed.batch_id!, members[0]!.key, 0).availability).toBe("available")
      expect(read).toEqual([members[0]!.source_refs[0]!.id])
      expect(() => f.learning.automatic.incrementSource("foreign", completed.batch_id!, members[0]!.key, 0)).toThrow()
      expect(() => f.learning.automatic.incrementSource(f.actor.session_id, completed.batch_id!, members[0]!.key, 31)).toThrow()
    } finally { probe.mockRestore() }
  } finally { f.close() }
})

test("unchanged idle inspects cursor metadata without resolving prior original contents", async () => {
  const f = fixture()
  try {
    f.store.record(f.actor, undefined, { kind: "concern", statement: "Retained earlier finding" })
    const first = await f.run()
    const read = spyOn(f.learning.automatic.sources, "resolve")
    try {
      expect(await f.run()).toEqual({ state: "complete", batch_id: first.batch_id, replayed: true })
      expect(read).not.toHaveBeenCalled()
    } finally { read.mockRestore() }
  } finally { f.close() }
})

test("causal learning descendants never start automatic evaluation even when directly notified", async () => {
  const f = fixture()
  try {
    const parent = { session_id: f.actor.session_id, message_id: "parent-message", call_id: "research" }
    f.learning.automatic.subjects.recordActivity({ actor: f.actor, invocation: parent, phase: "research", outcome: "started" })
    f.learning.automatic.subjects.registerDescendant({ parent, child_session_id: "research-child", native_parent_session_id: f.actor.session_id })
    const child = { session_id: "research-child", agent: "coder" }
    f.store.record(child, undefined, { kind: "concern", statement: "Failed learning evidence read" })
    expect(await f.learning.automatic.runIncrement(child.session_id, async () => {}, new AbortController().signal)).toEqual({ state: "empty" })
    expect(f.learning.automatic.history.list(child.session_id).items).toEqual([])
    expect(f.derived.query("SELECT COUNT(*) AS n FROM learning_subject_subjects WHERE owner_session='research-child'").get()).toEqual({ n: 0 })
  } finally { f.close() }
})

test("lost publication acknowledgement does not duplicate the committed checkpoint", async () => {
  const f = fixture()
  try {
    f.store.record(f.actor, undefined, { kind: "result", statement: "Recorded verification" })
    const publish = f.learning.automatic.history.publish.bind(f.learning.automatic.history)
    const fault = spyOn(f.learning.automatic.history, "publish").mockImplementationOnce((...args) => { publish(...args); throw new Error("lost committed acknowledgement") })
    await expect(f.run()).rejects.toThrow("lost committed acknowledgement")
    fault.mockRestore()
    const head = f.learning.automatic.history.latestInScope(f.actor.session_id, INCREMENTAL_SCOPE, true)!
    expect(head.published_state).toBe("complete")
    expect(await f.run()).toEqual({ state: "complete", batch_id: head.id, replayed: true })
    expect(f.derived.query("SELECT COUNT(*) AS n FROM learning_evaluation_reports WHERE member_key IS NULL").get()).toEqual({ n: 1 })
  } finally { f.close() }
})

test("large exact originals page without skipped content and every page rechecks original availability", async () => {
  const f = fixture()
  try {
    const record = f.store.observe(f.actor, undefined, { phase: "finished", status: "completed", note: "Original context <&> " + "important finding & ".repeat(2000) })
    const result = await f.run(), member = f.learning.automatic.history.frozenIncrement(result.batch_id!, f.actor.session_id).members[0]!
    let after = 0, text = "", pages = 0
    for (;;) {
      const page = f.learning.automatic.incrementSource(f.actor.session_id, result.batch_id!, member.key, 0, { after, max_chars: 1000 })
      expect(page.value).toBeNull()
      expect(page.fragment!.after).toBe(after)
      expect(page.fragment!.text.length).toBeLessThanOrEqual(1000)
      text += page.fragment!.text; pages++
      if (page.next_after === null) break
      expect(page.next_after).toBeGreaterThan(after); after = page.next_after
    }
    expect(text).toBe(canonical(record)); expect(pages).toBeGreaterThan(1)
    f.action.query("DELETE FROM ledger WHERE id=?").run(record.id)
    expect(f.learning.automatic.incrementSource(f.actor.session_id, result.batch_id!, member.key, 0, { after: 1000 })).toMatchObject({ availability: "source-unavailable", value: null, fragment: null })
  } finally { f.close() }
})

test("the durable owner cursor prevents a one-source quantum from starving authored relationships after restart", async () => {
  const f = fixture()
  try {
    const original = f.store.record(f.actor, undefined, { kind: "result", statement: "Recorded source for one explicitly authored goal" })
    for (let i = 0; i < 10; i++) f.store.record(f.actor, undefined, { kind: "result", statement: "Continuing ledger work " + i })
    f.learning.objectives.create(f.actor, f.learning.objectives.ledgerSource(original.id), "Explicit fixture goal")
    const first = await f.run(1)
    const resumed = new Learning(f.derived, f.store, f.action)
    const second = await resumed.automatic.runIncrement(f.actor.session_id, async () => {}, new AbortController().signal, 1)
    const third = await f.run(1)
    const batches = [first, second, third].map(item => f.learning.automatic.history.frozenIncrement(item.batch_id!, f.actor.session_id))
    expect(batches.map(batch => batch.members[0]!.source_refs[0]!.kind)).toEqual(["ledger-record", "objective", "objective-link"])
    expect(batches.map(batch => batch.boundary.from_owner)).toEqual([0, 1, 2])
    expect(batches.map(batch => batch.boundary.through_owner)).toEqual([1, 2, 3])
    expect(batches[2]!.boundary.through_ledger).toBeLessThan(f.learning.automatic.sources.captureFrontier(f.actor.session_id).ledger)
  } finally { f.close() }
})

test("increment disclosure and page selection enumerate retained dependencies without reading any original", async () => {
  const f = fixture()
  try {
    const retained = f.store.record(f.actor, undefined, { kind: "concern", statement: "Private retained finding needs its own source grant" })
    const first = await f.run()
    const current = f.store.record(f.actor, undefined, { kind: "result", statement: "New separately authorized work" })
    const second = await f.run()
    const resolve = spyOn(f.learning.automatic.sources, "resolve")
    const disclosure = f.learning.automatic.history.incrementDisclosure(second.batch_id!, f.actor.session_id)
    expect(disclosure.source_refs.map(ref => ref.id).sort()).toEqual([retained.id, current.id].sort())
    expect(disclosure.members.flatMap(member => member.source_refs).map(ref => ref.id)).toEqual([current.id])
    expect(disclosure.report).toMatchObject({ id: disclosure.report_id })
    expect("body" in disclosure.report!).toBe(false)
    expect(f.learning.automatic.history.incrementPage(f.actor.session_id, INCREMENTAL_SCOPE, { limit: 1 }).items.map(row => row.id)).toEqual([second.batch_id!])
    expect(f.learning.automatic.history.batchScope(first.batch_id!, f.actor.session_id)).toBe(INCREMENTAL_SCOPE)
    expect(resolve).not.toHaveBeenCalled(); resolve.mockRestore()
  } finally { f.close() }
})

test("a concurrent append or publication cannot expand an already authorized incremental disclosure", async () => {
  const f = fixture()
  try {
    f.store.record(f.actor, undefined, { kind: "concern", statement: "Retained protected finding" })
    const first = await f.run(), authorized = f.learning.automatic.history.incrementDisclosure(first.batch_id!, f.actor.session_id)
    f.store.record(f.actor, undefined, { kind: "result", statement: "Append after authorization" })
    const controller = new AbortController(); let checks = 0
    await expect(f.run(128, async () => { if (++checks === 2) controller.abort(new Error("Before overall publication")) }, controller.signal)).rejects.toThrow("Before overall publication")
    const pending = f.learning.automatic.history.incrementalHead(f.actor.session_id, INCREMENTAL_SCOPE)!
    const beforePublication = f.learning.automatic.history.incrementDisclosure(pending.id, f.actor.session_id)
    expect(beforePublication.report).toBeNull()
    await f.run()
    const resolve = spyOn(f.learning.automatic.sources, "resolve")
    expect(() => f.learning.automatic.incrementProgress(f.actor.session_id, { limit: 1 }, { [first.batch_id!]: authorized.disclosure_sha256 }))
      .toThrow("page changed")
    expect(() => f.learning.automatic.incrementReport(f.actor.session_id, pending.id, {}, beforePublication.disclosure_sha256))
      .toThrow("disclosure changed")
    expect(resolve).not.toHaveBeenCalled(); resolve.mockRestore()
    const current = f.learning.automatic.history.incrementDisclosure(pending.id, f.actor.session_id)
    expect(f.learning.automatic.incrementReport(f.actor.session_id, pending.id, {}, current.disclosure_sha256).body).not.toBeNull()
  } finally { f.close() }
})
