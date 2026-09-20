import { describe, expect, test } from "bun:test"
import {
  extractSessionId,
  extractText,
  extractTools,
  gradeToolAssertions,
  parseJsonLines,
  parseSemanticGrade,
} from "./eval-lib"

describe("behavioral eval utilities", () => {
  test("parses OpenCode JSONL and ignores warnings", () => {
    const events = parseJsonLines('warning\n{"type":"step_start","sessionID":"ses_1"}\n{"type":"text","part":{"type":"text","text":"hello"}}')
    expect(events).toHaveLength(2)
    expect(extractSessionId(events)).toBe("ses_1")
    expect(extractText(events)).toBe("hello")
  })

  test("extracts tool names from OpenCode tool events", () => {
    const events = [{
      type: "tool_use",
      part: { type: "tool", tool: "loom_intent_start" },
    }]
    expect(extractTools(events)).toEqual(["loom_intent_start"])
  })

  test("grades required and forbidden tools by exact/suffixed runtime names", () => {
    const failures = gradeToolAssertions(
      ["loom_intent_start", "mcp__SynaBun__recall"],
      { requires: ["intent_start", "recall"], forbids: ["start"] },
    )
    // intent_start also suffix-matches generic start only if separator semantics are wrong.
    expect(failures).toContain("forbidden tool observed: start")
  })

  test("parses strict semantic judge JSON", () => {
    const grade = parseSemanticGrade(JSON.stringify({
      passed: true,
      expectations: [{ expectation: "x", met: true, reason: "yes" }],
      violations: [{ rule: "y", violated: false, reason: "no" }],
      summary: "ok",
    }))
    expect(grade.passed).toBe(true)
  })
})
