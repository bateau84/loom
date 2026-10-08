import { afterEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  parseLocalPermissionPolicy,
  projectShellOverrides,
  projectWriteOverrides,
  readLocalPermissionPolicy,
} from "./local-policy"
import { localPolicyShellAllowed } from "./shell"

const temporary: string[] = []
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true })
})

const example = [
  "version: 1",
  "shell:",
  "  exact:",
  "    - node --version",
  "    - bun --version",
  "  prefixes:",
  "    - kubectl get",
  "projects:",
  "  /work/example:",
  "    shell:",
  "      exact:",
  "        - go env GOMOD",
  "    writes:",
  "      worker:",
  "        - src/**",
  "      documenter:",
  "        - docs/index.md",
  "        - docs/log.md",
  "",
].join("\n")

describe("local personal Loom permission policy", () => {
  test("combines global and matching project rules without bleeding into other projects", () => {
    const policy = parseLocalPermissionPolicy(example)
    expect(projectWriteOverrides(policy, "/work/example", "documenter")).toEqual([
      "docs/index.md", "docs/log.md",
    ])
    expect(projectWriteOverrides(policy, "/work/other", "documenter")).toEqual([])
    expect(projectWriteOverrides(policy, "/work/example", "critic")).toEqual([])
    const local = projectShellOverrides(policy, "/work/example")
    expect(local.exact).toEqual(["node --version", "bun --version", "go env GOMOD"])
    expect(local.prefixes).toEqual(["kubectl get"])
    expect(projectShellOverrides(policy, "/work/other").exact).toEqual([
      "node --version", "bun --version",
    ])
  })

  test("command exceptions are exact or full-word-prefix and reject shell escape", () => {
    const rules = projectShellOverrides(parseLocalPermissionPolicy(example), "/work/example")
    for (const command of [
      "node --version", "bun --version", "kubectl get pods",
      "kubectl get pods --namespace staging", "go env GOMOD",
    ]) {
      expect(localPolicyShellAllowed(command, rules)).toBe(true)
    }
    for (const command of [
      "kubectl getpods", "node -e 'console.log(1)'",
      "bun --version && touch /tmp/oops",
      "kubectl get pods | xargs rm",
      "kubectl get pods > /tmp/oops",
      "git push origin HEAD", "git status",
      "but push",
      "PATH=/tmp node --version",
    ]) {
      expect(localPolicyShellAllowed(command, rules)).toBe(false)
    }
  })

  test("rejects unbounded/protected path grants, unknown roles and malformed schemas", () => {
    for (const scope of [
      "*", "**", ".", "../other", "/tmp/a", ".git/**", ".loom/**",
      "docs/reports/**", "ephemeral-reports/**",
    ]) {
      expect(() => parseLocalPermissionPolicy(
        "version: 1\nprojects:\n  /work/example:\n    writes:\n      worker: [\"" + scope + "\"]\n",
      )).toThrow()
    }
    expect(() => parseLocalPermissionPolicy(
      "version: 1\nprojects:\n  /work/example:\n    writes:\n      reviewer: [\"src/**\"]\n",
    )).toThrow("does not support role")
    expect(() => parseLocalPermissionPolicy("version: 2")).toThrow("version: 1")
    expect(() => parseLocalPermissionPolicy("version: 1\nextra: yes")).toThrow("unsupported")
    expect(() => parseLocalPermissionPolicy("version: 1\nprojects:\n  ../other: {}")).toThrow("absolute")
  })

  test("reads edits on next admission, fails closed on unsafe files, and preserves absence", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-local-policy-"))
    temporary.push(root)
    const path = join(root, ".loom.yaml")
    expect((await readLocalPermissionPolicy(path)).status).toBe("absent")

    await writeFile(path, example, { mode: 0o600 })
    const first = await readLocalPermissionPolicy(path)
    expect(first.status).toBe("loaded")
    expect(projectWriteOverrides(first.policy, "/work/example", "documenter")).toEqual([
      "docs/index.md", "docs/log.md",
    ])

    await writeFile(path, "version: 1\nshell:\n  exact: [node --version, go version]\n")
    const second = await readLocalPermissionPolicy(path)
    expect(second.status).toBe("loaded")
    expect(projectShellOverrides(second.policy, "/work/example").exact).toEqual([
      "node --version", "go version",
    ])

    await writeFile(path, "version: definitely-not-supported")
    const invalid = await readLocalPermissionPolicy(path)
    expect(invalid.status).toBe("invalid")
    expect(invalid.policy).toBeUndefined()
    expect(invalid.error).toContain("version: 1")

    await chmod(path, 0o666)
    expect((await readLocalPermissionPolicy(path)).status).toBe("invalid")
    await chmod(path, 0o600)
    const symlinkPath = join(root, "symlink.yaml")
    await symlink(path, symlinkPath)
    expect((await readLocalPermissionPolicy(symlinkPath)).status).toBe("invalid")
    expect((await readFile(path, "utf8")).length).toBeGreaterThan(0)
  })
})
