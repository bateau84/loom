import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Store } from "../src/store.js"
import { Store as BaselineStore } from "./fixtures/baseline-c9ffcfa/producer/store.js"
import { workReference } from "../src/collaboration.js"
import { taskContext, taskContextOrRecovery } from "../src/context.js"

// Execute the published procedure itself, not an independently implemented copy.
const manual = readFileSync(new URL("../docs/manual-backup-restore.md", import.meta.url), "utf8")
const blocks = [...manual.matchAll(/```python\n([\s\S]*?)\n```/g)].map(match => match[1])
if (blocks.length !== 2) throw new Error("Expected the copy and verification Python blocks")
const [copyScript, verifyScript] = blocks
function python(script: string, args: string[], stopped = "yes") {
  return Bun.spawnSync(["python3", "-c", script, ...args], {
    env: { ...process.env, LOOM_WRITERS_STOPPED: stopped },
  })
}
function success(result: ReturnType<typeof python>) {
  expect(result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
  return result.stdout.toString()
}
function files(directory: string) {
  return Object.fromEntries(readdirSync(directory).sort().map(name => [name,
    createHash("sha256").update(readFileSync(join(directory, name))).digest("hex")]))
}
const worker = { session_id: "worker", agent: "implementer" }
const primary = { session_id: "primary", agent: "coordinator" }

function seed(filename: string) {
  // The old producer is a legitimate upgrade input, not an operative candidate API.
  const db = new Database(filename), store = new BaselineStore(db, "isolated-fixture")
  try {
    const action = store.create("Qualified restore fixture", "Fixture only; not production acceptance", worker)
    const other = store.create("Unrelated Action", "Preserve independently", { session_id: "other", agent: "researcher" })
    const plan1 = store.savePlan(action.id, 0, [
      { id: "phase", kind: "phase", title: "Proof" },
      { id: "research", kind: "task", title: "Research", parent: "phase" },
      { id: "work", kind: "task", title: "Work", parent: "phase", depends_on: ["research"] },
      { id: "removed", kind: "task", title: "Historical task", parent: "phase" },
    ])
    const focus = { action_id: action.id, node_id: "work" }
    store.select(worker.session_id, focus)
    store.select("historical-session", { action_id: action.id, node_id: "removed" })
    const boundary = { tool: "read", observer_epoch: "fixture-epoch", input_digest: "fixture-input" }
    const start = store.startObservation(worker, { ...boundary, correlation_key: "paired", phase: "started" })
    const finish = store.finishObservation(worker, { ...boundary, correlation_key: "paired", phase: "finished", status: "completed", result_digest: "fixture-output" }, true)!
    const interrupted = store.startObservation(worker, { ...boundary, correlation_key: "interrupted", phase: "started" })
    const ambiguous = [1, 2].map(() => store.startObservation(worker, { ...boundary, correlation_key: "reused", phase: "started" }))
    const unpaired = store.finishObservation(worker, { ...boundary, correlation_key: "reused", phase: "finished", status: "completed" }, true)!
    const conclusions = (["result", "claim", "assessment", "qa"] as const).map(kind => store.record(worker, focus, {
      kind, statement: `${kind}: valid ONLY for the isolated fixture; not native execution proof.`,
      evidence_ids: [finish.id], artifact_refs: ["fixture://qualified-evidence"],
      ...(["assessment", "qa"].includes(kind) ? { verdict: "inconclusive" } : {}),
    }))
    const ref = workReference(action, plan1, "work")
    const assignment = store.collaboration.assign(primary, { assignment_id: "fixture-assignment", worker_session_id: worker.session_id, work_ref: ref })
    store.collaboration.execute(primary, { operation: "authorize-continuation", assignment_id: "fixture-assignment", continuation: "primary-native/v1" })
    const question = store.collaboration.ask(worker, focus, { assignment_id: "fixture-assignment", respondent: "researcher", statement: "Does this apply beyond the fixture?", background: "Isolated round-trip only" })
    const answer = store.collaboration.answer({ session_id: "research", agent: "researcher" }, { question_id: question.id, statement: "No; fixture only, not approval.", artifact_refs: ["fixture://answer"] })
    const intentID = answer.delivery.intent_id!
    // Local state only: no sender, native API, real request or admission receipt.
    const attempt = store.delivery.claim(intentID)!
    expect(store.delivery.start(intentID, attempt.attempt_id)).toBe(true)
    const completion = store.collaboration.complete(worker, { work_ref: ref, assignment_id: "fixture-assignment", statement: "Reported for the ORIGINAL contract only." })
    const removedCompletion = store.collaboration.complete(worker, { work_ref: workReference(action, plan1, "removed"), statement: "Historical report, not acceptance." })
    const plan2 = store.savePlan(action.id, 1, plan1.nodes.filter(n => n.id !== "removed").map(n => n.id === "work" ? { ...n, criteria: ["Changed contract"] } : n))
    const current = store.update(action.id, 1, { goal: "Changed goal requires reconfirmation" })
    const delivery = store.delivery.status(intentID)
    expect(delivery.transport).toBe("admission-uncertain")
    return { action, current, other, plan1, plan2, focus, start, finish, interrupted, ambiguous, unpaired, conclusions,
      ref, assignment, question, answer, intentID, completion, removedCompletion, delivery,
      projection: db.query("SELECT * FROM primary_deliveries ORDER BY intent_seq").all() }
  } finally { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); db.close() }
}

for (const mode of ["closed", "residual-WAL"] as const) test(`manual restore preserves meaningful Store state: ${mode}`, () => {
  const root = mkdtempSync(join(tmpdir(), "ALP02-restore-"))
  let inspection: Database | undefined
  try {
    const source = join(root, "source"), backup = join(root, "backup"), restored = join(root, "restored")
    const reference = join(root, "reference"), check = join(root, "check")
    mkdirSync(source)
    const filename = join(source, "ledger.sqlite"), fixture = seed(filename)
    let walActionID: string | undefined
    if (mode === "residual-WAL") {
      // Exit without SQLite close: the process is gone before any copy begins,
      // but its committed Action exists only in a genuine residual WAL.
      const child = Bun.spawnSync([process.execPath, "--eval", String.raw`
        import { Database } from "bun:sqlite";
        import { Store } from ${JSON.stringify(new URL("../src/store.ts", import.meta.url).pathname)};
        import { writeSync } from "node:fs";
        const db = new Database(${JSON.stringify(filename)});
        const store = new Store(db);
        db.exec("PRAGMA wal_autocheckpoint=0");
        const action = store.create("WAL-only Action", "Committed before stopped process", {session_id:"wal-session",agent:"fixture"});
        writeSync(1, action.id + "\n");
        process.kill(process.pid, "SIGKILL");
      `])
      expect(child.stderr.toString()).toBe("")
      expect(child.signalCode).toBe("SIGKILL")
      walActionID = child.stdout.toString().trim()
      expect(existsSync(filename + "-wal")).toBe(true)
      expect(readFileSync(filename + "-wal").length).toBeGreaterThan(32)
    }
    const original = files(source)
    success(python(copyScript, [filename, backup]))
    expect(files(source)).toEqual(original)
    expect(files(backup)).toEqual(original)
    success(python(copyScript, [join(backup, "ledger.sqlite"), restored]))
    expect(files(restored)).toEqual(original)
    success(python(copyScript, [join(backup, "ledger.sqlite"), reference]))
    success(python(copyScript, [join(restored, "ledger.sqlite"), check]))
    const audit = success(python(verifyScript, [join(reference, "ledger.sqlite"), join(check, "ledger.sqlite")]))
    expect(audit).toContain("TABLE action_versions 1")
    expect(audit).toContain("TABLE primary_deliveries 1")
    expect(audit).toContain(fixture.interrupted.id)
    expect(audit).toContain("ambiguous-host-call")
    inspection = new Database(join(check, "ledger.sqlite"))
    const store = new Store(inspection, "isolated-fixture")
    expect(store.list().items.map(a => a.id).sort()).toEqual([fixture.action.id, fixture.other.id, ...(walActionID ? [walActionID] : [])].sort())
    expect(store.action(fixture.action.id)).toEqual(fixture.current)
    expect(store.plan(fixture.action.id, 1)).toEqual(fixture.plan1)
    expect(store.plan(fixture.action.id, 2)).toEqual(fixture.plan2)
    expect(store.plan(fixture.action.id).nodes.find(n => n.id === "work")).toMatchObject({ parent: "phase", depends_on: ["research"], criteria: ["Changed contract"] })
    expect(store.selected(worker.session_id)).toEqual(fixture.focus)
    expect(store.selected("fresh-native-session")).toBeUndefined()
    const records = store.records({ session_id: worker.session_id, limit: 50 }).items
    const byID = new Map(records.map(record => [record.id, record]))
    expect(byID.get(fixture.finish.id)).toMatchObject({ ...fixture.finish, data: { start_id: fixture.start.id, attribution: "captured-at-start" } })
    expect(byID.get(fixture.interrupted.id)).toMatchObject(fixture.interrupted)
    expect(records.some(record => record.data.start_id === fixture.interrupted.id)).toBe(false)
    expect(store.hasUnfinishedObservationStart("interrupted")).toBe(true)
    for (const start of fixture.ambiguous) expect(byID.get(start.id)).toMatchObject(start)
    const unpaired = byID.get(fixture.unpaired.id)!
    expect(unpaired).toMatchObject({ id: fixture.unpaired.id, data: fixture.unpaired.data })
    expect(unpaired.data.attribution).toBe("ambiguous-host-call; not assigned to current work")
    for (const field of [unpaired.action_id, unpaired.node_id, unpaired.fingerprint, unpaired.data.start_id]) expect(field).toBeUndefined()
    expect(store.records({ action_id: fixture.action.id, limit: 50 }).items.some(record => record.id === unpaired.id)).toBe(false)
    for (const conclusion of fixture.conclusions) {
      expect(byID.get(conclusion.id)).toMatchObject(conclusion)
      expect(byID.get(conclusion.id)?.data.evidence_ids).toEqual([fixture.finish.id])
      expect(byID.get(conclusion.id)?.data.verification).toBe("agent-reported; not independently validated by Loom")
    }
    const context = taskContext(store, fixture.focus, 64000)
    for (const conclusion of fixture.conclusions) expect(context.records.find(record => record.id === conclusion.id)).toMatchObject({ contract_match: false })
    const recovery = taskContextOrRecovery(store, store.selected("historical-session")!, 64000)
    expect(recovery).toMatchObject({ recovery: { code: "task-not-in-current-plan" }, selection_unchanged: true })
    const thread = store.collaboration.thread(fixture.question.id)
    expect(thread.question).toMatchObject(fixture.question)
    expect(thread.answers).toHaveLength(1)
    expect(thread.answers[0]).toMatchObject({ id: fixture.answer.id, data: { question_id: fixture.question.id, statement: "No; fixture only, not approval." } })
    expect(store.records({ action_id: fixture.action.id, record_id: fixture.assignment.id }).items[0]).toMatchObject(fixture.assignment)
    const delivery = store.records({ action_id: fixture.action.id, record_id: fixture.intentID }).items[0]
    expect(delivery).toMatchObject({ id: fixture.intentID, data: { question_id: fixture.question.id, answer_id: fixture.answer.id, payload: { work_ref: fixture.ref } } })
    expect(inspection.query("SELECT * FROM primary_deliveries ORDER BY intent_seq").all()).toEqual(fixture.projection)
    expect(store).not.toHaveProperty("delivery")
    expect(() => store.collaboration.execute(primary, { operation: "retry-delivery", delivery_id: fixture.intentID })).toThrow()
    expect(byID.get(fixture.completion.id)).toMatchObject({ data: { work_ref: fixture.ref, work_goal: { goal: fixture.action.goal } } })
    expect(byID.get(fixture.removedCompletion.id)).toMatchObject(fixture.removedCompletion)
    expect(store.collaboration.progress(fixture.action.id, "work").items[0].state).toBe("needs-reconfirmation")
    expect(store.collaboration.progress(fixture.action.id, "removed").items[0].state).toBe("needs-reconfirmation")
    const historical = inspection.prepare("SELECT data FROM action_versions WHERE action_id=? AND revision=1").get(fixture.action.id) as { data: string }
    expect(JSON.parse(historical.data)).toEqual(fixture.action)
    console.log(`${mode}: ${audit.split("\n").filter(line => line.startsWith("TABLE ")).join("; ")}; original and backup file sets preserved`)
    inspection.close(); inspection = undefined

    // Falsification: a main-file-only restore loses the committed WAL Action.
    if (walActionID) {
      const incomplete = join(root, "incomplete")
      mkdirSync(incomplete)
      copyFileSync(join(backup, "ledger.sqlite"), join(incomplete, "ledger.sqlite"))
      const result = python(verifyScript, [join(reference, "ledger.sqlite"), join(incomplete, "ledger.sqlite")])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain("SQL content differs")
    }
    expect(files(source)).toEqual(original)
    expect(files(backup)).toEqual(original)
    expect(files(restored)).toEqual(original)
  } finally { inspection?.close(); rmSync(root, { recursive: true, force: true }) }
})

test("manual copy refuses overwrites and invalid sources; SQL verification detects lost qualifications and empty replacement", () => {
  const root = mkdtempSync(join(tmpdir(), "ALP02-guards-"))
  try {
    const source = join(root, "source")
    mkdirSync(source)
    const filename = join(source, "ledger.sqlite"), fixture = seed(filename), original = files(source)
    for (const kind of ["directory", "file", "symlink"] as const) {
      const destination = join(root, kind)
      if (kind === "directory") { mkdirSync(destination); writeFileSync(join(destination, "keep"), "untouched") }
      if (kind === "file") writeFileSync(destination, "untouched")
      if (kind === "symlink") symlinkSync(join(root, "missing-target"), destination)
      const result = python(copyScript, [filename, destination])
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr.toString()).toContain("FileExistsError")
      if (kind === "directory") expect(readdirSync(destination)).toEqual(["keep"])
      if (kind !== "symlink") expect(readFileSync(kind === "directory" ? join(destination, "keep") : destination, "utf8")).toBe("untouched")
    }
    const rejected = join(root, "rejected")
    expect(python(copyScript, [filename, rejected], "no").exitCode).not.toBe(0)
    expect(existsSync(rejected)).toBe(false)
    expect(python(copyScript, [join(source, "missing.sqlite"), rejected]).exitCode).not.toBe(0)
    expect(python(copyScript, [filename, join(source, "nested")]).exitCode).not.toBe(0)
    const linked = join(root, "linked"); mkdirSync(linked); symlinkSync(filename, join(linked, "ledger.sqlite"))
    expect(python(copyScript, [join(linked, "ledger.sqlite"), rejected]).exitCode).not.toBe(0)
    writeFileSync(filename + "-unknown", "do not omit")
    expect(python(copyScript, [filename, rejected]).exitCode).not.toBe(0)
    expect(existsSync(rejected)).toBe(false)
    rmSync(filename + "-unknown")
    const reference = join(root, "reference"), changed = join(root, "changed")
    success(python(copyScript, [filename, reference]))
    success(python(copyScript, [filename, changed]))
    const db = new Database(join(changed, "ledger.sqlite"))
    try {
      const result = fixture.conclusions[0]
      db.prepare("UPDATE ledger SET data=? WHERE id=?").run(JSON.stringify({ ...result, data: { ...result.data, statement: "Unqualified success" } }), result.id)
    } finally { db.close() }
    const mismatch = python(verifyScript, [join(reference, "ledger.sqlite"), join(changed, "ledger.sqlite")])
    expect(mismatch.exitCode).not.toBe(0)
    expect(mismatch.stderr.toString()).toContain("SQL content differs in ledger")
    const empty = join(root, "empty"); mkdirSync(empty)
    const emptyDB = new Database(join(empty, "ledger.sqlite"))
    try { new Store(emptyDB) } finally { emptyDB.close() }
    expect(python(verifyScript, [join(reference, "ledger.sqlite"), join(empty, "ledger.sqlite")]).exitCode).not.toBe(0)
    expect(python(verifyScript, [filename, filename]).exitCode).not.toBe(0)
    expect(files(source)).toEqual(original)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
