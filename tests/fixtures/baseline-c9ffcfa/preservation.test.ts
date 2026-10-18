import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync, readFileSync, copyFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hydrate, populate, sha, snapshot, type Snapshot } from "./oracle.js"
import { Store } from "./producer/store.js"
import { taskContext, taskContextOrRecovery } from "./producer/context.js"

test("frozen baseline API produces qualified populated state, not empty boot or fabricated output", () => {
  const db = new Database(":memory:")
  try {
    const f = populate(db), store = new Store(db, "synthetic-baseline-c9ffcfa")
    expect(f.unrelatedProgress.items[0].state).toBe("reported-complete")
    expect(store.collaboration.progress(f.action.id, "work").items[0].state).toBe("needs-reconfirmation")
    expect(store.collaboration.progress(f.action.id, "removed").items[0]).toMatchObject({ state: "needs-reconfirmation", current_node: false })
    expect(store.collaboration.progress(f.action.id, "reopened").items[0].state).toBe("open")
    expect(store.plan(f.action.id, 1)).toEqual(f.plan1)
    expect(store.plan(f.action.id, 2)).toEqual(f.plan2)
    expect(store.plan(f.action.id, 3)).toEqual(f.plan3)
    expect(store.collaboration.thread(f.question.id).answers.map(a => a.session_id)).toEqual([
      "synthetic-research-a", "synthetic-research-b", "synthetic-research-b", "synthetic-research-a", "synthetic-research-b", "synthetic-late",
    ])
    const rows = snapshot(db).tables.ledger as { data: string }[]
    const records = rows.map(row => JSON.parse(row.data)), byID = new Map(records.map(row => [row.id, row]))
    expect(byID.get(f.falseAnswer.delivery.intent_id).data.automatic_continuation).toBe(false)
    expect(byID.get(f.missingAnswer.delivery.intent_id).data).not.toHaveProperty("automatic_continuation")
    expect(byID.get(f.uncertainAnswer.delivery.intent_id).data).toMatchObject({ automatic_continuation: true, authorization_id: (f.authorization as { id: string }).id })
    expect(store.delivery.status(f.uncertainAnswer.delivery.intent_id!).transport).toBe("admission-uncertain")
    expect(byID.get(f.withdrawnAnswer.delivery.intent_id).data.reason).toBe("continuation-withdrawn")
    expect(byID.get(f.lateAnswer.id)).toMatchObject({ action_id: f.action.id, node_id: "work", data: { question_id: f.question.id } })
    expect(byID.get(f.finish.id).data).toMatchObject({ start_id: f.start.id, attribution: "captured-at-start" })
    expect(records.some(row => row.data.start_id === f.interrupted.id)).toBe(false)
    expect(byID.get(f.unpaired.id)).not.toHaveProperty("action_id")
    expect(byID.get(f.unpaired.id).data.attribution).toContain("ambiguous-host-call")
    expect(byID.get(f.completion.id).data).toMatchObject({ work_ref: f.ref, work_goal: { goal: f.action.goal } })
    expect(byID.get(f.reopen.id).data.previous_report_id).toBe(f.reopenedCompletion.id)
    for (const conclusion of f.conclusions) {
      expect(byID.get(conclusion.id).data).toMatchObject({ evidence_ids: [f.finish.id], artifact_refs: ["fixture://synthetic/evidence"], verification: "agent-reported; not independently validated by Loom" })
      expect(taskContext(store, f.focus, 64000).records.find(row => row.id === conclusion.id)?.contract_match).toBe(false)
    }
    expect(taskContextOrRecovery(store, { action_id: f.action.id, node_id: "removed" }, 64000)).toMatchObject({ recovery: { code: "task-not-in-current-plan" } })
    expect(store.delivery.status(f.activeUncertain.delivery.intent_id!).transport).toBe("admission-uncertain")
    expect(db.query("SELECT bucket,phase FROM primary_deliveries WHERE intent_id=?").get(f.activePending.delivery.intent_id!)).toEqual({ bucket: "pending", phase: "pending" })
    expect((snapshot(db).tables.primary_deliveries as unknown[]).length).toBe(4)
    expect(new Set(records.map(row => row.kind))).toEqual(new Set(["observation", "result", "claim", "assessment", "qa", "assignment", "question", "answer", "delivery-intent", "continuation-authorization", "continuation-withdrawal", "delivery-event", "completion", "reopen"]))
    console.log(`API baseline: ${records.length} records; 14 kinds; 3 Plan revisions; 4 populated delivery projections; zero transport adapters constructed`)
  } finally { db.close() }
})

test("portable frozen rows hydrate byte-exactly, survive stopped copy/restore/read, and reject a lost qualification", () => {
  const root = mkdtempSync(join(tmpdir(), "question-baseline-oracle-"))
  try {
    const saved = JSON.parse(readFileSync(new URL("./snapshot.json", import.meta.url), "utf8")) as Snapshot
    const ids = JSON.parse(readFileSync(new URL("./ids.json", import.meta.url), "utf8")) as ReturnType<typeof populate>
    const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"))
    for (const file of manifest.files) expect(sha(readFileSync(new URL(file.path, import.meta.url)))).toBe(file.sha256)
    const source = join(root, "source"); mkdirSync(source)
    const db = new Database(join(source, "ledger.sqlite"))
    hydrate(db, saved)
    expect(snapshot(db)).toEqual(saved)
    // Independently compare every raw ledger UTF-8 BLOB against frozen hashes.
    for (const row of db.query("SELECT id,hex(CAST(data AS BLOB)) AS bytes FROM ledger ORDER BY seq").all() as { id: string; bytes: string }[]) {
      expect(sha(Buffer.from(row.bytes, "hex"))).toBe(manifest.ledger[row.id])
    }
    db.close() // stopped-writer boundary; no other connection ever exists here
    const before = sha(readFileSync(join(source, "ledger.sqlite")))
    const backup = join(root, "backup.sqlite"), restore = join(root, "restore.sqlite")
    copyFileSync(join(source, "ledger.sqlite"), backup); copyFileSync(backup, restore)
    const inspection = new Database(restore)
    try {
      expect(inspection.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
      expect(inspection.query("PRAGMA foreign_key_check").all()).toEqual([])
      const store = new Store(inspection, "synthetic-baseline-c9ffcfa")
      expect(store.collaboration.thread(ids.question.id).answers).toHaveLength(6)
      expect(store.collaboration.progress(ids.action.id, "work").items[0].state).toBe("needs-reconfirmation")
      expect(store.collaboration.progress(ids.action.id, "reopened").items[0].state).toBe("open")
      expect(snapshot(inspection)).toEqual(saved)
      // A wrong qualification must fail the SAME preservation oracle.
      inspection.query("UPDATE ledger SET data=json_set(data,'$.data.statement','Unqualified success') WHERE id=?").run(ids.conclusions[0].id)
      expect(snapshot(inspection)).not.toEqual(saved)
    } finally { inspection.close() }
    expect(sha(readFileSync(join(source, "ledger.sqlite")))).toBe(before)
    expect(sha(readFileSync(backup))).toBe(before)
    // Roll back by discarding the altered inspection and restoring preserved bytes.
    // Discard the ENTIRE disposable set: a stale WAL must not overwrite rollback.
    for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(restore + suffix, { force: true })
    copyFileSync(backup, restore)
    const rollback = new Database(restore)
    try { expect(snapshot(rollback)).toEqual(saved) } finally { rollback.close() }
    console.log(`portable oracle: ${Object.keys(manifest.ledger).length} raw ledger hashes; all table rows/schema identical; rollback exact; originals unchanged`)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
