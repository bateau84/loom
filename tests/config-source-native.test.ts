import { test, expect } from "bun:test"
import { YAML } from "bun"
import { open, mkdtemp, writeFile, appendFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig, type ConfigOpener } from "../src/config.js"

async function withFile(source: string | Buffer, run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "loom-config-native-"))
  const path = join(dir, ".loom.yaml")
  try { await writeFile(path, source); await run(path) }
  finally { await rm(dir, { recursive: true, force: true }) }
}
const decode = (source: string) => YAML.parse(source)

test("bounded source reader preserves native YAML aliases, text and role mapping", async () => {
  await withFile("agents:\n  investigator: &common\n    roles: [research]\n    description: |\n      Check Æøå and provenance.\n      Keep # and [brackets] in the text.\n  specialist: *common\n", async path => {
    let aliasesShared = false
    const value = await loadConfig([path], source => {
      const data = YAML.parse(source) as any
      aliasesShared = data.agents.investigator === data.agents.specialist
      return data
    })
    expect(aliasesShared).toBe(true)
    expect(value.errors).toEqual([])
    expect(value.config.agents.investigator).toEqual(value.config.agents.specialist)
    expect(value.config.agents.investigator.description).toBe("Check Æøå and provenance.\nKeep # and [brackets] in the text.")
  })
})

test("native decoding receives the complete exact 64 KiB input, never an oversized prefix", async () => {
  const prefix = "version: 1\nagents: {}\n#"
  const source = prefix + "x".repeat(65536 - Buffer.byteLength(prefix))
  await withFile(source, async path => {
    let calls = 0
    const value = await loadConfig([path], text => { calls++; expect(text).toBe(source); return decode(text) })
    expect(value.errors).toEqual([])
    expect(calls).toBe(1)
    await appendFile(path, "x")
    const failed = await loadConfig([path], text => { calls++; return decode(text) })
    expect(failed.errors[0]).toContain("64 KiB")
    expect(calls).toBe(1)
    expect(failed.config.instructions.enabled).toBe(false)
    expect(failed.config.ledger.capture).toBe("off")
  })
})

test("file growth after fstat remains bounded with the real Bun file handle", async () => {
  await withFile("version: 1\n", async path => {
    let changed = false, bytes = 0, closed = 0, decoded = false
    const growing: ConfigOpener = async (name, flags) => {
      const file = await open(name, flags)
      return {
        stat: async options => {
          const info = await file.stat(options)
          if (!changed) { changed = true; await appendFile(path, " ".repeat(2 * 1024 * 1024)) }
          return info
        },
        read: async (...args) => { const value = await file.read(...args); bytes += value.bytesRead; return value },
        close: async () => { closed++; await file.close() },
      }
    }
    const value = await loadConfig([path], text => { decoded = true; return decode(text) }, growing)
    expect(value.errors[0]).toContain("64 KiB")
    expect(bytes).toBe(65537)
    expect(closed).toBe(1)
    expect(decoded).toBe(false)
  })
})

test("invalid UTF-8 does not reach Bun YAML as silently changed text", async () => {
  await withFile(Buffer.from([0xff]), async path => {
    let calls = 0
    const value = await loadConfig([path], source => { calls++; return decode(source) })
    expect(calls).toBe(0)
    expect(value.errors[0]).toContain("valid UTF-8")
    expect(value.config.ledger.capture).toBe("off")
  })
})

test("native cyclic aliases remain a schema error and subsequent corrected config reloads", async () => {
  await withFile("agents: &recursive\n  child: *recursive\n", async path => {
    const bad = await loadConfig([path], decode)
    expect(bad.errors).toHaveLength(1)
    expect(bad.config.agents).toEqual({})
    expect(bad.config.instructions.enabled).toBe(false)
    await writeFile(path, "agents:\n  child:\n    roles: [implementation]\n")
    const fixed = await loadConfig([path], decode)
    expect(fixed.errors).toEqual([])
    expect(fixed.config.agents.child.roles).toEqual(["implementation"])
  })
})

test("deep native YAML decodes before schema rejection; this is not an allocation-limit test", async () => {
  await withFile("unused: " + "[".repeat(100) + "0" + "]".repeat(100) + "\n", async path => {
    let decoded = false
    const value = await loadConfig([path], source => { const result = decode(source); decoded = true; return result })
    expect(decoded).toBe(true)
    expect(value.errors[0]).toContain("Unknown setting")
    expect(value.config.instructions.enabled).toBe(false)
    expect(value.config.ledger.capture).toBe("off")
  })
})
