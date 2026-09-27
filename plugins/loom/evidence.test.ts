import { describe, expect, test } from "bun:test"
import {
  createClaim,
  observationsSupportKind,
  redactCommand,
  safeInputSummary,
  safeResultError,
  safeResultSummary,
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
    expect(safeInputSummary("loom_diagnostic_sandbox_exec", {
      sandboxId: "s1",
      command: "TOKEN=secret go test ./...",
    })).toEqual({ command: "TOKEN=[REDACTED] go test ./..." })
    expect(safeInputSummary("loom_code_diagnostic_sandbox_exec", {
      sandboxId: "s1",
      command: "API_KEY=secret go test ./...",
    })).toEqual({ command: "API_KEY=[REDACTED] go test ./..." })
    expect(safeInputSummary("loom.code.diagnostic_sandbox_exec", {
      sandboxId: "s1",
      command: "PASSWORD=secret go test ./...",
    })).toEqual({ command: "PASSWORD=[REDACTED] go test ./..." })
    expect(safeResultSummary("skill", {
      metadata: { metadata: { directory: "/workspace/.opencode/skills/software-engineering" } },
    })).toEqual({ skillDirectory: "/workspace/.opencode/skills/software-engineering" })
    expect(safeResultSummary("skill", "Base directory for this skill: /tmp/skills/software-engineering\n")).toEqual({
      skillDirectory: "/tmp/skills/software-engineering",
    })
    expect(safeResultSummary("loom_diagnostic_sandbox_exec", JSON.stringify({
      sandboxId: "s1",
      ok: false,
      exitCode: 2,
      signal: null,
      timedOut: false,
      stdout: "sensitive output",
      stderr: "sensitive error",
    }))).toEqual({
      diagnosticSandbox: {
        id: "s1",
        ok: false,
        exitCode: 2,
        signal: null,
        timedOut: false,
      },
    })
    expect(safeResultSummary(
      "loom.code.diagnostic_sandbox_exec",
      [
        "- **Sandbox ID:** `s2`",
        "- **Ok:** Yes",
        "- **Exit Code:** 0",
        "- **Timed Out:** No",
        "- **Stdout:**",
        "",
        "do not persist me",
      ].join("\n"),
    )).toEqual({
      diagnosticSandbox: {
        id: "s2",
        ok: true,
        exitCode: 0,
        timedOut: false,
      },
    })
  })

  test("detects inner tool errors even when transport completed", () => {
    expect(safeResultError(JSON.stringify({ error: "sandbox baseline unreadable" }))).toBe(
      "sandbox baseline unreadable",
    )
    expect(safeResultError("- **Error:** `sandbox baseline unreadable`")).toBe(
      "sandbox baseline unreadable",
    )
    expect(safeResultError(JSON.stringify({ ok: true }))).toBeUndefined()
  })

  test("failed sandbox experiments cannot support evidence claims", () => {
    const failedSandbox = observation({
      tool: "loom_diagnostic_sandbox_exec",
      command: "false",
      diagnosticSandbox: {
        id: "sandbox-1",
        ok: false,
        exitCode: 1,
        signal: null,
        timedOut: false,
      },
    })
    expect(observationsSupportKind("runtime", [failedSandbox])).toBe(false)
    expect(observationsSupportKind("other", [failedSandbox])).toBe(false)

    const assertedSandbox = observation({
      tool: "loom_diagnostic_sandbox_exec",
      command: "! command-that-must-fail",
      diagnosticSandbox: {
        id: "sandbox-1",
        ok: true,
        exitCode: 0,
        signal: null,
        timedOut: false,
      },
    })
    expect(observationsSupportKind("runtime", [assertedSandbox])).toBe(true)
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
