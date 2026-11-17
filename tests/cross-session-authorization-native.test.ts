import { test, expect } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { registeredLoom } from "./helpers/registered-loom.js"

const ask = { operation: "ask", question: "Which boundary should we use?", session_id: "peer", blocking: true }

test("peer delivery uses the actual caller and exact target permission before storing or contacting", async () => {
  const f = await registeredLoom()
  try {
    f.permission.beforeReturn = async () => {
      expect(f.nativeInputs).toHaveLength(0)
      expect((await f.invoke("record", { operation: "query", session_only: true }, "asker")).result.items).toEqual([])
    }
    const q = (await f.invoke("record", ask, "asker", "general")).result
    expect(f.permissionRequests).toEqual([{
      action: "loom.question.deliver", resources: ["session:peer"],
      sessionID: "asker", agent: "general", source: { type: "tool", messageID: "message", id: "tool-call" },
      metadata: { destination_session_id: "peer" },
    }])
    expect(q.dispatch).toMatchObject({ status: "admission-observed", reason: "native-peer-notice-admitted", target_session_id: "peer" })
    expect(f.nativeInputs).toHaveLength(1)
    const history = (await f.invoke("record", { operation: "query", session_only: true }, "asker")).result.items
    expect(history.find((r: any) => r.data.format === "loom-question-dispatch/v1").data.reason).toBe("native-peer-notice-admitted")
  } finally { await f.close() }
})

for (const denial of [new Error("Permission denied: loom.question.deliver"),
  { _tag: "PermissionRejected", message: "Native rejection ends this step" }]) {
  test("native delivery denial/rejection propagates unchanged and creates no question or input: " + denial.message, async () => {
    const f = await registeredLoom()
    try {
      f.permission.error = denial
      await expect(f.invoke("record", ask, "asker", "general")).rejects.toBe(denial)
      expect(f.permissionRequests).toHaveLength(1)
      expect(f.nativeInputs).toHaveLength(0)
      expect(f.sessionCreates).toHaveLength(0)
      expect((await f.invoke("record", { operation: "query", session_only: true }, "asker")).result.items).toEqual([])
      expect((await f.invoke("record", { operation: "query", view: "inbox" }, "peer")).result.items).toEqual([])
    } finally { await f.close() }
  })
}

test("an allow is never cached across targets, callers or agents", async () => {
  const f = await registeredLoom()
  try {
    f.permission.beforeReturn = async () => {
      const r = f.permissionRequests.at(-1)
      if (r.sessionID !== "asker" || r.agent !== "general" || r.resources[0] !== "session:peer")
        throw new Error("Native caller/target policy denied")
    }
    await f.invoke("record", ask, "asker", "general")
    for (const [session, agent, destination] of [["asker", "general", "other-peer"],
      ["other-asker", "general", "peer"], ["asker", "coder", "peer"]])
      await expect(f.invoke("record", { ...ask, session_id: destination }, session, agent)).rejects.toThrow("policy denied")
    expect(f.permissionRequests).toHaveLength(4)
    expect(f.permissionRequests.every(r => !Object.hasOwn(r, "save"))).toBe(true)
    expect(f.nativeInputs).toHaveLength(1)
    expect((await f.invoke("record", { operation: "query", view: "inbox" }, "peer")).result.items).toHaveLength(1)
    expect((await f.invoke("record", { operation: "query", view: "inbox" }, "other-peer")).result.items).toEqual([])
  } finally { await f.close() }
})

for (const moved of ["asker", "peer"]) {
  test("late permission cannot deliver after " + moved + " moves out of the project", async () => {
    const f = await registeredLoom()
    try {
      f.permission.beforeReturn = async () => {
        f.sessions.set(moved, { id: moved, projectID: "foreign", location: { directory: f.directory } })
      }
      await expect(f.invoke("record", ask, "asker", "general")).rejects.toThrow("project/workspace/location")
      expect(f.permissionRequests).toHaveLength(1)
      expect(f.nativeInputs).toHaveLength(0)
      f.sessions.delete(moved)
      expect((await f.invoke("record", { operation: "query", session_only: true }, "asker")).result.items).toEqual([])
    } finally { await f.close() }
  })
}

test("late permission cannot create a question after the caller interrupts", async () => {
  const f = await registeredLoom()
  const controller = new AbortController()
  try {
    f.permission.beforeReturn = async () => { controller.abort(new Error("Caller interrupted permission wait")) }
    await expect(f.tools.get("record").execute(ask, {
      sessionID: "asker", agent: "general", messageID: "actual-message", id: "actual-call", signal: controller.signal,
    })).rejects.toThrow("Caller interrupted")
    expect(f.nativeInputs).toHaveLength(0)
    expect((await f.invoke("record", { operation: "query", session_only: true }, "asker")).result.items).toEqual([])
  } finally { await f.close() }
})

test("a model guard enabled during permission wait still withholds the authorized native notice", async () => {
  const f = await registeredLoom()
  try {
    f.permission.beforeReturn = async () => {
      await writeFile(join(f.directory, ".loom.yaml"), "model-routing:\n  enabled: true\n  default-class: verified\nmodel-classes:\n  verified:\n    models: [sample-model]\ninstructions: {enabled: false}\nledger: {capture: off}\n")
    }
    const q = (await f.invoke("record", ask, "asker", "general")).result
    expect(q.dispatch).toMatchObject({ status: "not-attempted", reason: "model-routing-host-unqualified", attempted: false })
    expect(q.data.expected_session).toBe("peer")
    expect(f.nativeInputs).toHaveLength(0)
    expect(f.permissionRequests).toHaveLength(1)
    const later = (await f.invoke("record", { ...ask, question: "Already guarded?" }, "asker", "general")).result
    expect(later.dispatch.reason).toBe("model-routing-host-unqualified")
    expect(f.permissionRequests).toHaveLength(1)
    expect(f.nativeInputs).toHaveLength(0)
  } finally { await f.close() }
})

test("explicit same-family delivery uses the peer gate and typed parent history remains parent-specific", async () => {
  const f = await registeredLoom()
  try {
    f.sessions.set("child", { id: "child", parentID: "parent", agent: "general", projectID: "tool-help", location: { directory: f.directory } })
    const typed = (await f.invoke("record", { operation: "ask", question: "Parent?", blocking: false,
      recipient: { kind: "dispatcher" } }, "child", "general")).result
    expect(typed.dispatch.reason).toBe("native-parent-notice-admitted")
    expect(f.permissionRequests).toHaveLength(0)
    const explicit = (await f.invoke("record", { ...ask, session_id: "parent" }, "child", "general")).result
    expect(explicit.dispatch.reason).toBe("native-peer-notice-admitted")
    expect(f.permissionRequests).toHaveLength(1)
    expect(f.permissionRequests[0]).toMatchObject({ sessionID: "child", agent: "general", resources: ["session:parent"] })
  } finally { await f.close() }
})
