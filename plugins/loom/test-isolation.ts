import { appendFile, lstat, realpath } from "node:fs/promises"
import { appendFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"

const ROOT_KEYS = ["HOME", "USERPROFILE", "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "TMPDIR", "TMP", "TEMP"] as const
const guidance = "Loom integration tests require a pre-established private process environment; use scripts/run-unit-tests.py, never a raw ambient-state Bun launch."
type RootCheckOptions = { allowRuntimeFallback?: boolean }

function inside(root: string, path: string) {
  const suffix = relative(root, path)
  return suffix !== ".." && !suffix.startsWith("../") && !isAbsolute(suffix)
}

async function privatePath(root: string, value: string) {
  if (!isAbsolute(value) || !inside(root, resolve(value))) throw new Error(guidance)
  let cursor = resolve(value)
  const missing: string[] = []
  for (;;) {
    try {
      const physical = resolve(await realpath(cursor), ...missing.reverse())
      if (!inside(root, physical)) throw new Error("Test path escapes the private process root.")
      return physical
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
      // A dangling symlink is not proof of a safe future directory.
      if ((await lstat(cursor).catch(() => undefined))?.isSymbolicLink()) throw new Error("Test path contains an unresolved symlink.")
      if (cursor === root) throw error
      missing.push(basename(cursor))
      cursor = dirname(cursor)
    }
  }
}

/** Test-only prevention; this is not an OS sandbox or historical writer proof. */
export async function assertIsolatedTestProcess(env: Record<string, string | undefined> = process.env, options: RootCheckOptions = {}) {
  const declared = env.LOOM_TEST_ISOLATION_ROOT
  if (!declared || !isAbsolute(declared) || resolve(declared) === dirname(resolve(declared))) throw new Error(guidance)
  const root = await realpath(declared)
  const metadata = await lstat(declared)
  if (root !== resolve(declared) || !metadata.isDirectory() || (metadata.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && metadata.uid !== process.getuid())) throw new Error(guidance)
  for (const key of ROOT_KEYS) {
    const value = env[key]
    if (!value && key === "XDG_RUNTIME_DIR" && options.allowRuntimeFallback) continue
    if (!value) throw new Error(`${guidance} Missing ${key}.`)
    await privatePath(root, value)
  }
  return root
}

export async function assertIsolatedFixturePath(path: string, options: RootCheckOptions = {}) {
  return privatePath(await assertIsolatedTestProcess(process.env, options), path)
}

export async function assertIsolatedFixtureRuntime(runtime: { stateRoot: string; runtimeRoot: string; canonicalLocation: string }, options: RootCheckOptions = {}) {
  const root = await assertIsolatedTestProcess(process.env, options)
  for (const path of [runtime.stateRoot, runtime.runtimeRoot, runtime.canonicalLocation]) await privatePath(root, path)
  if (process.env.LOOM_TEST_ROOT_TRACE) {
    const trace = await privatePath(root, process.env.LOOM_TEST_ROOT_TRACE)
    await appendFile(trace, JSON.stringify({ kind: "fixture-runtime-selection", pid: process.pid, ppid: process.ppid,
      isolationRoot: root, stateRoot: runtime.stateRoot, runtimeRoot: runtime.runtimeRoot,
      databasePath: join(runtime.stateRoot, "execution-state.sqlite"), project: runtime.canonicalLocation,
      environment: Object.fromEntries(ROOT_KEYS.map((key) => [key, process.env[key]])) }) + "\n")
  }
}

/** Dedicated test-process setting; independent lifecycle tests control their own environment. */
let listenersObserved = false
export async function disableFixtureDashboardAutostart() {
  process.env.LOOM_DASHBOARD_AUTOSTART = "0"
  if (process.env.LOOM_TEST_ROOT_TRACE && !listenersObserved) {
    const root = await assertIsolatedTestProcess()
    const trace = await privatePath(root, process.env.LOOM_TEST_ROOT_TRACE)
    const serve = Bun.serve
    // Observe the external socket boundary and delegate unchanged; never fake a
    // successful listener or substitute any control-plane implementation.
    Bun.serve = (options) => {
      appendFileSync(trace, JSON.stringify({ kind: "listener-attempt", pid: process.pid, ppid: process.ppid,
        isolationRoot: root, port: "port" in options ? options.port : undefined }) + "\n")
      return serve(options)
    }
    listenersObserved = true
  }
}
