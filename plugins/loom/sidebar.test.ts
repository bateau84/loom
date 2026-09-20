import { describe, expect, test } from "bun:test"
import { buildSidebarSnapshot, selectSidebarTasks } from "./sidebar"
import type { Workflow } from "./workflow"

describe("Loom sidebar snapshot", () => {
  test("shows planned tasks and runnable state", () => {
    const workflow: Workflow = {
      id: "wf-1",
      anchor: "docs/anchors/leash-v1/anchor.md",
      createdBySession: "session-1",
      createdAt: "now",
      steps: [
        {
          id: "plan",
          agent: "planner",
          kind: "work",
          dependsOn: [],
          status: "complete",
        },
        {
          id: "task:cli-genesis",
          agent: "worker",
          kind: "work",
          dependsOn: ["plan"],
          status: "complete",
          task: {
            id: "cli-genesis",
            title: "CLI genesis",
            objective: "Create the CLI",
            dependsOn: [],
            write: ["cmd/**"],
            skills: ["golang"],
            verify: ["go test ./..."],
          },
        },
        {
          id: "task:agent-dry-run",
          agent: "worker",
          kind: "work",
          dependsOn: ["plan", "task:cli-genesis"],
          status: "pending",
          task: {
            id: "agent-dry-run",
            title: "Agent dry run",
            objective: "Exercise agent startup",
            dependsOn: ["cli-genesis"],
            write: ["internal/agent/**"],
            skills: ["golang"],
            verify: ["go test ./..."],
          },
        },
        {
          id: "review-implementation",
          agent: "reviewer",
          kind: "gate",
          dependsOn: ["task:cli-genesis", "task:agent-dry-run"],
          status: "pending",
        },
      ],
      verification: [
        {
          id: "vr-1",
          createdByStepId: "plan",
          createdByAgent: "planner",
          beforeStepId: "review-implementation",
          kind: "runtime",
          statement: "Run the CLI smoke test.",
          status: "open",
          createdAt: "now",
        },
      ],
    }

    const snapshot = buildSidebarSnapshot(workflow, [
      {
        id: "OQ-1",
        workflowId: "wf-1",
        question: "Which admission path applies?",
        raisedByAgent: "worker",
        raisedByStepId: "task:agent-dry-run",
        requiredAuthority: "architect",
        blocking: true,
        consumerStepIds: ["task:agent-dry-run"],
        evidence: [],
        status: "open",
        reconciliations: {},
        createdAt: "now",
      },
    ])

    expect(snapshot.state).toBe("active")
    expect(snapshot.progress).toEqual({ finished: 2, total: 4, failed: 0 })
    expect(snapshot.tasks).toEqual([
      { id: "cli-genesis", title: "CLI genesis", status: "complete" },
      { id: "agent-dry-run", title: "Agent dry run", status: "runnable" },
    ])
    expect(snapshot.now).toEqual([
      {
        id: "task:agent-dry-run",
        label: "Agent dry run",
        agent: "worker",
        kind: "work",
      },
    ])
    expect(snapshot.openQuestions).toBe(1)
    expect(snapshot.openVerification).toBe(1)
  })

  test("returns an idle snapshot without a workflow", () => {
    expect(buildSidebarSnapshot()).toEqual({
      active: false,
      workflowId: "",
      state: "idle",
      progress: { finished: 0, total: 0, failed: 0 },
      tasks: [],
      now: [],
      openQuestions: 0,
      openVerification: 0,
    })
  })

  test("keeps runnable tasks visible beyond the row cap", () => {
    const tasks = Array.from({ length: 14 }, (_, index) => ({
      id: `task-${index + 1}`,
      title: `Task ${index + 1}`,
      status: (index === 13 ? "runnable" : "complete") as "runnable" | "complete",
    }))

    const visible = selectSidebarTasks(tasks, 12)

    expect(visible).toHaveLength(12)
    expect(visible.some((task) => task.id === "task-14")).toBe(true)
  })
  test("keeps the discovered TUI entry wired to the sidebar", async () => {
    const entry = await Bun.file(new URL("./tui.ts", import.meta.url)).text()
    const view = await Bun.file(new URL("./tui-view.tsx", import.meta.url)).text()

    expect(entry).toContain('export { default } from "./tui-view"')
    expect(view).toContain('append: "sidebar.content"')
    expect(view).toContain("context.client.rpc(LoomRpc)")
    expect(view).toContain("{ location }")

    const transpiler = new Bun.Transpiler({ loader: "tsx", target: "bun" })
    expect(() => transpiler.transformSync(view)).not.toThrow()
  })

})
