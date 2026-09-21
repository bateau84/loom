import { resourcesWithinScope } from "./scope"

const writeFlags = [
  /(?:^|\s)--fix(?:\s|=|$)/,
  /(?:^|\s)--write(?:\s|=|$)/,
  /(?:^|\s)--in-place(?:\s|=|$)/,
  /(?:^|\s)-i(?:\s|$)/,
  /(?:^|\s)-w(?:\s|$)/,
  /(?:^|\s)--delete(?:\s|=|$)/,
]

const safePatterns = [
  /^pwd$/,
  /^ls(?:\s|$)/,
  /^tree(?:\s|$)/,
  /^cat(?:\s|$)/,
  /^head(?:\s|$)/,
  /^tail(?:\s|$)/,
  /^wc(?:\s|$)/,
  /^rg(?:\s|$)/,
  /^grep(?:\s|$)/,
  /^stat(?:\s|$)/,
  /^file(?:\s|$)/,

  /^git status(?:\s|$)/,
  /^git diff(?:\s|$)/,
  /^git log(?:\s|$)/,
  /^git show(?:\s|$)/,
  /^git rev-parse(?:\s|$)/,
  /^git grep(?:\s|$)/,
  /^git ls-files(?:\s|$)/,
  /^git branch --show-current(?:\s|$)/,

  /^go test(?:\s|$)/,
  /^go build \.\/\.\.\.(?:\s|$)/,
  /^go vet(?:\s|$)/,
  /^go list(?:\s|$)/,
  /^go env(?:\s|$)/,
  /^go mod graph(?:\s|$)/,
  /^gofmt(?:\s|$)/,
  /^golangci-lint run(?:\s|$)/,
  /^gosec(?:\s|$)/,
  /^govulncheck(?:\s|$)/,

  /^bun test(?:\s|$)/,
  /^bun run (?:test|typecheck|build|lint)(?:\s|$)/,
  /^npm (?:test|run (?:test|typecheck|build|lint))(?:\s|$)/,
  /^pnpm (?:test|run (?:test|typecheck|build|lint))(?:\s|$)/,
  /^yarn (?:test|run (?:test|typecheck|build|lint))(?:\s|$)/,

  /^pytest(?:\s|$)/,
  /^python3? -m pytest(?:\s|$)/,
  /^ruff check(?:\s|$)/,

  /^cargo (?:test|build|check|clippy)(?:\s|$)/,
  /^tsc --noEmit(?:\s|$)/,
  /^eslint(?:\s|$)/,
]

type EnvironmentAssignment = {
  name: string
  value: string
}

const safeGoFlags = new Set([
  "-mod=readonly",
  "-mod=vendor",
  "-buildvcs=false",
  "-trimpath",
])

function safeGoFlagsValue(value: string) {
  const flags = value.trim().split(/\s+/).filter(Boolean)
  return flags.length > 0 && flags.every((flag) => safeGoFlags.has(flag))
}

function safeAbsolutePath(value: string) {
  if (!value.startsWith("/")) return false
  if (!/^\/[A-Za-z0-9._/@%+,:= -]*$/.test(value)) return false
  return !value.split("/").includes("..")
}

const safeEnvironmentVariables: Record<string, (value: string) => boolean> = {
  GOTOOLCHAIN: (value) => value === "local",
  GOENV: (value) => value === "off",
  GOWORK: (value) => value === "off",
  CGO_ENABLED: (value) => value === "0",
  GOPROXY: (value) => value === "off",
  GOVCS: (value) => value === "*:off",
  GOFLAGS: safeGoFlagsValue,

  PYTHONDONTWRITEBYTECODE: (value) => value === "1",
  PYTHONNOUSERSITE: (value) => value === "1",
  PYTHONUNBUFFERED: (value) => value === "1",
  PYTHONUTF8: (value) => value === "0" || value === "1",
  PYTHONIOENCODING: (value) => /^[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)?$/.test(value),
  PYTHONHASHSEED: (value) => value === "random" || /^\d+$/.test(value),
  PYTHONSAFEPATH: (value) => value === "1",
  PYTHONDEVMODE: (value) => value === "0" || value === "1",

  XDG_CACHE_HOME: safeAbsolutePath,
  XDG_STATE_HOME: safeAbsolutePath,
  XDG_RUNTIME_DIR: safeAbsolutePath,
}

function hasForbiddenShellSyntax(command: string) {
  let quote: "single" | "double" | undefined

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]

    if (character === "\n" || character === "\r" || character === "\0") return true

    if (quote === "single") {
      if (character === "'") quote = undefined
      continue
    }

    if (quote === "double") {
      if (character === '"') {
        quote = undefined
        continue
      }

      if (character === "$" || character === "`" || character === "\\") return true
      continue
    }

    if (character === "'") {
      quote = "single"
      continue
    }

    if (character === '"') {
      quote = "double"
      continue
    }

    if (";&|<>()".includes(character)) return true
    if (character === "$" || character === "`" || character === "\\") return true
  }

  return quote !== undefined
}

function parseEnvironmentPrefix(command: string) {
  let remaining = command.trim()
  const assignments: EnvironmentAssignment[] = []

  while (remaining) {
    const match = remaining.match(
      /^([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|([^\s'"]*))(?:\s+|$)/,
    )
    if (!match) break

    assignments.push({
      name: match[1],
      value: match[2] ?? match[3] ?? match[4] ?? "",
    })
    remaining = remaining.slice(match[0].length).trimStart()
  }

  if (assignments.length > 0 && !remaining) return undefined
  return { assignments, command: remaining }
}

function environmentAllowed(assignments: EnvironmentAssignment[]) {
  return assignments.every((assignment) => {
    const validator = safeEnvironmentVariables[assignment.name]
    return Boolean(validator?.(assignment.value))
  })
}

export function isAllowedWorkerShell(command: string) {
  const normalized = command.trim()

  if (!normalized) return false
  if (hasForbiddenShellSyntax(normalized)) return false

  const parsed = parseEnvironmentPrefix(normalized)
  if (!parsed || !parsed.command) return false
  if (!environmentAllowed(parsed.assignments)) return false
  if (writeFlags.some((pattern) => pattern.test(parsed.command))) return false

  if (/^find(?:\s|$)/.test(parsed.command)) {
    return !/(?:^|\s)-(?:delete|exec|execdir|ok|okdir)(?:\s|$)/.test(parsed.command)
  }

  return safePatterns.some((pattern) => pattern.test(parsed.command))
}

function safeRelativeGoFile(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "")
  if (!normalized || normalized.startsWith("/")) return false
  if (normalized.split("/").includes("..")) return false
  if (/[*?\[\]{}]/.test(normalized)) return false
  return normalized.endsWith(".go")
}

export function scopedGofmtWriteTargets(command: string) {
  const normalized = command.trim()
  if (hasForbiddenShellSyntax(normalized)) return undefined

  const parsed = parseEnvironmentPrefix(normalized)
  if (!parsed || !environmentAllowed(parsed.assignments)) return undefined

  const tokens = parsed.command.split(/\s+/)
  if (tokens[0] !== "gofmt" || !tokens.includes("-w")) return undefined

  const targets: string[] = []
  for (const token of tokens.slice(1)) {
    if (token === "-w" || token === "-s") continue
    if (token.startsWith("-")) return undefined
    if (!safeRelativeGoFile(token)) return undefined
    targets.push(token)
  }

  return targets.length > 0 ? targets : undefined
}

export function shellResourcesAllowed(
  resources: readonly string[],
  writeScope: string[] = [],
) {
  if (resources.length === 0) return false

  return resources.every((command) => {
    if (isAllowedWorkerShell(command)) return true

    const targets = scopedGofmtWriteTargets(command)
    if (!targets || writeScope.length === 0) return false
    return resourcesWithinScope(targets, writeScope)
  })
}
