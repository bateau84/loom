import { test, expect, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { registeredLoom } from "../helpers/registered-loom.js"

// COMPONENT fault evidence only. Real registration/Store/SQLite/production
// resume adapter; SDK get rejection is simulated, not a native installed ACL.
test("component SDK get rejection follows committed answer: durable, zero synthetic/input/wake/resume, no transfer", async () => {
  const f = await registeredLoom()
  let db: Database | undefined
  try {
    const q = (await f.invoke("record", { operation: "ask", question: "Committed before rejection", to_agent: "investigator", blocking: true }, "asker")).result
    const state = join(f.directory, "state/loom/actions-v1")
    db = new Database(join(state, (await readdir(state))[0], "ledger.sqlite"))
    const atRejection: string[] = []
    f.sessions.set("asker", new Error("simulated SDK get rejection"))
    const original = f.sessions.get.bind(f.sessions)
    const get = spyOn(f.sessions, "get").mockImplementation(id => {
      if (id === "asker") {
        // Independent SQLite connection sees the answer BEFORE native get
        // rejects. No hand-injected record or simulated commit is used.
        const rows = db!.query("SELECT id FROM ledger WHERE kind='answer'").all() as { id: string }[]
        atRejection.push(...rows.map(row => row.id))
      }
      return original(id)
    })
    f.sessionReads.length = 0
    const first = (await f.invoke("record", { operation: "answer", question_id: q.id, answer: "Durable despite SDK rejection" }, "respondent")).result
    get.mockRestore()
    expect(atRejection).toEqual([first.id])
    expect(first.resume).toMatchObject({ asking_session_id: "asker", status: "not-attempted", reason: "target-check-failed", attempted: false })
    expect(f.sessionReads).toEqual(["respondent", "asker"])
    expect(f.nativeInputs).toHaveLength(0)
    f.sessions.delete("asker") // Recovery of external access cannot transfer firstness.
    f.sessionReads.length = 0
    const later = (await f.invoke("record", { operation: "answer", question_id: q.id, answer: "Later cannot retry" }, "respondent")).result
    expect(later.resume).toBeUndefined()
    const read = (await f.invoke("record", { operation: "query", view: "thread", question_id: q.id }, "respondent")).result
    expect(read.answers.map((a: { id: string }) => a.id)).toEqual([first.id, later.id])
    expect(f.sessionReads.every(id => id === "respondent")).toBe(true)
    expect(f.nativeInputs).toHaveLength(0)
    console.log("COMPONENT SDK-get rejection: committed answer durable; synthetic/input/wake/resume=0; exact target only; later/read no retry or eligibility transfer. NOT installed evidence.")
  } finally { db?.close(); await f.close() }
})
