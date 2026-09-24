import { describe, expect, test } from "bun:test"
import {
  createClaim,
  observationsSupportKind,
  redactCommand,
  safeInputSummary,
  type EvidenceObservation,
} from "./evidence"

function observation(overrides: Partial<EvidenceObservation> = {}): EvidenceObservation {
  return {
    id: "e1",
    sessionID: "s",
    agent: "worker",
    tool: "bash",
    status: "completed",
    observedAt: "now",
    command: "go test ./...",
    ...overrides,
  }
}

describe("Loom evidence ledger", () => {
  test("redacts obvious credentials from recorded commands", () => {
    expect(redactCommand("API_KEY=abc123 go test ./...")).toContain("API_KEY=[REDACTED]")
    expect(redactCommand("Authorization: Bearer secret-token")).toBe("Authorization: Bearer [REDACTED]")
  })

  test("captures only compact safe input summaries", () => {
    expect(safeInputSummary("bash", { command: "go test ./..." })).toEqual({ command: "go test ./..." })
    expect(safeInputSummary("read", { filePath: "src/main.go", content: "secret" })).toEqual({
      path: "src/main.go",
    })
    expect(safeInputSummary("skill", { name: "software-engineering" })).toEqual({ skill: "software-engineering", methodology: "practitioner" })
    expect(safeInputSummary("loom_assessment", { skill: "software-engineering" })).toEqual({ skill: "software-engineering", methodology: "assessment", path: "skills/software-engineering/ASSESSMENT.md" })
    expect(safeInputSummary("loom_qa", { skill: "software-engineering" })).toEqual({ skill: "software-engineering", methodology: "qa", path: "skills/software-engineering/QA.md" })
  })

  test("test claim needs an observed test command", () => {
    expect(observationsSupportKind("test", [observation()])).toBe(true)
    expect(
      observationsSupportKind("test", [observation({ command: "echo looks-good" })]),
    ).toBe(false)
  })

  test("failed observations cannot support success claims", () => {
    expect(observationsSupportKind("test", [observation({ status: "error" })])).toBe(false)
  })

  test("claims reference observed event ids rather than prose-only proof", () => {
    const claim = createClaim({
      id: "c1",
      workflowId: "w",
      stepId: "worker",
      byAgent: "worker",
      kind: "test",
      statement: "Go tests passed",
      observations: [observation()],
      now: "later",
    })

    expect(claim.observationIds).toEqual(["e1"])
  })
})
