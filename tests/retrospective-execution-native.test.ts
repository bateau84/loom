import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EvaluatorExecution } from "../src/evaluator-execution.js"
import { canonical, digest, type Actor } from "../src/model.js"
import { evaluatorEnrollmentKey, type EvaluatorExecutionAuthority } from "../src/evaluator-execution-contract.js"
import { retrospectiveMemberKey, type RetrospectiveSources } from "../src/retrospective-contract.js"
import type { RetrospectiveSourceRequest, RetrospectiveSourceResolver } from "../src/retrospective-populations.js"
import { retrospectiveFixture } from "./helpers/retrospective-store-fixture.js"
import { ACTOR, FixtureExecutionAuthority, NOW, POLICY, freshSignal, method, openState, pins } from "./helpers/evaluator-execution-fixture.js"

function fixture(options: { gaps?: boolean; privateReview?: boolean; native?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "loom-retrospective-execution-")), state = openState(join(root, "state"))
  const authority = new FixtureExecutionAuthority(join(root, "authority.sqlite"))
  const manifest = retrospectiveFixture(2, state.store.reviews.storeID)
  manifest.members = manifest.members.map(member => {
    const original = state.store.record({ session_id: member.source.session_id!, agent: "worker" }, undefined,
      { kind: "result", statement: "Original frozen evidence " + member.source.id })
    const source = state.learning.automatic.sources.retrospectiveOriginal("ledger-record", original.id, original.session_id, ACTOR.session_id)!
    return { ...member, source: source.ref, key: retrospectiveMemberKey(manifest.source_store_id, source.ref, member.permitted_view),
      availability: options.gaps ? "unresolved" as const : "available" as const }
  })
  if (options.privateReview) {
    const member = manifest.members[0]!
    member.source = { kind: "review-request", id: "private-review", session_id: ACTOR.session_id, required: true }
    member.permitted_view = "review-request"; member.availability = "unresolved"
    member.key = retrospectiveMemberKey(manifest.source_store_id, member.source, member.permitted_view)
    manifest.contributors.push(ACTOR.session_id)
  }
  if (options.native) {
    const member = manifest.members[0]!
    member.source = { ...member.source, kind: "native-message", session_id: ACTOR.session_id }
    member.permitted_view = "native-user-text"
    member.key = retrospectiveMemberKey(manifest.source_store_id, member.source, member.permitted_view)
    manifest.contributors.push(ACTOR.session_id)
  }
  const population = state.learning.automatic.history.freezeRetrospective(ACTOR, manifest)
  const prepared = state.learning.evaluator.prepareRetrospective(ACTOR, population, method(), POLICY)
  const first = population.manifest.members[0]!
  authority.source = { memberKey: first.key, sourceIndex: 0 }
  const calls: RetrospectiveSourceRequest[] = [], permissions: Array<{ recipient: Actor; population: RetrospectiveSources }> = []
  let ownerAllowed = true, recipientAllowed = true, currentTime = NOW
  const authorize = async (actor: Actor) => {
    if (!ownerAllowed || actor.session_id !== ACTOR.session_id) throw new Error("Owner readback denied")
  }
  const authorizePopulation = async (recipient: Actor, sources: RetrospectiveSources) => {
    permissions.push({ recipient, population: sources })
    if (!ownerAllowed || sources.population_id !== population.population_id || sources.manifest_sha256 !== population.manifest_sha256
        || recipient.session_id !== ACTOR.session_id && (!recipientAllowed || recipient.agent !== "evaluator"
          || !recipient.session_id.startsWith("ses_fixture_"))) throw new Error("Recipient population denied")
  }
  const resolve: RetrospectiveSourceResolver = async request => {
    calls.push(request)
    if (!(request.purpose === "inspect" && ownerAllowed && request.recipient_session_id === ACTOR.session_id)
        && !(request.purpose === "execute" && recipientAllowed && request.recipient_session_id.startsWith("ses_fixture_")))
      throw new Error("Actual recipient source denied")
    const ref = request.source
    const original = state.learning.automatic.sources.retrospectiveOriginal(ref.kind, ref.id, ref.session_id!, request.recipient_session_id)
    return original ? { ...request, source: original.ref, status: "available", value: original.value } : { ...request, status: "missing" }
  }
  const runtime = (changes: Partial<EvaluatorExecutionAuthority> = {}, overrides: {
    resolve?: RetrospectiveSourceResolver; authorize?: typeof authorize; population?: typeof authorizePopulation;
  } = {}) => new EvaluatorExecution(state.learning.evaluator, state.learning.automatic.history, state.store, {
    authority: { reconcile: authority.reconcile.bind(authority), prepare: authority.prepare.bind(authority), reserve: authority.reserve.bind(authority),
      validate: authority.validate.bind(authority), execute: authority.execute.bind(authority), cancel: authority.cancel.bind(authority), ...changes },
    authorize: overrides.authorize ?? authorize, retrospective: { populations: state.learning.populations,
      resolve: overrides.resolve ?? resolve, authorize: overrides.population ?? authorizePopulation },
  }, () => currentTime)
  return { state, authority, population, prepared, calls, permissions, resolve, runtime,
    denyOwner() { ownerAllowed = false }, denyRecipient() { recipientAllowed = false },
    expire() { currentTime += 60_001; authority.clock = () => currentTime },
    issue: () => state.store.reviews.readIssue(ACTOR, prepared.request_id).attempt,
    close() { state.close(); authority.close(); rmSync(root, { recursive: true, force: true }) } }
}

test("v2 enrolls exact population and original recipient; completed replay has one execution", async () => {
  const f = fixture()
  try {
    const before = canonical(f.population)
    f.state.store.record({ session_id: "initial", agent: "worker" }, undefined, { kind: "result", statement: "Later history must stay outside" })
    const result = await f.runtime().execute(ACTOR, pins(f.prepared), freshSignal())
    expect(result.admission.grant.subject.source).toEqual(f.prepared.request.format === "loom-evaluation-request/v2" ? f.prepared.request.source : undefined)
    expect(result.receipt).toMatchObject({ execution: "completed", budget: "settled", usage: { requests: 1 } })
    expect(f.calls.length).toBeGreaterThanOrEqual(f.population.manifest.members.length * 3 + 1)
    expect(f.calls.filter(request => request.purpose === "execute").every(request => request.recipient_session_id === result.admission.grant.recipient.session_id)).toBe(true)
    expect(f.calls.filter(request => request.purpose === "inspect").every(request => request.recipient_session_id === ACTOR.session_id)).toBe(true)
    const saved = f.authority.db.query("SELECT content FROM fixture_results").get() as { content: string }
    const material = JSON.parse(saved.content).original
    expect(material).toMatchObject({ population_id: f.population.population_id, population_manifest_sha256: f.population.manifest_sha256,
      receiving_session: result.admission.grant.recipient.session_id, status: "available" })
    expect(material.population_manifest.selection).toEqual(f.population.manifest.selection)
    expect(material.member).toEqual(f.population.manifest.members[0])
    expect(saved.content).toContain("Original frozen evidence")
    expect(saved.content).not.toContain("Later history must stay outside")
    expect(canonical(f.state.learning.automatic.history.retrospectivePopulation(f.population.population_id))).toBe(before)
    expect(await f.runtime().execute(ACTOR, pins(f.prepared), freshSignal())).toEqual(result)
    expect(await f.runtime().recover(ACTOR, pins(f.prepared))).toEqual(result)
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
  } finally { f.close() }
})

test("legacy enrollment bytes stay unchanged and v2 meaning is domain separated", () => {
  const input = { source_store_id: "store", owner_session: "owner", boundary: { ledger: 9, preparation_source_batch: "random", preparation_budget_policy: "hash" },
    membership_sha256: "a".repeat(64), method: { id: "method" }, source_policy: POLICY, route_policy: POLICY, budget_policy: POLICY }
  expect(evaluatorEnrollmentKey(input)).toBe(digest({ format: "loom-evaluation-enrollment-key/v1", source_store_id: "store", owner_session: "owner",
    slot: "overall", boundary: { ledger: 9 }, membership_sha256: input.membership_sha256, method: input.method,
    source_policy: POLICY, route_policy: POLICY, budget_policy: POLICY }))
  expect(evaluatorEnrollmentKey({ ...input, source: { kind: "retrospective-population", format: "loom-retrospective-population/v1",
    population_id: "population", manifest_sha256: "b".repeat(64) } })).not.toBe(evaluatorEnrollmentKey(input))
})

for (const field of ["request_id", "manifest_sha256", "attempt_id"] as const) test(`wrong v2 ${field} cannot reserve or claim`, async () => {
  const f = fixture()
  try {
    await expect(f.runtime().execute(ACTOR, { ...pins(f.prepared), [field]: "wrong" }, freshSignal())).rejects.toThrow("mismatch")
    expect(f.authority.counts().reservations).toBe(0); expect(f.issue().claimant_id).toBeNull()
  } finally { f.close() }
})

for (const field of ["population_id", "manifest_sha256"] as const) test(`authority cannot substitute v2 source ${field}`, async () => {
  const f = fixture()
  try {
    await expect(f.runtime({ prepare: async (...args) => {
      const grant = await f.authority.prepare(...args)
      return { ...grant, subject: { ...grant.subject, source: { ...grant.subject.source!, [field]: field === "population_id" ? "other-population" : "f".repeat(64) } } }
    } }).execute(ACTOR, pins(f.prepared), freshSignal())).rejects.toThrow("authority changed")
    expect(f.authority.counts().reservations).toBe(0); expect(f.issue().claimant_id).toBeNull()
  } finally { f.close() }
})

for (const change of ["changed", "missing"] as const) test(`${change} unrequested original blocks complete v2 admission`, async () => {
  const f = fixture()
  try {
    const second = f.population.manifest.members[1]!.source
    if (change === "missing") f.state.ledger.query("DELETE FROM ledger WHERE id=?").run(second.id)
    else {
      const row = f.state.ledger.query("SELECT data FROM ledger WHERE id=?").get(second.id) as { data: string }
      f.state.ledger.query("UPDATE ledger SET data=? WHERE id=?").run(canonical({ ...JSON.parse(row.data), statement: "Changed after freeze" }), second.id)
    }
    await expect(f.runtime().execute(ACTOR, pins(f.prepared), freshSignal())).rejects.toThrow("source unavailable or changed")
    expect(f.authority.counts().reservations).toBe(0); expect(f.issue().claimant_id).toBeNull()
    expect(f.state.learning.automatic.history.retrospectivePopulation(f.population.population_id)).toEqual(f.population)
  } finally { f.close() }
})

for (const field of ["recipient_session_id", "permitted_view", "source_store_id"] as const) test(`wrong source-owner ${field} rejects before admission`, async () => {
  const f = fixture()
  try {
    const resolve: RetrospectiveSourceResolver = async request => ({ ...await f.resolve(request), [field]: "wrong-owner-binding" })
    await expect(f.runtime({}, { resolve }).execute(ACTOR, pins(f.prepared), freshSignal())).rejects.toThrow("source-owner binding mismatch")
    expect(f.authority.counts().reservations).toBe(0); expect(f.issue().claimant_id).toBeNull()
  } finally { f.close() }
})

for (const gaps of [false, true]) test(`denied recipient with ${gaps ? "only frozen gaps" : "available sources"} cannot receive metadata or reserve`, async () => {
  const f = fixture({ gaps })
  try {
    f.denyRecipient()
    await expect(f.runtime().execute(ACTOR, pins(f.prepared), freshSignal())).rejects.toThrow("Recipient population denied")
    expect(f.calls).toEqual([]); expect(f.authority.counts().reservations).toBe(0); expect(f.issue().claimant_id).toBeNull()
  } finally { f.close() }
})

test("requester-owned private reviews remain withheld from a fresh Evaluator", async () => {
  const f = fixture({ privateReview: true })
  try {
    await expect(f.runtime({}, { population: async () => {} }).execute(ACTOR, pins(f.prepared), freshSignal())).rejects.toThrow("population unavailable")
    expect(f.calls).toEqual([]); expect(f.authority.counts().reservations).toBe(0)
  } finally { f.close() }
})

test("available native originals cannot inherit the preparing Session's access", async () => {
  const f = fixture({ native: true })
  try {
    await expect(f.runtime().execute(ACTOR, pins(f.prepared), freshSignal())).rejects.toThrow("source unavailable or changed")
    expect(f.calls.some(request => request.source.kind === "native-message")).toBe(false)
    expect(f.authority.counts().reservations).toBe(0); expect(f.issue().claimant_id).toBeNull()
  } finally { f.close() }
})

test("native sources already frozen as gaps remain gaps without invoking a resolver", async () => {
  const f = fixture({ native: true, gaps: true })
  try {
    const result = await f.runtime().execute(ACTOR, pins(f.prepared), freshSignal())
    expect(result.receipt.execution).toBe("completed")
    expect(f.calls).toEqual([])
    const saved = f.authority.db.query("SELECT content FROM fixture_results").get() as { content: string }
    expect(JSON.parse(saved.content).original).toMatchObject({ status: "unresolved", gap: { code: "unresolved-at-freeze" } })
    expect(JSON.parse(saved.content).original.value).toBeUndefined()
  } finally { f.close() }
})

for (const revokeAt of ["authority", "caller"]) test(`recipient revocation during final ${revokeAt} check withholds resolved original and never redispatches`, async () => {
  const f = fixture()
  let transfer = false, resolved = false, returned = 0, sourceChecks = 0
  try {
    f.authority.phase = async phase => { if (phase === "before-consume") transfer = true }
    const runtime = f.runtime({
      validate: async (...args) => {
        const receipt = await f.authority.validate(...args)
        if (args[1] === "source" && ++sourceChecks === 2 && revokeAt === "authority") f.denyRecipient()
        return receipt
      },
      execute: (admission, read, signal) => f.authority.execute(admission, async (...args) => {
        const result = await read(...args); returned++; return result
      }, signal),
    }, { resolve: async request => { const result = await f.resolve(request); if (transfer) resolved = true; return result },
      authorize: async () => { if (resolved && revokeAt === "caller") f.denyRecipient() } })
    await expect(runtime.execute(ACTOR, pins(f.prepared), freshSignal())).rejects.toThrow("Recipient population denied")
    expect(resolved).toBe(true); expect(returned).toBe(0); expect(f.issue().claimant_id).not.toBeNull()
    expect(f.authority.counts()).toMatchObject({ execute_calls: 1, effects: 0 })
    await runtime.execute(ACTOR, pins(f.prepared), freshSignal())
    expect(f.authority.counts()).toMatchObject({ execute_calls: 1, effects: 0 })
  } finally { f.close() }
})

test("reservation becoming uncertain during v2 source validation cannot claim", async () => {
  const f = fixture()
  let reserved = false, changed = false
  try {
    f.authority.phase = async phase => { if (phase === "reserved") reserved = true }
    const runtime = f.runtime({}, { resolve: async request => {
      const result = await f.resolve(request)
      if (reserved && !changed) {
        changed = true
        const snapshot = f.authority.all()[0]!, receipt = { ...snapshot.receipt, sequence: 2, receipt_id: "fixture-uncertain", budget: "uncertain" }
        f.authority.db.query("UPDATE fixture_enrollments SET receipt=?").run(canonical(receipt))
      }
      return result
    } })
    const result = await runtime.execute(ACTOR, pins(f.prepared), freshSignal())
    expect(result.receipt).toMatchObject({ execution: "reserved", budget: "uncertain" })
    expect(f.issue().claimant_id).toBeNull(); expect(f.authority.counts()).toMatchObject({ execute_calls: 0, effects: 0 })
  } finally { f.close() }
})

test("v2 contender calls share the existing exclusive claim and one execution", async () => {
  const f = fixture()
  try {
    await Promise.all([f.runtime().execute(ACTOR, pins(f.prepared), freshSignal()), f.runtime().execute(ACTOR, pins(f.prepared), freshSignal())])
    expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    expect((await f.runtime().recover(ACTOR, pins(f.prepared))).receipt.execution).toBe("completed")
  } finally { f.close() }
})

test("v2 recovery retains terminal accounting when original rights are denied without returning result identity", async () => {
  const f = fixture()
  try {
    const result = await f.runtime().execute(ACTOR, pins(f.prepared), freshSignal())
    const reads = f.calls.length
    f.denyOwner(); f.denyRecipient()
    await expect(f.runtime().recover(ACTOR, pins(f.prepared))).rejects.toThrow("Owner readback denied")
    expect(f.state.learning.automatic.history.readExecution(f.prepared.batch_id, ACTOR.session_id)?.receipts.at(-1)?.result).toEqual(result.receipt.result)
    expect(f.calls.length).toBe(reads); expect(f.authority.counts().effects).toBe(1)
  } finally { f.close() }
})

test("source-specific readback denial with permitted metadata withholds result IDs after accounting recovery", async () => {
  const f = fixture()
  try {
    const result = await f.runtime().execute(ACTOR, pins(f.prepared), freshSignal())
    const runtime = f.runtime({}, { resolve: async request => {
      if (request.purpose === "inspect") throw new Error("Exact source inspection denied")
      return f.resolve(request)
    } })
    await expect(runtime.recover(ACTOR, pins(f.prepared))).rejects.toThrow("Exact source inspection denied")
    expect(f.state.learning.automatic.history.readExecution(f.prepared.batch_id, ACTOR.session_id)?.receipts.at(-1)?.result).toEqual(result.receipt.result)
    expect(f.authority.counts()).toMatchObject({ execute_calls: 1, effects: 1 })
  } finally { f.close() }
})

for (const stopAt of ["expiry", "abort"]) test(`${stopAt} during awaited recipient check prevents a subsequent original read`, async () => {
  const f = fixture(), stop = new AbortController()
  let transfer = false, beforeTransfer = 0
  try {
    f.authority.phase = async phase => {
      if (phase === "before-consume") { transfer = true; beforeTransfer = f.calls.length }
    }
    const runtime = f.runtime({}, { population: async () => {
      if (transfer) {
        if (stopAt === "expiry") f.expire()
        else stop.abort(new Error("Controlled source abort"))
      }
    } })
    await expect(runtime.execute(ACTOR, pins(f.prepared), stop.signal)).rejects.toThrow(stopAt === "expiry" ? "expired" : "Controlled source abort")
    expect(transfer).toBe(true); expect(f.calls.length).toBe(beforeTransfer)
    expect(f.issue().claimant_id).not.toBeNull(); expect(f.authority.counts().effects).toBe(0)
  } finally { f.close() }
})
