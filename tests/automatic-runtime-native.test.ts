import { test, expect } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { registeredLoom } from "./helpers/registered-loom.js"

async function host() {
  const f = await registeredLoom([], { beforeSetup: async directory => {
    await writeFile(join(directory, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: automatic}\n")
  } })
  f.sessions.set("s", { id: "s", agent: "author", projectID: "tool-help", location: { directory: f.directory } })
  return f
}
async function settled(f: Awaited<ReturnType<typeof registeredLoom>>) {
  for (let i = 0; i < 100; i++) {
    const status = (await f.invoke("insights", { operation: "evaluation-status" })).result
    if (!status.queued && status.opportunity?.state === "idle") return status
    await new Promise<void>(resolve => setTimeout(resolve, 5))
  }
  throw new Error("Automatic processing did not settle")
}

test("registered native events produce a durable report without an evaluation command or idle callback", async () => {
  const f = await host()
  try {
    const event = { sessionID: "s", agent: "author", messageID: "message", id: "call", tool: "shell", input: { command: "fixture-test" } }
    await f.hooks.get("execute.before")(event)
    await f.hooks.get("execute.after")({ ...event, status: "error", error: { message: "fixture failure" } })
    await settled(f)
    const listing = (await f.invoke("insights", { operation: "evaluations" })).result
    expect(listing.items).toHaveLength(1)
    const report = (await f.invoke("insights", { operation: "evaluation", batch_id: listing.items[0].id })).result
    expect(report.report.body.observations["tool-error"]).toBe(1)
    expect(report.report.body.genuine_evaluator.state).toBe("blocked")
    expect(f.sessionCreates).toHaveLength(0)
    expect(f.sessionPrompts).toHaveLength(0)
  } finally { await f.close() }
})

async function source(f: Awaited<ReturnType<typeof host>>, id: string) {
  const event = { sessionID: "s", agent: "author", messageID: "message", id, tool: "shell", input: { command: "fixture-test" } }
  await f.hooks.get("execute.before")(event)
  await f.hooks.get("execute.after")({ ...event, status: "error", error: { message: "fixture failure" } })
}

test("every public report page rechecks native permission and denies unrelated owners", async () => {
  const f = await host()
  try {
    await source(f, "original")
    await settled(f)
    const listing = (await f.invoke("insights", { operation: "evaluations" })).result
    const id = listing.items[0].id
    expect((await f.invoke("insights", { operation: "evaluations" }, "unrelated")).result.items).toEqual([])
    await expect(f.invoke("insights", { operation: "evaluation", batch_id: id }, "unrelated")).rejects.toThrow("unavailable")
    f.permission.error = new Error("native source permission revoked")
    for (const input of [{ operation: "evaluation-status" }, { operation: "evaluations" },
      { operation: "evaluation", batch_id: id }, { operation: "evaluation-members", batch_id: id }]) {
      await expect(f.invoke("insights", input)).rejects.toThrow("permission revoked")
    }
    expect(f.permissionRequests.at(-1).resources).toHaveLength(2)
  } finally { await f.close() }
})

test("restart catches up sources from failed work even when the first process never authorized analysis", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loom-auto-restart-"))
  const setup = async (directory: string) => { await writeFile(join(directory, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: automatic}\n") }
  let f = await registeredLoom([], { directory, beforeSetup: setup })
  try {
    // No native agent is available to the first automatic worker, so it cannot inspect sources.
    await source(f, "failed-work")
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect((await f.invoke("insights", { operation: "evaluations" })).result.items).toHaveLength(0)
    await f.close()
    f = await registeredLoom([], { directory, beforeSetup: setup })
    f.sessions.set("s", { id: "s", agent: "author", projectID: "tool-help", location: { directory } })
    await settled(f)
    const listing = (await f.invoke("insights", { operation: "evaluations" })).result
    expect(listing.items).toHaveLength(1)
    const result = (await f.invoke("insights", { operation: "evaluation", batch_id: listing.items[0].id })).result
    expect(result.report.body.observations["tool-error"]).toBe(1)
  } finally { await f.close(); await rm(directory, { recursive: true, force: true }) }
})

test("capture opt-out leaves sources and learning history unchanged by opportunities", async () => {
  const f = await registeredLoom()
  try {
    f.sessions.set("s", { id: "s", agent: "author", projectID: "tool-help", location: { directory: f.directory } })
    await source(f, "ignored")
    await f.hooks.get("experimental.idle")({ sessionID: "s" })
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    const status = (await f.invoke("insights", { operation: "evaluation-status" })).result
    expect(status).toMatchObject({ enabled: false, opportunity: null, automatic_model_calls: false })
    expect((await f.invoke("insights", { operation: "evaluations" })).result.items).toEqual([])
  } finally { await f.close() }
})

test("shutdown cancels pending native permission without waiting for an unabortable host RPC", async () => {
  const f = await host()
  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  f.permission.beforeReturn = async () => { entered(); await gate }
  try {
    await source(f, "pending-permission")
    await started
    await f.close()
  } finally { release() }
})

test("concurrent late notifications are not lost and evaluation readback does not recursively create evidence", async () => {
  const f = await host()
  try {
    await source(f, "first")
    await settled(f)
    await Promise.all([source(f, "second"), source(f, "third")])
    await settled(f)
    const listing = (await f.invoke("insights", { operation: "evaluations" })).result
    const result = (await f.invoke("insights", { operation: "evaluation", batch_id: listing.items[0].id })).result
    expect(result.report.body.observations["tool-error"]).toBe(3)
    for (let i = 0; i < 3; i++) {
      await f.hooks.get("execute.after")({ sessionID: "s", agent: "author", messageID: "m", id: "read" + i, tool: "loom_insights", status: "completed" })
      await f.invoke("insights", { operation: "evaluations" })
    }
    expect((await f.invoke("insights", { operation: "evaluations" })).result.items.map((b: any) => b.id)).toEqual(listing.items.map((b: any) => b.id))
  } finally { await f.close() }
})
