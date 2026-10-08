import { afterEach, describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"
import { createIsolatedGitWorktree } from "./git-worktree"

const run = promisify(execFile)
const fixtures: Array<{ root: string; linked: string }> = []

async function git(root: string, ...args: string[]) {
  const result = await run("git", ["-C", root, ...args], {
    encoding: "utf8",
    timeout: 20_000,
  })
  return result.stdout.trim()
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-git-worktree-"))
  fixtures.push({ root, linked: root + "-wt" })
  await git(root, "init", "-q")
  await git(root, "config", "user.name", "Loom test")
  await git(root, "config", "user.email", "loom-test@example.invalid")
  await writeFile(join(root, "sample.txt"), "original\n")
  await git(root, "add", "--", "sample.txt")
  await git(root, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "baseline")
  return root
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await rm(fixture.linked, { recursive: true, force: true })
    await rm(fixture.root, { recursive: true, force: true })
  }
})

describe("bounded Git worktree creation", () => {
  test("creates a fresh branch at the exact revision without changing the current branch or Git index", async () => {
    const root = await fixture()
    const head = await git(root, "rev-parse", "HEAD")
    const branch = await git(root, "branch", "--show-current")
    const result = await createIsolatedGitWorktree(root, {
      name: "isolated-repair", branch: "loom/isolated-repair", startCommit: head,
    })
    expect(result).toMatchObject({
      branch: "loom/isolated-repair",
      startCommit: head,
      primaryWorktreeRoot: await realpath(root),
      currentProjectRoot: await realpath(root),
      gitMetadataAccess: "git-owned-only",
      existingProjectSessionRebound: false,
    })
    expect(result.worktreePath).toBe(join(dirname(root), basename(root) + "-wt", "isolated-repair"))
    expect(await readFile(join(result.worktreePath, "sample.txt"), "utf8")).toBe("original\n")
    expect(await git(root, "branch", "--show-current")).toBe(branch)
    expect(await git(root, "rev-parse", "HEAD")).toBe(head)
    expect(await git(root, "status", "--porcelain")).toBe("")
    expect(await git(result.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe("loom/isolated-repair")
    expect(await git(root, "worktree", "list", "--porcelain")).toContain(result.worktreePath)

    // No blanket scope: an existing target or branch is never reused/reset.
    await expect(createIsolatedGitWorktree(root, {
      name: "isolated-repair", branch: "loom/other-repair",
    })).rejects.toThrow("target already exists")
    await expect(createIsolatedGitWorktree(root, {
      name: "another-repair", branch: "loom/isolated-repair",
    })).rejects.toThrow("branch already exists")
  })

  test("a linked worktree points further worktrees to the same verified primary repository", async () => {
    const root = await fixture()
    const first = await createIsolatedGitWorktree(root, { name: "first", branch: "loom/first" })
    const second = await createIsolatedGitWorktree(first.worktreePath, {
      name: "second", branch: "loom/second", startCommit: first.startCommit,
    })
    expect(second.currentProjectRoot).toBe(first.worktreePath)
    expect(second.primaryWorktreeRoot).toBe(await realpath(root))
    expect(second.worktreePath).toBe(join(dirname(root), basename(root) + "-wt", "second"))
    expect(await git(first.worktreePath, "branch", "--show-current")).toBe("loom/first")
    expect(await git(root, "branch", "--show-current")).not.toBe("loom/second")
    expect(await git(second.worktreePath, "rev-parse", "--git-common-dir")).toBe(
      await git(first.worktreePath, "rev-parse", "--git-common-dir"),
    )
  })

  test("fails closed for unsafe branch/path/revision or a sibling-root symlink", async () => {
    const root = await fixture()
    for (const name of ["../outside", "sub/dir", "..", ".git", "-danger", "x..y"]) {
      await expect(createIsolatedGitWorktree(root, {
        name, branch: "loom/fresh",
      })).rejects.toThrow("Worktree name")
    }
    for (const branch of ["-force", "../oops", "a..b", "a/.hidden", "topic.lock", "a//b"]) {
      await expect(createIsolatedGitWorktree(root, {
        name: "fresh", branch,
      })).rejects.toThrow("branch")
    }
    await expect(createIsolatedGitWorktree(root, {
      name: "fresh", branch: "loom/fresh", startCommit: "HEAD",
    })).rejects.toThrow("40-hex")
    await expect(createIsolatedGitWorktree(root, {
      name: "fresh", branch: "loom/fresh", startCommit: "a".repeat(40),
    })).rejects.toThrow()

    const sibling = root + "-wt"
    const other = await mkdtemp(join(tmpdir(), "loom-git-symlink-target-"))
    fixtures.push({ root: other, linked: other + "-wt" })
    await symlink(other, sibling)
    expect((await lstat(sibling)).isSymbolicLink()).toBe(true)
    await expect(createIsolatedGitWorktree(root, {
      name: "fresh", branch: "loom/fresh",
    })).rejects.toThrow("not a symlink")
    expect(await git(root, "status", "--porcelain")).toBe("")
  })

  test("rejects an ordinary folder that is not itself the current Git worktree root", async () => {
    const root = await fixture()
    await mkdir(join(root, "src"))
    await expect(createIsolatedGitWorktree(join(root, "src"), {
      name: "new", branch: "loom/new",
    })).rejects.toThrow("Git worktree root")
  })
})
