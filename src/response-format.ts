/** Human-facing views. JSON remains the exact machine-readable tool contract. */
type CompanionResult = {
  skill: string
  methodology: "assessment" | "qa"
  available: boolean
  path: string
  content?: string
  sha256?: string
  reason?: string
}
type FullThreadResult = {
  format: string
  scope: { action_id: string; node_id?: string } | { session_id: string }
  markdown: string
  next_cursor: string | null
}

/** A single code span cannot be escaped by untrusted identifiers or paths. */
function inline(value: string): string {
  const safe = [...value].map(char => {
    const point = char.codePointAt(0)!
    return char === "`" || point < 32 || (point >= 127 && point <= 159) ||
      (point >= 0x200b && point <= 0x200f) || (point >= 0x2028 && point <= 0x202e)
      ? "\\u" + point.toString(16).padStart(4, "0") : char
  }).join("")
  return "`" + safe + "`"
}

/** Keep the actual ASSESSMENT.md / QA.md as renderable Markdown, not JSON-escaped text. */
export function reviewCompanionMarkdown(result: CompanionResult): string {
  const name = result.methodology === "assessment" ? "Assessment" : "QA"
  const file = result.methodology === "assessment" ? "ASSESSMENT.md" : "QA.md"
  const identity = `**Skill:** ${inline(result.skill)}  \n**Source:** ${inline(result.path)}`
  if (!result.available) return `# ${name} lens unavailable\n\n${identity}\n\nNo ${file} was found (${inline(result.reason ?? "companion-not-found")}). SKILL.md is not a substitute.\n`
  return `# ${name} lens\n\n${identity}  \n**SHA-256:** ${inline(result.sha256 ?? "")}\n\n---\n\n${result.content ?? ""}`
}

/** Put exact scope/cursor at the top so pagination survives long history pages. */
export function fullThreadMarkdown(result: FullThreadResult, configErrors: string[] = []): string {
  const scope = "session_id" in result.scope
    ? `Session ${inline(result.scope.session_id)}`
    : `Action ${inline(result.scope.action_id)}${result.scope.node_id === undefined ? "" : ` / node ${inline(result.scope.node_id)}`}`
  const cursor = result.next_cursor === null ? "none (end of this read)" : inline(result.next_cursor)
  const header = `**Scope:** ${scope}  \n**Next cursor:** ${cursor}\n\n`
  const prefix = "# Full stored thread\n\n"
  const body = result.markdown.startsWith(prefix)
    ? prefix + header + result.markdown.slice(prefix.length)
    : header + result.markdown
  if (!configErrors.length) return body
  const errors = configErrors.map(value => value.split(/\r?\n/).map(line => "    " + line).join("\n")).join("\n\n")
  return body + `\n## Loom configuration errors\n\n${errors}\n`
}
