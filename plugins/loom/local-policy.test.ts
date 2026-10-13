import { afterEach, describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  parseLocalPermissionPolicy, projectShellOverrides,
  projectWriteOverrides, readEffectiveLocalPermissionPolicy,
  targetsEffectiveLocalPermissionPolicy,
} from "./local-policy"
import { localPolicyShellAllowed } from "./shell"

const execFileAsync = promisify(execFile)
const roots: string[] = []
afterEach(async () => {
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true })
})

const globalYaml = `version: 1
shell:
  exact: ["go version"]
  prefixes: ["make"]
writes:
  worker: ["src/**"]
  documenter: ["docs/**"]
`
const worktreeYaml = `version: 1
shell:
  exact: ["go mod tidy -diff"]
  prefixes: ["just test"]
writes:
  worker: ["pkg/**"]
  documenter: []
`

describe("global and per-worktree Loom policy overrides", () => {
  test("uses global settings for worktrees without local file", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-policy-roots-"))
    roots.push(root)
    const global = join(root, "global.yaml")
    const worktree = join(root, "pr-worktree")
    await mkdir(worktree)
    await writeFile(global, globalYaml, { mode: 0o600 })
    const read = await readEffectiveLocalPermissionPolicy(worktree, global)
    expect(read).toMatchObject({ status: "loaded", source: "global" })
    expect(projectShellOverrides(read.policy, worktree).exact).toEqual(["go version"])
    expect(projectWriteOverrides(read.policy, worktree, "worker")).toEqual(["src/**"])
  })

  test("worktree file completely replaces global shell and write grants", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-policy-roots-"))
    roots.push(root)
    const global = join(root, "global.yaml")
    const first = join(root, "pr-001"), second = join(root, "pr-002")
    await mkdir(first); await mkdir(second)
    await writeFile(global, globalYaml, { mode: 0o600 })
    await writeFile(join(first, ".loom.yaml"), worktreeYaml, { mode: 0o600 })
    const local = await readEffectiveLocalPermissionPolicy(first, global)
    const other = await readEffectiveLocalPermissionPolicy(second, global)
    expect(local).toMatchObject({ status: "loaded", source: "worktree" })
    expect(projectShellOverrides(local.policy, first).exact).toEqual(["go mod tidy -diff"])
    expect(projectShellOverrides(local.policy, first).prefixes).toEqual(["just test"])
    expect(projectWriteOverrides(local.policy, first, "worker")).toEqual(["pkg/**"])
    expect(projectWriteOverrides(local.policy, first, "documenter")).toEqual([])
    expect(other.source).toBe("global")
    expect(projectWriteOverrides(other.policy, second, "worker")).toEqual(["src/**"])
    expect(localPolicyShellAllowed("go version", projectShellOverrides(local.policy, first))).toBe(false)
    expect(localPolicyShellAllowed("go version", projectShellOverrides(other.policy, second))).toBe(true)
  })

  test("an invalid local policy never falls back to global grants", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-policy-roots-"))
    roots.push(root)
    const global = join(root, "global.yaml")
    const first = join(root, "pr-001")
    await mkdir(first)
    await writeFile(global, globalYaml, { mode: 0o600 })
    const path = join(first, ".loom.yaml")
    await writeFile(path, "version: 2", { mode: 0o600 })
    const invalid = await readEffectiveLocalPermissionPolicy(first, global)
    expect(invalid).toMatchObject({ status: "invalid", source: "worktree" })
    expect(invalid.policy).toBeUndefined()
    await rm(path)
    await symlink(global, path)
    const symlinked = await readEffectiveLocalPermissionPolicy(first, global)
    expect(symlinked.status).toBe("invalid")
    await rm(path)
    expect((await readEffectiveLocalPermissionPolicy(first, global)).source).toBe("global")
  })

  test("tracked worktree policy is invalid until untracked", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-policy-tracked-"))
    roots.push(root)
    const global = join(root, "global.yaml")
    const worktree = join(root, "checkout")
    await mkdir(worktree)
    await writeFile(global, globalYaml, { mode: 0o600 })
    await execFileAsync("git", ["init", "-q"], { cwd: worktree })
    const path = join(worktree, ".loom.yaml")
    await writeFile(path, worktreeYaml, { mode: 0o600 })
    expect((await readEffectiveLocalPermissionPolicy(worktree, global)).source).toBe("worktree")
    await execFileAsync("git", ["add", "--", ".loom.yaml"], { cwd: worktree })
    const tracked = await readEffectiveLocalPermissionPolicy(worktree, global)
    expect(tracked).toMatchObject({ source: "worktree", status: "invalid" })
    expect(tracked.error).toContain("Tracked worktree")
    expect(tracked.policy).toBeUndefined()
    await execFileAsync("git", ["rm", "-q", "--cached", "--", ".loom.yaml"], { cwd: worktree })
    expect((await readEffectiveLocalPermissionPolicy(worktree, global)).status).toBe("loaded")
  })

  test("rejects broad and protected write grants in global or worktree files", () => {
    for (const value of ["*", "**", "../outside", ".git/**", ".loom.yaml", "docs/reports/**"]) {
      expect(() => parseLocalPermissionPolicy(`version: 1\nwrites:\n  worker: [${JSON.stringify(value)}]\n`)).toThrow()
    }
    expect(() => parseLocalPermissionPolicy("version: 1\nwrites:\n  critic: [src/**]\n"))
      .toThrow("does not support role")
  })

  test("protects both global and worktree YAML, including aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-policy-roots-"))
    roots.push(root)
    const global = join(root, "global.yaml")
    const worktree = join(root, "checkout")
    await mkdir(worktree)
    await writeFile(global, globalYaml, { mode: 0o600 })
    await writeFile(join(worktree, ".loom.yaml"), worktreeYaml, { mode: 0o600 })
    await symlink(join(worktree, ".loom.yaml"), join(worktree, "alias.yaml"))
    expect(await targetsEffectiveLocalPermissionPolicy(worktree, ".loom.yaml", global)).toBe(true)
    expect(await targetsEffectiveLocalPermissionPolicy(worktree, "alias.yaml", global)).toBe(true)
  })
})
