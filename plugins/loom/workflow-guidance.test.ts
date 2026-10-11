import { describe, expect, test } from "bun:test"
import { candidateLoomTransitions } from "./workflow-guidance"

describe("Loom agent-facing next actions", () => {
  test("exposes only currently admitted candidates without claiming liveness", () => {
    expect(candidateLoomTransitions("wf-1", [
      { step: "implement", agent: "worker", dispatch: { state: "ready" }, execution: { state: "unknown" } },
      { step: "review", agent: "reviewer", dispatch: { state: "blocked", reason: "budget" }, execution: { state: "unknown" } },
      { step: "qa", agent: "critic", dispatch: { state: "unknown" }, execution: { state: "unknown" } },
    ])).toEqual([{
      kind: "candidate", tool: "loom_dispatch_grant", input: { workflowId: "wf-1", stepId: "implement" },
      agent: "worker", executionLiveness: "unknown",
      note: "Current dispatch admission was ready. The grant will revalidate state, budget and ownership.",
    }])
  })
  test("never says an attached child has finished", () => {
    const [action] = candidateLoomTransitions("wf", [
      { step: "review", agent: "reviewer", dispatch: { state: "ready" }, execution: { state: "unknown", evidence: "current_attachment" } },
    ])
    expect(action.executionLiveness).toBe("unknown")
    expect(action.note).toContain("inspect live execution")
  })
  test("no admitted steps means no dispatch suggestions", () => {
    expect(candidateLoomTransitions("wf", [])).toEqual([])
  })
})
