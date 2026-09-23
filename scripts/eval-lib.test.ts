import { validateSuite } from "./eval-lib"
import { loadSuite } from "./eval-lib"
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


describe("conversation-first eval schema", () => {
  const root = new URL("..", import.meta.url).pathname
  const fixture = () => loadSuite(new URL("../evals/front-door.json", import.meta.url).pathname)
  test("accepts conversation responses and optional-suite metadata", () => {
    const suite = fixture()
    suite.default = false
    expect(validateSuite(suite, root)).toEqual([])
    ;(suite as any).default = "false"
    expect(validateSuite(suite, root).some((error) => error.includes("default"))).toBe(true)
  })
  test("accepts scalar equality and same-call argument conjunctions", () => {
    const suite = fixture()
    suite.cases = [suite.cases.find((item) => item.id === "CONVERSATION-01")!]
    suite.cases[0]!.actions = { requires: [{ tool: "subagent", args: { agent: "research", background: false } }, { tool: "subagent", arg: "background", equals: false }] }
    expect(validateSuite(suite, root)).toEqual([])
    suite.cases[0]!.actions!.requires![0]!.arg = "agent"
    expect(validateSuite(suite, root).some((error) => error.includes("cannot be combined"))).toBe(true)
  })
  test("rejects invalid response limits", () => {
    const suite = fixture()
    suite.cases[0]!.target_timeout_seconds = 601
    expect(validateSuite(suite, root).some((error) => error.includes("target_timeout"))).toBe(true)
    delete suite.cases[0]!.target_timeout_seconds
    suite.cases[0]!.output = { min_source_urls: 0 }
    expect(validateSuite(suite, root).some((error) => error.includes("min_source_urls"))).toBe(true)
  })
})
