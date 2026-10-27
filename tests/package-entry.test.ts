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


test("SDK pin and separately versioned host fixtures are explicit", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const sdkVersion = pkg.dependencies["@opencode/plugin"]
  expect(sdkVersion).toBe("2.2.0")
  const lock = await readFile(new URL("../bun.lock", import.meta.url), "utf8")
  expect(lock).toContain(`"@opencode/plugin": "${sdkVersion}"`)
  expect(lock).toContain(`"@opencode/plugin": ["@opencode/plugin@${sdkVersion}"`)
  const installed = JSON.parse(await readFile(new URL("../node_modules/@opencode/plugin/package.json", import.meta.url), "utf8"))
  expect(installed.version).toBe(sdkVersion)
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
  const host = await readFile(new URL("../.github/workflows/installed-host.yml", import.meta.url), "utf8")
  const smoke = await readFile(new URL("./installed_host_smoke.py", import.meta.url), "utf8")
  expect(ci).toContain("@opencode/codemode@2.0.29")
  expect(host).toContain("@opencode/cli@2.2.0")
  expect(host).toContain("--expect-version 2.2.0")
  expect(host).toContain("npm pack --json")
  expect(host).toContain("--plugin \"$RUNNER_TEMP/loom-plugin-install/node_modules/loom-plugin\"")
  expect(host).toContain("--artifact")
  expect(host).toContain("--expect-sdk-version 2.2.0")
  expect(smoke).toContain('--expect-version", default="2.2.0"')
  for (const workflow of [ci, host]) {
    expect(workflow).toContain("bun install --frozen-lockfile")
    expect(workflow).toContain("git diff --exit-code -- bun.lock")
    expect(workflow).not.toMatch(/run: bun install\s*$/m)
  }
})

test("2.2.0 is the sole installed host and SDK profile", async () => {
  const hostWorkflow = await readFile(new URL("../.github/workflows/installed-host.yml", import.meta.url), "utf8")
  const compatPath = new URL("../.github/workflows/installed-host-2.0.29.yml", import.meta.url)
  const smoke = await readFile(new URL("./installed_host_smoke.py", import.meta.url), "utf8")
  expect(hostWorkflow).toContain("@opencode/cli@2.2.0")
  expect(hostWorkflow).toContain("--expect-sdk-version 2.2.0")
  expect(hostWorkflow).toContain("npm pack --json")
  expect(hostWorkflow).toContain("npm install --prefix")
  expect(smoke).toContain('"profile": profile')
  await expect(readFile(compatPath, "utf8")).rejects.toThrow()
})

test("installed questions qualifies the exact packed 2.2.0 candidate", async () => {
  const workflow = await readFile(new URL("../.github/workflows/installed-questions.yml", import.meta.url), "utf8")
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const lock = await readFile(new URL("../bun.lock", import.meta.url), "utf8")
  const harness = await readFile(new URL("./installed_questions.py", import.meta.url), "utf8")
  const smoke = await readFile(new URL("./installed_host_smoke.py", import.meta.url), "utf8")

  expect(pkg.dependencies["@opencode/plugin"]).toBe("2.2.0")
  expect(lock).toContain('"@opencode/plugin": "2.2.0"')
  expect(workflow).toContain("bun install --frozen-lockfile")
  expect(workflow).toContain("npm pack --json")
  expect(workflow).toContain("@opencode/cli@2.2.0")
  expect(workflow).toContain("$RUNNER_TEMP/loom-question-install/node_modules/loom-plugin")
  expect(workflow).toContain("--artifact")
  expect(workflow).toContain("--expect-sdk-version 2.2.0")
  expect(workflow).toContain("tests/installed_questions.py")
  expect(workflow).toContain("--opencode \"$RUNNER_TEMP/loom-question-host/node_modules/.bin/opencode\"")
  expect(workflow).not.toContain("PROFILE_PACKAGE")
  expect(workflow).not.toContain('pkg.dependencies["@opencode/plugin"]')
  expect(workflow).not.toContain("@opencode/cli@2.0.29")
  expect(harness).toContain("expected_versions")
  expect(harness).toContain("observed_versions")
  expect(harness).toContain("candidate_artifact")
  expect(harness).toContain("source_oracle")
  expect(smoke).toContain("artifact_path")
  expect(harness).toContain("--artifact")
  expect(harness).toContain("--plugin")
  expect(harness).toContain("Version profile mismatch")
})
