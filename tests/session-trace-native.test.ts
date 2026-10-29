import { test, expect } from "bun:test"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { registeredLoom } from "./helpers/registered-loom.js"

test("registered trace projects original native tool/skill/dispatch events without exposing raw output", async () => {
  const f = await registeredLoom()
  try {
    const messages = [
      { id: "msg_user", type: "user", time: { created: 1 }, text: "private user request" },
      { id: "msg_skill", type: "skill", time: { created: 2 }, skill: "skill_test", name: "retrospective", text: "hidden-skill-body" },
      { id: "msg_assistant", type: "assistant", time: { created: 3 },
        agent: "general", model: { providerID: "openai", id: "gpt-test" }, cost: 0.04, tokens: { input: 40, output: 10 },
        content: [
          { id: "call_1", type: "tool", name: "task", state: { status: "completed",
            input: { subagent_type: "researcher", prompt: "Check source session messages" },
            content: [{ type: "text", text: "secret tool output" }] } },
          { id: "call_2", type: "tool", name: "grep", state: { status: "error",
            input: { pattern: "foo" }, error: { message: "secret runtime failure" } } },
          { type: "text", text: "Agent's user-visible reply" },
          { type: "reasoning", text: "internal-only-reasoning-sentinel-9472" },
        ] },
      { id: "msg_idle", type: "idle", time: { created: 4 }, outcome: "succeeded" },
    ]
    f.nativeContexts.set("source-session", { data: messages })
    const page = (await f.invoke("trace", { operation: "timeline", session_id: "source-session", limit: 3 })).result
    expect(page).toMatchObject({
      session_id: "source-session", source: "native-context",
      coverage: { full_history: false }, metrics: { user_prompts: 1, tool_calls: 2, tool_errors: 1, dispatches: 1, skills_loaded: 1 },
      total_events: 8, offset: 0, next_offset: 3, text_included: false,
    })
    expect(page.tool_statuses.grep.error).toBe(1)
    const raw = JSON.stringify(page)
    for (const hidden of ["private user request", "hidden-skill-body", "secret tool output", "internal-only-reasoning-sentinel-9472"]) {
      expect(raw).not.toContain(hidden)
    }
    const rest = (await f.invoke("trace", {
      operation: "timeline", session_id: "source-session", offset: page.next_offset, limit: 20, include_text: true,
    })).result
    expect(rest.next_offset).toBeNull()
    const dispatch = rest.events.find((e: any) => e.kind === "agent_dispatch")
    expect(dispatch).toMatchObject({ source_message_id: "msg_assistant", call_id: "call_1",
      recipient: "researcher", dispatch_prompt_excerpt: "Check source session messages" })
    expect(JSON.stringify(rest)).not.toContain("internal-only-reasoning-sentinel-9472")
    expect(JSON.stringify(rest)).not.toContain("secret tool output")
    expect(JSON.stringify(rest)).not.toContain("secret runtime failure")
    expect(f.nativeListRequests).toHaveLength(0)
  } finally { await f.close() }
})

test("child trace is strictly direct, same-project and pagination-aware", async () => {
  const f = await registeredLoom()
  try {
    const location = { directory: f.directory }
    f.nativePages.set("", { data: [
      { id: "c1", parentID: "parent", projectID: "tool-help", location, title: "Researcher" },
      { id: "wrong", parentID: "other", projectID: "tool-help", location },
      { id: "external", parentID: "parent", projectID: "other", location },
    ], cursor: { next: "following" } })
    f.nativePages.set("following", { data: [
      { id: "c2", parentID: "parent", projectID: "tool-help", location },
    ], cursor: { next: null } })
    const first = (await f.invoke("trace", { operation: "children", session_id: "parent", limit: 3 })).result
    expect(first.sessions.map((x: any) => x.id)).toEqual(["c1"])
    expect(first).toMatchObject({ scanned: 3, matched: 1, next_cursor: "following" })
    const next = (await f.invoke("trace", { operation: "children", session_id: "parent", cursor: first.next_cursor })).result
    expect(next.sessions.map((x: any) => x.id)).toEqual(["c2"])
    expect(next.next_cursor).toBeNull()
    expect(f.nativeListRequests[0]).toMatchObject({ parentID: "parent", project: "tool-help", directory: f.directory })
    await expect(f.invoke("trace", { operation: "children", session_id: "parent", export_path: "foo" }))
      .rejects.toThrow("children does not accept")
  } finally { await f.close() }
})

test("verified export projects full original history and blocks identity, path and scope escapes", async () => {
  const f = await registeredLoom()
  try {
    await mkdir(join(f.directory, "exports"))
    const fixture = {
      data: {
        info: { id: "session-a", projectID: "tool-help", location: { directory: f.directory } },
        messages: [
          { type: "user", id: "msg_old", text: "pre-compaction request" },
          { type: "compaction", id: "msg_compacted", status: "completed" },
          { type: "assistant", id: "msg_new", agent: "research", content: [
            { type: "tool", id: "tool_1", name: "read", state: { status: "completed",
              input: { file: "/private/file" }, content: [{ type: "text", text: "very secret output" }] } },
          ] },
        ],
      },
    }
    await writeFile(join(f.directory, "exports", "original.json"), JSON.stringify(fixture))
    const result = (await f.invoke("trace", {
      operation: "timeline", session_id: "session-a", export_path: "exports/original.json",
    })).result
    expect(result).toMatchObject({
      source: "provided-export", coverage: { full_history: null },
      metrics: { messages: 3, compactions: 1, tool_calls: 1 },
    })
    expect(JSON.stringify(result)).not.toContain("very secret output")
    expect(JSON.stringify(result)).not.toContain("/private/file")
    expect(f.permissionRequests).toEqual([{
      action: "read", resources: [join(f.directory, "exports", "original.json")],
      sessionID: "s", agent: "author",
      source: { type: "tool", messageID: "message", id: "tool-call" },
    }])
    f.permission.error = new Error("denied")
    await expect(f.invoke("trace", { operation: "timeline", session_id: "session-a",
      export_path: "exports/original.json" })).rejects.toThrow("denied")
    f.permission.error = undefined
    const candidate = join(f.directory, "exports", "wrong.json")
    await writeFile(candidate, JSON.stringify({ ...fixture, data: { ...fixture.data,
      info: { id: "other-session", projectID: "tool-help", location: { directory: f.directory } } } }))
    await expect(f.invoke("trace", { operation: "timeline", session_id: "session-a",
      export_path: "exports/wrong.json" })).rejects.toThrow("identity")
    await expect(f.invoke("trace", { operation: "timeline", session_id: "session-a",
      export_path: "../outside.json" })).rejects.toThrow("within the current project")
    await symlink("/etc/passwd", join(f.directory, "exports", "outside.json"))
    await expect(f.invoke("trace", { operation: "timeline", session_id: "session-a",
      export_path: "exports/outside.json" })).rejects.toThrow("outside the current project")
    f.sessions.set("session-a", { id: "session-a", projectID: "foreign", location: { directory: f.directory } })
    await expect(f.invoke("trace", { operation: "timeline", session_id: "session-a",
      export_path: "exports/original.json" })).rejects.toThrow("not in this Loom project")
  } finally { await f.close() }
})

test("trace rejects malformed requests and cannot mutate work selection or records", async () => {
  const f = await registeredLoom()
  try {
    const selected = (await f.invoke("action", { operation: "create", title: "Other", goal: "Preserve selection" })).result.id
    f.nativeContexts.set("s", { data: [{ type: "user", id: "msg1", text: "test" }] })
    for (const invalid of [
      { operation: "timeline", offset: -1 },
      { operation: "timeline", limit: 51 },
      { operation: "timeline", include_text: "yes" },
      { operation: "timeline", cursor: "unexpected" },
      { operation: "unknown" },
    ]) await expect(f.invoke("trace", invalid)).rejects.toThrow()
    const result = (await f.invoke("trace", { operation: "timeline" })).result
    expect(result.events[0].source_message_id).toBe("msg1")
    expect((await f.invoke("context", {})).result.action.id).toBe(selected)
    expect((await f.invoke("record", { operation: "query", session_only: true })).result.items).toEqual([])
  } finally { await f.close() }
})
