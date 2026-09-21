import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { consumeDispatchGrant, createProjectStorage, createTransactionalStorage, ensureRuntimeStateVersion, findUsableDispatchGrant, importLegacyPluginStorage, issueDispatchGrant, migrateLegacySessionState, resolveRuntimeIdentity, sessionBoundToOq, sessionBoundToStep, sessionBoundToWorkflow } from "./runtime"

class MemoryStorage {
  values = new Map<string, unknown>()
  async get(key: string) { return this.values.get(key) }
  async set(key: string, value: unknown) { this.values.set(key, value) }
  async scan({ prefix }: { prefix: string }) {
    return {
      entries: [...this.values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value })),
      next: undefined,
    }
  }
}

async function withRoots<T>(fn: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "loom-runtime-test-"))
  const previousState = process.env.XDG_STATE_HOME
  const previousRuntime = process.env.XDG_RUNTIME_DIR
  process.env.XDG_STATE_HOME = join(root, "state")
  process.env.XDG_RUNTIME_DIR = join(root, "runtime")
  try {
    return await fn(root)
  } finally {
    if (previousState === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previousState
    if (previousRuntime === undefined) delete process.env.XDG_RUNTIME_DIR
    else process.env.XDG_RUNTIME_DIR = previousRuntime
  }
}


type FixtureEnv = Record<string, string | undefined>

function fixtureProcessEnv(overrides: FixtureEnv) {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  return env
}

async function runFixture(
  args: string[],
  env: FixtureEnv,
) {
  const fixture = fileURLToPath(new URL("./runtime-process-fixture.ts", import.meta.url))
  const proc = Bun.spawn([process.execPath, fixture, ...args], {
    env: fixtureProcessEnv(env),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || `fixture exited ${exitCode}`)
  return stdout.trim()
}

async function runFixtureExit(
  args: string[],
  env: FixtureEnv,
) {
  const fixture = fileURLToPath(new URL("./runtime-process-fixture.ts", import.meta.url))
  const proc = Bun.spawn([process.execPath, fixture, ...args], {
    env: fixtureProcessEnv(env),
    stdout: "pipe",
    stderr: "pipe",
  })
  await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return proc.exited
}

async function runCommand(args: string[], cwd: string) {
  const proc = Bun.spawn(args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`${args.join(" ")} failed: ${stderr || stdout || `exit ${exitCode}`}`)
  }
}

describe("Loom identity publication durability", () => {
  test("create-if-absent syncs the containing directory after publishing the identity path", async () => {
    const source = await Bun.file(new URL("./runtime.ts", import.meta.url)).text()
    const start = source.indexOf("async function createJsonIfAbsent")
    const end = source.indexOf("\nasync function pathExists", start)
    const body = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(body).toContain("const directory = dirname(path)")
    expect(body).toContain("await link(temp, path)")
    expect(body).toContain("await syncDirectory(directory)")
    expect(body.indexOf("await syncDirectory(directory)")).toBeGreaterThan(
      body.indexOf("await link(temp, path)"),
    )
  })
})

describe("Loom runtime upgrade ledger", () => {
  test("runs ordered upgrades once and records durable receipts", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, raw as any)
      let v2Runs = 0
      let v3Runs = 0
      const steps = [
        {
          id: "test-v1-to-v2",
          fromVersion: 1,
          toVersion: 2,
          apply: async (storage: any) => {
            v2Runs++
            await storage.set("installation/test-v2", { ready: true })
            return { migrated: "v2" }
          },
        },
        {
          id: "test-v2-to-v3",
          fromVersion: 2,
          toVersion: 3,
          apply: async (storage: any) => {
            v3Runs++
            await storage.set("installation/test-v3", { ready: true })
            return { migrated: "v3" }
          },
        },
      ]

      const first = await ensureRuntimeStateVersion(raw as any, runtime, {
        targetVersion: 3,
        steps,
        now: new Date("2026-09-21T18:00:00.000Z"),
      })
      expect(first.currentVersion).toBe(3)
      expect(first.lastUpgradeId).toBe("test-v2-to-v3")
      expect(v2Runs).toBe(1)
      expect(v3Runs).toBe(1)

      const second = await ensureRuntimeStateVersion(raw as any, runtime, {
        targetVersion: 3,
        steps,
        now: new Date("2026-09-21T18:01:00.000Z"),
      })
      expect(second.currentVersion).toBe(3)
      expect(v2Runs).toBe(1)
      expect(v3Runs).toBe(1)

      const receipts = await raw.scan({ prefix: "installation/runtime-upgrades/" })
      expect(receipts.entries).toHaveLength(2)
      expect(await raw.get("installation/test-v2")).toEqual({ ready: true })
      expect(await raw.get("installation/test-v3")).toEqual({ ready: true })
    })
  })

  test("refuses a runtime state newer than this build supports", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, raw as any)
      await raw.set("installation/runtime-schema", {
        schemaVersion: 1,
        currentVersion: 9,
        initializedAt: "now",
        updatedAt: "now",
      })

      await expect(
        ensureRuntimeStateVersion(raw as any, runtime, { targetVersion: 3, steps: [] }),
      ).rejects.toThrow("newer than this build supports")
    })
  })
})

describe("Loom crash-safe durable storage", () => {
  test("crash inside a workflow transaction rolls back every aggregate key", async () => {
    await withRoots(async (root) => {
      const legacy = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, legacy as any)
      const storage = await createTransactionalStorage(runtime)
      const workflowKey = "project/p/workflow/w"
      const budgetKey = "project/p/budget/w"

      await storage.transaction!(async () => {
        await storage.set(workflowKey, { revision: 1, state: "before" })
        await storage.set(budgetKey, { dispatches: 1 })
      })

      const env = {
        XDG_STATE_HOME: join(root, "state"),
        XDG_RUNTIME_DIR: join(root, "runtime"),
      }
      const exitCode = await runFixtureExit(
        ["transaction-crash", project, workflowKey, budgetKey],
        env,
      )
      expect(exitCode).toBe(97)
      expect(await storage.get(workflowKey)).toEqual({
        revision: 1,
        state: "before",
      })
      expect(await storage.get(budgetKey)).toEqual({ dispatches: 1 })

      await storage.transaction!(async () => {
        await storage.set(workflowKey, { revision: 2, state: "after" })
        await storage.set(budgetKey, { dispatches: 2 })
      })
      expect(await storage.get(workflowKey)).toEqual({
        revision: 2,
        state: "after",
      })
      expect(await storage.get(budgetKey)).toEqual({ dispatches: 2 })
    })
  })

  test("imports existing scoped plugin state once into the transactional store", async () => {
    await withRoots(async (root) => {
      const legacy = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, legacy as any)
      const transactional = await createTransactionalStorage(runtime)

      await legacy.set(`project/${runtime.projectId}/workflow/w`, {
        id: "w",
        projectId: runtime.projectId,
        revision: 4,
      })
      await legacy.set("episode/e1", { id: "e1" })
      await legacy.set("heuristic/h1", { id: "h1" })

      const copied = await importLegacyPluginStorage(legacy as any, transactional, runtime)
      expect(copied).toBe(3)
      expect(await transactional.get(`project/${runtime.projectId}/workflow/w`)).toMatchObject({
        revision: 4,
      })
      expect(await transactional.get("episode/e1")).toEqual({ id: "e1" })
      expect(await transactional.get("heuristic/h1")).toEqual({ id: "h1" })

      expect(await importLegacyPluginStorage(legacy as any, transactional, runtime)).toBe(0)
    })
  })
})

describe("Loom runtime identity and scoped storage", () => {
  test("same local key is isolated by project epoch", async () => {
    const raw = new MemoryStorage()
    const a = createProjectStorage(raw as any, "project-a")
    const b = createProjectStorage(raw as any, "project-b")

    await a.set("workflow/same", { owner: "a" })
    await b.set("workflow/same", { owner: "b" })

    expect(await a.get("workflow/same")).toEqual({ owner: "a" })
    expect(await b.get("workflow/same")).toEqual({ owner: "b" })
    expect(raw.values.has("workflow/same")).toBe(false)
  })

  test("fresh sessions may share one workflow while unrelated bindings stay isolated", async () => {
    const raw = new MemoryStorage()
    const scoped = createProjectStorage(raw as any, "project-a")

    await scoped.set("session/worker-session", "workflow-a")
    await scoped.set("session/reviewer-session", "workflow-a")
    await scoped.set("session/critic-session", "workflow-a")
    await scoped.set("session/other-session", "workflow-b")
    await scoped.set("session-step/reviewer-session", "review-implementation")
    await scoped.set("session-oq/critic-session", "OQ-17")

    expect(await sessionBoundToWorkflow(scoped as any, "worker-session", "workflow-a")).toBe(true)
    expect(await sessionBoundToWorkflow(scoped as any, "reviewer-session", "workflow-a")).toBe(true)
    expect(await sessionBoundToWorkflow(scoped as any, "critic-session", "workflow-a")).toBe(true)

    expect(await sessionBoundToWorkflow(scoped as any, "other-session", "workflow-a")).toBe(false)
    expect(await sessionBoundToStep(scoped as any, "other-session", "workflow-a", "review-implementation")).toBe(false)
    expect(await sessionBoundToOq(scoped as any, "other-session", "workflow-a", "OQ-17")).toBe(false)

    expect(await sessionBoundToStep(scoped as any, "reviewer-session", "workflow-a", "review-implementation")).toBe(true)
    expect(await sessionBoundToOq(scoped as any, "critic-session", "workflow-a", "OQ-17")).toBe(true)
    expect(await sessionBoundToStep(scoped as any, "reviewer-session", "workflow-a", "task:worker")).toBe(false)
    expect(await sessionBoundToOq(scoped as any, "critic-session", "workflow-a", "OQ-18")).toBe(false)
  })

  test("installation and cross-project learning keys remain explicit global exceptions", async () => {
    const raw = new MemoryStorage()
    const scoped = createProjectStorage(raw as any, "project-a")
    await scoped.set("installation/id", "install")
    await scoped.set("episode/e1", { projectId: "project-a" })
    await scoped.set("heuristic/h1", { status: "provisional" })

    expect(raw.values.get("installation/id")).toBe("install")
    expect(raw.values.get("episode/e1")).toEqual({ projectId: "project-a" })
    expect(raw.values.get("heuristic/h1")).toEqual({ status: "provisional" })
  })

  test("symlink aliases resolve to one non-Git project epoch", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const project = join(root, "project")
      const alias = join(root, "alias")
      await mkdir(project, { recursive: true })
      await symlink(project, alias)

      const first = await resolveRuntimeIdentity(project, raw as any)
      const second = await resolveRuntimeIdentity(alias, raw as any)

      expect(second.projectId).toBe(first.projectId)
      expect(second.canonicalLocation).toBe(first.canonicalLocation)
    })
  })

  test("a copied non-Git marker at a second live root is re-keyed", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const firstRoot = join(root, "one")
      const secondRoot = join(root, "two")
      await mkdir(join(firstRoot, ".loom"), { recursive: true })
      await mkdir(join(secondRoot, ".loom"), { recursive: true })

      const first = await resolveRuntimeIdentity(firstRoot, raw as any)
      const marker = await readFile(join(firstRoot, ".loom", "project-id"), "utf8")
      await writeFile(join(secondRoot, ".loom", "project-id"), marker, "utf8")

      const second = await resolveRuntimeIdentity(secondRoot, raw as any)
      expect(second.projectId).not.toBe(first.projectId)
    })
  })

  test("simultaneous first-open converges on one project epoch", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })

      const identities = await Promise.all(
        Array.from({ length: 4 }, () => resolveRuntimeIdentity(project, raw as any)),
      )
      expect(new Set(identities.map((item) => item.projectId)).size).toBe(1)
    })
  })

  test("dispatch grants are exact, expiring, and single-use", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, raw as any)
      const storage = createProjectStorage(raw as any, runtime.projectId)
      const now = new Date("2026-09-21T12:00:00.000Z")

      const grant = await issueDispatchGrant(storage, runtime, {
        workflowId: "workflow-a",
        stepId: "task:a",
        expectedAgent: "worker",
        issuingParentSessionId: "general-session",
        ttlMs: 60_000,
        now,
      })

      expect(
        await findUsableDispatchGrant(storage, runtime, {
          workflowId: "workflow-a",
          stepId: "task:a",
          expectedAgent: "worker",
          issuingParentSessionId: "general-session",
          now,
        }),
      ).toMatchObject({ grantId: grant.grantId })

      await expect(
        consumeDispatchGrant(storage, runtime, {
          grantId: grant.grantId,
          workflowId: "workflow-a",
          stepId: "task:b",
          expectedAgent: "worker",
          consumingSessionId: "child-1",
          now,
        }),
      ).rejects.toThrow("scope")

      const consumed = await consumeDispatchGrant(storage, runtime, {
        grantId: grant.grantId,
        workflowId: "workflow-a",
        stepId: "task:a",
        expectedAgent: "worker",
        consumingSessionId: "child-1",
        now,
      })
      expect(consumed.consumingSessionId).toBe("child-1")

      await expect(
        consumeDispatchGrant(storage, runtime, {
          grantId: grant.grantId,
          workflowId: "workflow-a",
          stepId: "task:a",
          expectedAgent: "worker",
          consumingSessionId: "child-2",
          now,
        }),
      ).rejects.toThrow("already been consumed")
    })
  })

  test("dispatch grants reject wrong agent and expiry", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, raw as any)
      const storage = createProjectStorage(raw as any, runtime.projectId)
      const issuedAt = new Date("2026-09-21T12:00:00.000Z")

      const grant = await issueDispatchGrant(storage, runtime, {
        workflowId: "workflow-a",
        stepId: "review",
        expectedAgent: "reviewer",
        issuingParentSessionId: "general-session",
        ttlMs: 1_000,
        now: issuedAt,
      })

      await expect(
        consumeDispatchGrant(storage, runtime, {
          grantId: grant.grantId,
          workflowId: "workflow-a",
          stepId: "review",
          expectedAgent: "critic",
          consumingSessionId: "child",
          now: issuedAt,
        }),
      ).rejects.toThrow("scope")

      await expect(
        consumeDispatchGrant(storage, runtime, {
          grantId: grant.grantId,
          workflowId: "workflow-a",
          stepId: "review",
          expectedAgent: "reviewer",
          consumingSessionId: "child",
          now: new Date(issuedAt.getTime() + 1_001),
        }),
      ).rejects.toThrow("expired")
    })
  })
  test("path reuse creates a new project epoch instead of inheriting stale state", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })

      const first = await resolveRuntimeIdentity(project, raw as any)
      await rm(project, { recursive: true, force: true })
      await mkdir(project, { recursive: true })
      const second = await resolveRuntimeIdentity(project, raw as any)

      expect(second.projectId).not.toBe(first.projectId)
      expect(second.canonicalLocation).toBe(first.canonicalLocation)
    })
  })

  test("moving a non-Git project preserves its project epoch when the old root is gone", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const original = join(root, "original")
      const moved = join(root, "moved")
      await mkdir(original, { recursive: true })

      const first = await resolveRuntimeIdentity(original, raw as any)
      await rename(original, moved)
      const second = await resolveRuntimeIdentity(moved, raw as any)

      expect(second.projectId).toBe(first.projectId)
      expect(second.canonicalLocation).not.toBe(first.canonicalLocation)
      expect(second.canonicalLocation.endsWith("/moved")).toBe(true)
    })
  })

  test("Git worktrees receive distinct worktree-private project epochs", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const repo = join(root, "repo")
      const worktree = join(root, "worktree")
      await mkdir(repo, { recursive: true })

      await runCommand(["git", "init", "-q"], repo)
      await writeFile(join(repo, "README.md"), "runtime test\n", "utf8")
      await runCommand(["git", "add", "README.md"], repo)
      await runCommand(
        [
          "git",
          "-c",
          "user.name=Loom Runtime Test",
          "-c",
          "user.email=loom-runtime@example.invalid",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-q",
          "-m",
          "init",
        ],
        repo,
      )
      await runCommand(["git", "worktree", "add", "-q", "-b", "runtime-test-worktree", worktree], repo)

      const mainIdentity = await resolveRuntimeIdentity(repo, raw as any)
      const worktreeIdentity = await resolveRuntimeIdentity(worktree, raw as any)

      expect(mainIdentity.identitySource).toBe("git-worktree")
      expect(worktreeIdentity.identitySource).toBe("git-worktree")
      expect(worktreeIdentity.projectId).not.toBe(mainIdentity.projectId)
      expect(worktreeIdentity.markerLocation).not.toBe(mainIdentity.markerLocation)
    })
  })

  test("dispatch grants cannot be consumed under another project epoch", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const a = join(root, "a")
      const b = join(root, "b")
      await mkdir(a, { recursive: true })
      await mkdir(b, { recursive: true })

      const runtimeA = await resolveRuntimeIdentity(a, raw as any)
      const runtimeB = await resolveRuntimeIdentity(b, raw as any)
      const storageA = createProjectStorage(raw as any, runtimeA.projectId)
      const now = new Date("2026-09-21T12:00:00.000Z")
      const grant = await issueDispatchGrant(storageA, runtimeA, {
        workflowId: "workflow-a",
        stepId: "task:a",
        expectedAgent: "worker",
        issuingParentSessionId: "general-a",
        now,
      })

      await expect(
        consumeDispatchGrant(storageA, runtimeB, {
          grantId: grant.grantId,
          workflowId: "workflow-a",
          stepId: "task:a",
          expectedAgent: "worker",
          consumingSessionId: "child-b",
          now,
        }),
      ).rejects.toThrow("another project")
    })
  })

  test("legacy session state migrates only when the workflow proves the current project epoch", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, raw as any)
      const scoped = createProjectStorage(raw as any, runtime.projectId)

      await raw.set("session/legacy-session", "workflow-a")
      await raw.set("session-step/legacy-session", { workflowId: "workflow-a", stepId: "task:a" })
      await raw.set("workflow/workflow-a", {
        id: "workflow-a",
        projectId: runtime.projectId,
        revision: 0,
        anchor: "docs/anchors/example.md",
        createdBySession: "legacy-session",
        createdAt: "partially-scoped-era",
        steps: [],
      })
      await raw.set("budget/workflow-a", { totalDispatches: 2 })
      await raw.set("oq-index/workflow-a", ["OQ-1"])
      await raw.set("oq/workflow-a/OQ-1", { id: "OQ-1", workflowId: "workflow-a" })
      await raw.set("evidence-step/workflow-a/task:a/e1", "e1")
      await raw.set("evidence/e1", { id: "e1", workflowId: "workflow-a", stepId: "task:a" })
      await raw.set("evidence-claim/workflow-a/task:a/c1", { id: "c1", workflowId: "workflow-a" })
      await raw.set("evidence-claim-id/c1", { workflowId: "workflow-a", stepId: "task:a" })

      const result = await migrateLegacySessionState(raw as any, scoped, runtime, {
        sessionId: "legacy-session",
        sessionProjectId: "opencode-project-a",
        currentProjectId: "opencode-project-a",
      })

      expect(result.status).toBe("migrated")
      expect(await scoped.get("session/legacy-session")).toBe("workflow-a")
      expect(await scoped.get("workflow/workflow-a")).toMatchObject({
        id: "workflow-a",
        projectId: runtime.projectId,
        revision: 0,
      })
      expect(await scoped.get("budget/workflow-a")).toEqual({ totalDispatches: 2 })
      expect(await scoped.get("oq/workflow-a/OQ-1")).toMatchObject({ id: "OQ-1" })
      expect(await scoped.get("evidence/e1")).toMatchObject({ id: "e1" })
      expect(await scoped.get("evidence-claim-id/c1")).toMatchObject({ workflowId: "workflow-a" })
    })
  })

  test("legacy records already carrying the current project epoch migrate without user approval", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, raw as any)
      const scoped = createProjectStorage(raw as any, runtime.projectId)

      await raw.set("session/legacy-session", "workflow-a")
      await raw.set("workflow/workflow-a", {
        id: "workflow-a",
        projectId: runtime.projectId,
        revision: 3,
        anchor: "docs/anchors/example.md",
        createdBySession: "legacy-session",
        createdAt: "partially-scoped-era",
        steps: [],
      })

      const result = await migrateLegacySessionState(raw as any, scoped, runtime, {
        sessionId: "legacy-session",
        sessionProjectId: "opencode-project-a",
        currentProjectId: "opencode-project-a",
      })

      expect(result.status).toBe("migrated")
      expect(await scoped.get("workflow/workflow-a")).toMatchObject({
        projectId: runtime.projectId,
        revision: 3,
      })
    })
  })

  test("exact resumed OpenCode session reconciles pre-project-epoch workflow state", async () => {
    await withRoots(async (root) => {
      const legacy = new MemoryStorage()
      const canonical = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, canonical as any)
      const scoped = createProjectStorage(canonical as any, runtime.projectId)

      await legacy.set("session/resumed-session", "workflow-a")
      await legacy.set("session-step/resumed-session", "worker")
      await legacy.set("workflow/workflow-a", {
        id: "workflow-a",
        anchor: "docs/anchors/example.md",
        createdBySession: "resumed-session",
        createdAt: "before-project-scoping",
        steps: [
          {
            id: "worker",
            agent: "worker",
            kind: "work",
            dependsOn: [],
            status: "pending",
          },
        ],
      })
      await legacy.set("budget/workflow-a", { totalDispatches: 2 })

      const result = await migrateLegacySessionState(legacy as any, scoped, runtime, {
        sessionId: "resumed-session",
        sessionProjectId: "opencode-project-a",
        currentProjectId: "opencode-project-a",
        resumeProof: {
          kind: "opencode-host-session",
          sessionId: "resumed-session",
          projectId: "opencode-project-a",
        },
      })

      expect(result.status).toBe("migrated")
      expect(result.provenance).toBe("opencode-session-continuity")
      expect(await scoped.get("session/resumed-session")).toBe("workflow-a")
      expect(await scoped.get("session-step/resumed-session")).toBe("worker")
      expect(await scoped.get("workflow/workflow-a")).toMatchObject({
        id: "workflow-a",
        projectId: runtime.projectId,
        revision: 0,
      })
      const receipts = await scoped.scan({
        prefix: "installation/upgrade-reconciliation/legacy-session-v0-to-runtime-v1/",
      })
      expect(receipts.entries).toHaveLength(1)
      expect(receipts.entries[0].value).toMatchObject({
        upgradeId: "legacy-session-v0-to-runtime-v1",
        projectId: runtime.projectId,
        openCodeProjectId: "opencode-project-a",
        provenance: "opencode-session-continuity",
      })
    })
  })

  test("resumed-session proof cannot adopt another session's legacy binding", async () => {
    await withRoots(async (root) => {
      const legacy = new MemoryStorage()
      const canonical = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, canonical as any)
      const scoped = createProjectStorage(canonical as any, runtime.projectId)

      await legacy.set("session/legacy-session", "workflow-a")
      await legacy.set("workflow/workflow-a", {
        id: "workflow-a",
        anchor: "docs/anchors/example.md",
        createdBySession: "legacy-session",
        createdAt: "before-project-scoping",
        steps: [],
      })

      await expect(
        migrateLegacySessionState(legacy as any, scoped, runtime, {
          sessionId: "legacy-session",
          sessionProjectId: "opencode-project-a",
          currentProjectId: "opencode-project-a",
          resumeProof: {
            kind: "opencode-host-session",
            sessionId: "different-session",
            projectId: "opencode-project-a",
          },
        }),
      ).rejects.toThrow("exact resumed-session continuity proof")

      expect(await scoped.get("workflow/workflow-a")).toBeUndefined()
    })
  })

  test("resumed-session continuity never overrides conflicting project provenance", async () => {
    await withRoots(async (root) => {
      const legacy = new MemoryStorage()
      const canonical = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, canonical as any)
      const scoped = createProjectStorage(canonical as any, runtime.projectId)

      await legacy.set("session/resumed-session", "workflow-a")
      await legacy.set("workflow/workflow-a", {
        id: "workflow-a",
        projectId: "another-loom-project-epoch",
        anchor: "docs/anchors/example.md",
        createdBySession: "resumed-session",
        createdAt: "partially-scoped-era",
        steps: [],
      })

      await expect(
        migrateLegacySessionState(legacy as any, scoped, runtime, {
          sessionId: "resumed-session",
          sessionProjectId: "opencode-project-a",
          currentProjectId: "opencode-project-a",
          resumeProof: {
            kind: "opencode-host-session",
            sessionId: "resumed-session",
            projectId: "opencode-project-a",
          },
        }),
      ).rejects.toThrow("another project epoch")
    })
  })

  test("exact resumed OpenCode session can reconcile an in-progress legacy intent", async () => {
    await withRoots(async (root) => {
      const legacy = new MemoryStorage()
      const canonical = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, canonical as any)
      const scoped = createProjectStorage(canonical as any, runtime.projectId)

      await legacy.set("session-intent/resumed-session", "intent-a")
      await legacy.set("intent/intent-a", { id: "intent-a", state: "interviewing" })

      const result = await migrateLegacySessionState(legacy as any, scoped, runtime, {
        sessionId: "resumed-session",
        sessionProjectId: "opencode-project-a",
        currentProjectId: "opencode-project-a",
        resumeProof: {
          kind: "opencode-host-session",
          sessionId: "resumed-session",
          projectId: "opencode-project-a",
        },
      })

      expect(result.status).toBe("migrated")
      expect(result.intentId).toBe("intent-a")
      expect(result.provenance).toBe("opencode-session-continuity")
      expect(await scoped.get("session-intent/resumed-session")).toBe("intent-a")
      expect(await scoped.get("intent/intent-a")).toEqual({ id: "intent-a", state: "interviewing" })
    })
  })

  test("same-project legacy state without durable project provenance is refused", async () => {
    await withRoots(async (root) => {
      const raw = new MemoryStorage()
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const runtime = await resolveRuntimeIdentity(project, raw as any)
      const scoped = createProjectStorage(raw as any, runtime.projectId)

      await raw.set("session/legacy-session", "workflow-a")
      await raw.set("workflow/workflow-a", {
        id: "workflow-a",
        anchor: "docs/anchors/example.md",
        createdBySession: "legacy-session",
        createdAt: "before-project-scoping",
        steps: [],
      })

      await expect(
        migrateLegacySessionState(raw as any, scoped, runtime, {
          sessionId: "legacy-session",
          sessionProjectId: "opencode-project-a",
          currentProjectId: "opencode-project-a",
        }),
      ).rejects.toThrow("no unambiguous project provenance")

      expect(await scoped.get("session/legacy-session")).toBeUndefined()
      expect(await scoped.get("workflow/workflow-a")).toBeUndefined()
      const refusals = await raw.scan({ prefix: "installation/migration-refusal/" })
      expect(refusals.entries).toHaveLength(1)
      expect(refusals.entries[0].value).toMatchObject({ projectId: runtime.projectId })
    })
  })

  test("one installation persists one lock root across different process runtime environments", async () => {
    await withRoots(async (root) => {
      const project = join(root, "project")
      const state = join(root, "state")
      const runtimeA = join(root, "runtime-a")
      const runtimeB = join(root, "runtime-b")
      const counter = join(root, "mixed-runtime-counter.txt")
      await mkdir(project, { recursive: true })
      await writeFile(counter, "0", "utf8")

      const chosen = await runFixture(["runtime-root", project], {
        XDG_STATE_HOME: state,
        XDG_RUNTIME_DIR: runtimeA,
      })
      expect(chosen).toBe(join(runtimeA, "loom"))

      const [differentRuntime, missingRuntime] = await Promise.all([
        runFixture(["runtime-root", project], {
          XDG_STATE_HOME: state,
          XDG_RUNTIME_DIR: runtimeB,
        }),
        runFixture(["runtime-root", project], {
          XDG_STATE_HOME: state,
          XDG_RUNTIME_DIR: undefined,
        }),
      ])
      expect(differentRuntime).toBe(chosen)
      expect(missingRuntime).toBe(chosen)

      await Promise.all([
        runFixture(["lock", project, "workflow", "shared-resource", counter], {
          XDG_STATE_HOME: state,
          XDG_RUNTIME_DIR: runtimeA,
        }),
        runFixture(["lock", project, "workflow", "shared-resource", counter], {
          XDG_STATE_HOME: state,
          XDG_RUNTIME_DIR: runtimeB,
        }),
        runFixture(["lock", project, "workflow", "shared-resource", counter], {
          XDG_STATE_HOME: state,
          XDG_RUNTIME_DIR: undefined,
        }),
      ])
      expect((await readFile(counter, "utf8")).trim()).toBe("3")
    })
  })

  test("copied-marker collision stays serialized when first processes have different runtime roots", async () => {
    await withRoots(async (root) => {
      const firstRoot = join(root, "mixed-copy-a")
      const secondRoot = join(root, "mixed-copy-b")
      const state = join(root, "state")
      await mkdir(join(firstRoot, ".loom"), { recursive: true })
      await mkdir(join(secondRoot, ".loom"), { recursive: true })
      const copiedMarker = JSON.stringify({
        schemaVersion: 1,
        projectId: "mixed-copied-project-epoch",
      })
      await writeFile(join(firstRoot, ".loom", "project-id"), copiedMarker, "utf8")
      await writeFile(join(secondRoot, ".loom", "project-id"), copiedMarker, "utf8")

      const [first, second] = await Promise.all([
        runFixture(["identity", firstRoot], {
          XDG_STATE_HOME: state,
          XDG_RUNTIME_DIR: join(root, "runtime-a"),
        }),
        runFixture(["identity", secondRoot], {
          XDG_STATE_HOME: state,
          XDG_RUNTIME_DIR: undefined,
        }),
      ])
      expect(first).not.toBe(second)

      const persisted = JSON.parse(
        await readFile(join(state, "loom", "runtime-root.json"), "utf8"),
      ) as { schemaVersion: number; runtimeRoot: string }
      expect(persisted.schemaVersion).toBe(1)
      expect(persisted.runtimeRoot).toMatch(/(?:runtime-a\/loom|state\/loom\/runtime)$/)
    })
  })

  test("separate processes converge on one first-open project epoch", async () => {
    await withRoots(async (root) => {
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const env = {
        XDG_STATE_HOME: join(root, "state"),
        XDG_RUNTIME_DIR: join(root, "runtime"),
      }

      const ids = await Promise.all(
        Array.from({ length: 4 }, () => runFixture(["identity", project], env)),
      )
      expect(new Set(ids).size).toBe(1)
    })
  })

  test("separate processes re-key simultaneously opened copied markers", async () => {
    await withRoots(async (root) => {
      const firstRoot = join(root, "copy-a")
      const secondRoot = join(root, "copy-b")
      await mkdir(join(firstRoot, ".loom"), { recursive: true })
      await mkdir(join(secondRoot, ".loom"), { recursive: true })
      const copiedMarker = JSON.stringify({
        schemaVersion: 1,
        projectId: "copied-project-epoch",
      })
      await writeFile(join(firstRoot, ".loom", "project-id"), copiedMarker, "utf8")
      await writeFile(join(secondRoot, ".loom", "project-id"), copiedMarker, "utf8")

      const env = {
        XDG_STATE_HOME: join(root, "state"),
        XDG_RUNTIME_DIR: join(root, "runtime"),
      }
      const [first, second] = await Promise.all([
        runFixture(["identity", firstRoot], env),
        runFixture(["identity", secondRoot], env),
      ])

      expect(first).not.toBe(second)
    })
  })

  test("separate processes acquire workflow and work locks in canonical order", async () => {
    await withRoots(async (root) => {
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const counter = join(root, "multi-lock-counter.txt")
      await writeFile(counter, "0", "utf8")
      const env = {
        XDG_STATE_HOME: join(root, "state"),
        XDG_RUNTIME_DIR: join(root, "runtime"),
      }

      await Promise.all([
        runFixture(
          ["multi-lock", project, "workflow", "wf-a", "work", "objective-a", counter],
          env,
        ),
        runFixture(
          ["multi-lock", project, "work", "objective-a", "workflow", "wf-a", counter],
          env,
        ),
      ])

      expect((await readFile(counter, "utf8")).trim()).toBe("2")
    })
  })

  test("separate processes serialize workflow and work aggregate mutations", async () => {
    await withRoots(async (root) => {
      const project = join(root, "project")
      await mkdir(project, { recursive: true })
      const env = {
        XDG_STATE_HOME: join(root, "state"),
        XDG_RUNTIME_DIR: join(root, "runtime"),
      }

      for (const aggregate of ["workflow", "work"]) {
        const counter = join(root, `${aggregate}-counter.txt`)
        await writeFile(counter, "0", "utf8")

        await Promise.all(
          Array.from({ length: 4 }, () =>
            runFixture(["lock", project, aggregate, "shared-resource", counter], env),
          ),
        )

        expect((await readFile(counter, "utf8")).trim()).toBe("4")
      }
    })
  })

})
