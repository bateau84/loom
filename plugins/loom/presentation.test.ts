import { describe, expect, test } from "bun:test"
import { renderToolOutput } from "./presentation"

describe("Loom tool presentation", () => {
  test("renders task status as readable Markdown", () => {
    const output = renderToolOutput({
      tasks: [
        {
          stepId: "task:backend",
          status: "pending",
          runnable: true,
          dependsOn: ["task:setup"],
          task: {
            id: "backend",
            title: "Build backend",
            objective: "Implement the service",
            write: ["internal/backend/**"],
            skills: ["golang"],
            verify: ["go test ./..."],
          },
        },
      ],
    })

    expect(output).toContain("## Tasks")
    expect(output).toContain("### `task:backend`")
    expect(output).toContain("**Status:** pending")
    expect(output).toContain("**Runnable:** Yes")
    expect(output).toContain("#### Depends On")
    expect(output).toContain("- `task:setup`")
    expect(output).toContain("#### Task")
    expect(output).toContain("**Title:** Build backend")
    expect(output).not.toContain('{"tasks"')
  })

  test("renders errors prominently", () => {
    const output = renderToolOutput({
      error: "Step has unresolved blocking questions.",
      questions: [{ id: "OQ-17", status: "open", requiredAuthority: "architect" }],
    })

    expect(output).toStartWith("## Error")
    expect(output).toContain("Step has unresolved blocking questions.")
    expect(output).toContain("## Questions")
    expect(output).toContain("### `OQ-17`")
  })

  test("keeps raw JSON as an explicit debug format", () => {
    const output = renderToolOutput({ workflowId: "wf-1", status: "active" }, "json")
    expect(output).toBe(JSON.stringify({ workflowId: "wf-1", status: "active" }, null, 2))
  })

  test("routes every Loom JSON result through the shared renderer", async () => {
    const source = await Bun.file(new URL("./index.ts", import.meta.url)).text()
    expect(source).not.toContain("content: JSON.stringify(")
    expect(source).toContain("content: renderToolOutput(")
  })
})
