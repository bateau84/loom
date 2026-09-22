import { createHash, randomUUID } from "node:crypto"
import { execFile, spawn } from "node:child_process"
import { once } from "node:events"
import { AsyncLocalStorage } from "node:async_hooks"
import { Database } from "bun:sqlite"
import { promisify } from "node:util"
import { chmod, link, mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"
import { homedir } from "node:os"

export type RawStorage = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<unknown>
  scan(input: { prefix: string; limit?: number; after?: string }): Promise<any>
  transaction?<T>(fn: () => Promise<T>): Promise<T>
}

export type LoomRuntimeIdentity = {
  installationId: string
  instanceId: string
  projectId: string
  canonicalLocation: string
  identitySource: "git-worktree" | "loom-project-marker"
  markerLocation: string
  runtimeRoot: string
  stateRoot: string
}

type ProjectMarkerV1 = {
  schemaVersion: 1
  projectId: string
}

type ProjectRegistryV1 = {
  schemaVersion: 1
  projectId: string
  canonicalLocation: string
  identitySource: LoomRuntimeIdentity["identitySource"]
  markerLocation: string
  firstSeenAt: string
  lastSeenAt: string
}

const execFileAsync = promisify(execFile)

const PROJECT_PREFIX = "project/"
const GLOBAL_PREFIXES = ["installation/", "episode/", "heuristic/"]

export const RUNTIME_BASELINE_VERSION = 1
export const RUNTIME_STATE_VERSION = 1

export type RuntimeUpgradeStep = {
  id: string
  fromVersion: number
  toVersion: number
  applyInstallation?: (
    storage: RawStorage,
    runtime: LoomRuntimeIdentity,
  ) => Promise<Record<string, unknown> | void>
  applyProject?: (
    storage: RawStorage,
    projectId: string,
    runtime: LoomRuntimeIdentity,
  ) => Promise<Record<string, unknown> | void>
}

type RuntimeSchemaRecordV1 = {
  schemaVersion: 1
  currentVersion: number
  initializedAt: string
  updatedAt: string
  lastUpgradeId?: string
}

type RuntimeUpgradeReceiptV1 = {
  schemaVersion: 1
  upgradeId: string
  fromVersion: number
  toVersion: number
  completedAt: string
  details?: Record<string, unknown>
}

const RUNTIME_UPGRADE_STEPS: RuntimeUpgradeStep[] = []

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

async function ensurePrivateDir(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
  const info = await stat(path)
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined
  if (uid !== undefined && info.uid !== uid) {
    throw new Error(`Loom runtime directory is not owned by the current user: ${path}`)
  }
  if ((info.mode & 0o077) !== 0) {
    throw new Error(`Loom runtime directory must be user-private: ${path}`)
  }
  return path
}

type RuntimeRootV1 = {
  schemaVersion: 1
  runtimeRoot: string
}

function validateRuntimeRootRecord(record: RuntimeRootV1, path: string) {
  if (
    record.schemaVersion !== 1 ||
    typeof record.runtimeRoot !== "string" ||
    !isAbsolute(record.runtimeRoot)
  ) {
    throw new Error(`Unsupported Loom installation runtime-root metadata: ${path}`)
  }
  return record.runtimeRoot
}

async function chooseInitialRuntimeRoot(stateRoot: string) {
  const configured = process.env.XDG_RUNTIME_DIR
  if (configured && isAbsolute(configured)) {
    try {
      return await ensurePrivateDir(join(configured, "loom"))
    } catch {
      // The installation has not chosen its lock root yet, so a state-root
      // fallback is safe here. Once persisted, later processes never re-choose.
    }
  }
  return ensurePrivateDir(join(stateRoot, "runtime"))
}

async function roots() {
  const stateBase = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  const stateRoot = await ensurePrivateDir(join(stateBase, "loom"))
  const runtimeRootPath = join(stateRoot, "runtime-root.json")

  const existing = await readJson<RuntimeRootV1>(runtimeRootPath)
  if (existing) {
    const runtimeRoot = validateRuntimeRootRecord(existing, runtimeRootPath)
    return { runtimeRoot: await ensurePrivateDir(runtimeRoot), stateRoot }
  }

  const candidate = await chooseInitialRuntimeRoot(stateRoot)
  const record = await createJsonIfAbsent<RuntimeRootV1>(runtimeRootPath, {
    schemaVersion: 1,
    runtimeRoot: candidate,
  })
  const runtimeRoot = validateRuntimeRootRecord(record, runtimeRootPath)

  // Another first process may have won publication with a different candidate.
  // Honor the installation-wide winner; never fall back to a second lock root.
  return {
    runtimeRoot: runtimeRoot === candidate ? candidate : await ensurePrivateDir(runtimeRoot),
    stateRoot,
  }
}

async function syncDirectory(path: string) {
  const handle = await open(path, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function atomicWriteJson(
  path: string,
  value: unknown,
  mode = 0o600,
  afterTempSync?: () => void | Promise<void>,
) {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}`
  const handle = await open(temp, "wx", mode)
  let replaced = false
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await afterTempSync?.()
    await rename(temp, path)
    replaced = true
    await syncDirectory(directory)
  } finally {
    if (!replaced) await unlink(temp).catch(() => {})
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined
    throw error
  }
}

async function createJsonIfAbsent<T>(path: string, value: T): Promise<T> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temp = `${path}.candidate-${process.pid}-${randomUUID()}`
  const handle = await open(temp, "wx", 0o600)
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n", "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    try {
      await link(temp, path)
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error
    }
    // The file body is already synced. Persist the directory entry too before
    // any process treats this installation/project identity as committed.
    await syncDirectory(directory)
  } finally {
    await unlink(temp).catch(() => {})
  }

  const existing = await readJson<T>(path)
  if (!existing) throw new Error(`Loom identity file disappeared during initialization: ${path}`)
  return existing
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error: any) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

async function gitWorktreeDir(project: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", project, "rev-parse", "--path-format=absolute", "--git-dir"],
      { encoding: "utf8" },
    )
    const output = stdout.trim()
    return output || undefined
  } catch {
    return undefined
  }
}

async function acquireFlock(lockPath: string) {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })

  const marker = "__LOOM_LOCKED__"
  const proc = spawn(
    "flock",
    ["-x", lockPath, "sh", "-c", `printf '${marker}\\n'; cat >/dev/null`],
    { stdio: ["pipe", "pipe", "pipe"] },
  )

  let stderr = ""
  proc.stderr.setEncoding("utf8")
  proc.stderr.on("data", (chunk) => { stderr += chunk })

  const acquired = new Promise<void>((resolve, reject) => {
    let buffered = ""
    proc.stdout.setEncoding("utf8")
    const onData = (chunk: string) => {
      buffered += chunk
      if (!buffered.includes("\n")) return
      proc.stdout.off("data", onData)
      if (!buffered.startsWith(marker)) {
        reject(new Error("Loom advisory lock handshake failed."))
        return
      }
      resolve()
    }
    proc.stdout.on("data", onData)
    proc.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("Loom requires the host 'flock' utility for cross-process mutation correctness."))
      } else {
        reject(error)
      }
    })
    proc.once("exit", (code) => {
      if (code !== null && code !== 0 && !buffered.includes("\n")) {
        reject(new Error(`Unable to acquire Loom advisory lock: ${stderr.trim() || `exit ${code}`}`))
      }
    })
  })

  await acquired

  return async () => {
    if (!proc.killed) proc.stdin.end()
    if (proc.exitCode === null) await once(proc, "exit")
    if (proc.exitCode !== 0) {
      throw new Error(`Loom advisory lock process exited with ${proc.exitCode}: ${stderr.trim()}`)
    }
  }
}

type RuntimeLockResource = {
  aggregate: string
  resourceIdentity: string
}

function runtimeLockPath(runtime: LoomRuntimeIdentity, resource: RuntimeLockResource) {
  return join(
    runtime.runtimeRoot,
    "locks",
    runtime.installationId,
    runtime.projectId,
    resource.aggregate,
    `${sha256(resource.resourceIdentity)}.lock`,
  )
}

async function withRuntimeLockPaths<T>(
  runtime: LoomRuntimeIdentity,
  lockPaths: string[],
  fn: () => Promise<T>,
  options: { enforceRuntimeVersion?: boolean } = {},
): Promise<T> {
  const releases: Array<() => Promise<void>> = []

  try {
    for (const lockPath of [...new Set(lockPaths)].sort()) {
      releases.push(await acquireFlock(lockPath))
    }
    const store = transactionalStores.get(runtime.stateRoot)
    const execute = async () => {
      if (options.enforceRuntimeVersion !== false && store) {
        await assertRuntimeStateVersion(store, RUNTIME_STATE_VERSION)
      }
      return fn()
    }
    return store?.transaction ? await store.transaction(execute) : await execute()
  } finally {
    let releaseError: unknown
    for (const release of releases.reverse()) {
      try {
        await release()
      } catch (error) {
        releaseError ??= error
      }
    }
    if (releaseError) throw releaseError
  }
}

export async function withRuntimeLocks<T>(
  runtime: LoomRuntimeIdentity,
  resources: RuntimeLockResource[],
  fn: () => Promise<T>,
): Promise<T> {
  return withRuntimeLockPaths(
    runtime,
    resources.map((resource) => runtimeLockPath(runtime, resource)),
    fn,
  )
}

export async function withInstallationRuntimeLock<T>(
  runtime: LoomRuntimeIdentity,
  aggregate: string,
  resourceIdentity: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = join(
    runtime.runtimeRoot,
    "locks",
    runtime.installationId,
    "installation",
    aggregate,
    `${sha256(resourceIdentity)}.lock`,
  )
  return withRuntimeLockPaths(runtime, [lockPath], fn, { enforceRuntimeVersion: false })
}

export async function withRuntimeLock<T>(
  runtime: LoomRuntimeIdentity,
  aggregate: string,
  resourceIdentity: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withRuntimeLocks(runtime, [{ aggregate, resourceIdentity }], fn)
}

function validateRuntimeSchemaRecord(value: unknown): RuntimeSchemaRecordV1 {
  if (
    !value ||
    typeof value !== "object" ||
    (value as any).schemaVersion !== 1 ||
    !Number.isSafeInteger((value as any).currentVersion) ||
    (value as any).currentVersion < RUNTIME_BASELINE_VERSION
  ) {
    throw new Error("Unsupported Loom runtime schema metadata.")
  }
  return value as RuntimeSchemaRecordV1
}

export async function assertRuntimeStateVersion(
  storage: RawStorage,
  expectedVersion = RUNTIME_STATE_VERSION,
): Promise<RuntimeSchemaRecordV1> {
  const value = await storage.get("installation/runtime-schema")
  if (value === undefined) throw new Error("Loom runtime schema is not initialized.")
  const record = validateRuntimeSchemaRecord(value)
  if (record.currentVersion !== expectedVersion) {
    throw new Error(
      `Loom runtime state version ${record.currentVersion} does not match this running build (${expectedVersion}). Restart OpenCode with the current Loom version before accessing mutable runtime state.`,
    )
  }
  return record
}

async function scanAllKeys(storage: RawStorage, prefix: string) {
  const keys: string[] = []
  let after: string | undefined
  do {
    const page = await storage.scan({ prefix, limit: 1000, ...(after ? { after } : {}) })
    for (const entry of page.entries ?? []) {
      if (typeof entry?.key === "string") keys.push(entry.key)
    }
    after = page.next
  } while (after)
  return keys
}

async function runtimeProjectIds(storage: RawStorage, runtime: LoomRuntimeIdentity) {
  const ids = new Set<string>([runtime.projectId])
  for (const key of await scanAllKeys(storage, "installation/projects/")) {
    const projectId = key.slice("installation/projects/".length).split("/")[0]
    if (projectId) ids.add(projectId)
  }
  for (const key of await scanAllKeys(storage, PROJECT_PREFIX)) {
    const projectId = key.slice(PROJECT_PREFIX.length).split("/")[0]
    if (projectId) ids.add(projectId)
  }
  return [...ids].sort()
}

async function storageTransaction<T>(storage: RawStorage, fn: () => Promise<T>): Promise<T> {
  return storage.transaction ? storage.transaction(fn) : fn()
}

function isInstallationUpgradeKey(key: string) {
  return GLOBAL_PREFIXES.some((prefix) => key.startsWith(prefix))
}

function createInstallationUpgradeStorage(raw: RawStorage): RawStorage {
  const requireGlobal = (key: string) => {
    if (!isInstallationUpgradeKey(key)) {
      throw new Error(
        `Installation runtime upgrade may not access project-scoped key: ${key}`,
      )
    }
    return key
  }
  const storage: RawStorage = {
    get(key) {
      return raw.get(requireGlobal(key))
    },
    set(key, value) {
      return raw.set(requireGlobal(key), value)
    },
    scan(input) {
      return raw.scan({ ...input, prefix: requireGlobal(input.prefix) })
    },
  }
  if (raw.transaction) storage.transaction = (fn) => raw.transaction!(fn)
  return storage
}

function createProjectUpgradeStorage(raw: RawStorage, projectId: string): RawStorage {
  const qualify = (key: string) => {
    if (
      key.startsWith(PROJECT_PREFIX) ||
      GLOBAL_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      throw new Error(
        `Project runtime upgrade for ${projectId} may not escape its project namespace: ${key}`,
      )
    }
    return `${PROJECT_PREFIX}${projectId}/${key}`
  }
  const storage: RawStorage = {
    get(key) {
      return raw.get(qualify(key))
    },
    set(key, value) {
      return raw.set(qualify(key), value)
    },
    scan(input) {
      return raw.scan({ ...input, prefix: qualify(input.prefix) })
    },
  }
  if (raw.transaction) storage.transaction = (fn) => raw.transaction!(fn)
  return storage
}

export async function ensureRuntimeStateVersion(
  storage: RawStorage,
  runtime: LoomRuntimeIdentity,
  options: {
    targetVersion?: number
    steps?: RuntimeUpgradeStep[]
    now?: Date
  } = {},
): Promise<RuntimeSchemaRecordV1> {
  const targetVersion = options.targetVersion ?? RUNTIME_STATE_VERSION
  const steps = options.steps ?? RUNTIME_UPGRADE_STEPS
  const now = options.now ?? new Date()

  if (!Number.isSafeInteger(targetVersion) || targetVersion < RUNTIME_BASELINE_VERSION) {
    throw new Error(`Invalid Loom runtime target version: ${targetVersion}`)
  }

  return withInstallationRuntimeLock(runtime, "migration", "runtime-state-version", async () => {
    const key = "installation/runtime-schema"
    let record = await storageTransaction(storage, async () => {
      const existing = await storage.get(key)
      if (existing !== undefined) return validateRuntimeSchemaRecord(existing)
      const initialized: RuntimeSchemaRecordV1 = {
        schemaVersion: 1,
        currentVersion: RUNTIME_BASELINE_VERSION,
        initializedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }
      await storage.set(key, initialized)
      return initialized
    })

    if (record.currentVersion > targetVersion) {
      throw new Error(
        `Loom runtime state version ${record.currentVersion} is newer than this build supports (${targetVersion}).`,
      )
    }

    const byFrom = new Map<number, RuntimeUpgradeStep>()
    for (const step of steps) {
      if (
        !step.id ||
        !Number.isSafeInteger(step.fromVersion) ||
        !Number.isSafeInteger(step.toVersion) ||
        step.toVersion <= step.fromVersion ||
        (typeof step.applyInstallation !== "function" && typeof step.applyProject !== "function")
      ) {
        throw new Error(`Invalid Loom runtime upgrade step: ${step.id || "<unnamed>"}`)
      }
      if (byFrom.has(step.fromVersion)) {
        throw new Error(`Multiple Loom runtime upgrades start at version ${step.fromVersion}.`)
      }
      byFrom.set(step.fromVersion, step)
    }

    while (record.currentVersion < targetVersion) {
      const step = byFrom.get(record.currentVersion)
      if (!step || step.toVersion > targetVersion) {
        throw new Error(
          `No Loom runtime upgrade path from version ${record.currentVersion} to ${targetVersion}.`,
        )
      }

      record = await storageTransaction(storage, async () => {
        const current = validateRuntimeSchemaRecord(await storage.get(key))
        if (current.currentVersion !== step.fromVersion) {
          throw new Error(
            `Loom runtime upgrade ${step.id} expected version ${step.fromVersion}, found ${current.currentVersion}.`,
          )
        }

        const receiptKey =
          `installation/runtime-upgrades/${step.fromVersion}-${step.toVersion}/${sha256(step.id)}`
        const priorReceipt = (await storage.get(receiptKey)) as RuntimeUpgradeReceiptV1 | undefined
        if (
          priorReceipt?.schemaVersion === 1 &&
          priorReceipt.upgradeId === step.id &&
          priorReceipt.fromVersion === step.fromVersion &&
          priorReceipt.toVersion === step.toVersion
        ) {
          throw new Error(
            `Loom runtime upgrade receipt ${step.id} exists without its schema-version advance; refusing potentially partial migration state.`,
          )
        }

        const details: Record<string, unknown> = {}
        if (step.applyInstallation) {
          const installationDetails = await step.applyInstallation(
            createInstallationUpgradeStorage(storage),
            runtime,
          )
          if (installationDetails) details.installation = installationDetails
        }
        if (step.applyProject) {
          const projectIds = await runtimeProjectIds(storage, runtime)
          const projectDetails: Record<string, unknown> = {}
          for (const projectId of projectIds) {
            const result = await step.applyProject(
              createProjectUpgradeStorage(storage, projectId),
              projectId,
              runtime,
            )
            if (result) projectDetails[projectId] = result
          }
          details.projectIds = projectIds
          if (Object.keys(projectDetails).length > 0) details.projects = projectDetails
        }

        await storage.set(receiptKey, {
          schemaVersion: 1,
          upgradeId: step.id,
          fromVersion: step.fromVersion,
          toVersion: step.toVersion,
          completedAt: now.toISOString(),
          ...(Object.keys(details).length > 0 ? { details } : {}),
        } satisfies RuntimeUpgradeReceiptV1)

        const next: RuntimeSchemaRecordV1 = {
          ...current,
          currentVersion: step.toVersion,
          updatedAt: now.toISOString(),
          lastUpgradeId: step.id,
        }
        await storage.set(key, next)
        return next
      })
    }
    return record
  })
}

async function installationIdentity(stateRoot: string) {
  const path = join(stateRoot, "installation.json")
  const record = await createJsonIfAbsent(path, { schemaVersion: 1, installationId: randomUUID() })
  if ((record as any).schemaVersion !== 1 || typeof (record as any).installationId !== "string") {
    throw new Error("Unsupported Loom installation identity metadata.")
  }
  return (record as any).installationId as string
}

async function projectMarkerLocation(project: string) {
  const gitDir = await gitWorktreeDir(project)
  if (gitDir) {
    return {
      identitySource: "git-worktree" as const,
      markerLocation: join(gitDir, "loom", "project-id"),
    }
  }
  return {
    identitySource: "loom-project-marker" as const,
    markerLocation: join(project, ".loom", "project-id"),
  }
}

async function readOrCreateProjectMarker(path: string): Promise<ProjectMarkerV1> {
  const existing = await readJson<ProjectMarkerV1>(path)
  if (existing) {
    if (existing.schemaVersion !== 1 || typeof existing.projectId !== "string") {
      throw new Error(`Unsupported Loom project marker: ${path}`)
    }
    return existing
  }
  return createJsonIfAbsent<ProjectMarkerV1>(path, {
    schemaVersion: 1,
    projectId: randomUUID(),
  })
}

export async function resolveRuntimeIdentity(projectPath: string, rawStorage: RawStorage): Promise<LoomRuntimeIdentity> {
  const { runtimeRoot, stateRoot } = await roots()
  const installationId = await installationIdentity(stateRoot)
  const canonicalLocation = await realpath(projectPath)
  const locationLock = join(runtimeRoot, "locks", installationId, "identity", `${sha256(canonicalLocation)}.lock`)

  const release = await acquireFlock(locationLock)
  let resolved!: Omit<LoomRuntimeIdentity, "instanceId" | "runtimeRoot" | "stateRoot" | "installationId">
  try {
    const markerTarget = await projectMarkerLocation(canonicalLocation)
    let marker = await readOrCreateProjectMarker(markerTarget.markerLocation)

    const projectIdentityLock = join(
      runtimeRoot,
      "locks",
      installationId,
      "identity-project",
      `${sha256(marker.projectId)}.lock`,
    )
    const releaseProjectIdentity = await acquireFlock(projectIdentityLock)
    try {
      let registryPath = join(stateRoot, "projects", `${marker.projectId}.json`)
      let registry = await readJson<ProjectRegistryV1>(registryPath)

      if (registry && registry.canonicalLocation !== canonicalLocation) {
        const priorRootStillExists = await pathExists(registry.canonicalLocation)
        if (priorRootStillExists) {
          marker = { schemaVersion: 1, projectId: randomUUID() }
          await atomicWriteJson(markerTarget.markerLocation, marker)
          registryPath = join(stateRoot, "projects", `${marker.projectId}.json`)
          registry = undefined
        }
      }

      const now = new Date().toISOString()
      const nextRegistry: ProjectRegistryV1 = {
        schemaVersion: 1,
        projectId: marker.projectId,
        canonicalLocation,
        identitySource: markerTarget.identitySource,
        markerLocation: markerTarget.markerLocation,
        firstSeenAt: registry?.firstSeenAt ?? now,
        lastSeenAt: now,
      }
      await atomicWriteJson(registryPath, nextRegistry)

      resolved = {
        projectId: marker.projectId,
        canonicalLocation,
        identitySource: markerTarget.identitySource,
        markerLocation: markerTarget.markerLocation,
      }
    } finally {
      await releaseProjectIdentity()
    }
  } finally {
    await release()
  }

  const runtime: LoomRuntimeIdentity = {
    installationId,
    instanceId: randomUUID(),
    runtimeRoot,
    stateRoot,
    ...resolved,
  }

  await rawStorage.set("installation/id", installationId)
  await rawStorage.set(`installation/projects/${runtime.projectId}`, {
    projectId: runtime.projectId,
    canonicalLocation: runtime.canonicalLocation,
    identitySource: runtime.identitySource,
    markerLocation: runtime.markerLocation,
    lastSeenAt: new Date().toISOString(),
  })

  return runtime
}

function scopedKey(projectId: string, key: string) {
  if (key.startsWith(PROJECT_PREFIX) || GLOBAL_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return key
  }
  return `project/${projectId}/${key}`
}

export function createProjectStorage(
  raw: RawStorage,
  projectId: string,
  options: { expectedRuntimeVersion?: number } = {},
): RawStorage {
  const expectedVersion = options.expectedRuntimeVersion
  const assertVersion = async () => {
    if (expectedVersion !== undefined) {
      await assertRuntimeStateVersion(raw, expectedVersion)
    }
  }

  const fencedTransaction = <T>(fn: () => Promise<T>) =>
    expectedVersion !== undefined && raw.transaction ? raw.transaction(fn) : fn()

  const scoped: RawStorage = {
    async get(key) {
      return fencedTransaction(async () => {
        await assertVersion()
        return raw.get(scopedKey(projectId, key))
      })
    },
    async set(key, value) {
      return fencedTransaction(async () => {
        await assertVersion()
        return raw.set(scopedKey(projectId, key), value)
      })
    },
    async scan(input) {
      return fencedTransaction(async () => {
        await assertVersion()
        return raw.scan({ ...input, prefix: scopedKey(projectId, input.prefix) })
      })
    },
  }
  if (raw.transaction) {
    scoped.transaction = (fn) =>
      raw.transaction!(async () => {
        await assertVersion()
        return fn()
      })
  }
  return scoped
}

export function projectStorageKey(projectId: string, key: string) {
  return scopedKey(projectId, key)
}

export async function sessionBoundToWorkflow(
  storage: RawStorage,
  sessionId: string,
  workflowId: string,
): Promise<boolean> {
  return (await storage.get(`session/${sessionId}`)) === workflowId
}

export async function sessionBoundToStep(
  storage: RawStorage,
  sessionId: string,
  workflowId: string,
  stepId: string,
): Promise<boolean> {
  if (!(await sessionBoundToWorkflow(storage, sessionId, workflowId))) return false
  return (await storage.get(`session-step/${sessionId}`)) === stepId
}

export async function sessionBoundToOq(
  storage: RawStorage,
  sessionId: string,
  workflowId: string,
  questionId: string,
): Promise<boolean> {
  if (!(await sessionBoundToWorkflow(storage, sessionId, workflowId))) return false
  return (await storage.get(`session-oq/${sessionId}`)) === questionId
}

const transactionalStores = new Map<string, RawStorage>()

function escapeLikePrefix(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")
}

export async function createTransactionalStorage(
  runtime: LoomRuntimeIdentity,
): Promise<RawStorage> {
  const existing = transactionalStores.get(runtime.stateRoot)
  if (existing) return existing

  const path = join(runtime.stateRoot, "execution-state.sqlite")
  const db = new Database(path, { create: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = FULL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run(
    "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
  )
  await chmod(path, 0o600).catch(() => {})

  const transactionContext = new AsyncLocalStorage<boolean>()
  let tail: Promise<void> = Promise.resolve()

  const exclusive = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    if (transactionContext.getStore()) return await fn()

    const previous = tail
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    tail = previous.then(() => next)
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }

  const readValue = (key: string) => {
    const row = db.query("SELECT value FROM kv WHERE key = ?1").get(key) as
      | { value: string }
      | null
    return row ? JSON.parse(row.value) : undefined
  }

  const writeValue = (key: string, value: unknown) => {
    if (value === undefined) throw new Error("Loom durable storage cannot persist undefined.")
    db.query(
      "INSERT INTO kv(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, JSON.stringify(value))
    return value
  }

  const storage: RawStorage = {
    async get(key: string) {
      return exclusive(() => readValue(key))
    },
    async set(key: string, value: unknown) {
      return exclusive(() => writeValue(key, value))
    },
    async scan(input: { prefix: string; limit?: number; after?: string }) {
      return exclusive(() => {
        const limit = Math.max(1, Math.min(input.limit ?? 100, 1000))
        const prefix = `${escapeLikePrefix(input.prefix)}%`
        const after = input.after ?? ""
        const rows = db
          .query(
            "SELECT key, value FROM kv WHERE key LIKE ?1 ESCAPE '\\' AND key > ?2 ORDER BY key LIMIT ?3",
          )
          .all(prefix, after, limit + 1) as Array<{ key: string; value: string }>
        const selected = rows.slice(0, limit)
        return {
          entries: selected.map((row) => ({ key: row.key, value: JSON.parse(row.value) })),
          next: rows.length > limit ? selected.at(-1)?.key : undefined,
        }
      })
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (transactionContext.getStore()) return fn()
      return exclusive(async () => {
        db.run("BEGIN IMMEDIATE")
        try {
          const result = await transactionContext.run(true, fn)
          db.run("COMMIT")
          return result
        } catch (error) {
          try {
            db.run("ROLLBACK")
          } catch {
            // Preserve the original transaction error.
          }
          throw error
        }
      })
    },
  }

  transactionalStores.set(runtime.stateRoot, storage)
  return storage
}

type AtomicFileStorageOptions = {
  afterTempSync?: (key: string, path: string) => void | Promise<void>
}

function encodeStorageSegment(value: string) {
  return Buffer.from(value, "utf8").toString("base64url")
}

function decodeStorageSegment(value: string) {
  return Buffer.from(value, "base64url").toString("utf8")
}

function storageKeySegments(key: string) {
  const segments = key.split("/")
  if (segments.length === 0 || segments.some((segment) => !segment)) {
    throw new Error(`Invalid Loom storage key: ${key}`)
  }
  return segments
}

function storageRecordPath(root: string, key: string) {
  const encoded = storageKeySegments(key).map(encodeStorageSegment)
  const leaf = encoded.pop()!
  return join(root, ...encoded, `${leaf}.json`)
}

async function collectAtomicRecords(
  directory: string,
  prefixSegments: string[],
): Promise<Array<{ key: string; path: string }>> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error: any) {
    if (error?.code === "ENOENT") return []
    throw error
  }

  const records: Array<{ key: string; path: string }> = []
  for (const entry of entries) {
    const child = join(directory, entry.name)
    if (entry.isDirectory()) {
      records.push(
        ...(await collectAtomicRecords(child, [...prefixSegments, decodeStorageSegment(entry.name)])),
      )
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue
    const leaf = entry.name.slice(0, -5)
    const key = [...prefixSegments, decodeStorageSegment(leaf)].join("/")
    records.push({ key, path: child })
  }
  return records
}

export function createAtomicFileStorage(
  root: string,
  options: AtomicFileStorageOptions = {},
): RawStorage {
  const recordsRoot = join(root, "records")

  return {
    async get(key: string) {
      return readJson(storageRecordPath(recordsRoot, key))
    },
    async set(key: string, value: unknown) {
      if (value === undefined) throw new Error("Loom durable storage cannot persist undefined.")
      const path = storageRecordPath(recordsRoot, key)
      await atomicWriteJson(path, value, 0o600, () => options.afterTempSync?.(key, path))
      return value
    },
    async scan(input: { prefix: string; limit?: number; after?: string }) {
      const rawSegments = input.prefix.split("/")
      const prefixEndsAtBoundary = input.prefix === "" || input.prefix.endsWith("/")
      const baseSegments = prefixEndsAtBoundary
        ? rawSegments.filter(Boolean)
        : rawSegments.slice(0, -1).filter(Boolean)
      const directory = join(recordsRoot, ...baseSegments.map(encodeStorageSegment))
      const records = (await collectAtomicRecords(directory, baseSegments))
        .filter((record) => record.key.startsWith(input.prefix))
        .sort((a, b) => a.key.localeCompare(b.key))

      const after = input.after
      const remaining = after ? records.filter((record) => record.key > after) : records
      const limit = Math.max(1, Math.min(input.limit ?? 100, 1000))
      const selected = remaining.slice(0, limit)
      const entries = await Promise.all(
        selected.map(async (record) => ({
          key: record.key,
          value: await readJson(record.path),
        })),
      )
      return {
        entries,
        next: remaining.length > selected.length ? selected.at(-1)?.key : undefined,
      }
    },
  }
}

async function copyStoragePrefix(
  source: RawStorage,
  target: RawStorage,
  prefix: string,
): Promise<number> {
  let copied = 0
  let after: string | undefined
  do {
    const page = await source.scan({ prefix, limit: 100, ...(after ? { after } : {}) })
    for (const entry of page.entries ?? []) {
      if ((await target.get(entry.key)) !== undefined) continue
      await target.set(entry.key, entry.value)
      copied++
    }
    after = page.next
  } while (after)
  return copied
}

function runtimeUpgradePath(
  steps: RuntimeUpgradeStep[],
  fromVersion: number,
  targetVersion: number,
): RuntimeUpgradeStep[] {
  const byFrom = new Map<number, RuntimeUpgradeStep>()
  for (const step of steps) {
    if (
      !step.id ||
      !Number.isSafeInteger(step.fromVersion) ||
      !Number.isSafeInteger(step.toVersion) ||
      step.toVersion <= step.fromVersion ||
      (typeof step.applyInstallation !== "function" && typeof step.applyProject !== "function")
    ) {
      throw new Error(`Invalid Loom runtime upgrade step: ${step.id || "<unnamed>"}`)
    }
    if (byFrom.has(step.fromVersion)) {
      throw new Error(`Multiple Loom runtime upgrades start at version ${step.fromVersion}.`)
    }
    byFrom.set(step.fromVersion, step)
  }

  const path: RuntimeUpgradeStep[] = []
  let version = fromVersion
  while (version < targetVersion) {
    const step = byFrom.get(version)
    if (!step || step.toVersion > targetVersion) {
      throw new Error(
        `No Loom runtime upgrade path from version ${version} to ${targetVersion}.`,
      )
    }
    path.push(step)
    version = step.toVersion
  }
  return path
}

async function upgradeLateLegacyImport(
  target: RawStorage,
  runtime: LoomRuntimeIdentity,
  targetVersion: number,
  steps: RuntimeUpgradeStep[],
) {
  if (targetVersion <= RUNTIME_BASELINE_VERSION) return [] as string[]

  const applied: string[] = []
  for (const step of runtimeUpgradePath(steps, RUNTIME_BASELINE_VERSION, targetVersion)) {
    if (step.applyInstallation) {
      await step.applyInstallation(createInstallationUpgradeStorage(target), runtime)
    }
    if (step.applyProject) {
      await step.applyProject(
        createProjectUpgradeStorage(target, runtime.projectId),
        runtime.projectId,
        runtime,
      )
    }
    applied.push(step.id)
  }
  return applied
}

function createScopedProjectUpgradeStorage(scoped: RawStorage, projectId: string): RawStorage {
  const requireLocal = (key: string) => {
    if (
      key.startsWith(PROJECT_PREFIX) ||
      GLOBAL_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      throw new Error(
        `Project runtime upgrade for ${projectId} may not escape its project namespace: ${key}`,
      )
    }
    return key
  }
  const storage: RawStorage = {
    get(key) {
      return scoped.get(requireLocal(key))
    },
    set(key, value) {
      return scoped.set(requireLocal(key), value)
    },
    scan(input) {
      return scoped.scan({ ...input, prefix: requireLocal(input.prefix) })
    },
  }
  if (scoped.transaction) storage.transaction = (fn) => scoped.transaction!(fn)
  return storage
}

async function upgradeLegacySessionImport(
  scoped: RawStorage,
  runtime: LoomRuntimeIdentity,
  targetVersion: number,
  steps: RuntimeUpgradeStep[],
) {
  if (targetVersion <= RUNTIME_BASELINE_VERSION) return [] as string[]

  const applied: string[] = []
  const projectStorage = createScopedProjectUpgradeStorage(scoped, runtime.projectId)
  for (const step of runtimeUpgradePath(steps, RUNTIME_BASELINE_VERSION, targetVersion)) {
    if (step.applyProject) {
      await step.applyProject(projectStorage, runtime.projectId, runtime)
    }
    applied.push(step.id)
  }
  return applied
}

export async function importLegacyPluginStorage(
  source: RawStorage,
  target: RawStorage,
  runtime: LoomRuntimeIdentity,
  options: {
    targetVersion?: number
    steps?: RuntimeUpgradeStep[]
  } = {},
): Promise<number> {
  const markerKey = `installation/plugin-storage-import-v1/${runtime.projectId}`
  if (await target.get(markerKey)) return 0

  return withInstallationRuntimeLock(
    runtime,
    "migration",
    "plugin-storage-import-v1",
    async () => {
      const targetVersion = options.targetVersion ?? RUNTIME_STATE_VERSION
      const schema = await assertRuntimeStateVersion(target, targetVersion)
      if (await target.get(markerKey)) return 0

      let copied = 0
      copied += await copyStoragePrefix(source, target, `project/${runtime.projectId}/`)
      copied += await copyStoragePrefix(source, target, "episode/")
      copied += await copyStoragePrefix(source, target, "heuristic/")

      const appliedUpgradeIds =
        copied > 0
          ? await upgradeLateLegacyImport(
              target,
              runtime,
              schema.currentVersion,
              options.steps ?? RUNTIME_UPGRADE_STEPS,
            )
          : []

      await target.set(markerKey, {
        schemaVersion: 1,
        projectId: runtime.projectId,
        importedAt: new Date().toISOString(),
        copied,
        sourceRuntimeVersion: RUNTIME_BASELINE_VERSION,
        targetRuntimeVersion: schema.currentVersion,
        appliedUpgradeIds,
      })
      return copied
    },
  )
}

export type LegacyMigrationProvenance =
  | "project-epoch"
  | "opencode-session-continuity"
  | "canonical-workflow"

export type LegacySessionResumeProof = {
  kind: "opencode-host-session"
  sessionId: string
  projectId: string
}

export type LegacyMigrationResult = {
  status: "none" | "migrated" | "already-scoped"
  workflowId?: string
  intentId?: string
  migratedKeys: number
  provenance?: LegacyMigrationProvenance
  appliedUpgradeIds?: string[]
}

async function copyLegacyKey(
  raw: RawStorage,
  scoped: RawStorage,
  key: string,
): Promise<{ copied: boolean; value?: unknown }> {
  const existing = await scoped.get(key)
  if (existing !== undefined) return { copied: false, value: existing }

  const legacy = await raw.get(key)
  if (legacy === undefined) return { copied: false }

  await scoped.set(key, legacy)
  return { copied: true, value: legacy }
}

async function copyLegacyPrefix(
  raw: RawStorage,
  scoped: RawStorage,
  prefix: string,
): Promise<Array<{ key: string; value: unknown; copied: boolean }>> {
  const migrated: Array<{ key: string; value: unknown; copied: boolean }> = []
  let after: string | undefined

  do {
    const page = await raw.scan({ prefix, limit: 100, ...(after ? { after } : {}) })
    for (const entry of page.entries ?? []) {
      const current = await scoped.get(entry.key)
      if (current !== undefined) {
        migrated.push({ key: entry.key, value: current, copied: false })
        continue
      }
      await scoped.set(entry.key, entry.value)
      migrated.push({ key: entry.key, value: entry.value, copied: true })
    }
    after = page.next
  } while (after)

  return migrated
}

function migrationRefusalKey(runtime: LoomRuntimeIdentity, sessionId: string) {
  return `installation/migration-refusal/${runtime.projectId}/${sha256(sessionId)}`
}

async function recordMigrationRefusal(
  raw: RawStorage,
  runtime: LoomRuntimeIdentity,
  sessionId: string,
  reason: string,
) {
  await raw.set(
    migrationRefusalKey(runtime, sessionId),
    {
      schemaVersion: 1,
      projectId: runtime.projectId,
      sessionIdHash: sha256(sessionId),
      reason,
      recordedAt: new Date().toISOString(),
    },
  )
}

function validHostSessionResumeProof(
  input: {
    sessionId: string
    sessionProjectId: string
    currentProjectId: string
    resumeProof?: LegacySessionResumeProof
  },
) {
  return (
    input.sessionProjectId.length > 0 &&
    input.currentProjectId.length > 0 &&
    input.sessionProjectId === input.currentProjectId &&
    input.resumeProof?.kind === "opencode-host-session" &&
    input.resumeProof.sessionId === input.sessionId &&
    input.resumeProof.projectId === input.sessionProjectId
  )
}

async function recordLegacySessionReconciliation(
  legacy: RawStorage,
  scoped: RawStorage,
  runtime: LoomRuntimeIdentity,
  input: {
    sessionId: string
    sessionProjectId: string
    provenance: Extract<LegacyMigrationProvenance, "opencode-session-continuity" | "canonical-workflow">
    workflowId?: string
    intentId?: string
    sourceRuntimeVersion?: number
    targetRuntimeVersion?: number
    appliedUpgradeIds?: string[]
  },
) {
  const now = new Date().toISOString()
  await scoped.set(
    `installation/upgrade-reconciliation/legacy-session-v0-to-runtime-v1/${runtime.projectId}/${sha256(input.sessionId)}`,
    {
      schemaVersion: 1,
      upgradeId: "legacy-session-v0-to-runtime-v1",
      projectId: runtime.projectId,
      sessionIdHash: sha256(input.sessionId),
      ...(input.sessionProjectId ? { openCodeProjectId: input.sessionProjectId } : {}),
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      ...(input.intentId ? { intentId: input.intentId } : {}),
      provenance: input.provenance,
      ...(input.sourceRuntimeVersion !== undefined
        ? { sourceRuntimeVersion: input.sourceRuntimeVersion }
        : {}),
      ...(input.targetRuntimeVersion !== undefined
        ? { targetRuntimeVersion: input.targetRuntimeVersion }
        : {}),
      ...(input.appliedUpgradeIds?.length
        ? { appliedUpgradeIds: input.appliedUpgradeIds }
        : {}),
      reconciledAt: now,
    },
  )

  const refusalKey = migrationRefusalKey(runtime, input.sessionId)
  const priorRefusal = await legacy.get(refusalKey)
  if (priorRefusal && typeof priorRefusal === "object") {
    await legacy.set(refusalKey, {
      ...(priorRefusal as Record<string, unknown>),
      resolvedAt: now,
      resolution: input.provenance,
    })
  }
}

export async function migrateLegacySessionState(
  raw: RawStorage,
  scoped: RawStorage,
  runtime: LoomRuntimeIdentity,
  input: {
    sessionId: string
    sessionProjectId: string
    currentProjectId: string
    resumeProof?: LegacySessionResumeProof
  },
  options: {
    targetVersion?: number
    steps?: RuntimeUpgradeStep[]
  } = {},
): Promise<LegacyMigrationResult> {
  const sessionKey = `session/${input.sessionId}`
  const sessionIntentKey = `session-intent/${input.sessionId}`
  const [scopedWorkflowId, scopedIntentId, legacyWorkflowId, legacyIntentId] = await Promise.all([
    scoped.get(sessionKey),
    scoped.get(sessionIntentKey),
    raw.get(sessionKey),
    raw.get(sessionIntentKey),
  ])

  const hasLegacyWorkflow = typeof legacyWorkflowId === "string" && legacyWorkflowId.length > 0
  const hasLegacyIntent = typeof legacyIntentId === "string" && legacyIntentId.length > 0
  if (!hasLegacyWorkflow && !hasLegacyIntent) {
    return {
      status: scopedWorkflowId !== undefined || scopedIntentId !== undefined ? "already-scoped" : "none",
      migratedKeys: 0,
    }
  }

  if (
    input.sessionProjectId.length > 0 &&
    input.currentProjectId.length > 0 &&
    input.sessionProjectId !== input.currentProjectId
  ) {
    const reason =
      "OpenCode session project does not match the current plugin location; legacy ownership is ambiguous."
    await recordMigrationRefusal(raw, runtime, input.sessionId, reason)
    throw new Error(`Legacy Loom migration refused: ${reason}`)
  }

  const canonicalWorkflowId =
    typeof scopedWorkflowId === "string" && scopedWorkflowId.length > 0
      ? scopedWorkflowId
      : undefined
  const canonicalIntentId =
    typeof scopedIntentId === "string" && scopedIntentId.length > 0
      ? scopedIntentId
      : undefined

  // Canonical Loom state outranks compatibility storage after a controlled rebind.
  // Legacy data may only complete missing pieces when it still names the same
  // canonical workflow. A stale different workflow/intent is historical only.
  if (
    canonicalWorkflowId &&
    (!hasLegacyWorkflow || legacyWorkflowId !== canonicalWorkflowId)
  ) {
    return {
      status: "already-scoped",
      workflowId: canonicalWorkflowId,
      ...(canonicalIntentId ? { intentId: canonicalIntentId } : {}),
      migratedKeys: 0,
    }
  }

  const [legacyWorkflowForProvenance, canonicalWorkflowForProvenance] = hasLegacyWorkflow
    ? await Promise.all([
        raw.get(`workflow/${legacyWorkflowId}`),
        scoped.get(`workflow/${legacyWorkflowId}`),
      ])
    : [undefined, undefined]
  if (hasLegacyWorkflow && (!legacyWorkflowForProvenance || typeof legacyWorkflowForProvenance !== "object")) {
    const reason = "legacy session is bound to a missing workflow record."
    await recordMigrationRefusal(raw, runtime, input.sessionId, reason)
    throw new Error(`Legacy Loom migration refused: ${reason}`)
  }

  const explicitLegacyProjectId =
    legacyWorkflowForProvenance && typeof legacyWorkflowForProvenance === "object"
      ? (legacyWorkflowForProvenance as any).projectId
      : undefined

  const canonicalProjectId =
    canonicalWorkflowForProvenance && typeof canonicalWorkflowForProvenance === "object"
      ? (canonicalWorkflowForProvenance as any).projectId
      : undefined

  let provenance: LegacyMigrationProvenance
  if (explicitLegacyProjectId === runtime.projectId) {
    provenance = "project-epoch"
  } else if (explicitLegacyProjectId !== undefined) {
    const reason = "legacy workflow explicitly belongs to another project epoch."
    await recordMigrationRefusal(raw, runtime, input.sessionId, reason)
    throw new Error(`Legacy Loom migration refused: ${reason}`)
  } else if (canonicalProjectId === runtime.projectId) {
    provenance = "canonical-workflow"
  } else if (canonicalProjectId !== undefined) {
    const reason = "canonical workflow belongs to another project epoch."
    await recordMigrationRefusal(raw, runtime, input.sessionId, reason)
    throw new Error(`Legacy Loom migration refused: ${reason}`)
  } else if (validHostSessionResumeProof(input)) {
    provenance = "opencode-session-continuity"
  } else {
    const reason = hasLegacyWorkflow
      ? "legacy workflow predates durable project epochs and has no unambiguous project provenance, admitted canonical workflow, or exact resumed-session continuity proof."
      : "legacy intent predates durable project epochs and has no exact resumed-session continuity proof."
    await recordMigrationRefusal(raw, runtime, input.sessionId, reason)
    throw new Error(`Legacy Loom migration refused: ${reason}`)
  }

  return storageTransaction(scoped, async () => {
    let migratedKeys = 0
    let migratedIntentId = typeof scopedIntentId === "string" ? scopedIntentId : undefined
    
    if (scopedIntentId === undefined && hasLegacyIntent) {
      const intent = await raw.get(`intent/${legacyIntentId}`)
      if (intent !== undefined) {
        if ((await scoped.get(`intent/${legacyIntentId}`)) === undefined) {
          await scoped.set(`intent/${legacyIntentId}`, intent)
          migratedKeys++
        }
        await scoped.set(sessionIntentKey, legacyIntentId)
        migratedKeys++
        migratedIntentId = legacyIntentId
      }
    }
    
    let migratedWorkflowId = typeof scopedWorkflowId === "string" ? scopedWorkflowId : undefined
    let objectiveId: string | undefined
    
    if (scopedWorkflowId === undefined && hasLegacyWorkflow) {
      const result = await withRuntimeLock(runtime, "workflow", legacyWorkflowId, async () => {
        const currentScopedSession = await scoped.get(sessionKey)
        if (typeof currentScopedSession === "string") {
          return { workflowId: currentScopedSession, copied: 0, objectiveId: undefined as string | undefined }
        }
    
        const currentLegacyWorkflowId = await raw.get(sessionKey)
        if (currentLegacyWorkflowId !== legacyWorkflowId) {
          throw new Error("Legacy Loom migration refused: session workflow binding changed during migration.")
        }
    
        const legacyWorkflow = await raw.get(`workflow/${legacyWorkflowId}`)
        if (!legacyWorkflow || typeof legacyWorkflow !== "object") {
          throw new Error("Legacy Loom migration refused: bound workflow record is missing.")
        }
    
        const legacyProjectId = (legacyWorkflow as any).projectId
        if (legacyProjectId !== undefined && legacyProjectId !== runtime.projectId) {
          const reason = "legacy workflow explicitly belongs to another project epoch."
          await recordMigrationRefusal(raw, runtime, input.sessionId, reason)
          throw new Error(`Legacy Loom migration refused: ${reason}`)
        }
    
        let copied = 0
        let workflow = await scoped.get(`workflow/${legacyWorkflowId}`)
        if (workflow === undefined) {
          const legacyRevision = (legacyWorkflow as any).revision
          workflow = {
            ...(legacyWorkflow as Record<string, unknown>),
            projectId: runtime.projectId,
            revision:
              Number.isSafeInteger(legacyRevision) && legacyRevision >= 0
                ? legacyRevision
                : 0,
          }
          await scoped.set(`workflow/${legacyWorkflowId}`, workflow)
          copied++
        }
    
        await scoped.set(sessionKey, legacyWorkflowId)
        copied++
    
        for (const key of [
          `budget/${legacyWorkflowId}`,
          `limits/${legacyWorkflowId}`,
          `acceptance/${legacyWorkflowId}`,
          `knowledge/${legacyWorkflowId}`,
          `oq-index/${legacyWorkflowId}`,
          `session-step/${input.sessionId}`,
        ]) {
          const result = await copyLegacyKey(raw, scoped, key)
          if (result.copied) copied++
        }
    
        const questionEntries = await copyLegacyPrefix(raw, scoped, `oq/${legacyWorkflowId}/`)
        const scopeEntries = await copyLegacyPrefix(raw, scoped, `scope/${legacyWorkflowId}/`)
        const stepEvidenceEntries = await copyLegacyPrefix(
          raw,
          scoped,
          `evidence-step/${legacyWorkflowId}/`,
        )
        const sessionEvidenceEntries = await copyLegacyPrefix(
          raw,
          scoped,
          `evidence-session/${input.sessionId}/`,
        )
        const claimEntries = await copyLegacyPrefix(
          raw,
          scoped,
          `evidence-claim/${legacyWorkflowId}/`,
        )
    
        copied += [...questionEntries, ...scopeEntries, ...stepEvidenceEntries, ...sessionEvidenceEntries, ...claimEntries]
          .filter((entry) => entry.copied).length
    
        const evidenceIds = new Set<string>()
        for (const entry of [...stepEvidenceEntries, ...sessionEvidenceEntries]) {
          if (typeof entry.value === "string") evidenceIds.add(entry.value)
        }
        for (const evidenceId of evidenceIds) {
          const evidence = await copyLegacyKey(raw, scoped, `evidence/${evidenceId}`)
          if (evidence.copied) copied++
        }
    
        for (const entry of claimEntries) {
          const claimId =
            entry.value && typeof entry.value === "object"
              ? (entry.value as any).id
              : undefined
          if (typeof claimId !== "string") continue
          const claimIndex = await copyLegacyKey(raw, scoped, `evidence-claim-id/${claimId}`)
          if (claimIndex.copied) copied++
        }
    
        const workId =
          workflow && typeof workflow === "object"
            ? (workflow as any).work?.objectiveId
            : undefined
    
        return {
          workflowId: legacyWorkflowId,
          copied,
          objectiveId: typeof workId === "string" ? workId : undefined,
        }
      })
    
      migratedWorkflowId = result.workflowId
      migratedKeys += result.copied
      objectiveId = result.objectiveId
    }
    
    if (!objectiveId && migratedWorkflowId) {
      const scopedWorkflow = await scoped.get(`workflow/${migratedWorkflowId}`)
      const resumedWorkId =
        scopedWorkflow && typeof scopedWorkflow === "object"
          ? (scopedWorkflow as any).work?.objectiveId
          : undefined
      if (typeof resumedWorkId === "string") objectiveId = resumedWorkId
    }
    
    if (objectiveId) {
      await withRuntimeLock(runtime, "work", objectiveId, async () => {
        const work = await copyLegacyKey(raw, scoped, `work/${encodeURIComponent(objectiveId)}`)
        if (work.copied) migratedKeys++
      })
    }
    
    const targetVersion = options.targetVersion ?? RUNTIME_STATE_VERSION
    let appliedUpgradeIds: string[] = []
    if (migratedKeys > 0 && targetVersion > RUNTIME_BASELINE_VERSION) {
      const schema = await assertRuntimeStateVersion(scoped, targetVersion)
      appliedUpgradeIds = await upgradeLegacySessionImport(
        scoped,
        runtime,
        schema.currentVersion,
        options.steps ?? RUNTIME_UPGRADE_STEPS,
      )
    }
    
    if (provenance === "opencode-session-continuity" || provenance === "canonical-workflow") {
      await recordLegacySessionReconciliation(raw, scoped, runtime, {
        sessionId: input.sessionId,
        sessionProjectId: input.sessionProjectId,
        provenance,
        ...(migratedWorkflowId ? { workflowId: migratedWorkflowId } : {}),
        ...(migratedIntentId ? { intentId: migratedIntentId } : {}),
      })
    }
    
    return {
      status: migratedKeys > 0 ? "migrated" : "already-scoped",
      ...(migratedWorkflowId ? { workflowId: migratedWorkflowId } : {}),
      ...(migratedIntentId ? { intentId: migratedIntentId } : {}),
      migratedKeys,
      provenance,
      ...(appliedUpgradeIds.length ? { appliedUpgradeIds } : {}),
    }
  })
}


export type DispatchGrantV1 = {
  schemaVersion: 1
  grantId: string
  projectId: string
  workflowId: string
  stepId?: string
  oqId?: string
  expectedAgent: string
  issuingParentSessionId: string
  createdAt: string
  expiresAt: string
  consumedAt?: string
  consumingSessionId?: string
}

function dispatchGrantKey(grantId: string) {
  return `dispatch-grant/${grantId}`
}

function grantMatchesSelector(
  grant: DispatchGrantV1,
  input: { workflowId: string; stepId?: string; oqId?: string; expectedAgent: string; issuingParentSessionId?: string },
) {
  return (
    grant.workflowId === input.workflowId &&
    grant.expectedAgent === input.expectedAgent &&
    grant.stepId === input.stepId &&
    grant.oqId === input.oqId &&
    (input.issuingParentSessionId === undefined ||
      grant.issuingParentSessionId === input.issuingParentSessionId)
  )
}

type IssueDispatchGrantInput = {
  workflowId: string
  stepId?: string
  oqId?: string
  expectedAgent: string
  issuingParentSessionId: string
  ttlMs?: number
  now?: Date
}

export async function issueDispatchGrantLocked(
  storage: RawStorage,
  runtime: LoomRuntimeIdentity,
  input: IssueDispatchGrantInput,
): Promise<DispatchGrantV1> {
  if (Boolean(input.stepId) === Boolean(input.oqId)) {
    throw new Error("Dispatch grant requires exactly one of stepId or oqId.")
  }
  if (!input.expectedAgent.trim()) throw new Error("Dispatch grant requires expectedAgent.")
  if (!input.issuingParentSessionId.trim()) {
    throw new Error("Dispatch grant requires issuingParentSessionId.")
  }

  const now = input.now ?? new Date()
  const ttlMs = input.ttlMs ?? 10 * 60 * 1000
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 60 * 60 * 1000) {
    throw new Error("Dispatch grant ttlMs must be greater than zero and at most one hour.")
  }

  const grant: DispatchGrantV1 = {
    schemaVersion: 1,
    grantId: randomUUID(),
    projectId: runtime.projectId,
    workflowId: input.workflowId,
    ...(input.stepId ? { stepId: input.stepId } : {}),
    ...(input.oqId ? { oqId: input.oqId } : {}),
    expectedAgent: input.expectedAgent,
    issuingParentSessionId: input.issuingParentSessionId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  }
  await storage.set(dispatchGrantKey(grant.grantId), grant)
  return grant
}

export async function issueDispatchGrant(
  storage: RawStorage,
  runtime: LoomRuntimeIdentity,
  input: IssueDispatchGrantInput,
): Promise<DispatchGrantV1> {
  return withRuntimeLock(runtime, "workflow", input.workflowId, async () =>
    issueDispatchGrantLocked(storage, runtime, input),
  )
}

export async function findUsableDispatchGrant(
  storage: RawStorage,
  runtime: LoomRuntimeIdentity,
  input: {
    workflowId: string
    stepId?: string
    oqId?: string
    expectedAgent: string
    issuingParentSessionId?: string
    now?: Date
  },
): Promise<DispatchGrantV1 | undefined> {
  const now = (input.now ?? new Date()).getTime()
  let after: string | undefined
  do {
    const page = await storage.scan({
      prefix: "dispatch-grant/",
      limit: 100,
      ...(after ? { after } : {}),
    })
    for (const entry of page.entries ?? []) {
      const grant = entry.value as DispatchGrantV1
      if (
        grant?.schemaVersion === 1 &&
        grant.projectId === runtime.projectId &&
        !grant.consumedAt &&
        Date.parse(grant.expiresAt) > now &&
        grantMatchesSelector(grant, input)
      ) {
        return grant
      }
    }
    after = page.next
  } while (after)
  return undefined
}

type ConsumeDispatchGrantInput = {
  grantId: string
  workflowId: string
  stepId?: string
  oqId?: string
  expectedAgent: string
  consumingSessionId: string
  now?: Date
}

export async function consumeDispatchGrantLocked(
  storage: RawStorage,
  runtime: LoomRuntimeIdentity,
  input: ConsumeDispatchGrantInput,
): Promise<DispatchGrantV1> {
  const grant = (await storage.get(dispatchGrantKey(input.grantId))) as DispatchGrantV1 | undefined
  if (!grant || grant.schemaVersion !== 1) throw new Error("Dispatch grant not found.")
  if (grant.projectId !== runtime.projectId) throw new Error("Dispatch grant belongs to another project.")
  if (!grantMatchesSelector(grant, input)) throw new Error("Dispatch grant scope does not match this attachment.")
  if (grant.consumedAt) throw new Error("Dispatch grant has already been consumed.")

  const now = input.now ?? new Date()
  if (Date.parse(grant.expiresAt) <= now.getTime()) throw new Error("Dispatch grant has expired.")
  if (!input.consumingSessionId.trim()) throw new Error("Consuming session is required.")

  const consumed: DispatchGrantV1 = {
    ...grant,
    consumedAt: now.toISOString(),
    consumingSessionId: input.consumingSessionId,
  }
  await storage.set(dispatchGrantKey(grant.grantId), consumed)
  return consumed
}

export async function consumeDispatchGrant(
  storage: RawStorage,
  runtime: LoomRuntimeIdentity,
  input: ConsumeDispatchGrantInput,
): Promise<DispatchGrantV1> {
  return withRuntimeLock(runtime, "workflow", input.workflowId, async () =>
    consumeDispatchGrantLocked(storage, runtime, input),
  )
}
