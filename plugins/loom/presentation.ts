export type ToolOutputFormat = "markdown" | "json"

function humanizeKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace(/\bId\b/g, "ID")
    .replace(/\bOq\b/g, "OQ")
}

function looksMachineLike(value: string) {
  return (
    value.length > 0 &&
    value.length <= 120 &&
    !/\s/.test(value) &&
    (/[:/._-]/.test(value) || /^[0-9a-f]{8,}$/i.test(value))
  )
}

function scalar(value: unknown) {
  if (value === null || value === undefined) return "None"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number" || typeof value === "bigint") return String(value)

  const text = String(value)
  if (text.length === 0) return "—"
  if (text.includes("\n")) return text
  if (looksMachineLike(text)) return `\`${text.replaceAll("\`", "\\\`")}\``
  return text
}

function preferredItemLabel(value: Record<string, unknown>, index: number) {
  const preferred = ["title", "name", "stepId", "questionId", "workflowId", "id", "kind", "status"]
  for (const key of preferred) {
    const candidate = value[key]
    if (typeof candidate === "string" && candidate.trim()) return scalar(candidate)
  }

  const task = value.task
  if (task && typeof task === "object" && !Array.isArray(task)) {
    const title = (task as Record<string, unknown>).title
    if (typeof title === "string" && title.trim()) return scalar(title)
  }

  return `Item ${index + 1}`
}

function renderArray(values: unknown[], level: number): string[] {
  if (values.length === 0) return ["None"]

  if (values.every((value) => value === null || typeof value !== "object")) {
    return values.map((value) => `- ${scalar(value)}`)
  }

  const lines: string[] = []
  values.forEach((value, index) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const object = value as Record<string, unknown>
      lines.push(`${"#".repeat(Math.min(level, 6))} ${preferredItemLabel(object, index)}`)
      lines.push("")
      lines.push(...renderObject(object, level + 1))
    } else if (Array.isArray(value)) {
      lines.push(`${"#".repeat(Math.min(level, 6))} Item ${index + 1}`)
      lines.push("")
      lines.push(...renderArray(value, level + 1))
    } else {
      lines.push(`- ${scalar(value)}`)
    }

    if (index < values.length - 1) lines.push("")
  })
  return lines
}

function renderObject(value: Record<string, unknown>, level: number): string[] {
  const lines: string[] = []
  const entries = Object.entries(value)

  const scalars = entries.filter(([, entry]) => entry === null || typeof entry !== "object")
  const nested = entries.filter(([, entry]) => entry !== null && typeof entry === "object")

  for (const [key, entry] of scalars) {
    if (typeof entry === "string" && entry.includes("\n")) {
      lines.push(`**${humanizeKey(key)}:**`)
      lines.push("")
      lines.push(entry)
      lines.push("")
    } else {
      lines.push(`- **${humanizeKey(key)}:** ${scalar(entry)}`)
    }
  }

  if (scalars.length > 0 && nested.length > 0) lines.push("")

  nested.forEach(([key, entry], index) => {
    lines.push(`${"#".repeat(Math.min(level, 6))} ${humanizeKey(key)}`)
    lines.push("")

    if (Array.isArray(entry)) {
      lines.push(...renderArray(entry, level + 1))
    } else {
      lines.push(...renderObject(entry as Record<string, unknown>, level + 1))
    }

    if (index < nested.length - 1) lines.push("")
  })

  return lines
}

function markdown(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    if (typeof object.error === "string") {
      const { error, ...rest } = object
      const lines = ["## Error", "", String(error)]
      if (Object.keys(rest).length > 0) {
        lines.push("", ...renderObject(rest, 2))
      }
      return lines.join("\n").trim()
    }

    return renderObject(object, 2).join("\n").trim()
  }

  if (Array.isArray(value)) return renderArray(value, 2).join("\n").trim()
  return scalar(value)
}

export function renderToolOutput(
  value: unknown,
  format: ToolOutputFormat =
    process.env.LOOM_TOOL_OUTPUT === "json" ? "json" : "markdown",
) {
  if (format === "json") return JSON.stringify(value, null, 2) ?? String(value)
  return markdown(value)
}
