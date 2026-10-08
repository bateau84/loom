import { execFile } from "node:child_process"
import { lstat, mkdir, realpath } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

function gitEnvironment() {
  // Do not let ambient GIT_DIR, GIT_WORK_TREE or injected Git configuration
  // redirect a governed operation to a different repository.
  return Object.fromEntries(
    Object.entries(process.env).filter(([name, value]) =>
      !name.startsWith("GIT_") && value !== undefined,
    ),
  ) as NodeJS.ProcessEnv
}

async function git(root: string, args: string[]) {
  const { stdout } = await execFileAsync(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-C", root, ...args],
    {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      env: gitEnvironment(),
    },
  )
  return String(stdout).trim()
}

async function gitDirectoryExists(path: string) {
  try {
    return await lstat(path)
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined
    throw error
  }
}

function validateWorktreeName(name: string) {
  if (typeof name !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name) ||
      name.includes("..") || name.endsWith(".lock")) {
    throw new Error("Worktree name must be one simple directory name (letters, digits, dash, underscore or dot), not a path.")
  }
  return name
}

function validateBranchName(branch: string) {
  if (typeof branch !== "string" ||
      branch.length > 160 ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) ||
      branch.split("/").some((segment) =>
        !segment || segment === "." || segment === ".." ||
        segment.startsWith(".") || segment.endsWith(".") ||
        segment.endsWith(".lock"))) {
    throw new Error("New worktree branch must be one valid, explicit, non-option Git branch name.")
  }
  return branch
}

export type GitWorktreeCreateInput = {
  name: string
  branch: string
  /** Exact 40-hex commit, or the current HEAD resolved at admission. */
  startCommit?: string
}

export type GitWorktreeCreateResult = {
  worktreePath: string
  branch: string
  startCommit: string
  currentProjectRoot: string
  primaryWorktreeRoot: string
  gitMetadataAccess: "git-owned-only"
  existingProjectSessionRebound: false
}

/**
 * Create one new isolated worktree using Git itself, never by granting raw
 * writes to .git/refs, .git/objects or an external worktree gitdir.
 *
 * The destination is exactly <primary-checkout>-wt/<simple-name>, beside the
 * primary checkout. No arbitrary external paths, force, reset, remove, reuse
 * of existing refs, or rewrite of an existing worktree is supported.
 *
 * The owning Loom runtime must independently check Worker step/claim/scope
 * admission and serialize this operation before invoking this helper.
 */
export async function createIsolatedGitWorktree(
  projectDirectory: string,
  input: GitWorktreeCreateInput,
): Promise<GitWorktreeCreateResult> {
  const name = validateWorktreeName(input.name)
  const branch = validateBranchName(input.branch)
  if (input.startCommit !== undefined &&
      (typeof input.startCommit !== "string" || !/^[0-9a-fA-F]{40}$/.test(input.startCommit))) {
    throw new Error("startCommit must be an exact full 40-hex commit SHA.")
  }

  const currentRoot = await realpath(projectDirectory)
  const gitTop = await realpath(await git(currentRoot, ["rev-parse", "--show-toplevel"]))
  if (gitTop !== currentRoot) {
    throw new Error("The active Loom project must be the Git worktree root.")
  }

  const commonValue = await git(currentRoot, ["rev-parse", "--git-common-dir"])
  const commonRoot = await realpath(resolve(currentRoot, commonValue))
  if (basename(commonRoot) !== ".git" ||
      !(await lstat(commonRoot)).isDirectory()) {
    throw new Error("Worktree creation requires a normal primary Git checkout with a .git directory.")
  }
  const primaryRoot = await realpath(dirname(commonRoot))
  if (await realpath(await git(primaryRoot, ["rev-parse", "--show-toplevel"])) !== primaryRoot) {
    throw new Error("Git's common directory does not belong to a verified primary worktree.")
  }
  const primaryName = basename(primaryRoot)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(primaryName) || primaryName.includes("..")) {
    throw new Error("Primary checkout name is not suitable for an isolated sibling worktree directory.")
  }

  const requestedStart = input.startCommit ?? await git(currentRoot, ["rev-parse", "--verify", "HEAD^{commit}"])
  if (!/^[0-9a-fA-F]{40}$/.test(requestedStart) ||
      await git(currentRoot, ["cat-file", "-t", requestedStart]) !== "commit") {
    throw new Error("Requested worktree starting revision must be an existing commit.")
  }
  await git(currentRoot, ["check-ref-format", "--branch", branch])
  try {
    await git(currentRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
    throw new Error("Requested worktree branch already exists; no existing branch is modified.")
  } catch (error: any) {
    if (error?.message?.startsWith("Requested worktree branch already exists")) throw error
    if (error?.code !== 1) throw error
  }

  const siblingRoot = join(dirname(primaryRoot), primaryName + "-wt")
  const directory = await gitDirectoryExists(siblingRoot)
  if (!directory) {
    await mkdir(siblingRoot, { mode: 0o700 })
  } else if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error("Isolated worktree parent must be a real directory, not a symlink or file.")
  }
  if (await realpath(siblingRoot) !== siblingRoot) {
    throw new Error("Isolated worktree parent resolves outside the expected sibling directory.")
  }

  const target = join(siblingRoot, name)
  if (await gitDirectoryExists(target)) {
    throw new Error("Worktree target already exists; existing directories and worktrees are never overwritten.")
  }

  await git(currentRoot, [
    "worktree", "add", "--no-track", "-b", branch, target, requestedStart,
  ])
  if (await realpath(target) !== target ||
      await realpath(await git(target, ["rev-parse", "--show-toplevel"])) !== target ||
      await realpath(resolve(target, await git(target, ["rev-parse", "--git-common-dir"]))) !== commonRoot ||
      await git(target, ["rev-parse", "--abbrev-ref", "HEAD"]) !== branch ||
      await git(target, ["rev-parse", "--verify", "HEAD^{commit}"]) !== requestedStart) {
    throw new Error("Created worktree identity differs from the requested repository, branch or revision. Stop and inspect it.")
  }

  return {
    worktreePath: target,
    branch,
    startCommit: requestedStart,
    currentProjectRoot: currentRoot,
    primaryWorktreeRoot: primaryRoot,
    gitMetadataAccess: "git-owned-only",
    existingProjectSessionRebound: false,
  }
}
