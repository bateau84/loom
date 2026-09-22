import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

export type EvalExecution = "runtime" | "role-decision"

export type ActionAssertion = {
  tool: string
  arg: string
  equals?: string | number | boolean | null
  ends_with?: string
}

export type EvalCase = {
  id: string
  agent: string
  skill?: string
  execution: EvalExecution
  target_timeout_seconds?: number
  requirements: string[]
  prompt: string
  trap: string
  expectations: string[]
  must_not: string[]
  tools?: {
    requires?: string[]
    forbids?: string[]
  }
  actions?: {
    requires?: ActionAssertion[]
    forbids?: ActionAssertion[]
  }
  fixture_files?: Array<{ path: string; content: string }>
}

export type EvalSuite = {
  version: number
  name: string
  cases: EvalCase[]
}

export type JsonEvent = Record<string, unknown>

export function loadSuite(path: string): EvalSuite {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as EvalSuite
  return parsed
}

export function validateSuite(suite: EvalSuite, repoRoot: string) {
  const errors: string[] = []
  if (suite.version !== 1) errors.push("suite version must be 1")
  if (!suite.name?.trim()) errors.push("suite name is required")
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    errors.push("suite needs at least one case")
    return errors
  }

  const ids = new Set<string>()
  for (const [index, item] of suite.cases.entries()) {
    const label = item.id || `case-${index + 1}`
    if (!item.id?.trim()) errors.push(`${label}: id is required`)
    else if (ids.has(item.id)) errors.push(`${label}: duplicate id`)
    else ids.add(item.id)

    if (!item.agent?.trim()) errors.push(`${label}: agent is required`)
    else if (!existsSync(join(repoRoot, "agents", `${item.agent}.md`))) {
      errors.push(`${label}: unknown agent ${item.agent}`)
    }
    if (item.skill !== undefined) {
      if (typeof item.skill !== "string" || !item.skill.trim()) {
        errors.push(`${label}: skill must be a non-empty string when present`)
      } else if (!existsSync(join(repoRoot, "skills", item.skill, "SKILL.md"))) {
        errors.push(`${label}: unknown skill ${item.skill}`)
      }
      if (item.execution !== "runtime") {
        errors.push(`${label}: skill evals require runtime execution so skill loading is observable`)
      }
    }

    if (!["runtime", "role-decision"].includes(item.execution)) {
      errors.push(`${label}: execution must be runtime or role-decision`)
    }
    if (
      item.target_timeout_seconds !== undefined &&
      (!Number.isInteger(item.target_timeout_seconds) ||
        item.target_timeout_seconds < 30 ||
        item.target_timeout_seconds > 600)
    ) {
      errors.push(`${label}: target_timeout_seconds must be an integer from 30 to 600`)
    }
    if (!item.prompt?.trim()) errors.push(`${label}: prompt is required`)
    if (!item.trap?.trim()) errors.push(`${label}: trap is required`)
    if (!Array.isArray(item.requirements) || item.requirements.length === 0) {
      errors.push(`${label}: at least one requirement mapping is required`)
    } else {
      const requirementDir = join(repoRoot, "docs", "requirements", "loom")
      const requirementFiles = new Set(
        existsSync(requirementDir)
          ? readdirSync(requirementDir).filter((file) => file.startsWith("br-") && file.endsWith(".md"))
          : [],
      )
      for (const requirement of item.requirements) {
        const prefix = requirement.toLowerCase() + "-"
        if (![...requirementFiles].some((file) => file.startsWith(prefix))) {
          errors.push(`${label}: unknown requirement mapping ${requirement}`)
        }
      }
    }
    if (!Array.isArray(item.expectations) || item.expectations.length < 2) {
      errors.push(`${label}: at least two positive expectations are required`)
    }
    if (!Array.isArray(item.must_not) || item.must_not.length < 1) {
      errors.push(`${label}: at least one forbidden behavior is required`)
    }
    if (item.tools) {
      for (const key of ["requires", "forbids"] as const) {
        const values = item.tools[key]
        if (values !== undefined && (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value.trim()))) {
          errors.push(`${label}: tools.${key} must be a non-empty string array when present`)
        }
      }
    }
    if (item.actions) {
      if (item.execution !== "runtime") {
        errors.push(`${label}: action assertions require runtime execution`)
      }
      for (const key of ["requires", "forbids"] as const) {
        const values = item.actions[key]
        if (values === undefined) continue
        if (!Array.isArray(values)) {
          errors.push(`${label}: actions.${key} must be an array when present`)
          continue
        }
        for (const [actionIndex, assertion] of values.entries()) {
          const prefix = `${label}: actions.${key}[${actionIndex}]`
          if (!assertion || typeof assertion !== "object") {
            errors.push(`${prefix} must be an object`)
            continue
          }
          if (typeof assertion.tool !== "string" || !assertion.tool.trim()) {
            errors.push(`${prefix}.tool is required`)
          }
          if (typeof assertion.arg !== "string" || !assertion.arg.trim()) {
            errors.push(`${prefix}.arg is required`)
          }
          const hasEquals = Object.prototype.hasOwnProperty.call(assertion, "equals")
          const hasEndsWith = Object.prototype.hasOwnProperty.call(assertion, "ends_with")
          if (Number(hasEquals) + Number(hasEndsWith) !== 1) {
            errors.push(`${prefix} requires exactly one comparator: equals or ends_with`)
          } else if (
            hasEquals &&
            assertion.equals !== null &&
            !["string", "number", "boolean"].includes(typeof assertion.equals)
          ) {
            errors.push(`${prefix}.equals must be a JSON scalar`)
          } else if (hasEndsWith && typeof assertion.ends_with !== "string") {
            errors.push(`${prefix}.ends_with must be a string`)
          }
        }
      }
    }
  }
  return errors
}

export function parseJsonLines(text: string): JsonEvent[] {
  const events: JsonEvent[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    try {
      const value = JSON.parse(line)
      if (value && typeof value === "object" && !Array.isArray(value)) events.push(value)
    } catch {
      // OpenCode may emit warnings around JSONL; preserve them in raw artifacts,
      // but do not treat them as structured events.
    }
  }
  return events
}

function walk(value: unknown, visit: (record: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
    return
  }
  if (!value || typeof value !== "object") return
  const record = value as Record<string, unknown>
  visit(record)
  for (const child of Object.values(record)) walk(child, visit)
}

export function extractSessionId(events: JsonEvent[]) {
  for (const event of events) {
    if (typeof event.sessionID === "string") return event.sessionID
    if (typeof event.sessionId === "string") return event.sessionId
  }
  return undefined
}

export function extractText(...sources: unknown[]) {
  const parts: string[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    walk(source, (record) => {
      if (record.type === "text" && typeof record.text === "string") {
        const value = record.text.trim()
        if (value && !seen.has(value)) {
          seen.add(value)
          parts.push(value)
        }
      }
      const part = record.part
      if (part && typeof part === "object") {
        const p = part as Record<string, unknown>
        if (p.type === "text" && typeof p.text === "string") {
          const value = p.text.trim()
          if (value && !seen.has(value)) {
            seen.add(value)
            parts.push(value)
          }
        }
      }
    })
  }
  return parts.join("\n\n")
}

export function extractTools(...sources: unknown[]) {
  const tools = new Set<string>()
  for (const source of sources) {
    walk(source, (record) => {
      if (record.type === "tool" && typeof record.tool === "string") tools.add(record.tool)
      if (record.type === "tool_use") {
        const part = record.part
        if (part && typeof part === "object" && typeof (part as Record<string, unknown>).tool === "string") {
          tools.add(String((part as Record<string, unknown>).tool))
        }
      }
    })
  }
  return [...tools]
}

function normalizeTool(value: string) {
  return value
    .replace(/^mcp__([^_]+)__(.+)$/, "$1_$2")
    .replaceAll(".", "_")
}

function toolMatches(observed: string, expected: string) {
  return normalizeTool(observed) === normalizeTool(expected)
}

export function gradeToolAssertions(
  tools: string[],
  assertions: EvalCase["tools"],
) {
  const failures: string[] = []
  for (const required of assertions?.requires ?? []) {
    if (!tools.some((tool) => toolMatches(tool, required))) {
      failures.push(`required tool not observed: ${required}`)
    }
  }
  for (const forbidden of assertions?.forbids ?? []) {
    if (tools.some((tool) => toolMatches(tool, forbidden))) {
      failures.push(`forbidden tool observed: ${forbidden}`)
    }
  }
  return failures
}

export type SemanticGrade = {
  passed: boolean
  expectations: Array<{ expectation: string; met: boolean; reason: string }>
  violations: Array<{ rule: string; violated: boolean; reason: string }>
  summary: string
}

export function parseSemanticGrade(text: string): SemanticGrade {
  const cleaned = text
    .trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/, "")
  const parsed = JSON.parse(cleaned) as SemanticGrade
  if (typeof parsed.passed !== "boolean") throw new Error("judge result missing boolean passed")
  if (!Array.isArray(parsed.expectations) || !Array.isArray(parsed.violations)) {
    throw new Error("judge result missing expectation/violation arrays")
  }
  return parsed
}


export function extractAssistantText(exported: unknown) {
  const parts: string[] = []
  const messages = Array.isArray(exported)
    ? exported
    : exported && typeof exported === "object" && Array.isArray((exported as Record<string, unknown>).messages)
      ? ((exported as Record<string, unknown>).messages as unknown[])
      : []

  for (const item of messages) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const info = record.info
    if (!info || typeof info !== "object") continue
    const meta = info as Record<string, unknown>
    if (meta.role !== "assistant" || meta.summary === true) continue

    const messageParts = Array.isArray(record.parts) ? record.parts : []
    for (const part of messageParts) {
      if (!part || typeof part !== "object") continue
      const p = part as Record<string, unknown>
      if (p.type === "text" && p.synthetic !== true && p.ignored !== true && typeof p.text === "string") {
        const value = p.text.trim()
        if (value) parts.push(value)
      }
    }
  }
  return parts.join("\n\n")
}

export function extractAssistantTools(exported: unknown) {
  const tools = new Set<string>()
  const messages = Array.isArray(exported)
    ? exported
    : exported && typeof exported === "object" && Array.isArray((exported as Record<string, unknown>).messages)
      ? ((exported as Record<string, unknown>).messages as unknown[])
      : []

  for (const item of messages) {
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    const info = record.info
    if (!info || typeof info !== "object" || (info as Record<string, unknown>).role !== "assistant") continue
    const messageParts = Array.isArray(record.parts) ? record.parts : []
    for (const part of messageParts) {
      if (!part || typeof part !== "object") continue
      const p = part as Record<string, unknown>
      if (p.type === "tool" && typeof p.tool === "string") tools.add(p.tool)
    }
  }
  return [...tools]
}
