import { expect, spyOn, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { canonical, digest } from "../src/model.js"
import { EvaluatorExecution } from "../src/evaluator-execution.js"
import type { EvaluatorExecutionAdmission } from "../src/evaluator-execution-contract.js"
import { retrospectiveMemberKey } from "../src/retrospective-contract.js"
import { retrospectiveFixture } from "./helpers/retrospective-store-fixture.js"
import { ACTOR, FixtureExecutionAuthority, NOW, POLICY, freshSignal, method, openState, pins, type FixtureState } from "./helpers/evaluator-execution-fixture.js"

const command = new URL("../tools/learning-state-backup.py", import.meta.url).pathname
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex")
const files = (directory: string) => Object.fromEntries(readdirSync(directory).filter(name => name !== "loom-state-manifest.json").sort()
  .map(name => [name, { size: statSync(join(directory, name)).size, sha256: sha(readFileSync(join(directory, name))) }]))

function prepare(state: FixtureState, objective: string) {
  const manifest = retrospectiveFixture(4, state.store.reviews.storeID)
  if (manifest.selection.mode !== "explicit-objective") throw new Error("This fixture exercises the legacy objective format")
  manifest.selection.objective_id = objective
  manifest.selection.question = "Evaluate " + objective
  manifest.objective.id = objective
  manifest.coverage.unresolved_native_sources = 0
  manifest.members = manifest.members.map(member => {
    const record = state.store.record({ session_id: member.source.session_id!, agent: "worker" }, undefined,
      { kind: "result", statement: objective + " original " + member.source.id })
    const original = state.learning.automatic.sources.retrospectiveOriginal("ledger-record", record.id, record.session_id, ACTOR.session_id)!
    return { ...member, source: original.ref, key: retrospectiveMemberKey(manifest.source_store_id, original.ref, member.permitted_view) }
  })
  const population = state.learning.automatic.history.freezeRetrospective(ACTOR, manifest)
  const prepared = state.learning.evaluator.prepareRetrospective(ACTOR, population, method(), POLICY)
  return { population, prepared }
}

async function fixture(mode: "completed" | "unknown" | "unclaimed" = "completed") {
  const root = mkdtempSync(join(tmpdir(), "loom-retrospective-execution-backup-")), project = join(root, "project")
  mkdirSync(project)
  const source = join(root, digest({ project: "retrospective-execution-backup", canonical: project }))
  const state = openState(source), authority = new FixtureExecutionAuthority(join(root, "authority.sqlite"))
  const selected = prepare(state, "selected-objective"), other = prepare(state, "other-objective")
  const permittedRecipient = (session: string) => {
    const row = authority.db.query("SELECT 1 FROM fixture_grants WHERE json_extract(data,'$.recipient.session_id')=?").get(session)
    if (!row) throw new Error("Fixture recipient is not enrolled")
  }
  const runtime = (current: FixtureState) => new EvaluatorExecution(current.learning.evaluator, current.learning.automatic.history, current.store, {
    authority, authorize: async actor => { if (actor.session_id !== ACTOR.session_id) throw new Error("Fixture caller denied") },
    retrospective: {
      populations: current.learning.populations,
      authorize: async (recipient, population) => {
        if (population.owner_session !== ACTOR.session_id || population.population_id !== selected.population.population_id)
          throw new Error("Fixture population denied")
        if (recipient.session_id !== ACTOR.session_id) {
          if (recipient.agent !== "evaluator") throw new Error("Fixture recipient denied")
          permittedRecipient(recipient.session_id)
        }
      },
      resolve: async request => {
        if (request.purpose === "inspect") {
          if (request.recipient_session_id !== ACTOR.session_id) throw new Error("Fixture readback caller denied")
        } else if (request.purpose === "execute") permittedRecipient(request.recipient_session_id)
        else throw new Error("Unexpected fixture source purpose")
        const original = request.source.kind === "ledger-record"
          ? current.learning.automatic.sources.retrospectiveOriginal("ledger-record", request.source.id,
            request.source.session_id!, request.recipient_session_id) : null
        return original ? { ...request, source: original.ref, status: "available", value: original.value }
          : { ...request, status: "missing" }
      },
    },
  }, () => NOW)
  authority.source = { memberKey: selected.population.manifest.members[0]!.key, sourceIndex: 0 }
  try {
    if (mode === "unclaimed") {
      const save = state.learning.automatic.history.saveExecutionAdmission.bind(state.learning.automatic.history)
      const fault = spyOn(state.learning.automatic.history, "saveExecutionAdmission").mockImplementationOnce((...args) => {
        save(...args); throw new Error("Controlled admission acknowledgement loss")
      })
      try { await expect(runtime(state).execute(ACTOR, pins(selected.prepared), freshSignal())).rejects.toThrow("Controlled admission") }
      finally { fault.mockRestore() }
    } else if (mode === "unknown") {
      authority.phase = async phase => { if (phase === "consumed") throw new Error("Controlled execution interruption") }
      await expect(runtime(state).execute(ACTOR, pins(selected.prepared), freshSignal())).rejects.toThrow("Controlled execution")
      authority.phase = async () => {}
    } else {
      expect((await runtime(state).execute(ACTOR, pins(selected.prepared), freshSignal())).receipt.execution).toBe("completed")
    }
  } catch (error) { state.close(); authority.close(); rmSync(root, { recursive: true, force: true }); throw error }
  const mirrored = state.learning.automatic.history.readExecution(selected.prepared.batch_id, ACTOR.session_id)!
  const issue = state.store.reviews.readIssue(ACTOR, selected.prepared.request_id)
  state.close()
  const backup = join(root, "backup"), restoredParent = join(root, "restored")
  mkdirSync(restoredParent)
  const destination = join(restoredParent, source.slice(source.lastIndexOf("/") + 1))
  const settings = ["--project-id", "retrospective-execution-backup", "--project-canonical", project,
    "--loom-revision", "902d4f33d8992e2b07f375e219e69c5b9b381e96", "--package-version", "2.0.0-alpha.1"]
  const run = (operation: "backup" | "restore") => Bun.spawnSync(["python3", command, operation,
    ...(operation === "backup" ? ["--source-dir", source, "--backup-dir", backup]
      : ["--backup-dir", backup, "--destination-dir", destination]), ...settings],
    { env: { ...process.env, LOOM_WRITERS_STOPPED: "yes" } })
  return { ...selected, other, source, backup, destination, authority, mirrored, issue, runtime, run,
    close() { authority.close(); rmSync(root, { recursive: true, force: true }) } }
}
function ok(result: ReturnType<Awaited<ReturnType<typeof fixture>>["run"]>) {
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}
function rehashBackup(directory: string) {
  const path = join(directory, "loom-state-manifest.json"), manifest = JSON.parse(readFileSync(path, "utf8"))
  manifest.files = files(directory)
  writeFileSync(path, JSON.stringify(manifest))
}
function replaceAdmission(directory: string, batchID: string, change: (admission: EvaluatorExecutionAdmission) => void) {
  const db = new Database(join(directory, "learning.sqlite"))
  try {
    const row = db.query("SELECT data_json FROM learning_execution_admissions WHERE batch_id=?").get(batchID) as { data_json: string }
    const admission = JSON.parse(row.data_json) as EvaluatorExecutionAdmission
    change(admission)
    const fingerprint = digest(admission), subject = admission.grant.subject
    db.query("UPDATE learning_execution_admissions SET data_json=?,sha256=?,request_id=?,attempt_id=?,authority_id=?,reservation_id=?,semantic_key=? WHERE batch_id=?")
      .run(canonical(admission), fingerprint, subject.request_id, subject.attempt_id, admission.grant.authority_id, admission.reservation_id, subject.semantic_key, batchID)
    db.query("UPDATE learning_evaluator_requests SET execution_admission_sha256=? WHERE batch_id=?").run(fingerprint, batchID)
    for (const receiptRow of db.query("SELECT sequence,data_json FROM learning_execution_receipts WHERE batch_id=?").all(batchID) as Array<{ sequence: number; data_json: string }>) {
      const receipt = { ...JSON.parse(receiptRow.data_json), admission_sha256: fingerprint }
      db.query("UPDATE learning_execution_receipts SET data_json=?,sha256=? WHERE batch_id=? AND sequence=?")
        .run(canonical(receipt), digest(receipt), batchID, receiptRow.sequence)
    }
    expect(db.query("PRAGMA integrity_check").values()).toEqual([["ok"]])
    expect(db.query("PRAGMA foreign_key_check").values()).toEqual([])
  } finally { db.close(true) }
}

for (const mode of ["completed", "unknown", "unclaimed"] as const) test("stopped retrospective execution restore preserves " + mode + " enrollment and original canonical claim", async () => {
  const f = await fixture(mode)
  try {
    const before = files(f.source), counts = f.authority.counts()
    ok(f.run("backup")); ok(f.run("restore"))
    expect(files(f.source)).toEqual(before)
    expect(files(f.destination)).toEqual(before)
    const restored = openState(f.destination)
    try {
      expect(restored.learning.automatic.history.retrospectivePopulation(f.population.population_id)).toEqual(f.population)
      expect(restored.learning.automatic.history.readExecution(f.prepared.batch_id, ACTOR.session_id)).toEqual(f.mirrored)
      expect(restored.store.reviews.readIssue(ACTOR, f.prepared.request_id)).toEqual(f.issue)
      const result = await f.runtime(restored).execute(ACTOR, pins(f.prepared), freshSignal())
      expect(result.admission).toEqual(f.mirrored.admission)
      if (mode === "unclaimed") {
        expect(f.issue.attempt.claimant_id).toBeNull()
        expect(f.mirrored.receipts).toEqual([])
        expect(counts.effects).toBe(0)
        expect(result.receipt.execution).toBe("completed")
        expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
      } else {
        expect(f.issue.attempt.claimant_id).not.toBeNull()
        expect(result.receipt.execution).toBe(mode)
        expect(f.authority.counts()).toEqual(counts)
      }
      const after = f.authority.counts()
      await f.runtime(restored).recover(ACTOR, pins(f.prepared))
      expect(f.authority.counts()).toEqual(after)
    } finally { restored.close() }
  } finally { f.close() }
})

const corruptions: Array<[string, (value: EvaluatorExecutionAdmission, f: Awaited<ReturnType<typeof fixture>>) => void, string]> = [
  ["different frozen population", (value, f) => { value.grant.subject.source = f.other.prepared.request.format === "loom-evaluation-request/v2" ? f.other.prepared.request.source : undefined }, "population/request binding"],
  ["changed frozen digest", value => { value.grant.subject.source!.manifest_sha256 = "f".repeat(64) }, "population/request binding"],
  ["removed source discriminator", value => { delete value.grant.subject.source }, "contract fields"],
  ["wrong semantic enrollment", value => { value.grant.subject.semantic_key = "e".repeat(64) }, "semantic enrollment"],
  ["different canonical attempt", value => { value.grant.subject.attempt_id = "wrong-initial-attempt" }, "canonical initial issue"],
  ["different prepared method", value => { value.grant.method.evaluator.definition.sha256 = "c".repeat(64) }, "effective method"],
  ["different result recipient", value => { value.grant.recipient.session_id = "wrong-result-recipient" }, "result recipient"],
]
for (const operation of ["backup", "restore"] as const) for (const [name, change, message] of corruptions)
  test(operation + " rejects checksum-consistent retrospective execution with " + name, async () => {
    const f = await fixture()
    try {
      if (operation === "restore") ok(f.run("backup"))
      const directory = operation === "backup" ? f.source : f.backup
      replaceAdmission(directory, f.prepared.batch_id, value => change(value, f))
      if (operation === "restore") rehashBackup(directory)
      const before = files(directory), result = f.run(operation)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain(message)
      expect(files(directory)).toEqual(before)
      expect(existsSync(operation === "backup" ? join(f.backup, "loom-state-manifest.json") : f.destination)).toBe(false)
      expect(f.authority.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
    } finally { f.close() }
  })

for (const operation of ["backup", "restore"] as const) for (const damage of ["receipt association", "removed frozen member"] as const)
  test(operation + " refuses enrolled retrospective state with " + damage, async () => {
    const f = await fixture()
    try {
      if (operation === "restore") ok(f.run("backup"))
      const directory = operation === "backup" ? f.source : f.backup
      const db = new Database(join(directory, "learning.sqlite"))
      try {
        if (damage === "removed frozen member") {
          db.query("DELETE FROM learning_retrospective_members WHERE population_id=? AND ordinal=1").run(f.population.population_id)
        } else {
          const row = db.query("SELECT sequence,data_json FROM learning_execution_receipts WHERE batch_id=? ORDER BY sequence DESC LIMIT 1")
            .get(f.prepared.batch_id) as { sequence: number; data_json: string }
          const receipt = { ...JSON.parse(row.data_json), admission_sha256: "d".repeat(64) }
          db.query("UPDATE learning_execution_receipts SET data_json=?,sha256=? WHERE batch_id=? AND sequence=?")
            .run(canonical(receipt), digest(receipt), f.prepared.batch_id, row.sequence)
        }
        expect(db.query("PRAGMA integrity_check").values()).toEqual([["ok"]])
        expect(db.query("PRAGMA foreign_key_check").values()).toEqual([])
      } finally { db.close(true) }
      if (operation === "restore") rehashBackup(directory)
      const before = files(directory), result = f.run(operation)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain(damage === "receipt association" ? "receipt binding" : "Incomplete retrospective frozen membership")
      expect(files(directory)).toEqual(before)
      expect(existsSync(operation === "backup" ? join(f.backup, "loom-state-manifest.json") : f.destination)).toBe(false)
    } finally { f.close() }
  })

test("a completed retrospective execution restores accounting but withholds result disclosure after original-source loss", async () => {
  const f = await fixture()
  try {
    const ledger = new Database(join(f.source, "ledger.sqlite"))
    try { ledger.query("DELETE FROM ledger WHERE id=?").run(f.population.manifest.members[0]!.source.id) }
    finally { ledger.close(true) }
    ok(f.run("backup")); ok(f.run("restore"))
    const restored = openState(f.destination)
    try {
      const before = f.authority.counts()
      await expect(f.runtime(restored).recover(ACTOR, pins(f.prepared))).rejects.toThrow("Retrospective preparation source unavailable or changed")
      await expect(f.runtime(restored).execute(ACTOR, pins(f.prepared), freshSignal())).rejects.toThrow("Retrospective preparation source unavailable or changed")
      expect(f.authority.counts()).toEqual(before)
      expect(restored.learning.automatic.history.readExecution(f.prepared.batch_id, ACTOR.session_id)).toEqual(f.mirrored)
      expect(f.mirrored.receipts.at(-1)!.execution).toBe("completed")
      expect(f.mirrored.receipts.at(-1)!.result).not.toBeNull()
      expect(restored.learning.automatic.history.retrospectivePopulation(f.population.population_id)).toEqual(f.population)
    } finally { restored.close() }
  } finally { f.close() }
})
