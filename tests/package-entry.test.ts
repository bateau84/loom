import { test, expect } from "bun:test"
import { Host } from "@opencode/plugin/host"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"

test("Bun support metadata excludes older runtimes and CI uses the tested baseline", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const baseline = (await readFile(new URL("../.bun-version", import.meta.url), "utf8")).trim()
  expect(baseline).toBe("1.4.2")
  expect(pkg.engines.bun).toBe(`>=${baseline} <2.0.0`)
  for (const version of ["1.3.0", "1.3.14", "1.4.0", "1.4.1", "1.4.2-canary.1", "2.0.0"]) {
    expect(Bun.semver.satisfies(version, pkg.engines.bun)).toBe(false)
  }
  expect(Bun.semver.satisfies(baseline, pkg.engines.bun)).toBe(true)
  // Range admission is not a claim that this other version has been host-tested.
  expect(Bun.semver.satisfies("1.4.3", pkg.engines.bun)).toBe(true)
  for (const file of ["ci.yml", "installed-host.yml"]) {
    const workflow = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8")
    expect(workflow).toContain("bun-version-file: .bun-version")
    expect(workflow).not.toMatch(/\bbun-version:/)
  }
})

test("pinned host loads the server with optional TUI and RPC entrypoints absent", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  // Fail clearly on an unsupported test runner instead of hiding its resolver error.
  // This is not a runtime guard inside OpenCode's independently packaged host.
  if (!Bun.semver.satisfies(Bun.version, pkg.engines.bun)) {
    throw new Error(`Loom requires Bun ${pkg.engines.bun}; this test runner is ${Bun.version}. Use the baseline in .bun-version and rerun test:native.`)
  }
  const root = fileURLToPath(new URL("../", import.meta.url))
  const entrypoints = Host.resolve({ directory: root })
  expect(entrypoints.tui).toBeUndefined()
  expect(entrypoints.rpc).toBeUndefined()
  const entry = entrypoints.server
  expect(entry).toBe(new URL("../server.ts", import.meta.url).href)
  if (!entry) throw new Error("Loom has no discoverable local entrypoint")
  const loaded = await Host.load(entry) as { default?: { id?: string; setup?: unknown } }
  expect(loaded.default?.id).toBe("loom")
  expect(typeof loaded.default?.setup).toBe("function")
  expect(pkg.files).toContain("server.ts")
  expect(pkg.exports["./server"]).toBe("./server.ts")
})


test("SDK, installed host, search fixture and boot default share the exact OpenCode pin", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const version = pkg.dependencies["@opencode/plugin"]
  expect(version).toBe("2.0.29")
  const installed = JSON.parse(await readFile(new URL("../node_modules/@opencode/plugin/package.json", import.meta.url), "utf8"))
  expect(installed.version).toBe(version)
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
  const host = await readFile(new URL("../.github/workflows/installed-host.yml", import.meta.url), "utf8")
  const search = await readFile(new URL("./tool-search-codemode.test.ts", import.meta.url), "utf8")
  const smoke = await readFile(new URL("./installed_host_smoke.py", import.meta.url), "utf8")
  expect(ci).toContain(`@opencode/codemode@${version}`)
  expect(host).toContain(`@opencode/cli@${version}`)
  expect(host).toContain(`--expect-version ${version}`)
  expect(search).toContain(`metadata.version !== "${version}"`)
  expect(smoke).toContain(`"--expect-version", default="${version}"`)
  for (const workflow of [ci, host]) {
    expect(workflow).toContain("bun install --frozen-lockfile")
    expect(workflow).toContain("git diff --exit-code -- bun.lock")
    expect(workflow).not.toMatch(/run: bun install\s*$/m)
  }
})
