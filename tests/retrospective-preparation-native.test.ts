import { expect, spyOn, test } from "bun:test"
import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EvaluatorExecution } from "../src/evaluator-execution.js"
import { retrospectiveMemberKey } from "../src/retrospective-contract.js"
import { retrospectiveFixture } from "./helpers/retrospective-store-fixture.js"
import { ACTOR, FixtureExecutionAuthority, NOW, POLICY, freshSignal, method, openState, pins, type FixtureState } from "./helpers/evaluator-execution-fixture.js"

function population(state: FixtureState) {
  const manifest = retrospectiveFixture(7, state.store.reviews.storeID)
  manifest.members = manifest.members.map(member => {
    const record = state.store.record({ session_id: member.source.session_id!, agent: "worker" }, undefined,
      { kind: "result", statement: "Controlled original " + member.source.id })
    const source = state.learning.automatic.sources.retrospectiveOriginal("ledger-record", record.id, record.session_id, ACTOR.session_id)
    if (!source) throw new Error("Controlled original unavailable")
    return { ...member, source: source.ref, key: retrospectiveMemberKey(manifest.source_store_id, source.ref, member.permitted_view) }
  })
  return state.learning.automatic.history.freezeRetrospective(ACTOR, manifest)
}

for (const boundary of ["mapping", "review", "issue"] as const) test(`retrospective preparation recovers the same population and request after interrupted ${boundary} write`, () => {
  const root = mkdtempSync(join(tmpdir(), "loom-population-preparation-")), path = join(root, "state")
  let state = openState(path)
  try {
    const frozen = population(state)
    const fail = () => { throw new Error("controlled interrupted " + boundary) }
    const fault = boundary === "mapping" ? spyOn(state.store.reviews, "freezeEvaluatorPreparation").mockImplementation(fail)
      : boundary === "review" ? spyOn(state.store.reviews, "prepareIssue").mockImplementation(fail)
        : spyOn(state.learning.automatic.history, "block").mockImplementation(fail)
    expect(() => state.learning.evaluator.prepareRetrospective(ACTOR, frozen, method(), POLICY)).toThrow("controlled interrupted")
    fault.mockRestore()
    const mapped = state.derived.query("SELECT batch_id,request_id FROM learning_evaluator_requests").get() as { batch_id: string; request_id: string }
    expect(mapped).toBeDefined()
    state.close(); state = openState(path)
    const replay = state.learning.evaluator.prepareRetrospective({ ...ACTOR, agent: "after-restart" }, frozen, method(), POLICY)
    expect(replay.request_id).toBe(mapped.request_id)
    expect(replay.batch_id).toBe(mapped.batch_id)
    expect(replay.request).toMatchObject({ format: "loom-evaluation-request/v2", source: {
      kind: "retrospective-population", population_id: frozen.population_id, manifest_sha256: frozen.manifest_sha256 } })
    expect(replay.request.review_request.requester).toEqual(ACTOR)
    expect(replay.issue?.attempt).toMatchObject({ state: "prepared", claimant_id: null, native_outcome: "not-issued" })
    expect(state.derived.query("SELECT COUNT(*) AS n FROM learning_evaluator_requests").get()).toEqual({ n: 1 })
    expect(state.ledger.query("SELECT COUNT(*) AS n FROM review_requests").get()).toEqual({ n: 1 })
    expect(state.ledger.query("SELECT COUNT(*) AS n FROM review_issue_intents").get()).toEqual({ n: 1 })
  } finally { state.close(); rmSync(root, { recursive: true, force: true }) }
})

test("restoring a real pre-mapping population snapshot retains a surviving consumed issue and original requester", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-population-preparation-restore-")), path = join(root, "state")
  let state = openState(path)
  try {
    const frozen = population(state)
    state.derived.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    const before = join(root, "pre-mapping.sqlite")
    copyFileSync(join(path, "learning.sqlite"), before)
    const prepared = state.learning.evaluator.prepareRetrospective(ACTOR, frozen, method(), POLICY)
    if (!prepared.issue) throw new Error("Missing canonical issue")
    state.store.reviews.issues.claim(ACTOR, prepared.issue.intent, "consumed-before-restore")
    state.store.reviews.issues.recordOutcome(prepared.issue.intent, "consumed-before-restore", { status: "unknown", reason: "controlled uncertain issue", source_ref: "fixture://uncertain-issue" })
    const consumed = state.store.reviews.readIssue(ACTOR, prepared.request_id)
    state.close()
    copyFileSync(before, join(path, "learning.sqlite"))
    state = openState(path)
    const replay = state.learning.evaluator.prepareRetrospective({ ...ACTOR, agent: "restored-reader" }, frozen, method(), POLICY)
    expect(replay.batch_id).toBe(prepared.batch_id)
    expect(replay.request_id).toBe(prepared.request_id)
    expect(replay.manifest_sha256).toBe(prepared.manifest_sha256)
    expect(replay.request.review_request.requester).toEqual(ACTOR)
    expect(replay.issue).toEqual(consumed)
    expect(state.learning.automatic.history.retrospectivePopulation(frozen.population_id).manifest_sha256).toBe(frozen.manifest_sha256)
  } finally { state.close(); rmSync(root, { recursive: true, force: true }) }
})

test("retrospective mapping loss is fenced without replacing a committed preparation identity", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-population-mapping-loss-")), state = openState(join(root, "state"))
  try {
    const frozen = population(state), prepared = state.learning.evaluator.prepareRetrospective(ACTOR, frozen, method(), POLICY)
    state.derived.query("DELETE FROM learning_evaluator_requests WHERE batch_id=?").run(prepared.batch_id)
    expect(() => state.learning.evaluator.prepareRetrospective(ACTOR, frozen, method(), POLICY)).toThrow("restore required")
    expect(state.derived.query("SELECT COUNT(*) AS n FROM learning_evaluator_requests").get()).toEqual({ n: 0 })
    expect(state.store.reviews.readIssue(ACTOR, prepared.request_id).attempt.claimant_id).toBeNull()
  } finally { state.close(); rmSync(root, { recursive: true, force: true }) }
})

test("retrospective preparation cannot reach even a supplied fixture execution authority", async () => {
  const root = mkdtempSync(join(tmpdir(), "loom-population-execution-fence-")), state = openState(join(root, "state"))
  const authority = new FixtureExecutionAuthority(join(root, "authority.sqlite"))
  try {
    const frozen = population(state), prepared = state.learning.evaluator.prepareRetrospective(ACTOR, frozen, method(), POLICY)
    const consumer = new EvaluatorExecution(state.learning.evaluator, state.learning.automatic.history, state.store,
      { authority, authorize: async () => {} }, () => NOW)
    const calls = spyOn(authority, "prepare"), inventory = spyOn(authority, "reconcile")
    for (const run of [() => consumer.execute(ACTOR, pins(prepared), freshSignal()), () => consumer.recover(ACTOR, pins(prepared)), () => consumer.cancel(ACTOR, pins(prepared))])
      await expect(run()).rejects.toThrow("retrospective-execution-disconnected")
    expect(calls).not.toHaveBeenCalled(); expect(inventory).not.toHaveBeenCalled()
    expect(authority.counts()).toEqual({ reservations: 0, consumed: 0, execute_calls: 0, effects: 0 })
    expect(state.store.reviews.readIssue(ACTOR, prepared.request_id).attempt.claimant_id).toBeNull()
    calls.mockRestore(); inventory.mockRestore()
  } finally { state.close(); authority.close(); rmSync(root, { recursive: true, force: true }) }
})
