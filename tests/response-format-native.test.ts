import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fullThreadMarkdown, reviewCompanionMarkdown } from "../src/response-format.js"
import { registeredLoom } from "./helpers/registered-loom.js"

type Fixture = Awaited<ReturnType<typeof registeredLoom>>
const tick = String.fromCharCode(96)
async function raw(f: Fixture, name: string, input: unknown, sessionID = "s", agent = "author"): Promise<string> {
  return (await f.tools.get(name).execute(input, {
    sessionID, agent, id: "tool-call", messageID: "message", signal: new AbortController().signal,
  })).content
}

test("Assessment and QA default to Markdown with provenance and offer the original JSON", async () => {
  const f = await registeredLoom()
  try {
    await writeFile(join(f.directory, ".loom.yaml"), JSON.stringify({
      agents: { reviewer: { roles: ["assessment"] }, critic: { roles: ["qa"] } },
      instructions: { enabled: false }, ledger: { capture: "off" },
    }))
    const root = join(f.directory, "installed")
    await mkdir(root)
    await writeFile(join(root, "SKILL.md"), "# Implementation\n")
    const source = "# Review methodology\n\n- Compare claims to accepted requirements.\n"
    await writeFile(join(root, "ASSESSMENT.md"), source)
    f.skills.set("external", { id: "external", path: join(root, "SKILL.md") })

    const markdown = await raw(f, "assessment", { skill: "external" }, "review-session", "reviewer")
    expect(markdown.startsWith("# Assessment lens\n")).toBe(true)
    expect(markdown).toContain("**Skill:** " + tick + "external" + tick)
    expect(markdown).toContain("**Source:** " + tick + join(root, "ASSESSMENT.md") + tick)
    expect(markdown).toContain("**SHA-256:** " + tick + createHash("sha256").update(source).digest("hex") + tick)
    expect(markdown).toContain("\n---\n\n" + source)
    expect(markdown).not.toContain('"result":')
    expect(() => JSON.parse(markdown)).toThrow()

    const original = JSON.parse(await raw(f, "assessment", {
      skill: "external", response_format: "json",
    }, "review-session", "reviewer"))
    expect(original).toEqual({ result: {
      skill: "external", methodology: "assessment", available: true,
      path: join(root, "ASSESSMENT.md"), sha256: createHash("sha256").update(source).digest("hex"),
      content: source,
    } })

    const missing = await raw(f, "qa", { skill: "external" }, "review-session", "critic")
    expect(missing).toContain("# QA lens unavailable")
    expect(missing).toContain("No QA.md was found")
    expect(missing).toContain("SKILL.md is not a substitute")
    const missingJSON = JSON.parse(await raw(f, "qa", {
      skill: "external", response_format: "json",
    }, "review-session", "critic"))
    expect(missingJSON.result.available).toBe(false)
    expect(missingJSON.result.reason).toBe("companion-not-found")
    expect(missingJSON.result).not.toHaveProperty("content")
    for (const input of [
      { skill: "external", response_format: "xml" },
      { skill: "external", response_format: 12 },
      { skill: "external", response_format: "json", other: true },
    ]) {
      await expect(raw(f, "assessment", input, "review-session", "reviewer")).rejects.toThrow("Expected only skill")
    }
    expect(f.nativeInputs).toHaveLength(0)
  } finally { await f.close() }
})

test("full_thread defaults to Markdown with scope/cursor while structured outputs stay JSON", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Readable thread", goal: "Keep all history" })).result
    const first = (await f.invoke("record", { operation: "add", action_id: action.id, kind: "result", statement: "First finding" })).result
    const second = (await f.invoke("record", { operation: "add", action_id: action.id, kind: "concern", statement: "Second finding" })).result
    const input = { operation: "query", view: "full_thread", action_id: action.id, limit: 1 }
    const md = await raw(f, "record", input)
    const json = JSON.parse(await raw(f, "record", { ...input, response_format: "json" }))
    expect(json.result.format).toBe("loom-full-thread/v1")
    expect(json.result.scope).toEqual({ action_id: action.id })
    expect(json.result.next_cursor).toBeTruthy()
    expect(md.startsWith("# Full stored thread\n\n")).toBe(true)
    expect(md).toContain("**Scope:** Action " + tick + action.id + tick)
    expect(md).toContain("**Next cursor:** " + tick + json.result.next_cursor + tick)
    expect(md).toContain(first.id)
    expect(md).toContain("First finding")
    expect(md).not.toContain(second.id)
    expect(json.result.markdown).not.toContain("**Next cursor:**")
    expect(() => JSON.parse(md)).toThrow()

    const next = await raw(f, "record", { ...input, cursor: json.result.next_cursor })
    expect(next).toContain(second.id)
    expect(next).toContain("Second finding")
    expect(next).toContain("**Next cursor:** none (end of this read)")
    expect(JSON.parse(await raw(f, "record", { ...input, response_format: "json" })).result.next_cursor).toBe(json.result.next_cursor)
    expect(await raw(f, "record", { ...input, response_format: "markdown" })).toBe(md)
    await expect(raw(f, "record", { ...input, response_format: "xml" })).rejects.toThrow("must be markdown or json")
    const ledger = JSON.parse(await raw(f, "record", { operation: "query", action_id: action.id }))
    expect(ledger.result.items).toHaveLength(2)
    expect(JSON.parse(await raw(f, "action", { operation: "list" })).result.items[0].id).toBe(action.id)
  } finally { await f.close() }
})

test("explicit JSON preserves every structured record query and rejects unsupported formats before writes", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Format compatibility", goal: "Read a known record" })).result
    await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0,
      nodes: [{ id: "task", kind: "task", title: "Read evidence" }] })
    const record = (await f.invoke("record", { operation: "add", action_id: action.id, node_id: "task",
      kind: "result", statement: "Original finding" })).result
    const question = (await f.invoke("record", { operation: "ask", action_id: action.id,
      to_agent: "manual", question: "Which limit applies?", blocking: false })).result
    for (const fields of [
      { action_id: action.id },
      { action_id: action.id, record_id: record.id },
      { view: "ledger", action_id: action.id, record_id: record.id },
      { view: "progress", action_id: action.id },
      { view: "questions", action_id: action.id },
      { view: "thread", question_id: question.id },
      { view: "inbox" },
      { session_only: true },
    ]) {
      const input = { operation: "query", ...fields }
      const implicit = await raw(f, "record", input)
      const explicit = await raw(f, "record", { ...input, response_format: "json" })
      expect(JSON.parse(explicit)).toEqual(JSON.parse(implicit))
      await expect(raw(f, "record", { ...input, response_format: "markdown" })).rejects.toThrow("markdown is only supported for full_thread")
      // A presentation option must not relax the collaboration view's own field allowlist.
      if (fields.view && fields.view !== "ledger")
        await expect(raw(f, "record", { ...input, response_format: "json", kind: "result" })).rejects.toThrow(`kind is not supported by query:${fields.view}`)
    }
    const exact = JSON.parse(await raw(f, "record", { operation: "query", action_id: action.id,
      record_id: record.id, response_format: "json" }))
    expect(exact.result.items[0]).toMatchObject({ id: record.id, data: { statement: "Original finding" } })
    const before = await raw(f, "record", { operation: "query", action_id: action.id })
    for (const response_format of ["json", "markdown"])
      await expect(raw(f, "record", { operation: "add", action_id: action.id,
        kind: "result", statement: "Must not be saved", response_format })).rejects.toThrow("only supported for queries")
    expect(await raw(f, "record", { operation: "query", action_id: action.id })).toBe(before)
  } finally { await f.close() }
})

test("explicit JSON preserves projected evidence bytes and native permission checks", async () => {
  const f = await registeredLoom()
  try {
    const record = (await f.invoke("record", { operation: "add", session_only: true, kind: "result",
      statement: "Original", artifact_refs: ["PRIVATE-UNSELECTED-REFERENCE"] })).result
    const input = { operation: "query", source_session_id: "s", record_id: record.id,
      projection: "fields", fields: ["statement"] }
    const implicit = await raw(f, "record", input)
    const resources = f.permissionRequests.at(-1).resources
    f.permissionRequests.length = 0
    const explicit = await raw(f, "record", { ...input, response_format: "json" })
    expect(explicit).toBe(implicit)
    expect(JSON.parse(explicit).result.items[0].data).toEqual({ statement: "Original" })
    expect(explicit).not.toContain("PRIVATE-UNSELECTED-REFERENCE")
    expect(f.permissionRequests.at(-1).resources).toEqual(resources)
    expect(f.permissionRequests.at(-1).metadata.view_sha256).toBe(createHash("sha256").update(explicit).digest("hex"))
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).metadata?.view_sha256) throw new Error("format test disclosure denied")
    }
    await expect(raw(f, "record", { ...input, response_format: "json" })).rejects.toThrow("format test disclosure denied")
  } finally { await f.close() }
})

test("untrusted metadata cannot forge headings and configuration errors stay visible", () => {
  const response = fullThreadMarkdown({
    format: "loom-full-thread/v1",
    scope: { session_id: "session" + tick + "\n# fake heading" },
    markdown: "# Full stored thread\n\nStored, escaped history.\n",
    next_cursor: null,
  }, ["Invalid config\n# second fake heading"])
  expect(response).toContain("Session " + tick + "session\\u0060\\u000a# fake heading" + tick)
  expect(response).toContain("\n    # second fake heading")
  expect(response).not.toContain("\n# second fake heading")
  expect(response).toContain("Stored, escaped history.")
  const companion = reviewCompanionMarkdown({
    skill: "unsafe" + tick + "\n" + "fake",
    methodology: "qa", available: false, path: "/tmp/QA.md", reason: "companion-not-found",
  })
  expect(companion).toContain(tick + "unsafe\\u0060\\u000afake" + tick)
  expect(companion).not.toContain('"result":')
})
