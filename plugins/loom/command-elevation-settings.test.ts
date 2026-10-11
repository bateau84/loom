import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { localLoomSettingsPath, unrestrictedCommandElevationEnabled } from "./command-elevation-settings"

describe("operator-owned command elevation switch", () => {
  test("is off when the untracked local file is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "loom-command-config-"))
    try {
      expect(await unrestrictedCommandElevationEnabled(join(dir, "missing.yaml"))).toBe(false)
      expect(localLoomSettingsPath({ XDG_CONFIG_HOME: dir })).toBe(join(dir, "opencode", ".loom.yaml"))
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  test("requires one exact top-level true flag", async () => {
    const dir = await mkdtemp(join(tmpdir(), "loom-command-config-"))
    try {
      const path = join(dir, ".loom.yaml")
      for (const value of ["false", "yes", "1", "'true'"]) {
        await writeFile(path, `unrestricted_command_elevation: ${value}\n`)
        expect(await unrestrictedCommandElevationEnabled(path)).toBe(false)
      }
      await writeFile(path, "unrestricted_command_elevation: true\n")
      expect(await unrestrictedCommandElevationEnabled(path)).toBe(true)
      await writeFile(path, "unrestricted_command_elevation: true\nunrestricted_command_elevation: false\n")
      expect(await unrestrictedCommandElevationEnabled(path)).toBe(false)
      await writeFile(path, "nested:\n  unrestricted_command_elevation: true\n")
      expect(await unrestrictedCommandElevationEnabled(path)).toBe(false)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  test("never follows symlinked local settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "loom-command-config-"))
    try {
      const target = join(dir, "target.yaml")
      const link = join(dir, "link.yaml")
      await writeFile(target, "unrestricted_command_elevation: true\n")
      await symlink(target, link)
      expect(await unrestrictedCommandElevationEnabled(link)).toBe(false)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
