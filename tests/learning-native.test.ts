import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { Store } from "../src/store.js"
import { Learning } from "../src/learning.js"
import { Observer } from "../src/context.js"
import { registeredLoom } from "./helpers/registered-loom.js"

const actor = { session_id: "coder-parent", agent: "coder" }
const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex")
function fixture() {
  const db = new Database(":memory:")
  const store = new Store(db)
  const learning = new Learning(db, store)
  const action = store.create("User feature", "One real objective", actor)
  return { db, store, learning, action }
}

test("insights count records rather than declaring successful objectives from three handbacks", () => {
  const { db, store, learning, action } = fixture()
  try {
    for (const session of ["coder-1", "coder-2", "coder-3"]) {
      store.record({ session_id: session, agent: "coder" }, { action_id: action.id }, {
        kind: "result", statement: "Local implementation finished; later runtime verification belongs to parent" })
    }
    const p = learning.events({ action_id: action.id })
    expect(p.totals.reported_results).toBe(3)
    expect(p.distinct_recorded_sessions).toBe(3)
    expect(p.distinct_action_ids).toBe(1)
    expect(p.coverage.action_is_verified_objective).toBe(false)
    expect(p.coverage.native_session_history).toBe("not-inspected")
    expect(JSON.stringify(p)).not.toContain("success_rate")
  } finally { db.close() }
})

test("insights cursor pages ledger data and do not silently count omitted records", () => {
  const { db, store, learning, action } = fixture()
  try {
    for (let i=0; i<5; i++) store.record(actor, { action_id: action.id }, { kind: "concern", statement: "Verified episode " + i })
    const a = learning.events({ action_id: action.id, limit: 2 })
    expect(a.totals.concerns).toBe(2)
    expect(a.next_before).not.toBeNull()
    const b = learning.events({ action_id: action.id, before: a.next_before!, limit: 2 })
    expect(b.totals.concerns).toBe(2)
    expect(b.events.map(e => e.record_id).some(x => a.events.map(e => e.record_id).includes(x))).toBe(false)
    expect(b.coverage.complete_ledger_window).toBe(false)
  } finally { db.close() }
})

test("tweak candidate is immutable, fingerprinted and never automatically activated", () => {
  const { db, learning } = fixture()
  try {
    const content = "# Skill\\nUse direct evidence."
    const a = learning.propose(actor, { target_kind: "skill", target_id: "software-engineering",
      base_sha256: fingerprint("old"), candidate_content: content,
      hypothesis: "Avoid a recurring unverified DONE result", evidence_refs: ["source:1"] })
    expect(a.candidate_sha256).toBe(fingerprint(content))
    const t = learning.trial(actor, { id: a.id, observed_sha256: a.candidate_sha256,
      observed_effect: "inconclusive", statement: "Could not prove native host delivery" })
    expect(t.activated).toBe(false)
    expect(t.verification).toContain("not certified")
    const loaded = learning.read(a.id)
    expect(loaded.content).toBe(content)
    expect(loaded.trials).toHaveLength(1)
    expect(loaded.trials[0].session_id).toBe(actor.session_id)
    expect(learning.retire(a.id).status).toBe("retired")
    expect(() => learning.trial(actor, { id: a.id, observed_effect: "promising", statement: "Bad claim" })).toThrow()
    expect(() => learning.propose(actor, { target_kind: "skill", target_id: "x", base_sha256: "bad",
      candidate_content: content, hypothesis: "Hypothesis" })).toThrow()
  } finally { db.close() }
})

test("registered tools expose read-only insights and opt-in candidate memory", async () => {
  const host = await registeredLoom()
  try {
    const created = (await host.invoke("action", { operation: "create", title: "Pilot", goal: "One objective" })).result
    const insights = (await host.invoke("insights", { operation: "action", action_id: created.id, limit: 10 })).result
    expect(insights.coverage.action_is_verified_objective).toBe(false)
    const proposal = (await host.invoke("tweak", {
      operation: "propose", target_kind: "skill", target_id: "software-engineering", base_sha256: fingerprint("baseline"),
      candidate_content: "# Experiment", hypothesis: "Test on eligible real work",
    })).result
    expect(proposal.authority).toContain("never installed")
    const list = (await host.invoke("tweak", { operation: "list" })).result
    expect(list.items.some((x: any) => x.id === proposal.id)).toBe(true)
  } finally { await host.close() }
})
