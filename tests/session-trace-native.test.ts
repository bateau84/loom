import { test, expect } from "bun:test"
import { mkdir, rename, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { traceTimeline } from "../src/session-trace.js"
import { registeredLoom } from "./helpers/registered-loom.js"

test("registered timeline pages original evidence without releasing tool outputs or reasoning", async () => {
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
    f.nativeContexts.set("s", { data: messages })
    const first = (await f.invoke("trace", { operation: "timeline", limit: 3 })).result
    expect(first).toMatchObject({
      session_id: "s", source: "native-context",
      coverage: { full_history: false, delegation_complete: false },
      metrics_scope: "page", metrics: { user_prompts: 1, skills_loaded: 1, assistant_steps: 1, tool_calls: 0 },
      source_messages: 4, total_events: null, text_included: false,
    })
    expect(first.events).toHaveLength(3)
    expect(typeof first.next_cursor).toBe("string")
    for (const hidden of ["private user request", "hidden-skill-body", "secret tool output", "internal-only-reasoning-sentinel-9472"]) {
      expect(JSON.stringify(first)).not.toContain(hidden)
    }
    const second = (await f.invoke("trace", {
      operation: "timeline", cursor: first.next_cursor, limit: 20, include_text: true,
    })).result
    expect(second.next_cursor).toBeNull()
    expect(second.total_events).toBe(8)
    expect(second.metrics).toMatchObject({ tool_calls: 2, tool_errors: 1, dispatches: 1 })
    expect(second.tool_statuses.grep.error).toBe(1)
    expect(second.events.find((e: any) => e.kind === "agent_dispatch")).toMatchObject({
      source_message_id: "msg_assistant", call_id: "call_1", recipient: "researcher",
      dispatch_prompt_excerpt: "Check source session messages",
    })
    const output = JSON.stringify(second)
    for (const hidden of ["secret tool output", "secret runtime failure", "internal-only-reasoning-sentinel-9472"]) expect(output).not.toContain(hidden)
    expect(f.nativeListRequests).toHaveLength(0)
  } finally { await f.close() }
})

test("native context of another Session is denied, including same-project peers and children", async () => {
  const f = await registeredLoom()
  try {
    f.nativeContexts.set("s", { data: [{ type: "user", id: "msg_own", text: "own request" }] })
    f.nativeContexts.set("peer", { data: [{ type: "user", id: "msg_peer", text: "peer secret" }] })
    f.nativeContexts.set("child", { data: [{ type: "user", id: "msg_child", text: "child secret" }] })
    f.sessions.set("child", { id: "child", projectID: "tool-help", parentID: "s", location: { directory: f.directory } })
    for (const target of ["peer", "child"]) {
      await expect(f.invoke("trace", { operation: "timeline", session_id: target, include_text: true }))
        .rejects.toThrow("native context is not authorized")
    }
    expect(f.permissionRequests).toEqual([])
    expect((await f.invoke("trace", { operation: "timeline", include_text: true })).result.events[0].text_excerpt).toBe("own request")
  } finally { await f.close() }
})

test("direct-child inventory permits the caller's family only, with exact paging and scope checks", async () => {
  const f = await registeredLoom()
  try {
    const location = { directory: f.directory }
    f.sessions.set("s", { id: "s", parentID: "parent", projectID: "tool-help", location })
    f.sessions.set("parent", { id: "parent", projectID: "tool-help", location })
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
    await expect(f.invoke("trace", { operation: "children", session_id: "other" }))
      .rejects.toThrow("unrelated Session family")
    await expect(f.invoke("trace", { operation: "children", session_id: "parent", export_path: "foo" }))
      .rejects.toThrow("children does not accept")
  } finally { await f.close() }
})

test("export requires native permission and never claims verified completeness", async () => {
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
      source: "provided-export", coverage: { full_history: null, location_verified: true },
      source_messages: 3, metrics: { compactions: 1, tool_calls: 1 }, total_events: 4,
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
    const redacted = { ...fixture, data: { ...fixture.data, info: { ...fixture.data.info,
      location: { directory: "/[redacted:session-directory:session-a]" },
    } } }
    await writeFile(join(f.directory, "exports", "sanitized.json"), JSON.stringify(redacted))
    const sanitized = (await f.invoke("trace", { operation: "timeline", session_id: "session-a",
      export_path: "exports/sanitized.json" })).result
    expect(sanitized.coverage.full_history).toBeNull()
    expect(sanitized.coverage.location_verified).toBe(false)
    expect(sanitized.events.some((x: any) => x.source_message_id === "msg_old")).toBe(true)
    await writeFile(join(f.directory, "exports", "forged-redaction.json"), JSON.stringify({
      ...redacted, data: { ...redacted.data, info: { ...redacted.data.info,
        location: { directory: "/[redacted:session-directory:another-session]" },
      } },
    }))
    await expect(f.invoke("trace", { operation: "timeline", session_id: "session-a",
      export_path: "exports/forged-redaction.json" })).rejects.toThrow("cannot be verified")
    await writeFile(join(f.directory, "exports", "wrong.json"), JSON.stringify({ ...fixture, data: { ...fixture.data,
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

test("same-path export replacement during permission approval fails before reading", async () => {
  const f = await registeredLoom()
  try {
    await mkdir(join(f.directory, "exports"))
    const path = join(f.directory, "exports", "original.json")
    const copy = join(f.directory, "exports", "old.json")
    const fixture = (text: string) => JSON.stringify({ data: { info: {
      id: "session-a", projectID: "tool-help", location: { directory: f.directory },
    }, messages: [{ type: "user", id: "msg_original", text }] } })
    await writeFile(path, fixture("first"))
    f.permission.beforeReturn = async () => {
      await rename(path, copy)
      await writeFile(path, fixture("replaced"))
      f.permission.beforeReturn = undefined
    }
    await expect(f.invoke("trace", { operation: "timeline", session_id: "session-a",
      export_path: "exports/original.json", include_text: true })).rejects.toThrow("Export file changed")
    expect(f.permissionRequests).toHaveLength(1)
  } finally { await f.close() }
})

test("opaque Code Mode tools and namespaced native delegation must not be misclassified as no delegation", () => {
  const input = [{ type: "assistant", id: "msg_opaque", agent: "general",
    content: [
      { type: "tool", id: "call_opaque", name: "functions.exec",
        state: { status: "completed", input: { code: "const result = await tools.some_tool()" } } },
      { type: "tool", id: "call_named", name: "opencode.delegate",
        state: { status: "completed", input: { prompt: "Inspect evidence", to_agent: "researcher" } } },
    ] }]
  const result = traceTimeline(input, { sessionID: "own", source: "native-context", includeText: true })
  expect(result.metrics).toMatchObject({ tool_calls: 2, dispatches: 1, opaque_tools: 1 })
  expect(result.coverage.delegation_complete).toBe(false)
  expect(result.events.find(x => x.kind === "opaque_tool")).toMatchObject({
    tool: "functions.exec", call_id: "call_opaque", delegation_visibility: "unknown-inner-calls",
  })
  expect(result.events.find(x => x.kind === "agent_dispatch")).toMatchObject({
    call_id: "call_named", recipient: "researcher", dispatch_prompt_excerpt: "Inspect evidence",
  })
})

test("cursor-based pages do not revisit earlier messages or claim a mutable snapshot", () => {
  const input: Record<string, unknown>[] = []
  for (let i = 0; i < 300; i++) input.push({ id: "msg_" + i, type: "user", text: "message " + i })
  const first = traceTimeline(input, { sessionID: "own", source: "native-context", limit: 1 })
  expect(first.total_events).toBeNull()
  expect(first.events[0].source_message_id).toBe("msg_0")
  Object.defineProperty(input[0], "type", { get: () => { throw new Error("Old message was rescanned") } })
  const second = traceTimeline(input, { sessionID: "own", source: "native-context", limit: 1, cursor: first.next_cursor! })
  expect(second.events[0].source_message_id).toBe("msg_1")
  expect(second.total_events).toBeNull()
  expect(() => traceTimeline(input, { sessionID: "different", source: "native-context", cursor: first.next_cursor! }))
    .toThrow("does not match")
  expect(() => traceTimeline(input, { sessionID: "own", source: "provided-export", cursor: first.next_cursor! }))
    .toThrow("does not match")
})

test("trace rejects malformed requests and cannot mutate work selection or records", async () => {
  const f = await registeredLoom()
  try {
    const selected = (await f.invoke("action", { operation: "create", title: "Other", goal: "Preserve selection" })).result.id
    f.nativeContexts.set("s", { data: [{ type: "user", id: "msg1", text: "test" }] })
    for (const invalid of [
      { operation: "timeline", offset: 1 },
      { operation: "timeline", limit: 51 },
      { operation: "timeline", include_text: "yes" },
      { operation: "timeline", cursor: "bad" },
      { operation: "unknown" },
    ]) await expect(f.invoke("trace", invalid)).rejects.toThrow()
    const result = (await f.invoke("trace", { operation: "timeline" })).result
    expect(result.events[0].source_message_id).toBe("msg1")
    expect((await f.invoke("context", {})).result.action.id).toBe(selected)
    expect((await f.invoke("record", { operation: "query", session_only: true })).result.items).toEqual([])
  } finally { await f.close() }
})


test("forged source IDs and projected escaped bytes cannot amplify a trace page", () => {
  const huge = "m".repeat(1024 * 1024)
  const parts = Array.from({ length: 49 }, (_, i) => ({
    id: "call_" + i, type: "tool", name: "read",
    state: { status: "completed", input: {}, content: [{ type: "text", text: "ok" }] },
  }))
  expect(() => traceTimeline([{ id: huge, type: "assistant", content: parts }], {
    sessionID: "s", source: "provided-export", limit: 50,
  })).toThrow(/source.*(ID|identifier)|identifier.*source/i)
  const escaped = Array.from({ length: 50 }, (_, i) => ({
    id: "msg_" + i, type: "user", text: "\u0000".repeat(1100),
  }))
  expect(() => traceTimeline(escaped, {
    sessionID: "s", source: "provided-export", limit: 50, includeText: true,
  })).toThrow(/output.*limit|response.*limit|page.*limit/i)
})

test("text excerpts redact secret-bearing patterns before they reach the result", () => {
  const apiToken = "sk-proj-RETROSECRET000111222333444555666"
  const bearer = "Authorization: Bearer v8Z37-secretToken938163c"
  const assignment = "api_key = ultraPrivateToken-ABC123"
  const jwt = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    "test-signature-ABC123456789",
  ].join(".")
  const history = [
    { id: "msg_user", type: "user", text: apiToken + " asked for " + bearer + "; " + assignment },
    { id: "msg_assistant", type: "assistant", agent: "general", content: [
      { type: "text", text: jwt + " was mentioned in conversation" },
      { type: "tool", id: "call_1", name: "task", state: {
        status: "completed", input: { subagent_type: "researcher", prompt: "Check " + apiToken },
      } },
    ] },
    { id: "msg_shell", type: "shell", command: "export AUTH_TOKEN=" + apiToken, status: "completed" },
  ]
  const response = traceTimeline(history, { sessionID: "s", source: "native-context", includeText: true })
  const rendered = JSON.stringify(response)
  for(const secret of [apiToken, "v8Z37-secretToken938163c", "ultraPrivateToken-ABC123", jwt])
    expect(rendered).not.toContain(secret)
  expect(rendered).toContain("[REDACTED]")
  expect(response.events.some(x => x.kind === "agent_dispatch")).toBe(true)
})

test("requested skill attachment IDs reflect actual OpenCode Prompt.SkillAttachment schema", () => {
  const history = [{ id: "msg_user", type: "user", text: "Use retrospective",
    skills: [
      { id: "skill_1", name: "retrospective", text: "secret skill content" },
      { id: "skill_2", name: "researcher", text: "secret researcher content" },
    ] }]
  const response = traceTimeline(history, { sessionID: "s", source: "native-context" })
  expect(response.events[0]).toMatchObject({
    kind: "user_prompt", requested_skills: ["skill_1", "skill_2"],
  })
  expect(JSON.stringify(response)).not.toContain("secret skill content")
})
