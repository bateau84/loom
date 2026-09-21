import { resourcesWithinScope } from "./scope"

const forbiddenOperators = [
  /(?:^|\s)(?:&&|\|\||;|\|)(?:\s|$)/,
  /(?:^|\s)(?:>|>>|<|2>|2>>|&>)(?:\s|$)/,
  /`/,
  /\$\(/,
]

const writeFlags = [
  /(?:^|\s)--fix(?:\s|=|$)/,
  /(?:^|\s)--write(?:\s|=|$)/,
  /(?:^|\s)--in-place(?:\s|=|$)/,
  /(?:^|\s)-i(?:\s|$)/,
  /(?:^|\s)-w(?:\s|$)/,
  /(?:^|\s)--delete(?:\s|=|$)/,
]

const passiveInspectionPatterns = [
  /^pwd$/,
  /^ls(?:\s|$)/,
  /^tree(?:\s|$)/,
  /^cat(?:\s|$)/,
  /^head(?:\s|$)/,
  /^tail(?:\s|$)/,
  /^wc(?:\s|$)/,
  /^stat(?:\s|$)/,
  /^file(?:\s|$)/,
]

const strictPatterns = [
  /^rg(?:\s|$)/,
  /^grep(?:\s|$)/,

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

type EnvironmentDisposition = "safe" | "unknown" | "deny"

const simpleGoProxy = /^(?:off|direct|(?:https?|file):\/\/[^\s,|]+)(?:[,|](?:off|direct|(?:https?|file):\/\/[^\s,|]+))*$/
const simpleGoVcs = /^[A-Za-z0-9*:_.,|+-]+$/
const safeGoFlags = new Set([
  "-mod=readonly",
  "-mod=vendor",
  "-buildvcs=false",
  "-buildvcs=true",
  "-trimpath",
])

function safeGoFlagsValue(value: string) {
  const flags = value.trim().split(/\s+/).filter(Boolean)
  return flags.length > 0 && flags.every((flag) => safeGoFlags.has(flag))
}

function safeAbsolutePath(value: string) {
  if (!value.startsWith("/")) return false
  if (value.includes("\0") || value.includes("$") || value.includes("`")) return false
  return !value.split("/").includes("..")
}

const safeEnvironmentVariables: Record<string, (value: string) => boolean> = {
  GOTOOLCHAIN: (value) => value === "local",
  GOENV: (value) => value === "off",
  GOWORK: (value) => value === "off",
  CGO_ENABLED: (value) => value === "0" || value === "1",
  GOPROXY: (value) => simpleGoProxy.test(value),
  GOVCS: (value) => simpleGoVcs.test(value),
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

const deniedEnvironmentVariables = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "IFS",
  "ENV",
  "BASH_ENV",
  "BASHOPTS",
  "SHELLOPTS",
  "CDPATH",
  "PAGER",
  "GIT_PAGER",
  "LESSOPEN",
  "LESSCLOSE",
  "RIPGREP_CONFIG_PATH",
  "CC",
  "CXX",
  "AR",
  "LD",
  "PYTHONPATH",
  "PYTHONHOME",
  "PYTHONSTARTUP",
  "PYTHONBREAKPOINT",
  "NODE_OPTIONS",
  "RUSTC_WRAPPER",
  "RUSTC_WORKSPACE_WRAPPER",
  "RUBYOPT",
  "RUBYLIB",
  "PERL5OPT",
  "PERL5LIB",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
])

const deniedEnvironmentPrefixes = [
  "LD_",
  "DYLD_",
  "GIT_CONFIG",
  "GIT_SSH",
]

function parseEnvironmentPrefix(command: string) {
  let remaining = command.trim()
  const assignments: EnvironmentAssignment[] = []

  while (remaining) {
    const match = remaining.match(
      /^([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"\\]*)"|'([^']*)'|([^\s'"]*))(?:\s+|$)/,
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

function environmentDisposition(assignment: EnvironmentAssignment): EnvironmentDisposition {
  const validator = safeEnvironmentVariables[assignment.name]
  if (validator) return validator(assignment.value) ? "safe" : "deny"

  if (deniedEnvironmentVariables.has(assignment.name)) return "deny"
  if (deniedEnvironmentPrefixes.some((prefix) => assignment.name.startsWith(prefix))) return "deny"

  if (/^(?:GO|PYTHON|XDG_|NODE_|NPM_|BUN_|CARGO_|RUST|RUBY|PERL)/.test(assignment.name)) {
    return "deny"
  }

  return "unknown"
}

function environmentAllowed(assignments: EnvironmentAssignment[], allowUnknown: boolean) {
  for (const assignment of assignments) {
    const disposition = environmentDisposition(assignment)
    if (disposition === "deny") return false
    if (disposition === "unknown" && !allowUnknown) return false
  }
  return true
}

export function isAllowedWorkerShell(command: string) {
  const normalized = command.trim()

  if (!normalized) return false
  if (forbiddenOperators.some((pattern) => pattern.test(normalized))) return false

  const parsed = parseEnvironmentPrefix(normalized)
  if (!parsed || !parsed.command) return false
  if (writeFlags.some((pattern) => pattern.test(parsed.command))) return false

  if (passiveInspectionPatterns.some((pattern) => pattern.test(parsed.command))) {
    return environmentAllowed(parsed.assignments, true)
  }

  if (/^find(?:\s|$)/.test(parsed.command)) {
    if (/(?:^|\s)-(?:delete|exec|execdir|ok|okdir)(?:\s|$)/.test(parsed.command)) return false
    return environmentAllowed(parsed.assignments, false)
  }

  if (!strictPatterns.some((pattern) => pattern.test(parsed.command))) return false
  return environmentAllowed(parsed.assignments, false)
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
  if (forbiddenOperators.some((pattern) => pattern.test(normalized))) return undefined

  const parsed = parseEnvironmentPrefix(normalized)
  if (!parsed || !environmentAllowed(parsed.assignments, false)) return undefined

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
