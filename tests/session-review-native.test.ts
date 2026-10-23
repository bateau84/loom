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

test("malformed review verdicts and no-Action context options remain guarded", async () => {
  const f = await registeredLoom()
  try {
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

test("result, claim and concern work without an Action; selected Actions can be overridden explicitly", async () => {
  const f = await registeredLoom()
  try {
    const records: any[] = []
    for (const kind of ["result", "claim", "concern"] as const) {
      for (const session_only of [false, true]) {
        const entry = (await f.invoke("record", {
          operation: "add", kind, ...(session_only ? { session_only: true } : {}),
          statement: `Recorded ${kind} in a Session with no Action.`,
          artifact_refs: ["/tmp/local-diagnostics.txt"],
        }, "notes-session")).result
        expect(entry.kind).toBe(kind)
        expect(entry.session_id).toBe("notes-session")
        expect(entry.action_id).toBeUndefined()
        expect(entry.node_id).toBeUndefined()
        expect(entry.fingerprint).toBeUndefined()
        records.push(entry)
      }
    }
    expect((await f.invoke("action", { operation: "list" })).result.items).toEqual([])
    const own = (await f.invoke("record", { operation: "query", session_only: true }, "notes-session")).result.items
    expect(own.map((r: any) => r.id)).toEqual(records.map(r => r.id))
    expect((await f.invoke("record", { operation: "query" }, "notes-session")).result.items.map((r: any) => r.id)).toEqual(records.map(r => r.id))
    expect((await f.invoke("record", { operation: "query", session_only: true }, "other-session")).result.items).toEqual([])
    const thread = (await f.invoke("record", {
      operation: "query", view: "full_thread", session_id: "notes-session",
    }, "other-session")).result
    for (const kind of ["result", "claim", "concern"]) expect(thread.markdown).toContain(`Recorded ${kind}`)

    const action = (await f.invoke("action", {
      operation: "create", title: "Selected work", goal: "Preserve scope boundaries",
    }, "notes-session")).result
    const linked = (await f.invoke("record", {
      operation: "add", kind: "claim", statement: "This claim is about the Action.",
    }, "notes-session")).result
    const detached = (await f.invoke("record", {
      operation: "add", kind: "concern", session_only: true, statement: "This concern is not about the Action.",
    }, "notes-session")).result
    expect(linked.action_id).toBe(action.id)
    expect(typeof linked.fingerprint).toBe("string")
    expect(detached.action_id).toBeUndefined()
    expect(detached.fingerprint).toBeUndefined()
    expect((await f.invoke("context", {}, "notes-session")).result.action.id).toBe(action.id)
    expect((await f.invoke("record", { operation: "query", action_id: action.id }, "notes-session")).result.items.map((r: any) => r.id)).toEqual([linked.id])
    expect((await f.invoke("record", { operation: "query", session_only: true }, "notes-session")).result.items.map((r: any) => r.id)).toEqual([...records.map(r => r.id), linked.id, detached.id])
    await expect(f.invoke("record", {
      operation: "add", action_id: action.id, kind: "concern", session_only: true, statement: "Invalid mixed scope",
    }, "notes-session")).rejects.toThrow("session_only")
    await expect(f.invoke("record", {
      operation: "add", action_id: "missing-action", kind: "result", statement: "Invalid explicit Action must fail",
    }, "notes-session")).rejects.toThrow("Unknown Action")
  } finally { await f.close() }
})

test("Session-only results, claims and concerns may cite only unscoped observations from their own Session", () => {
  const db = new Database(":memory:")
  try {
    const store = new Store(db)
    const actor = { session_id: "evidence-session", agent: "general" }
    const own = store.observe(actor, undefined, { source: "own host observation" })
    const foreign = store.observe({ session_id: "another-session", agent: "general" }, undefined, { source: "foreign observation" })
    const action = store.create("Other Action", "Keep work evidence separate", actor)
    const scoped = store.observe(actor, { action_id: action.id }, { source: "Action observation" })
    for (const kind of ["result", "claim", "concern"] as const) {
      const record = store.record(actor, undefined, {
        kind, statement: `Unscoped ${kind} with evidence.`, evidence_ids: [own.id],
      })
      expect(record.data.evidence_ids).toEqual([own.id])
      expect(record.action_id).toBeUndefined()
      expect(record.fingerprint).toBeUndefined()
      for (const forbidden of [foreign.id, scoped.id, "unknown-record"]) {
        expect(() => store.record(actor, undefined, {
          kind, statement: "Evidence from wrong scope must fail.", evidence_ids: [forbidden],
        })).toThrow("in this Session")
      }
      const linked = store.record(actor, { action_id: action.id }, {
        kind, statement: "Action-linked evidence.", evidence_ids: [scoped.id],
      })
      expect(linked.action_id).toBe(action.id)
      expect(() => store.record(actor, { action_id: action.id }, {
        kind, statement: "Action cannot borrow Session evidence.", evidence_ids: [own.id],
      })).toThrow("in this Action")
    }
  } finally { db.close() }
})
