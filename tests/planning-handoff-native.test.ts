import { test, expect } from "bun:test"
import { defaults, mergeConfig } from "../src/config.js"
import { guidance } from "../src/agents.js"
import { registeredLoom } from "./helpers/registered-loom.js"

test("planning and coordination guidance distinguish Action planning from optional proposals", () => {
  const config = mergeConfig(defaults(), {
    agents: {
      general: { roles: ["coordination"] },
      "task-manager": { roles: ["planning"] },
      researcher: { roles: ["research"] },
    },
  })
  const planner = guidance(config, "task-manager") ?? ""
  const general = guidance(config, "general") ?? ""
  const researcher = guidance(config, "researcher") ?? ""
  expect(planner).toContain("When assigned to plan an existing Action with its Action ID")
  expect(planner).toContain("loom_context")
  expect(planner).toContain("loom_plan")
  expect(planner).toContain("saved revision and node IDs")
  expect(planner).toContain("docs/plan/")
  expect(planner).toContain("Without an Action ID")
  expect(planner).toContain("if saving to an existing Action is requested, obtain its ID")
  expect(general).toContain("When delegating planning for an existing Action")
  expect(general).toContain("verify the saved loom_plan revision")
  expect(researcher).toContain("An Action alone does not require a Plan")
  expect(researcher).not.toContain("docs/plan/")
})

test("an Action plan revision is attributable to its native planning Session and visible to General", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", {
      operation: "create", title: "Improve retries", goal: "Define safe retry behavior.",
    }, "general-session", "general")).result
    // Reading or receiving an Action ID in chat does not silently create a Plan.
    expect((await f.invoke("context", {}, "planner-session", "task-manager")).result.selected).toBeNull()
    expect((await f.invoke("plan", { operation: "read", action_id: action.id }, "planner-session", "task-manager")).result)
      .toEqual({ revision: 0, nodes: [] })

    expect((await f.invoke("context", { action_id: action.id }, "planner-session", "task-manager")).result.action.id)
      .toBe(action.id)
    const nodes = [
      { id: "research", kind: "task", title: "Investigate retry safety", roles: ["research"] },
      { id: "implement", kind: "task", title: "Implement retries", depends_on: ["research"], roles: ["implementation"] },
    ]
    const saved = (await f.invoke("plan", {
      operation: "save", action_id: action.id, expected_revision: 0, nodes,
    }, "planner-session", "task-manager")).result
    expect(saved).toMatchObject({ revision: 1, nodes, saved_by: { session_id: "planner-session", agent: "task-manager" } })
    expect((await f.invoke("plan", { operation: "read", action_id: action.id }, "general-session", "general")).result)
      .toEqual(saved)

    // A Plan writer remains discoverable after clearing the current selection.
    await f.invoke("context", { clear: true }, "planner-session", "task-manager")
    f.nativePages.set("", {
      data: ["general-session", "planner-session", "other-session"].map(id => ({
        id, projectID: "tool-help", location: { directory: f.directory },
      })),
      cursor: { next: null, previous: null },
    })
    const associated = (await f.invoke("action", {
      operation: "sessions", action_id: action.id,
    }, "general-session", "general")).result.sessions
    expect(associated.map((session: any) => session.id)).toContain("planner-session")
    expect(associated.find((session: any) => session.id === "planner-session").has_recorded_activity).toBe(true)
    expect(associated.map((session: any) => session.id)).not.toContain("other-session")

    await expect(f.invoke("plan", {
      operation: "save", action_id: action.id, expected_revision: 0,
      nodes: [{ id: "stale", kind: "task", title: "Old draft" }],
    }, "other-session", "task-manager")).rejects.toThrow("Plan changed")
    expect((await f.invoke("plan", { operation: "read", action_id: action.id })).result).toEqual(saved)

    // Each revision keeps its original writer, without overwriting history.
    const newer = (await f.invoke("plan", {
      operation: "save", action_id: action.id, expected_revision: 1,
      nodes: [...nodes, { id: "verify", kind: "task", title: "Verify behavior", depends_on: ["implement"] }],
    }, "second-planner-session", "task-manager")).result
    expect(newer.saved_by).toEqual({ session_id: "second-planner-session", agent: "task-manager" })
    expect((await f.invoke("plan", { operation: "read", action_id: action.id, revision: 1 })).result.saved_by)
      .toEqual({ session_id: "planner-session", agent: "task-manager" })
  } finally { await f.close() }
})
