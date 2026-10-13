import { test, expect } from "bun:test"
import { Host } from "@opencode/plugin/host"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"

test("pinned host resolves the actual local-directory server entrypoint", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const entry = Host.resolve({ directory: root }).server
  expect(entry).toBe(new URL("../server.ts", import.meta.url).href)
  if (!entry) throw new Error("Loom has no discoverable local entrypoint")
  const loaded = await Host.load(entry) as { default?: { id?: string; setup?: unknown } }
  expect(loaded.default?.id).toBe("loom")
  expect(typeof loaded.default?.setup).toBe("function")
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  expect(pkg.files).toContain("server.ts")
  expect(pkg.exports["./server"]).toBe("./server.ts")
})
