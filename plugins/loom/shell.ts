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

function safeCommitMessagePath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "")
  if (!safeProjectRelativePath(normalized)) return undefined
  if (
    !/^ephemeral-reports\/[A-Za-z0-9_-]+\/commit-messages\/[A-Za-z0-9._/-]+\.md$/.test(
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
      messageFile = safeCommitMessagePath(file)
      if (!messageFile) return undefined
      index += 1
      continue
    }
    if (word.startsWith("--file=")) {
      if (hasInlineMessage || messageFile) return undefined
      messageFile = safeCommitMessagePath(word.slice("--file=".length))
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
