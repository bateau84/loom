import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { Store } from "../src/store.js"
import { registeredLoom } from "./helpers/registered-loom.js"

test("fresh independent Session can record Assessment and QA without creating an Action", async () => {
  const f = await registeredLoom()
  try {
    const independent = (await f.invoke("context", { mode: "independent" }, "review-session", "reviewer")).result
    expect(independent).toMatchObject({
      selected: null, context_mode: "independent", history_withheld: true,
      selection_unchanged: true, records: [], progress: [], questions: [],
    })
    expect((await f.invoke("context", {}, "review-session")).result.selected).toBeNull()
    const assessment = (await f.invoke("record", {
      operation: "add", kind: "assessment", verdict: "inconclusive",
      statement: "Assessment without Action: needs another source check.",
    }, "review-session", "reviewer")).result
    const qa = (await f.invoke("record", {
      operation: "add", kind: "qa", verdict: "pass",
      statement: "QA without Action: two negative cases were exercised.",
    }, "review-session", "critic")).result
    for (const entry of [assessment, qa]) {
      expect(entry.session_id).toBe("review-session")
      expect(entry.action_id).toBeUndefined()
      expect(entry.node_id).toBeUndefined()
      expect(entry.fingerprint).toBeUndefined()
    }
    expect(assessment.agent).toBe("reviewer")
    expect(qa.agent).toBe("critic")
    expect((await f.invoke("action", { operation: "list" })).result.items).toEqual([])
    const own = (await f.invoke("record", { operation: "query", session_only: true }, "review-session")).result.items
    expect(own.map((r: any) => r.id)).toEqual([assessment.id, qa.id])
    expect((await f.invoke("record", { operation: "query" }, "review-session")).result.items.map((r: any) => r.id)).toEqual([assessment.id, qa.id])
    expect((await f.invoke("record", { operation: "query", session_only: true }, "other-session")).result.items).toEqual([])
    const complete = (await f.invoke("record", {
      operation: "query", view: "full_thread", session_id: "review-session", limit: 20,
    }, "other-session")).result
    expect(complete.markdown).toContain("QA without Action")
    expect(complete.markdown).toContain("Assessment without Action")
  } finally { await f.close() }
})

test("session_only add overrides a selected Action without clearing it or contaminating Action history", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Selected", goal: "Retain unrelated work" })).result
    const linked = (await f.invoke("record", {
      operation: "add", kind: "assessment", verdict: "pass", statement: "Review specifically about selected Action.",
    })).result
    const unlinked = (await f.invoke("record", {
      operation: "add", session_only: true, kind: "qa", verdict: "fail",
      statement: "Different Session-only QA, unrelated to the selected Action.",
    })).result
    expect(linked.action_id).toBe(action.id)
    expect(typeof linked.fingerprint).toBe("string")
    expect(unlinked.action_id).toBeUndefined()
    expect(unlinked.fingerprint).toBeUndefined()
    expect((await f.invoke("context", {})).result.action.id).toBe(action.id)
    const actionHistory = (await f.invoke("record", { operation: "query", action_id: action.id })).result.items
    expect(actionHistory.map((r: any) => r.id)).toEqual([linked.id])
    const sessionHistory = (await f.invoke("record", { operation: "query", session_only: true })).result.items
    expect(sessionHistory.map((r: any) => r.id)).toEqual([linked.id, unlinked.id])
    await expect(f.invoke("record", {
      operation: "add", action_id: action.id, session_only: true, kind: "qa", verdict: "pass", statement: "Invalid mixed scope.",
    })).rejects.toThrow("session_only")
    await expect(f.invoke("record", {
      operation: "add", node_id: "task", session_only: true, kind: "qa", verdict: "pass", statement: "Invalid mixed scope.",
    })).rejects.toThrow("session_only")
    await expect(f.invoke("record", {
      operation: "add", action_id: "missing", kind: "qa", verdict: "pass", statement: "Must not fall back to Session.",
    })).rejects.toThrow("Unknown Action")
    expect((await f.invoke("record", { operation: "query", session_only: true })).result.items).toHaveLength(2)
  } finally { await f.close() }
})

test("only unscoped review kinds are permitted; malformed verdicts and no-Action context options remain guarded", async () => {
  const f = await registeredLoom()
  try {
    for (const kind of ["result", "claim", "concern"]) {
      await expect(f.invoke("record", { operation: "add", kind, statement: "No Action exists." }, "unselected")).rejects.toThrow("Provide action_id")
      await expect(f.invoke("record", { operation: "add", session_only: true, kind, statement: "No Action exists." }, "unselected")).rejects.toThrow("session_only")
    }
    await expect(f.invoke("record", { operation: "add", kind: "qa", statement: "Missing verdict." }, "unselected")).rejects.toThrow("Review verdict")
    await expect(f.invoke("record", {
      operation: "add", kind: "assessment", verdict: "pass", evidence_ids: ["missing"], statement: "Forged evidence.",
    }, "unselected")).rejects.toThrow("in this Session")
    for (const options of [{ mode: "continuation" }, { mode: "independent", handoff_id: null }, { handoff_id: "result" }]) {
      await expect(f.invoke("context", options, "unselected")).rejects.toThrow("Select work")
    }
    expect((await f.invoke("record", { operation: "query", session_only: true }, "unselected")).result.items).toEqual([])
    expect((await f.invoke("action", { operation: "list" })).result.items).toEqual([])
  } finally { await f.close() }
})

test("Session review evidence is restricted to unscoped observations from the same Session", () => {
  const db = new Database(":memory:")
  try {
    const store = new Store(db)
    const actor = { session_id: "first-session", agent: "reviewer" }
    const own = store.observe(actor, undefined, { source: "own review call" })
    const foreign = store.observe({ session_id: "other-session", agent: "reviewer" }, undefined, { source: "unrelated" })
    const action = store.create("Scoped task", "Proof should stay linked to its scope", actor)
    const actionObservation = store.observe(actor, { action_id: action.id }, { source: "Action work" })
    const qa = store.record(actor, undefined, {
      kind: "qa", verdict: "pass", statement: "Checked the original unscoped call.", evidence_ids: [own.id],
    })
    expect(qa.data.evidence_ids).toEqual([own.id])
    expect(qa.action_id).toBeUndefined()
    expect(qa.fingerprint).toBeUndefined()
    for (const evidence of [foreign.id, actionObservation.id]) {
      expect(() => store.record(actor, undefined, {
        kind: "assessment", verdict: "pass", statement: "Must not borrow cross-scope evidence.", evidence_ids: [evidence],
      })).toThrow("in this Session")
    }
    const linked = store.record(actor, { action_id: action.id }, {
      kind: "assessment", verdict: "pass", statement: "Action-level observation is linked.", evidence_ids: [actionObservation.id],
    })
    expect(linked.action_id).toBe(action.id)
    expect(typeof linked.fingerprint).toBe("string")
    expect(() => store.record(actor, { action_id: action.id }, {
      kind: "assessment", verdict: "pass", statement: "Cannot borrow Session observation.", evidence_ids: [own.id],
    })).toThrow("in this Action")
    expect(store.records({ session_id: actor.session_id }).items.filter(r => r.kind === "assessment" || r.kind === "qa")).toHaveLength(2)
  } finally { db.close() }
})
