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
    await expect(raw(f, "record", { operation: "query", action_id: action.id, response_format: "json" })).rejects.toThrow("only supported for full_thread")
    await expect(raw(f, "record", { ...input, response_format: "xml" })).rejects.toThrow("must be markdown or json")
    const ledger = JSON.parse(await raw(f, "record", { operation: "query", action_id: action.id }))
    expect(ledger.result.items).toHaveLength(2)
    expect(JSON.parse(await raw(f, "action", { operation: "list" })).result.items[0].id).toBe(action.id)
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
