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

export async function withRuntimeLocks<T>(
  runtime: LoomRuntimeIdentity,
  resources: RuntimeLockResource[],
  fn: () => Promise<T>,
): Promise<T> {
  const lockPaths = [...new Set(resources.map((resource) => runtimeLockPath(runtime, resource)))].sort()
  const releases: Array<() => Promise<void>> = []

  try {
    for (const lockPath of lockPaths) {
      releases.push(await acquireFlock(lockPath))
    }
    const store = transactionalStores.get(runtime.stateRoot)
    return store?.transaction ? await store.transaction(fn) : await fn()
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

export async function withRuntimeLock<T>(
  runtime: LoomRuntimeIdentity,
  aggregate: string,
  resourceIdentity: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withRuntimeLocks(runtime, [{ aggregate, resourceIdentity }], fn)
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

export function createProjectStorage(raw: RawStorage, projectId: string): RawStorage {
  const scoped: RawStorage = {
    get(key) {
      return raw.get(scopedKey(projectId, key))
    },
    set(key, value) {
      return raw.set(scopedKey(projectId, key), value)
    },
    scan(input) {
      return raw.scan({ ...input, prefix: scopedKey(projectId, input.prefix) })
    },
  }
  if (raw.transaction) {
    scoped.transaction = (fn) => raw.transaction!(fn)
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

export async function importLegacyPluginStorage(
  source: RawStorage,
  target: RawStorage,
  runtime: LoomRuntimeIdentity,
): Promise<number> {
  const markerKey = `installation/plugin-storage-import-v1/${runtime.projectId}`
  if (await target.get(markerKey)) return 0

  return withRuntimeLock(runtime, "migration", "plugin-storage-import-v1", async () => {
    if (await target.get(markerKey)) return 0
    let copied = 0
    copied += await copyStoragePrefix(source, target, `project/${runtime.projectId}/`)
    copied += await copyStoragePrefix(source, target, "episode/")
    copied += await copyStoragePrefix(source, target, "heuristic/")
    await target.set(markerKey, {
      schemaVersion: 1,
      projectId: runtime.projectId,
      importedAt: new Date().toISOString(),
      copied,
    })
    return copied
  })
}

export type LegacyMigrationResult = {
  status: "none" | "migrated" | "already-scoped"
  workflowId?: string
  intentId?: string
  migratedKeys: number
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

async function recordMigrationRefusal(
  raw: RawStorage,
  runtime: LoomRuntimeIdentity,
  sessionId: string,
  reason: string,
) {
  await raw.set(
    `installation/migration-refusal/${runtime.projectId}/${sha256(sessionId)}`,
    {
      schemaVersion: 1,
      projectId: runtime.projectId,
      sessionIdHash: sha256(sessionId),
      reason,
      recordedAt: new Date().toISOString(),
    },
  )
}

export async function migrateLegacySessionState(
  raw: RawStorage,
  scoped: RawStorage,
  runtime: LoomRuntimeIdentity,
  input: {
    sessionId: string
    sessionProjectId: string
    currentProjectId: string
  },
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

  if (input.sessionProjectId !== input.currentProjectId) {
    const reason =
      "OpenCode session project does not match the current plugin location; legacy ownership is ambiguous."
    await recordMigrationRefusal(raw, runtime, input.sessionId, reason)
    throw new Error(`Legacy Loom migration refused: ${reason}`)
  }

  const legacyWorkflowForProvenance = hasLegacyWorkflow
    ? await raw.get(`workflow/${legacyWorkflowId}`)
    : undefined
  const explicitLegacyProjectId =
    legacyWorkflowForProvenance && typeof legacyWorkflowForProvenance === "object"
      ? (legacyWorkflowForProvenance as any).projectId
      : undefined

  if (!hasLegacyWorkflow || explicitLegacyProjectId !== runtime.projectId) {
    const reason =
      !hasLegacyWorkflow
        ? "legacy state has no workflow with durable project provenance."
        : explicitLegacyProjectId === undefined
          ? "legacy workflow predates durable project epochs and has no unambiguous project provenance."
          : "legacy workflow explicitly belongs to another project epoch."
    await recordMigrationRefusal(raw, runtime, input.sessionId, reason)
    throw new Error(`Legacy Loom migration refused: ${reason}`)
  }

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

  if (objectiveId) {
    await withRuntimeLock(runtime, "work", objectiveId, async () => {
      const work = await copyLegacyKey(raw, scoped, `work/${encodeURIComponent(objectiveId)}`)
      if (work.copied) migratedKeys++
    })
  }

  return {
    status: migratedKeys > 0 ? "migrated" : "already-scoped",
    ...(migratedWorkflowId ? { workflowId: migratedWorkflowId } : {}),
    ...(migratedIntentId ? { intentId: migratedIntentId } : {}),
    migratedKeys,
  }
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
