import { readFile, writeFile } from "node:fs/promises"
import { createProjectStorage, createTransactionalStorage, ensureRuntimeStateVersion, resolveRuntimeIdentity, withRuntimeLock, withRuntimeLocks, type RawStorage } from "./runtime"

class ProcessStorage implements RawStorage {
  async get(_key: string) { return undefined }
  async set(_key: string, _value: unknown) { return undefined }
  async scan(_input: { prefix: string; limit?: number; after?: string }) {
    return { entries: [], next: undefined }
  }
}

const [mode, project, ...args] = process.argv.slice(2)
if (!mode || !project) throw new Error("mode and project are required")

const runtime = await resolveRuntimeIdentity(project, new ProcessStorage())

if (mode === "identity") {
  process.stdout.write(runtime.projectId + "\n")
  process.exit(0)
}

if (mode === "runtime-root") {
  process.stdout.write(runtime.runtimeRoot + "\n")
  process.exit(0)
}

if (mode === "lock") {
  const [aggregate, resource, counterPath] = args
  if (!aggregate || !resource || !counterPath) throw new Error("lock mode requires aggregate, resource, counterPath")
  await withRuntimeLock(runtime, aggregate, resource, async () => {
    const current = Number((await readFile(counterPath, "utf8")).trim())
    await Bun.sleep(40)
    await writeFile(counterPath, String(current + 1), "utf8")
  })
  process.stdout.write("ok\n")
  process.exit(0)
}

if (mode === "transaction-crash") {
  const [workflowKey, budgetKey] = args
  if (!workflowKey || !budgetKey) {
    throw new Error("transaction-crash mode requires workflowKey and budgetKey")
  }
  const storage = await createTransactionalStorage(runtime)
  await ensureRuntimeStateVersion(storage, runtime)
  await withRuntimeLock(runtime, "workflow", "crash-test", async () => {
    await storage.set(workflowKey, { revision: 2, state: "after" })
    await storage.set(budgetKey, { dispatches: 2 })
    process.exit(97)
  })
  throw new Error("transaction-crash fault injection did not terminate the process")
}

if (mode === "upgrade-crash") {
  const storage = await createTransactionalStorage(runtime)
  await ensureRuntimeStateVersion(storage, runtime, {
    targetVersion: 2,
    steps: [{
      id: "fixture-crash-v1-to-v2",
      fromVersion: 1,
      toVersion: 2,
      applyProject: async (projectStorage) => {
        await projectStorage.set("format", { version: 2 })
        process.exit(98)
      },
    }],
  })
  throw new Error("upgrade-crash fault injection did not terminate the process")
}

if (mode === "version-skew-old") {
  const [readyPath, upgradedPath] = args
  if (!readyPath || !upgradedPath) throw new Error("version-skew-old requires readyPath and upgradedPath")
  const storage = await createTransactionalStorage(runtime)
  await ensureRuntimeStateVersion(storage, runtime, { targetVersion: 1 })
  const scoped = createProjectStorage(storage, runtime.projectId, { expectedRuntimeVersion: 1 })
  await writeFile(readyPath, "ready", "utf8")
  while (true) {
    try {
      await readFile(upgradedPath, "utf8")
      break
    } catch {
      await Bun.sleep(50)
    }
  }
  try {
    await scoped.set("workflow/version-skew", { revision: 1 })
    throw new Error("old runtime mutation unexpectedly succeeded after upgrade")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes("does not match this running build (1)")) throw error
    process.stdout.write(`rejected: ${message}\n`)
    process.exit(0)
  }
}

if (mode === "version-skew-upgrade") {
  const [upgradedPath] = args
  if (!upgradedPath) throw new Error("version-skew-upgrade requires upgradedPath")
  const storage = await createTransactionalStorage(runtime)
  await ensureRuntimeStateVersion(storage, runtime, {
    targetVersion: 2,
    steps: [{
      id: "fixture-v1-to-v2",
      fromVersion: 1,
      toVersion: 2,
      applyProject: async (projectStorage) => {
        await projectStorage.set("upgrade-v2-marker", { version: 2 })
      },
    }],
  })
  await writeFile(upgradedPath, "upgraded", "utf8")
  process.stdout.write("upgraded\n")
  process.exit(0)
}

if (mode === "multi-lock") {
  const [aggregateA, resourceA, aggregateB, resourceB, counterPath] = args
  if (!aggregateA || !resourceA || !aggregateB || !resourceB || !counterPath) {
    throw new Error("multi-lock mode requires two aggregate/resource pairs and counterPath")
  }
  await withRuntimeLocks(
    runtime,
    [
      { aggregate: aggregateA, resourceIdentity: resourceA },
      { aggregate: aggregateB, resourceIdentity: resourceB },
    ],
    async () => {
      const current = Number((await readFile(counterPath, "utf8")).trim())
      await Bun.sleep(40)
      await writeFile(counterPath, String(current + 1), "utf8")
    },
  )
  process.stdout.write("ok\n")
  process.exit(0)
}

throw new Error(`unsupported mode: ${mode}`)
