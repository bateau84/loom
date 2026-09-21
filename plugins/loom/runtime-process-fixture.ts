import { readFile, writeFile } from "node:fs/promises"
import { createTransactionalStorage, resolveRuntimeIdentity, withRuntimeLock, withRuntimeLocks, type RawStorage } from "./runtime"

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
  await withRuntimeLock(runtime, "workflow", "crash-test", async () => {
    await storage.set(workflowKey, { revision: 2, state: "after" })
    await storage.set(budgetKey, { dispatches: 2 })
    process.exit(97)
  })
  throw new Error("transaction-crash fault injection did not terminate the process")
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
