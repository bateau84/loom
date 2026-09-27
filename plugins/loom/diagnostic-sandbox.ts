import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { cp, mkdir, rm } from "node:fs/promises"
import { relative, resolve, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type DiagnosticSandboxEngine = "podman" | "docker"
export type DiagnosticSandboxNetwork = "none" | "host"

export type DiagnosticSandboxRecord = {
  schemaVersion: 1
  id: string
  sessionId: string
  workflowId: string
  stepId: string
  attempt: number
  projectId: string
  rootPath: string
  workspacePath: string
  baselineGitPath: string
  image: string
  engine: DiagnosticSandboxEngine
  network: DiagnosticSandboxNetwork
  createdAt: string
  active: boolean
  destroyedAt?: string
}

export type DiagnosticSandboxExecInput = {
  command: string
  timeoutSeconds?: number
}

export type DiagnosticSandboxExecResult = {
  sandboxId: string
  ok: boolean
  exitCode?: number | string | null
  signal?: string | null
  timedOut: boolean
  stdout: string
  stderr: string
  cleanupError?: string
}

type ExecResult = { stdout?: string | Buffer; stderr?: string | Buffer }

type ExecRunner = (
  file: string,
  args: string[],
  options?: {
    cwd?: string
    encoding?: BufferEncoding
    timeout?: number
    maxBuffer?: number
    killSignal?: NodeJS.Signals
  },
) => Promise<ExecResult>

const OUTPUT_LIMIT = 48_000
const PATCH_LIMIT = 64_000
const MAX_COMMAND_LENGTH = 32_000
const MAX_TIMEOUT_SECONDS = 600

function clipped(value: unknown, max = OUTPUT_LIMIT) {
  const text = String(value ?? "")
  if (text.length <= max) return text
  return text.slice(0, max) + `\n… clipped ${text.length - max} chars`
}

function containerAlreadyGone(error: any) {
  const detail = [error?.message, error?.stderr, error?.stdout]
    .filter(Boolean)
    .join("\n")
  return /(?:no such container|no container with name or id|container .* does not exist)/i.test(detail)
}

async function stopDiagnosticSandboxContainer(
  record: DiagnosticSandboxRecord,
  run: ExecRunner,
) {
  const name = diagnosticSandboxContainerName(record)
  try {
    await run(record.engine, ["rm", "-f", name], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 512_000,
    })
    return undefined
  } catch (error) {
    if (containerAlreadyGone(error)) return undefined
    throw error
  }
}

function sandboxId(value: string) {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Invalid diagnostic sandbox id.")
  return value
}

function validateRelativeWorkdirCopy(sourceRoot: string, path: string) {
  const rel = relative(sourceRoot, path).replaceAll("\\", "/")
  if (!rel) return true
  const parts = rel.split("/")
  if (parts.includes(".git")) return false
  if (parts[0] === ".loom") return false
  return true
}

export function validateDiagnosticSandboxImage(image: string) {
  const value = image.trim()
  if (!value || value.length > 512 || value.startsWith("-") || /\s/.test(value)) {
    throw new Error("Diagnostic sandbox image must be one bounded OCI image reference without whitespace.")
  }
  return value
}

export function validateDiagnosticSandboxCommand(command: string) {
  const value = command.trim()
  if (!value) throw new Error("Diagnostic sandbox command must not be empty.")
  if (value.length > MAX_COMMAND_LENGTH) {
    throw new Error(`Diagnostic sandbox command exceeds ${MAX_COMMAND_LENGTH} characters.`)
  }
  return value
}

export function normalizeDiagnosticSandboxTimeout(timeoutSeconds?: number) {
  if (timeoutSeconds === undefined) return 120
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
    throw new Error(`Diagnostic sandbox timeout must be an integer from 1 to ${MAX_TIMEOUT_SECONDS} seconds.`)
  }
  return timeoutSeconds
}

export async function detectDiagnosticContainerEngine(
  run: ExecRunner = execFileAsync as unknown as ExecRunner,
): Promise<DiagnosticSandboxEngine> {
  for (const candidate of ["podman", "docker"] as const) {
    try {
      await run(candidate, ["version"], {
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 512_000,
      })
      return candidate
    } catch {
      // Try the next supported engine.
    }
  }
  throw new Error("Diagnostic sandbox requires Podman or Docker on the Loom host.")
}

async function git(
  cwd: string,
  args: string[],
  run: ExecRunner = execFileAsync as unknown as ExecRunner,
) {
  return run("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  })
}

async function sandboxGit(
  gitDir: string,
  workTree: string,
  args: string[],
  run: ExecRunner = execFileAsync as unknown as ExecRunner,
) {
  return run("git", ["--git-dir", gitDir, "--work-tree", workTree, ...args], {
    cwd: workTree,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  })
}

export async function createDiagnosticSandbox(input: {
  runtimeRoot: string
  projectDirectory: string
  projectId: string
  sessionId: string
  workflowId: string
  stepId: string
  attempt: number
  image: string
  network: DiagnosticSandboxNetwork
  engine?: DiagnosticSandboxEngine
  now?: string
  run?: ExecRunner
}): Promise<DiagnosticSandboxRecord> {
  const run = input.run ?? (execFileAsync as unknown as ExecRunner)
  const image = validateDiagnosticSandboxImage(input.image)
  const engine = input.engine ?? await detectDiagnosticContainerEngine(run)
  const id = randomUUID()
  const rootPath = join(
    input.runtimeRoot,
    "diagnostic-sandboxes",
    input.projectId,
    id,
  )
  const workspacePath = join(rootPath, "workspace")
  const baselineGitPath = join(rootPath, "baseline.git")
  const sourceRoot = resolve(input.projectDirectory)

  await mkdir(rootPath, { recursive: true, mode: 0o700 })
  try {
    await cp(sourceRoot, workspacePath, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
      filter: (source) => validateRelativeWorkdirCopy(sourceRoot, source),
    })

    // Keep the baseline Git database outside the writable workspace. Diagnostic
    // may mutate the copy freely, but cannot move the authority against which
    // Loom later computes the experiment delta.
    await git(rootPath, ["init", "--quiet", "--bare", baselineGitPath], run)
    await sandboxGit(baselineGitPath, workspacePath, ["add", "-f", "-A"], run)
    await sandboxGit(baselineGitPath, workspacePath, [
      "-c", "user.name=Loom Diagnostic Sandbox",
      "-c", "user.email=diagnostic-sandbox@loom.invalid",
      "commit",
      "--quiet",
      "--allow-empty",
      "--no-gpg-sign",
      "--no-verify",
      "-m", "diagnostic sandbox baseline",
    ], run)
  } catch (error) {
    await rm(rootPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(() => undefined)
    throw error
  }

  return {
    schemaVersion: 1,
    id,
    sessionId: input.sessionId,
    workflowId: input.workflowId,
    stepId: input.stepId,
    attempt: input.attempt,
    projectId: input.projectId,
    rootPath,
    workspacePath,
    baselineGitPath,
    image,
    engine,
    network: input.network,
    createdAt: input.now ?? new Date().toISOString(),
    active: true,
  }
}

function hostUidArgs(engine: DiagnosticSandboxEngine) {
  if (engine === "podman" && typeof process.getuid === "function") {
    return ["--userns=keep-id"]
  }
  if (
    engine === "docker" &&
    typeof process.getuid === "function" &&
    typeof process.getgid === "function"
  ) {
    return ["--user", `${process.getuid()}:${process.getgid()}`]
  }
  return []
}

export function diagnosticSandboxContainerName(record: DiagnosticSandboxRecord) {
  sandboxId(record.id)
  return `loom-diag-${record.id.replaceAll("-", "").slice(0, 16)}`
}

export function diagnosticSandboxContainerArgs(
  record: DiagnosticSandboxRecord,
  command: string,
) {
  if (!record.active) throw new Error("Diagnostic sandbox is no longer active.")
  const safeCommand = validateDiagnosticSandboxCommand(command)
  const name = diagnosticSandboxContainerName(record)
  const args = [
    "run",
    "--rm",
    "--name", name,
    "--pull=never",
    `--network=${record.network}`,
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--read-only",
    "--pids-limit=512",
    "--mount", `type=bind,src=${record.workspacePath},dst=/workspace`,
    "--mount", `type=bind,src=${record.baselineGitPath},dst=/diagnostic-git,ro`,
    "--workdir", "/workspace",
    "--tmpfs", "/tmp:rw,exec,nosuid,nodev,mode=1777",
    ...hostUidArgs(record.engine),
    ...(record.engine === "podman" ? ["--http-proxy=false"] : []),
    "--env", "HOME=/tmp",
    "--env", "GIT_DIR=/diagnostic-git",
    "--env", "GIT_WORK_TREE=/workspace",
    "--env", "HTTP_PROXY=",
    "--env", "HTTPS_PROXY=",
    "--env", "ALL_PROXY=",
    "--env", "NO_PROXY=",
    "--env", "http_proxy=",
    "--env", "https_proxy=",
    "--env", "all_proxy=",
    "--env", "no_proxy=",
    "--entrypoint=sh",
    record.image,
    "-lc", safeCommand,
  ]
  return { name, args }
}

export async function executeDiagnosticSandbox(
  record: DiagnosticSandboxRecord,
  input: DiagnosticSandboxExecInput,
  run: ExecRunner = execFileAsync as unknown as ExecRunner,
): Promise<DiagnosticSandboxExecResult> {
  sandboxId(record.id)
  const timeoutSeconds = normalizeDiagnosticSandboxTimeout(input.timeoutSeconds)
  const { args } = diagnosticSandboxContainerArgs(record, input.command)

  try {
    const result = await run(record.engine, args, {
      encoding: "utf8",
      timeout: timeoutSeconds * 1000,
      maxBuffer: 4 * 1024 * 1024,
      killSignal: "SIGKILL",
    })
    return {
      sandboxId: record.id,
      ok: true,
      exitCode: 0,
      timedOut: false,
      stdout: clipped(result.stdout),
      stderr: clipped(result.stderr),
    }
  } catch (error: any) {
    // Killing the client on timeout can leave the named container alive.
    // Remove it explicitly; normal --rm handles ordinary command exits.
    let cleanupError: string | undefined
    try {
      await stopDiagnosticSandboxContainer(record, run)
    } catch (cleanup) {
      cleanupError = clipped(
        cleanup instanceof Error ? cleanup.message : String(cleanup),
        1000,
      )
    }

    const timedOut =
      Boolean(error?.killed) ||
      error?.signal === "SIGKILL" ||
      error?.code === "ETIMEDOUT"

    return {
      sandboxId: record.id,
      ok: false,
      exitCode: error?.code ?? null,
      signal: error?.signal ?? null,
      timedOut,
      stdout: clipped(error?.stdout),
      stderr: clipped(error?.stderr || error?.message),
      ...(cleanupError ? { cleanupError } : {}),
    }
  }
}

export async function diffDiagnosticSandbox(
  record: DiagnosticSandboxRecord,
  includePatch = false,
  run: ExecRunner = execFileAsync as unknown as ExecRunner,
) {
  sandboxId(record.id)
  if (!record.active) throw new Error("Diagnostic sandbox is no longer active.")

  const [status, stat, patch] = await Promise.all([
    sandboxGit(record.baselineGitPath, record.workspacePath, ["status", "--short", "--untracked-files=all", "--ignored=matching"], run),
    sandboxGit(record.baselineGitPath, record.workspacePath, ["diff", "--no-ext-diff", "--no-color", "--stat", "HEAD", "--"], run),
    includePatch
      ? sandboxGit(record.baselineGitPath, record.workspacePath, ["diff", "--no-ext-diff", "--no-color", "HEAD", "--"], run)
      : Promise.resolve({ stdout: "", stderr: "" }),
  ])

  return {
    sandboxId: record.id,
    status: clipped(status.stdout),
    stat: clipped(stat.stdout),
    ...(includePatch ? { patch: clipped(patch.stdout, PATCH_LIMIT) } : {}),
  }
}

export async function destroyDiagnosticSandbox(
  record: DiagnosticSandboxRecord,
  now = new Date().toISOString(),
  run: ExecRunner = execFileAsync as unknown as ExecRunner,
) {
  sandboxId(record.id)
  await stopDiagnosticSandboxContainer(record, run)
  await rm(record.rootPath, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  })
  record.active = false
  record.destroyedAt = now
  return {
    sandboxId: record.id,
    destroyed: true,
    destroyedAt: now,
  }
}
