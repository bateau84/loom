import { describe, expect, test } from "bun:test"
import {
  extractAssistantText,
  extractAssistantTools,
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
      { requires: ["loom_intent_start", "SynaBun_recall"], forbids: ["loom_start"] },
    )
    expect(failures).toEqual([])
  })

  test("extracts only assistant text and tools from session export", () => {
    const exported = [
      { info: { role: "user" }, parts: [{ type: "text", text: "user prompt" }] },
      {
        info: { role: "assistant", summary: false },
        parts: [
          { type: "tool", tool: "loom_intent_start" },
          { type: "text", text: "What matters most?" },
        ],
      },
    ]
    expect(extractAssistantText(exported)).toBe("What matters most?")
    expect(extractAssistantTools(exported)).toEqual(["loom_intent_start"])
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
