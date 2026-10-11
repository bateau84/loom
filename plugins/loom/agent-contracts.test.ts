import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { loadLoomAgentContracts, LOOM_AGENT_ROLES, LOOM_ROLE_PERMISSIONS } from "./agent-contracts"

describe("optional Loom agent contracts", () => {
  test("all installed roles receive the shared plus their own contract", async () => {
    const result = await loadLoomAgentContracts()
    expect(result.size).toBe(LOOM_AGENT_ROLES.length)
    for (const role of LOOM_AGENT_ROLES) {
      const body = result.get(role)
      expect(body).toContain("# Loom shared runtime contract")
      expect(body).toContain(`# Loom runtime contract: ${role}`)
      expect(LOOM_ROLE_PERMISSIONS[role].length).toBeGreaterThan(0)
    }
  })
  test("portable agent definitions contain neither Loom tool calls nor Loom permission rules", async () => {
    for (const role of LOOM_AGENT_ROLES) {
      const body = await readFile(new URL(`../../agents/${role}.md`, import.meta.url), "utf8")
      expect(body).not.toMatch(/\bloom_[a-z_]+\b/)
      expect(body.split("---")[1]).not.toContain("permissions:")
      expect(body).toMatch(/mode: (primary|subagent)/)
    }
  })
  test("missing or empty runtime contracts fail closed", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-contracts-"))
    try {
      const url = pathToFileURL(root + "/")
      await expect(loadLoomAgentContracts(url)).rejects.toThrow()
      await writeFile(join(root, "shared.md"), "  ")
      await expect(loadLoomAgentContracts(url)).rejects.toThrow("shared runtime contract is empty")
      await writeFile(join(root, "shared.md"), "# Valid shared contract")
      await expect(loadLoomAgentContracts(url)).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
