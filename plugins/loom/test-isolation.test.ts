import { expect, setDefaultTimeout, test } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertIsolatedTestProcess } from "./test-isolation"

setDefaultTimeout(120_000)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const keys = ["HOME", "USERPROFILE", "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "TMPDIR", "TMP", "TEMP"]

async function execute(command: string[], env: Record<string, string | undefined>) {
  const child = Bun.spawn(command, { cwd: repository, env, stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => child.kill(), 100_000)
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, stdout, stderr }
  } finally { clearTimeout(timer) }
}

// Invoke the existing launch-environment implementation, not a second runner.
// This bounded child launcher is a test subject, never a host-permission bypass.
const isolatedLaunch = `
import json, pathlib, runpy, subprocess, sys, tempfile
m = runpy.run_path('scripts/run-unit-tests.py')
with tempfile.TemporaryDirectory(prefix='child-', dir=sys.argv[1]) as directory:
    root = pathlib.Path(directory)
    env = m['isolated_test_environment'](root)
    env['LOOM_TEST_ROOT_TRACE'] = str(root / 'roots.jsonl')
    result = subprocess.run(['bun', 'test', './plugins/loom/plugin-boundary.test.ts', '-t', 'planned Brainstorm semantic amendment|isolated fixture environment'], env=env, text=True, capture_output=True)
    trace = root / 'roots.jsonl'
    records = [json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []
    print(json.dumps({'code': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr, 'root': str(root), 'records': records}))
    sys.exit(result.returncode)
`

test("test process guard rejects missing roots and physical escapes before plugin setup", async () => {
  const root = await assertIsolatedTestProcess()
  await expect(assertIsolatedTestProcess({ ...process.env, LOOM_TEST_ISOLATION_ROOT: undefined })).rejects.toThrow("pre-established private process")
  const outside = join(dirname(root), "synthetic-outside-root")
  await expect(assertIsolatedTestProcess({ ...process.env, XDG_STATE_HOME: outside })).rejects.toThrow("private process")
  const privateCase = await mkdtemp(join(tmpdir(), "loom-guard-"))
  try {
    const escape = join(privateCase, "escape")
    await symlink(dirname(root), escape)
    await expect(assertIsolatedTestProcess({ ...process.env, XDG_STATE_HOME: escape })).rejects.toThrow("escapes")
  } finally { await rm(privateCase, { recursive: true, force: true }) }
})

test("actual raw fixture launches are denied and canonical isolated Bun launch preserves a synthetic v9 canary", async () => {
  await assertIsolatedTestProcess()
  const laboratory = await mkdtemp(join(tmpdir(), "loom-process-proof-"))
  try {
    const directories = Object.fromEntries(["home", "state", "runtime", "config", "data", "cache", "tmp"].map((name) => [name, join(laboratory, "canary", name)]))
    for (const path of Object.values(directories)) await mkdir(path, { recursive: true, mode: 0o700 })
    const state = join(directories.state!, "loom")
    await mkdir(state, { mode: 0o700 })
    const databasePath = join(state, "execution-state.sqlite")
    const database = new Database(databasePath, { create: true })
    database.run("CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)")
    database.query("INSERT INTO kv VALUES (?1, ?2)").run("installation/runtime-schema", JSON.stringify({ schemaVersion: 1, currentVersion: 9,
      initializedAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z" }))
    database.close()
    const fingerprint = createHash("sha256").update(await readFile(databasePath)).digest("hex")
    const raw = { ...process.env, LOOM_TEST_ISOLATION_ROOT: undefined, LOOM_TEST_ROOT_TRACE: undefined,
      HOME: directories.home, USERPROFILE: directories.home, XDG_STATE_HOME: directories.state, XDG_RUNTIME_DIR: directories.runtime,
      XDG_CONFIG_HOME: directories.config, XDG_DATA_HOME: directories.data, XDG_CACHE_HOME: directories.cache,
      TMPDIR: directories.tmp, TMP: directories.tmp, TEMP: directories.tmp }
    for (const [file, selection] of [
      ["./plugins/loom/plugin-boundary.test.ts", "planned Brainstorm semantic amendment"],
      ["./plugins/loom/inspection.test.ts", "plugin registers all inspection tools"],
    ]) {
      const rejected = await execute([process.execPath, "test", file!, "-t", selection!], raw)
      expect(rejected.code).not.toBe(0)
      expect(rejected.stdout + rejected.stderr).toContain("pre-established private process")
      expect(createHash("sha256").update(await readFile(databasePath)).digest("hex")).toBe(fingerprint)
    }
    const isolated = await execute(["python3", "-c", isolatedLaunch, laboratory], process.env)
    expect(isolated.code).toBe(0)
    const report: unknown = JSON.parse(isolated.stdout)
    if (!report || typeof report !== "object" || !("root" in report) || typeof report.root !== "string" ||
        !("records" in report) || !Array.isArray(report.records) || !("stderr" in report) || typeof report.stderr !== "string") throw new Error("Malformed child-process proof report")
    expect(report.stderr).toContain("3 pass")
    expect(report.stderr).not.toContain("dashboard auto-start unavailable")
    expect(report.records.length).toBeGreaterThan(0)
    for (const record of report.records) {
      if (!record || typeof record !== "object") throw new Error("Malformed runtime-root observation")
      expect(record.kind).not.toBe("listener-attempt")
      for (const field of ["stateRoot", "runtimeRoot", "databasePath", "project"]) {
        if (!(field in record) || typeof record[field] !== "string") throw new Error(`Missing root observation ${field}`)
        const suffix = relative(report.root, record[field])
        expect(suffix === ".." || suffix.startsWith("../")).toBe(false)
        expect(record[field].startsWith(report.root + "/")).toBe(true)
      }
      expect(record.pid).toBeGreaterThan(0)
      expect(record.ppid).toBeGreaterThan(0)
      if (!record.environment || typeof record.environment !== "object") throw new Error("Missing actual child environment")
      for (const key of keys) expect(String(record.environment[key]).startsWith(report.root + "/")).toBe(true)
    }
    expect(createHash("sha256").update(await readFile(databasePath)).digest("hex")).toBe(fingerprint)
    const retained = new Database(databasePath, { readonly: true })
    try {
      const row = retained.query("SELECT value FROM kv WHERE key = ?1").get("installation/runtime-schema") as { value: string } | null
      expect(row && JSON.parse(row.value).currentVersion).toBe(9)
    } finally { retained.close() }
  } finally { await rm(laboratory, { recursive: true, force: true }) }
})
