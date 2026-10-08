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
  if (isButlerInspectionShellCommand(normalized)) return true

  const parsed = parseEnvironmentPrefix(normalized)
  if (!parsed || !parsed.command) return false
  if (!environmentAllowed(parsed.assignments)) return false
  if (isGitShellCommand(parsed.command)) {
    return isGitInspectionShellCommand(parsed.command)
  }
  if (writeFlags.some((pattern) => pattern.test(parsed.command))) return false

  if (/^find(?:\s|$)/.test(parsed.command)) {
    return !/(?:^|\s)-(?:delete|exec|execdir|ok|okdir)(?:\s|$)/.test(parsed.command)
  }

  if (/^git diff(?:\s|$)/.test(parsed.command)) {
    return !/(?:^|\s)--(?:output(?:=|\s|$)|ext-diff(?:\s|$)|textconv(?:\s|$))/.test(
      parsed.command,
    )
  }

  return safePatterns.some((pattern) => pattern.test(parsed.command))
}


function splitShellWords(command: string) {
  const words: string[] = []
  let current = ""
  let quote: "single" | "double" | undefined

  for (const character of command) {
    if (quote === "single") {
      if (character === "'") quote = undefined
      else current += character
      continue
    }
    if (quote === "double") {
      if (character === '"') quote = undefined
      else current += character
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
    if (/\s/.test(character)) {
      if (current) {
        words.push(current)
        current = ""
      }
      continue
    }
    current += character
  }

  if (quote) return undefined
  if (current) words.push(current)
  return words
}

function parsedCommandWords(command: string) {
  const normalized = command.trim()
  if (!normalized || hasForbiddenShellSyntax(normalized)) return undefined

  const parsed = parseEnvironmentPrefix(normalized)
  if (!parsed || !parsed.command || !environmentAllowed(parsed.assignments)) return undefined
  return splitShellWords(parsed.command)
}

// Named package scripts execute project code. The command and environment
// remain bounded, but script effects are not restricted by this allowlist.
export function isAllowedPackageScriptShell(command: string) {
  const words = parsedCommandWords(command)
  return Boolean(
    words &&
    words.length >= 3 &&
    ["bun", "npm", "pnpm", "yarn"].includes(words[0]) &&
    words[1] === "run" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(words[2]),
  )
}


export type VerificationShellCommand = {
  family: "package" | "python" | "go" | "shell"
  runner: string
}

function projectScriptPath(path: string, extension: RegExp) {
  return !path.startsWith("-") && safeProjectRelativePath(path) &&
    extension.test(path.replace(/^\.\/+/, ""))
}

function namedTestScript(path: string) {
  if (!projectScriptPath(path, /\.(?:py|sh|bash)$/)) return false
  const parts = path.replace(/^\.\/+/, "").split("/")
  const basename = parts[parts.length - 1] ?? ""
  return parts.some((part) => /^(?:test|tests|spec|specs|checks)$/.test(part)) ||
    /(?:^|[._-])(?:test|tests|check|verify|validate|lint|qa|spec|e2e|integration)(?:[._-]|$)/.test(basename)
}

/** Test runners are executable project code; this classifies command shape, not side effects. */
export function classifyVerificationShell(command: string): VerificationShellCommand | undefined {
  const words = parsedCommandWords(command)
  if (!words?.length) return undefined
  const [runner, action, target] = words
  if (isAllowedPackageScriptShell(command) ||
      (["bun", "npm", "pnpm", "yarn"].includes(runner) && action === "test")) {
    return { family: "package", runner }
  }

  if (runner === "go") {
    if (["test", "vet"].includes(action) ||
        (action === "tool" && ["cover", "test2json"].includes(target))) {
      return { family: "go", runner }
    }
  }

  if (/^python(?:3(?:\.[0-9]+)?)?$/.test(runner)) {
    if (action === "-m" && [
      "pytest", "unittest", "tox", "nox", "coverage", "behave",
      "compileall", "py_compile", "mypy", "ruff",
    ].includes(target) &&
      !(target === "ruff" && words.some((word) => ["--fix", "--fix-only", "--unsafe-fixes"].includes(word)))) {
      return { family: "python", runner }
    }
    if (action && namedTestScript(action) && action.endsWith(".py")) {
      return { family: "python", runner }
    }
  }
  if (["pytest", "tox", "nox", "mypy", "pyright", "coverage", "behave"].includes(runner) ||
      (runner === "ruff" && action === "check" &&
        !words.some((word) => ["--fix", "--fix-only", "--unsafe-fixes"].includes(word)))) {
    return { family: "python", runner }
  }

  if (["shellcheck", "bats"].includes(runner) ||
      (runner === "shfmt" &&
        words.some((word) => ["-d", "-l"].includes(word)) &&
        !words.some((word) => ["-w", "--write"].includes(word)))) {
    return { family: "shell", runner }
  }
  if (["bash", "sh"].includes(runner)) {
    if (action === "-n" && target && projectScriptPath(target, /\.(?:sh|bash)$/)) {
      return { family: "shell", runner }
    }
    if (action && namedTestScript(action) && /\.(?:sh|bash)$/.test(action)) {
      return { family: "shell", runner }
    }
  }
  if (/^\.\/.*\.(?:sh|bash)$/.test(runner) && namedTestScript(runner)) {
    return { family: "shell", runner }
  }
  return undefined
}

/**
 * Explicit one-use elevation can cover project verification entrypoints not
 * included in the routine list. It never admits shell eval, Git, package
 * installation, arbitrary command chains, or paths outside the project.
 */
export function isElevatableVerificationShell(command: string) {
  const words = parsedCommandWords(command)
  if (!words?.length || classifyVerificationShell(command)) return false
  const [runner, action, target] = words
  // A self-elevation is for testing, not obviously destructive lifecycle work.
  // This does not inspect the contents/effects of the requested scripts.
  if (words.some((word) =>
    /(?:^|[\/._-])(?:deploy|install|publish|release|migrate|delete|remove|wipe|reset|clean|destroy|push|prune)(?:[\/._-]|$)/i.test(word)
  )) return false
  if (["make", "just"].includes(runner)) {
    // Options after a target still affect the Makefile/Justfile being run.
    // In particular -f/-C/--eval can replace local test code with external code.
    return words.length === 2 &&
      /^(?:test|check|verify|validate|lint|qa|unit|integration|e2e)(?:[._:-]|$)/.test(action)
  }
  if (["bash", "sh"].includes(runner)) {
    return Boolean(action && projectScriptPath(action, /\.(?:sh|bash)$/))
  }
  if (/^python(?:3(?:\.[0-9]+)?)?$/.test(runner)) {
    if (action === "-m" && target) {
      return !/^(?:pip|ensurepip|venv)(?:$|\.)/.test(target) &&
        /^[A-Za-z0-9_.-]+$/.test(target) &&
        /(?:^|[._-])(?:test|tests|testing|check|checks|verify|validate|validation|lint|qa|spec|unit|integration|e2e|ci|diagnose|diagnostic|repro|reproduce)(?:$|[._-])/.test(target)
    }
    return Boolean(action && projectScriptPath(action, /\.py$/))
  }
  if (runner === "go" && action === "run") {
    return Boolean(target && target.startsWith("./") &&
      safeProjectRelativePath(target))
  }
  return false
}

/**
 * Return a filesystem entrypoint that must resolve inside this project.
 * A lexical relative path is insufficient when a symlink can escape the root.
 */
export function elevatedVerificationEntrypoint(command: string): string | undefined {
  if (!isElevatableVerificationShell(command)) return undefined
  const words = parsedCommandWords(command)
  if (!words) return undefined
  const [runner, action, target] = words
  if (["bash", "sh"].includes(runner)) return action
  if (/^python(?:3(?:\.[0-9]+)?)?$/.test(runner) && action !== "-m") return action
  if (runner === "go" && action === "run") return target
  return undefined
}

type ParsedGitCommand = {
  subcommand: string
  args: string[]
}

function parsedGitCommand(command: string): ParsedGitCommand | undefined {
  const words = parsedCommandWords(command)
  if (!words || words[0] !== "git") return undefined

  let index = 1
  if (words[index] === "--no-pager") index += 1
  if (!words[index] || words[index].startsWith("-")) return undefined

  return {
    subcommand: words[index],
    args: words.slice(index + 1),
  }
}

export function isGitShellCommand(command: string) {
  return /^git(?:\s|$)/.test(command.trimStart())
}

function gitInspectionHasUnsafeOption(args: readonly string[]) {
  return args.some((word) =>
    word === "--ext-diff" ||
    word === "--textconv" ||
    word === "--no-index" ||
    word === "--paginate" ||
    word === "-P" ||
    word === "--output" ||
    word.startsWith("--output=") ||
    word === "--open-files-in-pager" ||
    word.startsWith("--open-files-in-pager=") ||
    word === "-O" ||
    word === "--filters"
  )
}

export function isGitInspectionShellCommand(command: string) {
  const parsed = parsedGitCommand(command)
  if (!parsed || gitInspectionHasUnsafeOption(parsed.args)) return false

  if (
    [
      "status",
      "diff",
      "log",
      "show",
      "rev-parse",
      "grep",
      "ls-files",
      "blame",
      "shortlog",
      "describe",
      "merge-base",
      "name-rev",
      "ls-tree",
    ].includes(parsed.subcommand)
  ) return true

  if (parsed.subcommand === "branch") {
    return parsed.args.length === 1 && parsed.args[0] === "--show-current"
  }

  if (parsed.subcommand === "remote") {
    return (
      parsed.args.length === 0 ||
      (parsed.args.length === 1 && ["-v", "--verbose"].includes(parsed.args[0]))
    )
  }

  if (parsed.subcommand === "tag") {
    return parsed.args.length === 0 || parsed.args.every((word) =>
      word === "-l" ||
      word === "--list" ||
      word.startsWith("--list=") ||
      word.startsWith("--sort=") ||
      word.startsWith("--format=")
    )
  }

  return false
}


type ParsedButlerCommand = {
  subcommand: string
  args: string[]
}

function parsedButlerCommand(command: string): ParsedButlerCommand | undefined {
  const words = parsedCommandWords(command)
  if (!words || words[0] !== "but") return undefined

  const rest: string[] = []
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]
    if (
      word === "-C" ||
      word === "--current-dir" ||
      word.startsWith("--current-dir=")
    ) return undefined
    if (word === "--json" || word === "--status-after") continue
    rest.push(word)
  }

  if (rest.some((word) => word === "--help" || word === "-h")) {
    return { subcommand: "help", args: [] }
  }
  return {
    subcommand: rest[0] ?? "",
    args: rest.slice(1),
  }
}

export function isButlerShellCommand(command: string) {
  return /^but(?:\s|$)/.test(command.trimStart())
}

export function isButlerInspectionShellCommand(command: string) {
  const parsed = parsedButlerCommand(command)
  if (!parsed) return false

  if (parsed.subcommand === "help" || parsed.subcommand === "diff") return true

  if (parsed.subcommand === "status") {
    return parsed.args.every((word) =>
      [
        "-f",
        "--files",
        "-v",
        "--verbose",
        "-u",
        "--upstream",
        "--no-hint",
        "--short",
      ].includes(word) ||
      /^-[fvu]{2,3}$/.test(word)
    )
  }

  if (parsed.subcommand === "show") {
    const positional = parsed.args.filter((word) => !word.startsWith("-"))
    const flags = parsed.args.filter((word) => word.startsWith("-"))
    return (
      positional.length === 1 &&
      flags.every((word) => word === "-v" || word === "--verbose")
    )
  }

  if (parsed.subcommand === "branch") {
    const actionIndex = parsed.args.findIndex((word) => !word.startsWith("-"))
    const action = actionIndex >= 0 ? parsed.args[actionIndex] : "list"
    const args = actionIndex >= 0
      ? parsed.args.slice(actionIndex + 1)
      : parsed.args

    if (action === "list") {
      return args.every((word) =>
        word === "-l" ||
        word === "--local" ||
        word === "-r" ||
        word === "--remote" ||
        word === "-a" ||
        word === "--all" ||
        word === "--no-ahead" ||
        word === "--no-check" ||
        word === "--empty" ||
        (!word.startsWith("-") && /^[A-Za-z0-9._/-]+$/.test(word))
      )
    }

    if (action === "show") {
      const positional = args.filter((word) => !word.startsWith("-"))
      const flags = args.filter((word) => word.startsWith("-"))
      return (
        positional.length === 1 &&
        flags.every((word) => word === "-f" || word === "--files")
      )
    }

    return false
  }

  if (parsed.subcommand === "oplog") {
    const actionIndex = parsed.args.findIndex((word) => !word.startsWith("-"))
    const action = actionIndex >= 0 ? parsed.args[actionIndex] : "list"
    const args = actionIndex >= 0
      ? parsed.args.slice(actionIndex + 1)
      : parsed.args
    if (action !== "list") return false

    for (let index = 0; index < args.length; index += 1) {
      const word = args[index]
      if (word === "--snapshot") continue
      if (word === "--since") {
        if (!args[index + 1] || args[index + 1].startsWith("-")) return false
        index += 1
        continue
      }
      if (word.startsWith("--since=") && word.length > "--since=".length) continue
      return false
    }
    return true
  }

  return false
}

export function isButlerCommitShellCommand(command: string) {
  return parsedButlerCommand(command)?.subcommand === "commit"
}

export function butlerCommitSourceIds(command: string) {
  const parsed = parsedButlerCommand(command)
  if (!parsed || parsed.subcommand !== "commit") return undefined

  let hasMessage = false
  const sources: string[] = []

  for (let index = 0; index < parsed.args.length; index += 1) {
    const word = parsed.args[index]

    if (word === "-m" || word === "--message") {
      const value = parsed.args[index + 1]
      if (!value) return undefined
      hasMessage = true
      index += 1
      continue
    }
    if (word.startsWith("--message=")) {
      if (!word.slice("--message=".length)) return undefined
      hasMessage = true
      continue
    }

    if (
      word === "-b" ||
      word === "--branch" ||
      word.startsWith("--branch=")
    ) return undefined

    if (
      word === "--no-message" ||
      word === "--empty" ||
      word === "-i" ||
      word === "--interactive"
    ) return undefined

    if (word.startsWith("-")) return undefined
    if (word.includes(":") || word === "zz") return undefined
    sources.push(word)
  }

  if (!hasMessage || sources.length === 0 || sources.length > 64) return undefined
  return sources
}

export function isAllowedButlerCommit(command: string) {
  return Boolean(butlerCommitSourceIds(command))
}

function splitSafeAndChain(command: string) {
  const commands: string[] = []
  let current = ""
  let quote: "single" | "double" | undefined

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]

    if (character === "\n" || character === "\r" || character === "\0") return undefined

    if (quote === "single") {
      current += character
      if (character === "'") quote = undefined
      continue
    }

    if (quote === "double") {
      current += character
      if (character === '"') {
        quote = undefined
        continue
      }
      if (character === "$" || character === "`" || character === "\\") return undefined
      continue
    }

    if (character === "'") {
      quote = "single"
      current += character
      continue
    }

    if (character === '"') {
      quote = "double"
      current += character
      continue
    }

    if (character === "&") {
      if (command[index + 1] !== "&") return undefined
      const segment = current.trim()
      if (!segment) return undefined
      commands.push(segment)
      current = ""
      index += 1
      continue
    }

    if (";|<>()".includes(character)) return undefined
    if (character === "$" || character === "`" || character === "\\") return undefined
    current += character
  }

  if (quote) return undefined
  const segment = current.trim()
  if (!segment) return undefined
  commands.push(segment)
  return commands.length > 1 ? commands : undefined
}

function safeProjectRelativePath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "")
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized.startsWith(":")
  ) return false
  if (normalized.split("/").includes("..")) return false
  if (/[*?\[\]{}]/.test(normalized)) return false
  return true
}

function singleScopedGitAddTargets(command: string) {
  const words = parsedCommandWords(command)
  if (!words || words[0] !== "git") return undefined

  let addIndex = 1
  if (
    words[1] === "-c" &&
    words[2] === "core.hooksPath=/dev/null"
  ) {
    addIndex = 3
  }
  if (words[addIndex] !== "add") return undefined

  const targets: string[] = []
  for (const word of words.slice(addIndex + 1)) {
    if (word === "--") continue
    if (word.startsWith("-") || !safeProjectRelativePath(word)) return undefined
    targets.push(word)
  }
  return targets.length > 0 ? targets : undefined
}

function authoringInspectionAllowed(command: string) {
  const words = parsedCommandWords(command)
  if (!words || words[0] !== "git") return false

  if (words[1] === "status") return true
  if (words[1] !== "diff") return false

  return !words.slice(2).some(
    (word) =>
      word === "--output" ||
      word.startsWith("--output=") ||
      word === "--ext-diff" ||
      word === "--textconv",
  )
}

export function scopedGitAddTargets(command: string) {
  const direct = singleScopedGitAddTargets(command)
  if (direct) return direct

  const commands = splitSafeAndChain(command)
  if (!commands) return undefined

  const targets: string[] = []
  let sawAdd = false
  for (const segment of commands) {
    const addTargets = singleScopedGitAddTargets(segment)
    if (addTargets) {
      targets.push(...addTargets)
      sawAdd = true
      continue
    }
    if (!authoringInspectionAllowed(segment)) return undefined
  }

  return sawAdd ? [...new Set(targets)] : undefined
}

function shellSegmentsForAuthoringClassification(command: string) {
  const segments: string[] = []
  let current = ""
  let quote: "single" | "double" | undefined

  const flush = () => {
    const segment = current.trim()
    if (segment) segments.push(segment)
    current = ""
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]

    if (quote === "single") {
      current += character
      if (character === "'") quote = undefined
      continue
    }
    if (quote === "double") {
      current += character
      if (character === '"') quote = undefined
      continue
    }
    if (character === "'") {
      quote = "single"
      current += character
      continue
    }
    if (character === '"') {
      quote = "double"
      current += character
      continue
    }

    if (
      character === "&" ||
      character === "|" ||
      character === ";" ||
      character === "\n" ||
      character === "\r"
    ) {
      flush()
      continue
    }

    current += character
  }

  flush()
  return segments
}

function gitAuthoringSubcommand(words: readonly string[]) {
  let executableIndex = 0
  const skipAssignments = () => {
    while (
      executableIndex < words.length &&
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[executableIndex])
    ) {
      executableIndex += 1
    }
  }
  skipAssignments()

  if (words[executableIndex] === "command") {
    executableIndex += 1
    if (words[executableIndex] === "-v" || words[executableIndex] === "-V") {
      return undefined
    }
    while (
      words[executableIndex] === "-p" ||
      words[executableIndex] === "--"
    ) {
      executableIndex += 1
    }
    skipAssignments()
  }

  if (words[executableIndex] === "env") {
    executableIndex += 1
    while (executableIndex < words.length) {
      const word = words[executableIndex]
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
        executableIndex += 1
        continue
      }
      if (
        word === "-i" ||
        word === "--ignore-environment" ||
        word === "-0" ||
        word === "--null"
      ) {
        executableIndex += 1
        continue
      }
      if (
        word === "-u" ||
        word === "--unset" ||
        word === "-C" ||
        word === "--chdir"
      ) {
        if (!words[executableIndex + 1]) return undefined
        executableIndex += 2
        continue
      }
      if (
        word.startsWith("--unset=") ||
        word.startsWith("--chdir=")
      ) {
        executableIndex += 1
        continue
      }
      break
    }
    skipAssignments()
  }

  const executable = words[executableIndex] ?? ""
  if (
    executable !== "git" &&
    !executable.endsWith("/git") &&
    !executable.endsWith("\\git.exe") &&
    !executable.endsWith("/git.exe")
  ) {
    return undefined
  }

  const optionsWithValue = new Set([
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--config-env",
  ])
  const terminalInspectionOptions = new Set([
    "--version",
    "-v",
    "--help",
    "-h",
    "--exec-path",
    "--html-path",
    "--man-path",
    "--info-path",
  ])

  let index = executableIndex + 1
  while (index < words.length) {
    const word = words[index]
    if (terminalInspectionOptions.has(word)) return undefined

    if (optionsWithValue.has(word)) {
      if (!words[index + 1]) return undefined
      index += 2
      continue
    }

    if (word.startsWith("-")) {
      index += 1
      continue
    }

    return word === "add" || word === "commit" ? word : undefined
  }

  return undefined
}

export function isGitAuthoringShellCommand(command: string) {
  return shellSegmentsForAuthoringClassification(command).some((segment) => {
    const words = splitShellWords(segment)
    return Boolean(words && gitAuthoringSubcommand(words))
  })
}

type AllowedGitCommit = {
  messageFile?: string
}

export function commitMessageScratchPath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "")
  if (!safeProjectRelativePath(normalized)) return undefined
  if (
    !/^ephemeral-reports\/[A-Za-z0-9_-]+\/commit-messages\/[A-Za-z0-9._-]+\.md$/.test(
      normalized,
    )
  ) return undefined
  return normalized
}

function parsedAllowedGitCommit(command: string): AllowedGitCommit | undefined {
  const words = parsedCommandWords(command)
  if (
    !words ||
    words[0] !== "git" ||
    words[1] !== "-c" ||
    words[2] !== "core.hooksPath=/dev/null" ||
    words[3] !== "commit"
  ) return undefined

  let hasInlineMessage = false
  let messageFile: string | undefined
  for (let index = 4; index < words.length; index += 1) {
    const word = words[index]
    if (word === "-m" || word === "--message") {
      const message = words[index + 1]
      if (!message || messageFile) return undefined
      hasInlineMessage = true
      index += 1
      continue
    }
    if (word === "-F" || word === "--file") {
      const file = words[index + 1]
      if (!file || hasInlineMessage || messageFile) return undefined
      messageFile = commitMessageScratchPath(file)
      if (!messageFile) return undefined
      index += 1
      continue
    }
    if (word.startsWith("--file=")) {
      if (hasInlineMessage || messageFile) return undefined
      messageFile = commitMessageScratchPath(word.slice("--file=".length))
      if (!messageFile) return undefined
      continue
    }
    if (word === "--signoff" || word === "-s") {
      continue
    }
    return undefined
  }

  if (!hasInlineMessage && !messageFile) return undefined
  return messageFile ? { messageFile } : {}
}

export function gitCommitMessageFile(command: string) {
  return parsedAllowedGitCommit(command)?.messageFile
}

export function isAllowedGitCommit(command: string) {
  return Boolean(parsedAllowedGitCommit(command))
}

function workerExecutionAllowed(command: string) {
  const words = parsedCommandWords(command)
  if (!words) return false

  if (words[0] === "go" && words[1] === "run") {
    const target = words[2]
    if (!target) return false
    if (target === ".") return true
    return target.startsWith("./") && !target.split("/").includes("..")
  }

  if (/^python3?$/.test(words[0] ?? "")) {
    if (words[1] === "-m") {
      const module = words[2]
      if (!module || ["pip", "ensurepip", "venv"].includes(module)) return false
      return /^[A-Za-z0-9_.-]+$/.test(module)
    }
    const script = words[1]
    return Boolean(script && script.endsWith(".py") && safeProjectRelativePath(script))
  }

  return false
}

function githubInspectionAllowed(command: string) {
  const words = parsedCommandWords(command)
  if (!words || words[0] !== "gh") return false

  if (words[1] === "pr") {
    return ["view", "checks", "status", "diff"].includes(words[2] ?? "")
  }
  if (words[1] === "run") {
    return ["list", "view", "watch"].includes(words[2] ?? "")
  }
  if (words[1] === "workflow") {
    return ["list", "view"].includes(words[2] ?? "")
  }
  return false
}

export function diagnosticShellResourcesAllowed(resources: readonly string[]) {
  if (resources.length === 0) return false
  return resources.every(
    (command) =>
      isAllowedWorkerShell(command) ||
      isAllowedPackageScriptShell(command) ||
      Boolean(classifyVerificationShell(command)) ||
      githubInspectionAllowed(command),
  )
}

export function diagnosticExecutionShellResourcesAllowed(resources: readonly string[]) {
  if (resources.length === 0) return false
  return resources.every(
    (command) =>
      diagnosticShellResourcesAllowed([command]) ||
      workerExecutionAllowed(command),
  )
}

function safeGitRef(value: string) {
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false
  if (value.startsWith("-") || value.startsWith("/") || value.endsWith("/")) return false
  return !value.split("/").includes("..")
}

function workerDeliveryAllowed(command: string) {
  const words = parsedCommandWords(command)
  if (!words) return false

  if (isAllowedGitCommit(command)) return true

  if (words[0] === "git" && words[1] === "fetch") {
    const args = words.slice(2)
    const refs = args.filter((word) => !["--prune", "--tags", "--no-tags"].includes(word))
    if (refs.length === 0) return true
    if (refs[0] !== "origin") return false
    return refs.slice(1).every(safeGitRef)
  }

  if (words[0] === "git" && words[1] === "rebase") {
    const args = words.slice(2)
    if (args.length === 1 && ["--continue", "--abort", "--skip"].includes(args[0])) return true
    return args.length === 1 && safeGitRef(args[0])
  }

  if (words[0] === "git" && words[1] === "push") {
    const args = words.slice(2)
    const positional = args.filter(
      (word) => !["-u", "--set-upstream", "--force-with-lease"].includes(word),
    )
    if (positional.some((word) => word.startsWith("-"))) return false
    return positional.length === 2 && positional[0] === "origin" && positional[1] === "HEAD"
  }

  if (words[0] === "gh" && words[1] === "pr") {
    const action = words[2] ?? ""
    const args = words.slice(3)
    const forbiddenPrOptions = new Set([
      "--repo",
      "-R",
      "--body-file",
      "-F",
      "--template",
      "-T",
      "--recover",
      "--web",
    ])
    if (
      args.some((word) =>
        forbiddenPrOptions.has(word) ||
        [...forbiddenPrOptions].some((option) => word.startsWith(option + "="))
      )
    ) return false

    if (action === "create") {
      if (args.some((word) => word === "--head" || word.startsWith("--head="))) return false
      return true
    }

    return ["view", "checks", "status", "diff"].includes(action)
  }

  if (words[0] === "gh" && words[1] === "run") {
    return ["list", "view", "watch"].includes(words[2] ?? "")
  }

  if (words[0] === "gh" && words[1] === "workflow") {
    return ["list", "view"].includes(words[2] ?? "")
  }

  return false
}

export function workerShellResourcesAllowed(
  resources: readonly string[],
  writeScope: string[] = [],
) {
  if (resources.length === 0) return false

  return resources.every((command) => {
    if (
      diagnosticShellResourcesAllowed([command]) ||
      workerExecutionAllowed(command) ||
      workerDeliveryAllowed(command)
    ) return true

    const gofmtTargets = scopedGofmtWriteTargets(command)
    if (
      gofmtTargets &&
      writeScope.length > 0 &&
      resourcesWithinScope(gofmtTargets, writeScope)
    ) return true

    const targets = scopedGitAddTargets(command)
    if (!targets || writeScope.length === 0) return false
    return resourcesWithinScope(targets, writeScope)
  })
}

export function authorGitShellResourcesAllowed(
  resources: readonly string[],
  writeScope: string[],
) {
  if (resources.length === 0 || writeScope.length === 0) return false

  return resources.every((command) => {
    if (isAllowedGitCommit(command) || authoringInspectionAllowed(command)) {
      return true
    }
    const targets = scopedGitAddTargets(command)
    return Boolean(targets && resourcesWithinScope(targets, writeScope))
  })
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
