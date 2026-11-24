import { expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EvaluatorExecution } from "../src/evaluator-execution.js"
import type { Actor } from "../src/model.js"
import type { EvaluatorExecutionAuthority } from "../src/evaluator-execution-contract.js"
import { ACTOR, NOW, POLICY, FixtureExecutionAuthority, firstSource, freshSignal, method, openState, pins, prepareFixture,
  type FixtureState, type PreparedFixture } from "./helpers/evaluator-execution-fixture.js"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function fixture(capacity = 10) {
  const root = mkdtempSync(join(tmpdir(), "loom-execution-contract-")), statePath = join(root, "state"), pool = join(root, "authority.sqlite")
  const states = [openState(statePath)], authorities = [new FixtureExecutionAuthority(pool, capacity)]
  const state = states[0]!, authority = authorities[0]!
  const runtime = (s: FixtureState = state, a: EvaluatorExecutionAuthority = authority, authorize: (actor: Actor) => Promise<void> = async () => {}, clock = () => NOW) =>
    new EvaluatorExecution(s.learning.evaluator, s.learning.automatic.history, s.store, { authority: a, authorize }, clock)
  return { root, state, statePath, pool, authority, runtime,
    open() { const s = openState(statePath); states.push(s); return s },
    connect() { const a = new FixtureExecutionAuthority(pool); authorities.push(a); return a },
    close() { for (const s of states) s.close(); for (const a of authorities) { try { a.close() } catch {} }; rmSync(root, { recursive: true, force: true }) } }
}
function issue(state: FixtureState, prepared: PreparedFixture, actor = ACTOR) {
  return state.store.reviews.readIssue(actor, prepared.request_id)
}
function saved(state: FixtureState, prepared: PreparedFixture, actor = ACTOR) {
  const result = state.learning.automatic.history.readExecution(prepared.batch_id, actor.session_id)
  if (!result) throw new Error("Expected saved admission")
  return result
}
function authorityWith(base: FixtureExecutionAuthority, changes: Partial<EvaluatorExecutionAuthority>): EvaluatorExecutionAuthority {
  return { reconcile: base.reconcile.bind(base), prepare: base.prepare.bind(base), reserve: base.reserve.bind(base),
    validate: base.validate.bind(base), execute: base.execute.bind(base), cancel: base.cancel.bind(base), ...changes }
}
async function preparedFixture(f: ReturnType<typeof fixture>) {
  const x = await prepareFixture(f.state)
  f.authority.source = firstSource(f.state, x.prepared)
  return x
}

test("one fresh claim executes against actual prepared originals; replay only recovers the same result", async () => {
  const f = fixture()
  try {
    const { prepared, sourceBatch } = await preparedFixture(f)
    const stage3 = f.state.learning.automatic.history.report(sourceBatch, ACTOR.session_id)
    const result = await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    expect(result).toMatchObject({ qualification: "execution-consumer-only", interpretation: null,
      receipt: { execution: "completed", budget: "settled", usage: { requests: 1 } } })
    const originalResult = result.receipt.result
    expect(originalResult).not.toBeNull()
    const native = f.authority.db.query("SELECT content FROM fixture_results WHERE result_id=?").get(originalResult!.result_id) as { content: string }
    expect(native.content).toContain("Actual synthetic engineering source")
    expect(await f.runtime().execute(ACTOR, pins(prepared), freshSignal())).toEqual(result)
    expect(await f.runtime().recover(ACTOR, pins(prepared))).toEqual(result)
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    expect(issue(f.state, prepared).attempt).toMatchObject({ state: "issued", native_outcome: "issued" })
    expect(saved(f.state, prepared).receipts.at(-1)?.result).toEqual(originalResult)
    expect(f.state.learning.automatic.history.report(sourceBatch, ACTOR.session_id)).toEqual(stage3)
    expect(f.state.learning.evaluator.read(ACTOR.session_id, prepared.batch_id).interpretation).toBeNull()
  } finally { f.close() }
})

test("production construction has no execution authority and cannot reserve or claim", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    const runtime = new EvaluatorExecution(f.state.learning.evaluator, f.state.learning.automatic.history, f.state.store)
    for (const run of [() => runtime.execute(ACTOR, pins(prepared), freshSignal()), () => runtime.recover(ACTOR, pins(prepared)), () => runtime.cancel(ACTOR, pins(prepared))])
      await expect(run()).rejects.toThrow("authority-unavailable")
    expect(issue(f.state, prepared).attempt.claimant_id).toBeNull()
    expect(f.authority.counts().reservations).toBe(0)
  } finally { f.close() }
})

test("missing budget, extra authority fields, changed pins and a foreign owner cannot admit", async () => {
  const f = fixture()
  try {
    const { prepared, sourceBatch } = await preparedFixture(f)
    const unbudgeted = f.state.learning.evaluator.prepare(ACTOR, sourceBatch, method(), null)
    await expect(f.runtime().execute(ACTOR, pins(unbudgeted), freshSignal())).rejects.toThrow("budget")
    await expect(f.runtime().execute(ACTOR, { ...pins(prepared), effect_permit: true } as ReturnType<typeof pins>, freshSignal())).rejects.toThrow("pins")
    await expect(f.runtime().execute(ACTOR, { ...pins(prepared), attempt_id: "forged-attempt" }, freshSignal())).rejects.toThrow("mismatch")
    await expect(f.runtime().execute({ ...ACTOR, session_id: "foreign" }, pins(prepared), freshSignal())).rejects.toThrow()
    expect(f.authority.counts().reservations).toBe(0)
    expect(issue(f.state, prepared).attempt.claimant_id).toBeNull()
  } finally { f.close() }
})

for (const change of ["subject", "method", "recipient", "model", "expiry", "extra-field"] as const) {
  test(`consumer rejects ${change} in an authority response before reservation`, async () => {
    const f = fixture()
    try {
      const { prepared } = await preparedFixture(f)
      let reserves = 0
      const authority = authorityWith(f.authority, {
        async prepare(...args) {
          const grant = structuredClone(await f.authority.prepare(...args))
          if (change === "subject") grant.subject.request_id = "wrong-request"
          if (change === "method") grant.method.rubric.sha256 = "c".repeat(64)
          // Malformed negative inputs deliberately cross the typed adapter seam.
          if (change === "recipient") (grant.recipient as { agent: string }).agent = "coder"
          if (change === "model") grant.account.model_id = "different-model"
          if (change === "expiry") grant.expires_at = new Date(NOW).toISOString()
          if (change === "extra-field") Object.assign(grant, { verified: true })
          return grant
        }, async reserve(grant) { reserves++; return f.authority.reserve(grant) },
      })
      await expect(f.runtime(f.state, authority).execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow()
      expect(reserves).toBe(0)
      expect(f.authority.counts().effects).toBe(0)
      expect(issue(f.state, prepared).attempt.claimant_id).toBeNull()
    } finally { f.close() }
  })
}

test("forged grant and missing operator grant fail at the actual fixture owner", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    const missing = authorityWith(f.authority, { async prepare() { throw new Error("No separate fixture operator approval") } })
    await expect(f.runtime(f.state, missing).execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("approval")
    const forged = authorityWith(f.authority, { async prepare(...args) {
      const grant = await f.authority.prepare(...args)
      return { ...grant, grant_id: "caller-forged-grant" }
    } })
    await expect(f.runtime(f.state, forged).execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("authority")
    expect(f.authority.counts()).toEqual({ reservations: 0, consumed: 0, execute_calls: 0, effects: 0 })
  } finally { f.close() }
})

for (const boundary of ["reserved", "claim", "before-consume"] as const) {
  test(`revocation at ${boundary} fences before the fixture effect`, async () => {
    const f = fixture()
    try {
      const { prepared } = await preparedFixture(f)
      f.authority.phase = async phase => { if (phase === boundary) f.authority.revoke() }
      await Promise.allSettled([f.runtime().execute(ACTOR, pins(prepared), freshSignal())])
      expect(f.authority.counts().effects).toBe(0)
      const remote = f.authority.all()[0]!
      expect(remote.receipt).toMatchObject({ execution: "not-admitted", budget: "released", fenced: true })
      expect(remote.receipt.usage?.requests).toBe(0)
      await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
      expect(f.authority.counts().effects).toBe(0)
    } finally { f.close() }
  })
}

test("changed credential generation and changed original before claim are denied", async () => {
  for (const change of ["account", "source"] as const) {
    const f = fixture()
    try {
      const { prepared, original } = await preparedFixture(f)
      f.authority.phase = async phase => {
        if (phase !== "reserved") return
        if (change === "account") f.authority.changeAccount()
        else f.state.ledger.query("UPDATE ledger SET data=json_set(data,'$.data.statement','modified original') WHERE id=?").run(original.id)
      }
      await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow()
      expect(f.authority.counts().effects).toBe(0)
      expect(issue(f.state, prepared).attempt.claimant_id).toBeNull()
      expect(f.authority.all()[0]!.receipt.budget).toBe("released")
    } finally { f.close() }
  }
})

test("two connections competing for the same canonical issue produce one consumer execution entry", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f), other = f.open(), authority2 = f.connect()
    authority2.source = firstSource(other, prepared)
    const outcomes = await Promise.allSettled([
      f.runtime().execute(ACTOR, pins(prepared), freshSignal()), f.runtime(other, authority2).execute(ACTOR, pins(prepared), freshSignal()),
    ])
    expect(outcomes.some(x => x.status === "fulfilled")).toBe(true)
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    expect(f.state.store.reviews.issues.list(ACTOR, prepared.request_id).items).toHaveLength(1)
  } finally { f.close() }
})

test("independent issues share capacity; an uncertain consumed reservation cannot expire or free budget", async () => {
  const f = fixture(1)
  try {
    const { prepared } = await preparedFixture(f)
    const otherActor = { session_id: "second-owner", agent: "general" }
    const second = await prepareFixture(f.state, otherActor, "Independent synthetic objective")
    f.authority.phase = async phase => { if (phase === "consumed") throw new Error("lost-native-ack") }
    await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("lost-native-ack")
    expect(f.authority.all()[0]!.receipt).toMatchObject({ execution: "unknown", budget: "uncertain" })
    await expect(f.runtime().execute(otherActor, pins(second.prepared), freshSignal())).rejects.toThrow("pool exhausted")
    const claimed = f.state.learning.automatic.history.claim(prepared.batch_id, "new-processor", { now_ms: NOW, lease_ms: 1 })
    expect(claimed.status).toBe("claimed")
    expect(f.state.learning.automatic.history.claim(prepared.batch_id, "replacement-processor", { now_ms: NOW + 2 }).status).toBe("claimed")
    await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    expect(issue(f.state, second.prepared, otherActor).attempt.claimant_id).toBeNull()
  } finally { f.close() }
})

test("lost reserve acknowledgement recovers one held reservation before a fresh claim", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    f.authority.phase = async phase => { if (phase === "reserved") throw new Error("lost-reserve-ack") }
    await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("lost-reserve-ack")
    expect(issue(f.state, prepared).attempt.claimant_id).toBeNull()
    expect((await f.runtime().recover(ACTOR, pins(prepared))).receipt).toMatchObject({ execution: "reserved", budget: "held" })
    f.authority.phase = async () => {}
    await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
  } finally { f.close() }
})

test("lost claim acknowledgement consumes the issue and can only release after authority fencing", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f), claim = f.state.store.reviews.claimIssue.bind(f.state.store.reviews)
    f.state.store.reviews.claimIssue = (...args) => { claim(...args); throw new Error("lost-claim-ack") }
    await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("lost-claim-ack")
    f.state.store.reviews.claimIssue = claim
    expect(issue(f.state, prepared).attempt.claimant_id).not.toBeNull()
    expect(f.authority.all()[0]!.receipt).toMatchObject({ execution: "not-admitted", budget: "released", fenced: true })
    await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    expect(f.authority.counts().effects).toBe(0)
    expect(f.authority.counts().execute_calls).toBe(0)
  } finally { f.close() }
})

test("result acknowledgement lost across restart recovers the exact original without another send", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    f.authority.phase = async phase => { if (phase === "result") throw new Error("lost-result-ack") }
    await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("lost-result-ack")
    const original = f.authority.all()[0]!.receipt.result
    f.state.close()
    const restarted = f.open(), authority = f.connect()
    const result = await f.runtime(restarted, authority).recover(ACTOR, pins(prepared))
    expect(result.receipt.result).toEqual(original)
    expect(result.receipt.budget).toBe("settled")
    await f.runtime(restarted, authority).execute(ACTOR, pins(prepared), freshSignal())
    expect(authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
  } finally { f.close() }
})

test("pre-start cancellation has no effect; cancellation during execution retains uncertainty and later original result", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f), abort = new AbortController()
    abort.abort()
    await expect(f.runtime().execute(ACTOR, pins(prepared), abort.signal)).rejects.toThrow()
    expect(f.authority.counts().reservations).toBe(0)
    const entered = deferred(), resume = deferred()
    f.authority.phase = async phase => { if (phase === "consumed") { entered.resolve(); await resume.promise } }
    const execution = f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    await entered.promise
    const cancelled = await f.runtime().cancel(ACTOR, pins(prepared))
    expect(cancelled.receipt).toMatchObject({ execution: "cancelled", budget: "uncertain", result: null, fenced: true })
    resume.resolve()
    const late = await execution
    expect(late.receipt.execution).toBe("cancelled")
    expect(late.receipt.result).not.toBeNull()
    expect(late.receipt.budget).toBe("settled")
    expect((await f.runtime().recover(ACTOR, pins(prepared))).receipt.result).toEqual(late.receipt.result)
    expect(f.authority.counts().effects).toBe(1)
  } finally { f.close() }
})

test("expiry blocks new inference while revoked disclosure cannot stop safe accounting recovery", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    let allowed = true
    const authorize = async () => { if (!allowed) throw new Error("source readback revoked") }
    f.authority.phase = async phase => { if (phase === "result") { allowed = false; throw new Error("lost result while revoked") } }
    await expect(f.runtime(f.state, f.authority, authorize).execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow()
    await expect(f.runtime(f.state, f.authority, authorize, () => NOW + 120_000).recover(ACTOR, pins(prepared))).rejects.toThrow("revoked")
    expect(saved(f.state, prepared).receipts.at(-1)?.budget).toBe("settled")
    allowed = true
    const recovered = await f.runtime(f.state, f.authority, authorize, () => NOW + 120_000).recover(ACTOR, pins(prepared))
    expect(recovered.receipt.result).toEqual(f.authority.all()[0]!.receipt.result)
    expect(f.authority.counts().effects).toBe(1)
  } finally { f.close() }
})

test("restoring pre-claim Loom databases recovers the authority result without recreating a claim", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f), backup = join(f.root, "backup")
    mkdirSync(backup)
    f.state.ledger.exec("PRAGMA wal_checkpoint(TRUNCATE)"); f.state.derived.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    for (const name of ["ledger.sqlite", "learning.sqlite"]) copyFileSync(join(f.statePath, name), join(backup, name))
    await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    const original = f.authority.all()[0]!.receipt.result
    f.state.close()
    for (const name of ["ledger.sqlite", "learning.sqlite"]) copyFileSync(join(backup, name), join(f.statePath, name))
    const restored = f.open()
    const result = await f.runtime(restored).execute(ACTOR, pins(prepared), freshSignal())
    expect(result.receipt.result).toEqual(original)
    expect(issue(restored, prepared).attempt.claimant_id).toBeNull()
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
  } finally { f.close() }
})

test("restoring before Stage 3 allocation fences a replacement request with the same semantic enrollment", async () => {
  const f = fixture()
  try {
    const original = f.state.store.record(ACTOR, undefined, { kind: "result", statement: "Source predates the old snapshot" })
    const backup = join(f.root, "before-stage3")
    mkdirSync(backup)
    f.state.ledger.exec("PRAGMA wal_checkpoint(TRUNCATE)"); f.state.derived.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    for (const name of ["ledger.sqlite", "learning.sqlite"]) copyFileSync(join(f.statePath, name), join(backup, name))
    async function prepareExisting(state: FixtureState) {
      const result = await state.learning.automatic.run(ACTOR.session_id, async () => {}, freshSignal())
      if (result.state !== "complete" || !result.batch_id) throw new Error("Expected bounded source batch")
      return state.learning.evaluator.prepare(ACTOR, result.batch_id, method(), POLICY)
    }
    const first = await prepareExisting(f.state)
    await f.runtime().execute(ACTOR, pins(first), freshSignal())
    f.state.close()
    for (const name of ["ledger.sqlite", "learning.sqlite"]) copyFileSync(join(backup, name), join(f.statePath, name))
    const restored = f.open(), replacement = await prepareExisting(restored)
    expect(replacement.request_id).not.toBe(first.request_id)
    expect(replacement.issue!.attempt.attempt_id).not.toBe(first.issue!.attempt.attempt_id)
    expect(restored.store.records({ session_id: ACTOR.session_id, record_id: original.id }).items).toHaveLength(1)
    await expect(f.runtime(restored).execute(ACTOR, pins(replacement), freshSignal())).rejects.toThrow("restore enrollment conflict")
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    expect(issue(restored, replacement).attempt.claimant_id).toBeNull()
  } finally { f.close() }
})

type CrashBoundary = "reserved" | "claimed" | "consumed" | "result"
function worker(f: ReturnType<typeof fixture>, prepared: PreparedFixture, options: { actor?: typeof ACTOR; stopAt?: CrashBoundary } = {}) {
  const process = Bun.spawn([processPath(), join(import.meta.dir, "helpers/evaluator-execution-worker.ts")], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  })
  process.stdin.write(JSON.stringify({ state: f.statePath, pool: f.pool, pins: pins(prepared), ...options }))
  process.stdin.end()
  return process
}
const processPath = () => process.execPath
async function workerResult(child: ReturnType<typeof worker>) {
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exit !== 0) throw new Error(`Fixture child failed (${exit}): ${stderr}`)
  const line = stdout.trim().split("\n").at(-1)
  if (!line) throw new Error("Fixture child produced no result")
  return JSON.parse(line) as { ok: boolean; error?: string }
}
async function killAtBoundary(child: ReturnType<typeof worker>, boundary: CrashBoundary) {
  const reader = child.stdout.getReader(), decoder = new TextDecoder()
  let output = ""
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000)
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) throw new Error("Fixture worker exited before requested crash boundary: " + output)
      output += decoder.decode(next.value)
      if (output.includes(JSON.stringify({ stopped_at: boundary }))) break
    }
    child.kill("SIGKILL")
    await child.exited
    expect(output).toContain(JSON.stringify({ stopped_at: boundary }))
  } finally { clearTimeout(timer); reader.releaseLock(); child.kill("SIGKILL"); await child.exited }
}

test("two real worker processes cannot issue the same canonical evaluation twice", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    const results = await Promise.all([workerResult(worker(f, prepared)), workerResult(worker(f, prepared))])
    expect(results.some(x => x.ok)).toBe(true)
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    expect(f.state.store.reviews.issues.list(ACTOR, prepared.request_id).items).toHaveLength(1)
    expect(issue(f.state, prepared).attempt.claimant_id).not.toBeNull()
  } finally { f.close() }
}, 15_000)

test("two independent issues in real worker processes cannot collectively exceed one shared capacity", async () => {
  const f = fixture(1)
  try {
    const { prepared } = await preparedFixture(f)
    const actor = { session_id: "other-fixture-owner", agent: "general" }
    const second = await prepareFixture(f.state, actor)
    const results = await Promise.all([workerResult(worker(f, prepared)), workerResult(worker(f, second.prepared, { actor }))])
    expect(results.filter(x => x.ok)).toHaveLength(1)
    expect(results.find(x => !x.ok)?.error).toContain("pool exhausted")
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
  } finally { f.close() }
}, 15_000)

test("SIGKILL after shared reservation retains the same reserved intent and cancellation fences it", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    await killAtBoundary(worker(f, prepared, { stopAt: "reserved" }), "reserved")
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 0, execute_calls: 0, effects: 0 })
    expect(issue(f.state, prepared).attempt.claimant_id).toBeNull()
    const originalReservation = f.authority.all()[0]!.admission.reservation_id
    expect((await f.runtime().recover(ACTOR, pins(prepared))).admission.reservation_id).toBe(originalReservation)
    const cancelled = await f.runtime().cancel(ACTOR, pins(prepared))
    expect(cancelled.receipt).toMatchObject({ execution: "not-admitted", budget: "released", fenced: true })
    await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    expect(f.authority.counts().effects).toBe(0)
  } finally { f.close() }
}, 15_000)

test("SIGKILL after possible native effect leaves consumed claim and uncertain budget across restart", async () => {
  const f = fixture(1)
  try {
    const { prepared } = await preparedFixture(f)
    await killAtBoundary(worker(f, prepared, { stopAt: "consumed" }), "consumed")
    const claimed = issue(f.state, prepared).attempt.claimant_id
    expect(claimed).not.toBeNull()
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    f.state.close()
    const reopened = f.open(), authority = f.connect()
    const recovered = await f.runtime(reopened, authority).recover(ACTOR, pins(prepared))
    expect(recovered.receipt).toMatchObject({ execution: "unknown", budget: "uncertain", result: null })
    await f.runtime(reopened, authority).execute(ACTOR, pins(prepared), freshSignal())
    expect(issue(reopened, prepared).attempt.claimant_id).toBe(claimed)
    expect(authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    const actor = { session_id: "after-crash-owner", agent: "general" }, second = await prepareFixture(reopened, actor)
    await expect(f.runtime(reopened, authority).execute(actor, pins(second.prepared), freshSignal())).rejects.toThrow("pool exhausted")
  } finally { f.close() }
}, 15_000)

for (const afterCommit of [false, true]) {
  test(`admission persistence ${afterCommit ? "lost acknowledgement" : "failure before write"} never issues before a durable envelope`, async () => {
    const f = fixture()
    try {
      const { prepared } = await preparedFixture(f), history = f.state.learning.automatic.history
      const save = history.saveExecutionAdmission.bind(history)
      history.saveExecutionAdmission = (...args) => {
        if (afterCommit) save(...args)
        throw new Error("injected-admission-write-failure")
      }
      await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("injected-admission-write-failure")
      history.saveExecutionAdmission = save
      expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 0, execute_calls: 0, effects: 0 })
      expect(issue(f.state, prepared).attempt.claimant_id).toBeNull()
      await f.runtime().recover(ACTOR, pins(prepared))
      await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
      expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    } finally { f.close() }
  })
}

test("receipt persistence acknowledgement failure reconciles the original without a replacement effect", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f), history = f.state.learning.automatic.history
    const append = history.appendExecutionReceipt.bind(history)
    let fail = true
    history.appendExecutionReceipt = (...args) => {
      const result = append(...args)
      if (fail) { fail = false; throw new Error("lost-receipt-commit-ack") }
      return result
    }
    await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("lost-receipt-commit-ack")
    const result = await f.runtime().recover(ACTOR, pins(prepared))
    expect(result.receipt.result).toEqual(f.authority.all()[0]!.receipt.result)
    expect(saved(f.state, prepared).receipts).toHaveLength(1)
    expect(f.authority.counts().effects).toBe(1)
  } finally { f.close() }
})

test("authority inventory loss after a durable local claim cannot be treated as nonexecution", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    f.authority.phase = async phase => { if (phase === "consumed") throw new Error("unknown-native-effect") }
    await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("unknown-native-effect")
    const absent = authorityWith(f.authority, { async reconcile() { return null } })
    await expect(f.runtime(f.state, absent).execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("history disagreement")
    await expect(f.runtime(f.state, absent).recover(ACTOR, pins(prepared))).rejects.toThrow("inventory unavailable")
    await expect(f.runtime(f.state, absent).cancel(ACTOR, pins(prepared))).rejects.toThrow("inventory unavailable")
    expect(f.authority.counts().effects).toBe(1)
    expect(saved(f.state, prepared).receipts.at(-1)?.budget).toBe("uncertain")
  } finally { f.close() }
})

test("post-completion original source loss withholds result disclosure while accounting remains retained", async () => {
  const f = fixture()
  try {
    const { prepared, original } = await preparedFixture(f)
    const completed = await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    f.state.ledger.query("DELETE FROM ledger WHERE id=?").run(original.id)
    await expect(f.runtime().recover(ACTOR, pins(prepared))).rejects.toThrow()
    expect(saved(f.state, prepared).receipts.at(-1)?.result).toEqual(completed.receipt.result)
    expect(saved(f.state, prepared).receipts.at(-1)?.budget).toBe("settled")
    expect(f.authority.counts().effects).toBe(1)
    expect(f.state.store.record(ACTOR, undefined, { kind: "result", statement: "Ordinary engineering work remains healthy" }).id).toBeTruthy()
  } finally { f.close() }
})

test("token reservations in the shared fixture pool remain held until authoritative settlement", async () => {
  for (const constrained of ["input_tokens", "output_tokens"] as const) {
    const f = fixture()
    const entered = deferred(), release = deferred()
    let inFlight: Promise<unknown> | undefined
    try {
      const { prepared } = await preparedFixture(f)
      const secondActor = { session_id: "token-pool-competitor", agent: "general" }, second = await prepareFixture(f.state, secondActor)
      f.authority.capacity({ requests: 2, input_tokens: 100, output_tokens: 100, [constrained]: 15 })
      f.authority.phase = async phase => { if (phase === "consumed") { entered.resolve(); await release.promise } }
      inFlight = f.runtime().execute(ACTOR, pins(prepared), freshSignal())
      await entered.promise
      await expect(f.runtime().execute(secondActor, pins(second.prepared), freshSignal())).rejects.toThrow("pool exhausted")
      expect(f.authority.counts().reservations).toBe(1)
      release.resolve()
      await inFlight
      f.authority.phase = async () => {}
      f.authority.source = firstSource(f.state, second.prepared, secondActor)
      await f.runtime().execute(secondActor, pins(second.prepared), freshSignal())
      expect(f.authority.counts().effects).toBe(2)
      expect(f.authority.all().every(x => x.receipt.budget === "settled")).toBe(true)
    } finally { release.resolve(); await inFlight?.catch(() => {}); f.close() }
  }
})

test("authority lookup failure after claim is not native rejection and retains uncertain reservation until fenced", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    f.authority.phase = async phase => { if (phase === "before-consume") throw new Error("native admission acknowledgement unavailable") }
    await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("acknowledgement unavailable")
    expect(issue(f.state, prepared).attempt).toMatchObject({ native_outcome: "unknown" })
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 0, execute_calls: 1, effects: 0 })
    expect(f.authority.all()[0]!.receipt.budget).toBe("held")
    await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    expect(f.authority.counts().execute_calls).toBe(1)
    expect((await f.runtime().cancel(ACTOR, pins(prepared))).receipt).toMatchObject({ budget: "released", fenced: true, execution: "not-admitted" })
    expect(issue(f.state, prepared).attempt.claimant_id).not.toBeNull()
  } finally { f.close() }
})

test("recipient source validation is rechecked before actual original return", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    f.authority.phase = async phase => { if (phase === "source") f.authority.revoke() }
    await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("revoked")
    expect(f.authority.counts().effects).toBe(0)
    expect(f.authority.db.query("SELECT COUNT(*) AS n FROM fixture_results").get()).toEqual({ n: 0 })
    expect(issue(f.state, prepared).attempt.claimant_id).not.toBeNull()
    expect(f.authority.all()[0]!.receipt.budget).toBe("held")
  } finally { f.close() }
})

test("SIGKILL after the local claim cannot convert the held reservation into a replacement permit", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    await killAtBoundary(worker(f, prepared, { stopAt: "claimed" }), "claimed")
    const claimant = issue(f.state, prepared).attempt.claimant_id
    expect(claimant).not.toBeNull()
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 0, execute_calls: 0, effects: 0 })
    await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    expect(issue(f.state, prepared).attempt.claimant_id).toBe(claimant)
    expect(f.authority.counts().execute_calls).toBe(0)
    expect(f.authority.all()[0]!.receipt.budget).toBe("held")
    expect((await f.runtime().cancel(ACTOR, pins(prepared))).receipt).toMatchObject({ execution: "not-admitted", budget: "released", fenced: true })
    expect(issue(f.state, prepared).attempt.claimant_id).toBe(claimant)
  } finally { f.close() }
}, 15_000)

test("SIGKILL after original result storage recovers that exact result without another effect", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    await killAtBoundary(worker(f, prepared, { stopAt: "result" }), "result")
    const original = f.authority.all()[0]!.receipt.result
    expect(original).not.toBeNull()
    expect(issue(f.state, prepared).attempt.native_outcome).toBe("unknown")
    expect(saved(f.state, prepared).receipts).toHaveLength(0)
    const recovered = await f.runtime().recover(ACTOR, pins(prepared))
    expect(recovered.receipt.result).toEqual(original)
    expect(recovered.receipt.budget).toBe("settled")
    await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
  } finally { f.close() }
}, 15_000)

test("an abort racing a late successful result retains the result but rejects uncancelled completion", async () => {
  const f = fixture(), controller = new AbortController()
  try {
    const { prepared } = await preparedFixture(f)
    let cancellations = 0
    f.authority.phase = async phase => {
      if (phase === "result") controller.abort(new Error("caller cancelled while native result was returning"))
      if (phase === "cancelled") cancellations++
    }
    await expect(f.runtime().execute(ACTOR, pins(prepared), controller.signal)).rejects.toThrow("caller cancelled")
    expect(cancellations).toBe(1)
    const original = f.authority.all()[0]!.receipt.result
    expect(original).not.toBeNull()
    expect(saved(f.state, prepared).receipts.at(-1)?.result).toEqual(original)
    expect((await f.runtime().recover(ACTOR, pins(prepared))).receipt.result).toEqual(original)
    expect(f.authority.counts().effects).toBe(1)
  } finally { f.close() }
})

for (const boundary of ["claim", "source"] as const) {
  for (const change of ["caller-revocation", "expiry-during-authority", "expiry-during-authorization"] as const) {
    test(`${boundary} rechecks ${change} after asynchronous authority validation`, async () => {
      const f = fixture(), marker = `ORIGINAL_MUST_REMAIN_PRIVATE_${boundary}_${change}`
      try {
        const { prepared } = await prepareFixture(f.state, ACTOR, marker)
        f.authority.source = firstSource(f.state, prepared)
        let allowed = true, now = NOW, passedBoundary = false, denied = 0, originalReads = 0
        const originalSource = f.state.learning.evaluator.source.bind(f.state.learning.evaluator)
        f.state.learning.evaluator.source = (...args) => { originalReads++; return originalSource(...args) }
        const authorize = async () => {
          if (!allowed) { denied++; throw new Error("caller source permission revoked") }
          if (passedBoundary && change === "expiry-during-authorization") {
            await Promise.resolve()
            now = NOW + 60_000
          }
        }
        f.authority.phase = async phase => {
          if (phase !== boundary) return
          await Promise.resolve()
          passedBoundary = true
          if (change === "caller-revocation") allowed = false
          if (change === "expiry-during-authority") now = NOW + 60_000
        }
        // Keep the fixture owner's clock independent. This regression must
        // exercise the consumer's deadline check after each awaited boundary.
        await expect(f.runtime(f.state, f.authority, authorize, () => now)
          .execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow(change === "caller-revocation" ? "permission revoked" : "expired")
        expect(passedBoundary).toBe(true)
        if (change === "caller-revocation") expect(denied).toBe(1)
        expect(originalReads).toBe(0)
        const results = f.authority.db.query("SELECT content FROM fixture_results").all() as { content: string }[]
        expect(results.some(result => result.content.includes(marker))).toBe(false)
        expect(results).toHaveLength(0)
        expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 0, execute_calls: boundary === "claim" ? 0 : 1, effects: 0 })
        if (boundary === "claim") {
          expect(issue(f.state, prepared).attempt.claimant_id).toBeNull()
          expect(f.authority.all()[0]!.receipt).toMatchObject({ execution: "not-admitted", budget: "released", fenced: true })
        } else {
          expect(issue(f.state, prepared).attempt.claimant_id).not.toBeNull()
          expect(f.authority.all()[0]!.receipt).toMatchObject({ execution: "reserved", budget: "held", fenced: false })
        }
      } finally { f.close() }
    })
  }
}

test("a delayed exact reserved observation returns the newer accepted completed result", async () => {
  const f = fixture(), captured = deferred(), resume = deferred()
  let delayed: ReturnType<EvaluatorExecution["recover"]> | undefined
  try {
    const { prepared } = await preparedFixture(f)
    f.authority.phase = async phase => { if (phase === "reserved") throw new Error("lost-reserve-ack") }
    await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("lost-reserve-ack")
    const reserved = await f.runtime().recover(ACTOR, pins(prepared))
    expect(reserved.receipt.execution).toBe("reserved")
    f.authority.phase = async () => {}
    const observer = f.open()
    const slowAuthority = authorityWith(f.authority, {
      async reconcile(subject) {
        const exactOldObservation = await f.authority.reconcile(subject)
        captured.resolve()
        await resume.promise
        return exactOldObservation
      },
    })
    delayed = f.runtime(observer, slowAuthority).recover(ACTOR, pins(prepared))
    await captured.promise
    const completed = await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    expect(completed.receipt.execution).toBe("completed")
    expect(completed.receipt.result).not.toBeNull()
    resume.resolve()
    const recovered = await delayed
    expect(recovered.receipt).toEqual(completed.receipt)
    expect(recovered.receipt.sequence).toBeGreaterThan(reserved.receipt.sequence)
    expect(saved(observer, prepared).receipts.at(-1)).toEqual(completed.receipt)
    expect(issue(observer, prepared).attempt.native_outcome).toBe("issued")
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
  } finally { resume.resolve(); await delayed?.catch(() => {}); f.close() }
})
