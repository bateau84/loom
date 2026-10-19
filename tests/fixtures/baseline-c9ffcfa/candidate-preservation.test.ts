import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { Store } from "../../../src/store.js"
import { taskContextOrRecovery } from "../../../src/context.js"
import { hydrate, snapshot, type Snapshot, type populate } from "./oracle.js"

// This consumer deliberately imports CURRENT production code, not the frozen
// producer. Run unchanged on each retirement candidate before native startup.
test("current Store startup and qualification-sensitive reads preserve populated baseline exactly", () => {
  const saved = JSON.parse(readFileSync(new URL("./snapshot.json", import.meta.url), "utf8")) as Snapshot
  const ids = JSON.parse(readFileSync(new URL("./ids.json", import.meta.url), "utf8")) as ReturnType<typeof populate>
  const db = new Database(":memory:")
  try {
    hydrate(db, saved)
    for (let restart = 0; restart < 2; restart++) {
      const store = new Store(db, "synthetic-baseline-c9ffcfa")
      expect(store.action(ids.action.id)).toEqual(ids.current)
      expect(store.plan(ids.action.id, 1)).toEqual(ids.plan1)
      expect(store.plan(ids.action.id, 3)).toEqual(ids.plan3)
      expect(store.collaboration.progress(ids.action.id, "work").items[0]).toMatchObject({ state: "needs-reconfirmation", work_ref: ids.ref })
      expect(store.collaboration.progress(ids.action.id, "reopened").items[0].state).toBe("open")
      expect(taskContextOrRecovery(store, { action_id: ids.action.id, node_id: "removed" }, 64000)).toMatchObject({ recovery: { code: "task-not-in-current-plan" } })
      expect(snapshot(db)).toEqual(saved)
    }
    console.log("candidate startup/read x2: schema and all rows unchanged; original completion/reopen qualification retained; no host/transport constructed")
  } finally { db.close() }
})
