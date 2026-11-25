import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EvaluatorExecution } from "../src/evaluator-execution.js"
import type { Actor } from "../src/model.js"
import type { EvaluatorExecutionAuthority, EvaluatorExecutionReceipt } from "../src/evaluator-execution-contract.js"
import { ACTOR, NOW, FixtureExecutionAuthority, firstSource, freshSignal, openState, pins, prepareFixture,
  type FixtureState, type PreparedFixture } from "./helpers/evaluator-execution-fixture.js"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "loom-execution-corrections-")), statePath = join(root, "state"), pool = join(root, "authority.sqlite")
  const states = [openState(statePath)], authorities = [new FixtureExecutionAuthority(pool)]
  const state = states[0]!, authority = authorities[0]!
  return { state, authority,
    runtime(s: FixtureState = state, a: EvaluatorExecutionAuthority = authority,
      authorize: (actor: Actor) => Promise<void> = async () => {}) {
      return new EvaluatorExecution(s.learning.evaluator, s.learning.automatic.history, s.store, { authority: a, authorize }, () => NOW)
    },
    open() { const s = openState(statePath); states.push(s); return s },
    connect() { const a = new FixtureExecutionAuthority(pool); authorities.push(a); return a },
    close() {
      for (const s of states) s.close()
      for (const a of authorities) a.close()
      rmSync(root, { recursive: true, force: true })
    } }
}
function authorityWith(base: FixtureExecutionAuthority, changes: Partial<EvaluatorExecutionAuthority>): EvaluatorExecutionAuthority {
  return { reconcile: base.reconcile.bind(base), prepare: base.prepare.bind(base), reserve: base.reserve.bind(base),
    validate: base.validate.bind(base), execute: base.execute.bind(base), cancel: base.cancel.bind(base), ...changes }
}
function currentIssue(state: FixtureState, prepared: PreparedFixture) {
  return state.store.reviews.readIssue(ACTOR, prepared.request_id)
}
function markReservationUncertain(authority: FixtureExecutionAuthority) {
  // The external fixture owner changes its durable accounting state. This does
  // not inject a claim, a result, or the consumer's desired outcome.
  const snapshot = authority.all()[0]
  if (!snapshot) throw new Error("Expected a real fixture reservation")
  const receipt = { ...snapshot.receipt, sequence: snapshot.receipt.sequence + 1,
    receipt_id: `${snapshot.receipt.receipt_id}-uncertain`, budget: "uncertain" }
  authority.db.query("UPDATE fixture_enrollments SET receipt=? WHERE semantic_key=?")
    .run(JSON.stringify(receipt), snapshot.admission.grant.subject.semantic_key)
}
async function preparedFixture(f: ReturnType<typeof fixture>) {
  const value = await prepareFixture(f.state)
  f.authority.source = firstSource(f.state, value.prepared)
  return value
}
function expectNoClaimOrExecution(f: ReturnType<typeof fixture>, prepared: PreparedFixture) {
  expect(currentIssue(f.state, prepared).attempt.claimant_id).toBeNull()
  expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 0, execute_calls: 0, effects: 0 })
}
async function loseReservationAcknowledgement(f: ReturnType<typeof fixture>, prepared: PreparedFixture) {
  f.authority.phase = async phase => { if (phase === "reserved") throw new Error("lost-reservation-ack") }
  await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("lost-reservation-ack")
  f.authority.phase = async () => {}
  expectNoClaimOrExecution(f, prepared)
}

test("a newly reserved admission with uncertain accounting never claims or enters execution", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    let changed = false
    f.authority.phase = async phase => {
      if (phase === "reserved") { markReservationUncertain(f.authority); changed = true }
    }
    await Promise.allSettled([f.runtime().execute(ACTOR, pins(prepared), freshSignal())])
    expect(changed).toBe(true)
    expectNoClaimOrExecution(f, prepared)
  } finally { f.close() }
})

test("replayed inventory with uncertain reservation accounting never claims or enters execution", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    await loseReservationAcknowledgement(f, prepared)
    markReservationUncertain(f.authority)
    await Promise.allSettled([f.runtime().execute(ACTOR, pins(prepared), freshSignal())])
    expectNoClaimOrExecution(f, prepared)
  } finally { f.close() }
})

test("an old held receipt cannot bypass a newer locally reconciled uncertain reservation", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    await loseReservationAcknowledgement(f, prepared)
    const held = await f.runtime().recover(ACTOR, pins(prepared))
    expect(held.receipt.budget).toBe("held")
    markReservationUncertain(f.authority)
    const recovered = await f.runtime().recover(ACTOR, pins(prepared))
    expect(recovered.receipt.budget).toBe("uncertain")
    let replayed = 0
    const replay = authorityWith(f.authority, {
      async reconcile(subject) {
        if (replayed++ === 0) return held
        return f.authority.reconcile(subject)
      },
    })
    await Promise.allSettled([f.runtime(f.state, replay).execute(ACTOR, pins(prepared), freshSignal())])
    expect(replayed).toBeGreaterThan(0)
    expectNoClaimOrExecution(f, prepared)
  } finally { f.close() }
})

for (const boundary of ["claim-validation", "caller-authorization-after-validation"] as const) {
  test(`accounting becoming uncertain during ${boundary} blocks the canonical claim`, async () => {
    const f = fixture()
    try {
      const { prepared } = await preparedFixture(f)
      let validated = false, changed = false
      f.authority.phase = async phase => {
        if (phase !== "claim") return
        validated = true
        if (boundary === "claim-validation") { markReservationUncertain(f.authority); changed = true }
      }
      const authorize = async () => {
        if (validated && !changed && boundary === "caller-authorization-after-validation") {
          await Promise.resolve()
          markReservationUncertain(f.authority)
          changed = true
        }
      }
      await Promise.allSettled([f.runtime(f.state, f.authority, authorize).execute(ACTOR, pins(prepared), freshSignal())])
      expect(validated).toBe(true)
      expect(changed).toBe(true)
      expectNoClaimOrExecution(f, prepared)
    } finally { f.close() }
  })
}

test("a current held reservation recovers a lost reserve acknowledgement and executes exactly once", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f)
    await loseReservationAcknowledgement(f, prepared)
    const before = await f.runtime().recover(ACTOR, pins(prepared))
    expect(before.receipt).toMatchObject({ execution: "reserved", budget: "held", fenced: false })
    const complete = await f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    expect(complete.receipt).toMatchObject({ execution: "completed", budget: "settled" })
    expect((await f.runtime().recover(ACTOR, pins(prepared))).receipt.result).toEqual(complete.receipt.result)
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
  } finally { f.close() }
})

for (const violation of ["omitted", "swallowed-failure"] as const) {
  test(`claim validation that ${violation === "omitted" ? "omits" : "swallows failure of"} the caller recheck cannot create a claim`, async () => {
    const f = fixture()
    try {
      const { prepared } = await preparedFixture(f)
      let denyCaller = false, callbackFailures = 0, validations = 0, cancellations = 0
      const authority = authorityWith(f.authority, {
        async validate(admission, boundary, recheckCaller) {
          if (boundary !== "claim") return f.authority.validate(admission, boundary, recheckCaller)
          validations++
          if (violation === "swallowed-failure") {
            denyCaller = true
            try { await recheckCaller!() } catch { callbackFailures++ }
          }
          // Deliberately nonconforming external adapter: even a held receipt
          // cannot substitute for a successfully completed caller check.
          return f.authority.all()[0]!.receipt
        },
        async cancel(admission) { cancellations++; return f.authority.cancel(admission) },
      })
      const authorize = async () => { if (denyCaller) throw new Error("caller-check-failed") }
      await expect(f.runtime(f.state, authority, authorize).execute(ACTOR, pins(prepared), freshSignal()))
        .rejects.toThrow("omitted caller revalidation")
      expect(validations).toBe(1)
      expect(callbackFailures).toBe(violation === "swallowed-failure" ? 1 : 0)
      expect(cancellations).toBe(0)
      expectNoClaimOrExecution(f, prepared)
    } finally { f.close() }
  })
}

for (const violation of ["missing", "wrong-reservation"] as const) {
  test(`a ${violation} current reservation receipt is rejected before claiming`, async () => {
    const f = fixture()
    try {
      const { prepared } = await preparedFixture(f)
      let validations = 0
      const authority = authorityWith(f.authority, {
        async validate(...args) {
          const valid = await f.authority.validate(...args)
          if (args[1] !== "claim") return valid
          validations++
          // Intentionally malformed values cross the trusted adapter seam to
          // check consumer validation, not to manufacture product authority.
          return violation === "missing" ? undefined as unknown as EvaluatorExecutionReceipt
            : { ...valid, reservation_id: "another-reservation" }
        },
      })
      await expect(f.runtime(f.state, authority).execute(ACTOR, pins(prepared), freshSignal()))
        .rejects.toThrow(violation === "missing" ? "Invalid execution record" : "binding mismatch")
      expect(validations).toBe(1)
      expectNoClaimOrExecution(f, prepared)
    } finally { f.close() }
  })
}

for (const failure of ["caller-authorization", "caller-abort", "lost-losing-claim-ack"] as const) {
  test(`a losing contender's ${failure} cannot cancel another worker's in-flight execution`, async () => {
    const f = fixture(), loserAtClaim = deferred(), releaseLoser = deferred(), winnerInFlight = deferred(), finishWinner = deferred()
    let loser: Promise<PromiseSettledResult<unknown>[]> | undefined
    let winner: Promise<Awaited<ReturnType<EvaluatorExecution["execute"]>>> | undefined
    try {
      const { prepared } = await preparedFixture(f), other = f.open(), winningAuthority = f.connect()
      winningAuthority.source = firstSource(other, prepared)
      const controller = new AbortController()
      let permitted = true, cancellations = 0, losingClaimStatus: string | undefined
      const authority = authorityWith(f.authority, {
        async cancel(admission) { cancellations++; return f.authority.cancel(admission) },
      })
      f.authority.phase = async phase => {
        if (phase === "claim") { loserAtClaim.resolve(); await releaseLoser.promise }
      }
      winningAuthority.phase = async phase => {
        // Keep a held receipt for the claim-ack race so the contender reaches
        // real canonical arbitration even when current accounting is checked.
        if (phase === (failure === "lost-losing-claim-ack" ? "before-consume" : "consumed")) {
          winnerInFlight.resolve(); await finishWinner.promise
        }
      }
      const claim = f.state.store.reviews.claimIssue.bind(f.state.store.reviews)
      if (failure === "lost-losing-claim-ack") {
        f.state.store.reviews.claimIssue = (...args) => {
          const result = claim(...args)
          losingClaimStatus = result.status
          throw new Error("losing-claim-ack-lost")
        }
      }
      const authorize = async () => { if (!permitted) throw new Error("losing-caller-permission-revoked") }
      // Install rejection handling immediately, before releasing either worker.
      loser = Promise.allSettled([f.runtime(f.state, authority, authorize).execute(ACTOR, pins(prepared), controller.signal)])
      await loserAtClaim.promise
      winner = f.runtime(other, winningAuthority).execute(ACTOR, pins(prepared), freshSignal())
      await winnerInFlight.promise
      const claimant = currentIssue(other, prepared).attempt.claimant_id
      expect(claimant).not.toBeNull()
      const consumed = failure === "lost-losing-claim-ack" ? 0 : 1
      expect(f.authority.counts()).toEqual({ reservations: 1, consumed, execute_calls: 1, effects: consumed })
      if (failure === "caller-authorization") permitted = false
      if (failure === "caller-abort") controller.abort(new Error("losing-caller-aborted"))
      releaseLoser.resolve()
      const [failed] = await loser
      expect(failed?.status).toBe("rejected")
      if (failed?.status === "rejected") expect(String(failed.reason)).toContain(failure === "caller-authorization"
        ? "losing-caller-permission-revoked" : failure === "caller-abort" ? "losing-caller-aborted" : "losing-claim-ack-lost")
      if (failure === "lost-losing-claim-ack") expect(losingClaimStatus).not.toBe("claimed-now")
      expect(cancellations).toBe(0)
      expect(f.authority.all()[0]!.receipt).toMatchObject(failure === "lost-losing-claim-ack"
        ? { execution: "reserved", budget: "held", fenced: false }
        : { execution: "unknown", budget: "uncertain", fenced: false })
      expect(currentIssue(other, prepared).attempt.claimant_id).toBe(claimant)
      finishWinner.resolve()
      const completed = await winner
      expect(completed.receipt).toMatchObject({ execution: "completed", budget: "settled" })
      expect(completed.receipt.result).not.toBeNull()
      expect((await f.runtime(other, winningAuthority).recover(ACTOR, pins(prepared))).receipt.result).toEqual(completed.receipt.result)
      expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    } finally {
      releaseLoser.resolve(); finishWinner.resolve()
      await loser
      await winner?.catch(() => {})
      f.close()
    }
  })
}

test("a winning claim with a lost acknowledgement remains consumed and recovers without execution", async () => {
  const f = fixture()
  try {
    const { prepared } = await preparedFixture(f), observer = f.open()
    const claim = f.state.store.reviews.claimIssue.bind(f.state.store.reviews)
    let attemptedClaimant: string | undefined
    f.state.store.reviews.claimIssue = (...args) => {
      attemptedClaimant = args[2]
      const result = claim(...args)
      expect(result.status).toBe("claimed-now")
      throw new Error("winning-claim-ack-lost")
    }
    await expect(f.runtime().execute(ACTOR, pins(prepared), freshSignal())).rejects.toThrow("winning-claim-ack-lost")
    f.state.store.reviews.claimIssue = claim
    expect(attemptedClaimant).toBeDefined()
    expect(currentIssue(observer, prepared).attempt.claimant_id).toBe(attemptedClaimant!)
    const recovered = await f.runtime(observer, f.connect()).recover(ACTOR, pins(prepared))
    expect(recovered.receipt).toMatchObject({ execution: "not-admitted", budget: "released", fenced: true,
      usage: { requests: 0, input_tokens: 0, output_tokens: 0 } })
    await f.runtime(observer, f.connect()).execute(ACTOR, pins(prepared), freshSignal())
    expect(currentIssue(observer, prepared).attempt.claimant_id).toBe(attemptedClaimant!)
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 0, execute_calls: 0, effects: 0 })
  } finally { f.close() }
})

for (const aborted of [false, true]) {
  test(`lost claim acknowledgement with unreadable ownership${aborted ? " and caller abort" : ""} cannot cancel shared work`, async () => {
    const f = fixture(), controller = new AbortController()
    try {
      const { prepared } = await preparedFixture(f), observer = f.open()
      const claim = f.state.store.reviews.claimIssue.bind(f.state.store.reviews)
      const readIssue = f.state.store.reviews.readIssue.bind(f.state.store.reviews)
      let unreadable = false, attemptedClaimant: string | undefined, cancellations = 0
      const authority = authorityWith(f.authority, {
        async cancel(admission) { cancellations++; return f.authority.cancel(admission) },
      })
      f.state.store.reviews.readIssue = (...args) => {
        if (unreadable) throw new Error("canonical ownership temporarily unavailable")
        return readIssue(...args)
      }
      f.state.store.reviews.claimIssue = (...args) => {
        attemptedClaimant = args[2]
        expect(claim(...args).status).toBe("claimed-now")
        unreadable = true
        if (aborted) controller.abort(new Error("caller aborted after possible claim"))
        throw new Error("claim-ack-lost-with-unreadable-owner")
      }
      await expect(f.runtime(f.state, authority).execute(ACTOR, pins(prepared), controller.signal))
        .rejects.toThrow("claim-ack-lost-with-unreadable-owner")
      expect(attemptedClaimant).toBeDefined()
      expect(currentIssue(observer, prepared).attempt.claimant_id).toBe(attemptedClaimant!)
      expect(cancellations).toBe(0)
      expect(f.authority.all()[0]!.receipt).toMatchObject({ execution: "reserved", budget: "held", fenced: false })
      unreadable = false
      f.state.store.reviews.claimIssue = claim
      f.state.store.reviews.readIssue = readIssue
      const recovered = await f.runtime(observer, f.connect()).recover(ACTOR, pins(prepared))
      expect(recovered.receipt).toMatchObject({ execution: "reserved", budget: "held", fenced: false })
      await f.runtime(observer, f.connect()).execute(ACTOR, pins(prepared), freshSignal())
      expect(currentIssue(observer, prepared).attempt.claimant_id).toBe(attemptedClaimant!)
      expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 0, execute_calls: 0, effects: 0 })
    } finally { f.close() }
  })
}

test("explicit canonical cancellation still fences shared work and reconciles its late original result", async () => {
  const f = fixture(), entered = deferred(), resume = deferred()
  let execution: Promise<Awaited<ReturnType<EvaluatorExecution["execute"]>>> | undefined
  try {
    const { prepared } = await preparedFixture(f), observer = f.open(), otherAuthority = f.connect()
    f.authority.phase = async phase => { if (phase === "consumed") { entered.resolve(); await resume.promise } }
    execution = f.runtime().execute(ACTOR, pins(prepared), freshSignal())
    await entered.promise
    const claimant = currentIssue(observer, prepared).attempt.claimant_id
    const cancelled = await f.runtime(observer, otherAuthority).cancel(ACTOR, pins(prepared))
    expect(cancelled.receipt).toMatchObject({ execution: "cancelled", budget: "uncertain", fenced: true })
    expect(currentIssue(observer, prepared).attempt.claimant_id).toBe(claimant)
    resume.resolve()
    const late = await execution
    expect(late.receipt).toMatchObject({ execution: "cancelled", budget: "settled", fenced: true })
    expect(late.receipt.result).not.toBeNull()
    expect((await f.runtime(observer, otherAuthority).recover(ACTOR, pins(prepared))).receipt.result).toEqual(late.receipt.result)
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
  } finally { resume.resolve(); await execution?.catch(() => {}); f.close() }
})
