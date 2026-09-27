import { afterEach, describe, expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import {
  allocateDiagnosticSandbox,
  assertDiagnosticSandboxImageAvailable,
  createDiagnosticSandbox,
  destroyDiagnosticSandbox,
  diagnosticSandboxContainerArgs,
  diagnosticSandboxContainerName,
  diffDiagnosticSandbox,
  materializeDiagnosticSandbox,
  normalizeDiagnosticSandboxTimeout,
  resolveDiagnosticSandboxImage,
  resolveDiagnosticSandboxRuntime,
  validateDiagnosticSandboxCommand,
  validateDiagnosticSandboxImage,
} from "./diagnostic-sandbox"

const execFileAsync = promisify(execFile)
const roots: string[] = []

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), "loom-diagnostic-sandbox-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true }).catch(() => undefined),
  ))
})

describe("Diagnostic sandbox", () => {
  test("copies the working directory without host Git/Loom metadata and keeps experiments isolated", async () => {
    const root = await tempRoot()
    const project = join(root, "project")
    const runtimeRoot = join(root, "runtime")
    await mkdir(join(project, "src"), { recursive: true })
    await mkdir(join(project, ".git"), { recursive: true })
    await mkdir(join(project, ".loom"), { recursive: true })
    await mkdir(join(project, "cache"), { recursive: true })
    await writeFile(join(project, ".gitignore"), "cache/**\n")
    await writeFile(join(project, "cache", "state.db"), "cached-before\n")
    await writeFile(join(project, "src", "value.txt"), "before\n")
    await writeFile(join(project, ".git", "host-secret"), "do-not-copy\n")
    await writeFile(join(project, ".loom", "project-id"), "host-project\n")
    await writeFile(join(project, ".loom", "diagnostic-fixture.json"), "{\"relevant\":true}\n")

    const sandbox = await createDiagnosticSandbox({
      runtimeRoot,
      projectDirectory: project,
      projectId: "project-1",
      sessionId: "session-1",
      workflowId: "workflow-1",
      stepId: "diagnostic",
      attempt: 0,
      image: "docker.io/library/alpine:3.22",
      imageId: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      network: "host",
      engine: "podman",
    })

    expect(await readFile(join(sandbox.workspacePath, "src", "value.txt"), "utf8")).toBe("before\n")
    await expect(stat(join(sandbox.workspacePath, ".git", "host-secret"))).rejects.toThrow()
    await expect(stat(join(sandbox.workspacePath, ".git"))).rejects.toThrow()
    await expect(stat(join(sandbox.workspacePath, ".loom", "project-id"))).rejects.toThrow()
    expect(await readFile(join(sandbox.workspacePath, ".loom", "diagnostic-fixture.json"), "utf8")).toBe("{\"relevant\":true}\n")
    expect((await stat(sandbox.baselineGitPath)).isDirectory()).toBe(true)

    await writeFile(join(sandbox.workspacePath, "src", "value.txt"), "experiment\n")
    await writeFile(join(sandbox.workspacePath, "cache", "state.db"), "cached-after\n")
    await writeFile(join(sandbox.workspacePath, "cache", "new-state.db"), "new-cache\n")
    await writeFile(join(sandbox.workspacePath, "new-evidence.txt"), "new\n")

    const diff = await diffDiagnosticSandbox(sandbox)
    expect(diff.imageId).toBe(sandbox.imageId)
    expect(diff.snapshotDigest === sandbox.snapshotDigest).toBe(true)
    expect(diff.status).toContain("M src/value.txt")
    expect(diff.status).toContain("M cache/state.db")
    expect(diff.status).toContain("!! cache/new-state.db")
    expect(diff.status).toContain("?? new-evidence.txt")
    expect(await readFile(join(project, "src", "value.txt"), "utf8")).toBe("before\n")

    await destroyDiagnosticSandbox(sandbox)
    await expect(stat(sandbox.rootPath)).rejects.toThrow()
  })

  test("baseline Git ignores host config, templates, hooks, and filters", async () => {
    const root = await tempRoot()
    const project = join(root, "project")
    const runtimeRoot = join(root, "runtime")
    const template = join(root, "host-template")
    const hookProof = join(root, "host-hook-ran")
    const filterProof = join(root, "host-filter-ran")
    const filterScript = join(root, "host-filter.sh")
    const hostConfig = join(root, "host-gitconfig")

    await mkdir(join(project, "src"), { recursive: true })
    await mkdir(join(template, "hooks"), { recursive: true })
    await writeFile(join(project, ".gitattributes"), "*.txt filter=host-probe\n")
    await writeFile(join(project, "src", "value.txt"), "before\n")
    await writeFile(
      join(template, "hooks", "post-commit"),
      `#!/bin/sh\nprintf 'hook-ran\\n' > "${hookProof}"\n`,
      { mode: 0o755 },
    )
    await writeFile(
      filterScript,
      `#!/bin/sh\nprintf 'filter-ran\\n' > "${filterProof}"\ncat\n`,
      { mode: 0o755 },
    )
    await writeFile(
      hostConfig,
      [
        "[init]",
        `  templateDir = ${template}`,
        '[filter "host-probe"]',
        `  clean = ${filterScript}`,
        "  required = true",
        "",
      ].join("\n"),
    )

    const previousGlobal = process.env.GIT_CONFIG_GLOBAL
    process.env.GIT_CONFIG_GLOBAL = hostConfig
    try {
      await createDiagnosticSandbox({
        runtimeRoot,
        projectDirectory: project,
        projectId: "project-1",
        sessionId: "session-1",
        workflowId: "workflow-1",
        stepId: "diagnostic",
        attempt: 0,
        image: "local/toolchain:test",
        imageId: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        network: "none",
        engine: "podman",
      })
    } finally {
      if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = previousGlobal
    }

    await expect(stat(hookProof)).rejects.toThrow()
    await expect(stat(filterProof)).rejects.toThrow()
  })

  test("preregistered sandbox cleanup does not require a container engine", async () => {
    const root = await tempRoot()
    const record = allocateDiagnosticSandbox({
      runtimeRoot: join(root, "runtime"),
      projectId: "project-1",
      sessionId: "session-1",
      workflowId: "workflow-1",
      stepId: "diagnostic",
      attempt: 0,
      image: "local/toolchain:test",
      imageId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      network: "none",
      engine: "docker",
      id: "66666666-6666-4666-8666-666666666666",
      now: "2026-09-27T00:00:00.000Z",
    })
    expect(record.materialized).toBe(false)
    await expect(stat(record.rootPath)).rejects.toThrow()

    const calls: Array<{ file: string; args: string[] }> = []
    await destroyDiagnosticSandbox(
      record,
      "2026-09-27T00:01:00.000Z",
      async (file, args) => {
        calls.push({ file, args })
        throw new Error("container engine must not be needed")
      },
    )

    expect(calls).toHaveLength(0)
    expect(record.active).toBe(false)
    await expect(stat(record.rootPath)).rejects.toThrow()
  })

  test("materialization turns a preregistered sandbox into an executable sandbox", async () => {
    const root = await tempRoot()
    const project = join(root, "project")
    await mkdir(project, { recursive: true })
    await writeFile(join(project, "state.txt"), "before\n")
    const record = allocateDiagnosticSandbox({
      runtimeRoot: join(root, "runtime"),
      projectId: "project-1",
      sessionId: "session-1",
      workflowId: "workflow-1",
      stepId: "diagnostic",
      attempt: 0,
      image: "local/toolchain:test",
      imageId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      network: "none",
      engine: "docker",
      id: "99999999-9999-4999-8999-999999999999",
      now: "2026-09-27T00:00:00.000Z",
    })

    await materializeDiagnosticSandbox(record, project)
    expect(record.materialized).toBe(true)
    expect(record.materializedAt).toBeDefined()
    expect(record.snapshotTree).toMatch(/^[0-9a-f]{40,64}$/)
    expect(record.snapshotDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(await readFile(join(record.workspacePath, "state.txt"), "utf8")).toBe("before\n")
  })

  test("rejects a torn snapshot when the source changes during capture", async () => {
    const root = await tempRoot()
    const project = join(root, "project")
    await mkdir(project, { recursive: true })
    await writeFile(join(project, "state.txt"), "before\n")
    const record = allocateDiagnosticSandbox({
      runtimeRoot: join(root, "runtime"),
      projectId: "project-1",
      sessionId: "session-1",
      workflowId: "workflow-1",
      stepId: "diagnostic",
      attempt: 0,
      image: "local/toolchain:test",
      imageId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      network: "none",
      engine: "docker",
      id: "12121212-1212-4212-8212-121212121212",
      now: "2026-09-27T00:00:00.000Z",
    })

    let mutated = false
    const run = async (file: string, args: string[], options?: any) => {
      const result = await execFileAsync(file, args, options)
      if (!mutated && file === "git" && args.includes("commit")) {
        mutated = true
        await writeFile(join(project, "state.txt"), "after\n")
      }
      return result
    }

    await expect(
      materializeDiagnosticSandbox(record, project, run as any),
    ).rejects.toThrow("changed while")
    expect(record.materialized).toBe(false)
    expect(record.snapshotTree).toBeUndefined()
    expect(record.snapshotDigest).toBeUndefined()
    await expect(stat(record.rootPath)).rejects.toThrow()
  })

  test("rejects raw byte drift that Git text normalization would consider clean", async () => {
    const root = await tempRoot()
    const project = join(root, "project")
    await mkdir(project, { recursive: true })
    await writeFile(join(project, ".gitattributes"), "*.txt text\n")
    await writeFile(join(project, "state.txt"), "a\r\nb\n")
    const record = allocateDiagnosticSandbox({
      runtimeRoot: join(root, "runtime"),
      projectId: "project-1",
      sessionId: "session-1",
      workflowId: "workflow-1",
      stepId: "diagnostic",
      attempt: 0,
      image: "local/toolchain:test",
      imageId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      network: "none",
      engine: "docker",
      id: "13131313-1313-4313-8313-131313131313",
      now: "2026-09-27T00:00:00.000Z",
    })

    let mutated = false
    const run = async (file: string, args: string[], options?: any) => {
      const result = await execFileAsync(file, args, options)
      if (!mutated && file === "git" && args.includes("commit")) {
        mutated = true
        // Same size and same Git-clean normalized content, different raw bytes.
        await writeFile(join(project, "state.txt"), "a\nb\r\n")
      }
      return result
    }

    await expect(
      materializeDiagnosticSandbox(record, project, run as any),
    ).rejects.toThrow("bytes changed while")
    expect(record.materialized).toBe(false)
    expect(record.snapshotDigest).toBeUndefined()
    await expect(stat(record.rootPath)).rejects.toThrow()
  })

  test("raw diff change signal survives Git text normalization", async () => {
    const root = await tempRoot()
    const project = join(root, "project")
    const runtimeRoot = join(root, "runtime")
    await mkdir(project, { recursive: true })
    await writeFile(join(project, ".gitattributes"), "*.txt text\n")
    await writeFile(join(project, "state.txt"), "a\r\nb\n")

    const sandbox = await createDiagnosticSandbox({
      runtimeRoot,
      projectDirectory: project,
      projectId: "project-raw-diff",
      sessionId: "session-raw-diff",
      workflowId: "workflow-raw-diff",
      stepId: "diagnostic",
      attempt: 0,
      image: "local/toolchain:test",
      imageId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      network: "none",
      engine: "docker",
    })

    // Same Git-normalized text, different raw bytes.
    await writeFile(join(sandbox.workspacePath, "state.txt"), "a\nb\r\n")
    const diff = await diffDiagnosticSandbox(sandbox)

    expect(diff.status).not.toContain("state.txt")
    expect(diff.rawChanged).toBe(true)
    expect(diff.workspaceDigest === diff.snapshotDigest).toBe(false)
  })

  test("container execution mounts only the sandbox copy read-write and supports explicit host networking", () => {
    const sandbox = {
      schemaVersion: 1 as const,
      id: "11111111-1111-4111-8111-111111111111",
      sessionId: "session",
      workflowId: "workflow",
      stepId: "diagnostic",
      attempt: 0,
      projectId: "project",
      rootPath: "/runtime/diagnostic-sandboxes/project/id",
      workspacePath: "/runtime/diagnostic-sandboxes/project/id/workspace",
      baselineGitPath: "/runtime/diagnostic-sandboxes/project/id/baseline.git",
      image: "docker.io/library/golang:1.25",
      imageId: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      engine: "podman" as const,
      network: "host" as const,
      createdAt: "2026-09-27T00:00:00.000Z",
      materialized: true,
      snapshotTree: "1111111111111111111111111111111111111111",
      snapshotDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      active: true,
    }

    const { name, args } = diagnosticSandboxContainerArgs(
      sandbox,
      "go test ./...",
    )

    expect(name).toBe(diagnosticSandboxContainerName(sandbox))
    expect(args).toContain("--pull=never")
    expect(args).toContain("--network=host")
    expect(args).toContain("--cap-drop=ALL")
    expect(args).toContain("--security-opt=no-new-privileges")
    expect(args).toContain("--read-only")
    expect(args).toContain("--pids-limit=512")
    expect(args).toContain("type=bind,src=/runtime/diagnostic-sandboxes/project/id/workspace,dst=/workspace,relabel=private")
    expect(args).toContain("type=bind,src=/runtime/diagnostic-sandboxes/project/id/baseline.git,dst=/diagnostic-git,ro,relabel=private")
    expect(args).not.toContain("/real/project")
    expect(args).toContain("HOME=/tmp")
    expect(args).toContain("GIT_DIR=/diagnostic-git")
    expect(args).toContain("GIT_WORK_TREE=/workspace")
    expect(args).toContain("GIT_OPTIONAL_LOCKS=0")
    expect(args).toContain("--http-proxy=false")
    const dockerArgs = diagnosticSandboxContainerArgs(
      { ...sandbox, engine: "docker" as const },
      "go test ./...",
    ).args
    expect(dockerArgs).toContain(
      "type=bind,src=/runtime/diagnostic-sandboxes/project/id/workspace,dst=/workspace",
    )
    expect(dockerArgs).not.toContain(
      "type=bind,src=/runtime/diagnostic-sandboxes/project/id/workspace,dst=/workspace,relabel=private",
    )
    for (const name of [
      "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
      "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    ]) {
      expect(args).toContain(`${name}=`)
    }
    expect(args).toContain("--entrypoint=sh")
    expect(args).toContain("go test ./...")
    expect(args).toContain(sandbox.imageId)
    expect(args).not.toContain(sandbox.image)
    expect(args[args.indexOf(sandbox.imageId) + 1]).toBe("-lc")
  })

  test("resolves mutable image references to immutable local image IDs", async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const run = async (file: string, args: string[]) => {
      calls.push({ file, args })
      return {
        stdout: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n",
        stderr: "",
      }
    }
    await expect(resolveDiagnosticSandboxImage(
      "docker",
      "local/toolchain:latest",
      run,
    )).resolves.toEqual({
      reference: "local/toolchain:latest",
      id: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    })
    expect(calls).toEqual([{
      file: "docker",
      args: ["image", "inspect", "--format", "{{.Id}}", "local/toolchain:latest"],
    }])
  })

  test("falls back to Docker when Podman exists but does not have the requested image", async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const imageId = "sha256:abababababababababababababababababababababababababababababababab"
    const run = async (file: string, args: string[]) => {
      calls.push({ file, args })
      if (args[0] === "version") return { stdout: "", stderr: "" }
      if (file === "podman") throw new Error("image not known")
      return { stdout: imageId + "\n", stderr: "" }
    }

    await expect(resolveDiagnosticSandboxRuntime(
      "local/toolchain:test",
      run,
    )).resolves.toEqual({
      engine: "docker",
      reference: "local/toolchain:test",
      id: imageId,
    })

    expect(calls).toEqual([
      { file: "podman", args: ["version"] },
      {
        file: "podman",
        args: ["image", "inspect", "--format", "{{.Id}}", "local/toolchain:test"],
      },
      { file: "docker", args: ["version"] },
      {
        file: "docker",
        args: ["image", "inspect", "--format", "{{.Id}}", "local/toolchain:test"],
      },
    ])
  })

  test("checks local image availability without pulling", async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const unavailable = async (file: string, args: string[]) => {
      calls.push({ file, args })
      throw new Error("missing")
    }

    await expect(assertDiagnosticSandboxImageAvailable(
      "docker",
      "local/toolchain:missing",
      unavailable,
    )).rejects.toThrow("will not pull")
    expect(calls).toEqual([{
      file: "docker",
      args: ["image", "inspect", "local/toolchain:missing"],
    }])

    calls.length = 0
    const available = async (file: string, args: string[]) => {
      calls.push({ file, args })
      return { stdout: "", stderr: "" }
    }
    await expect(assertDiagnosticSandboxImageAvailable(
      "podman",
      "local/toolchain:ready",
      available,
    )).resolves.toBe("local/toolchain:ready")
    expect(calls).toEqual([{
      file: "podman",
      args: ["image", "exists", "local/toolchain:ready"],
    }])
  })

  test("rejects an invalid image before copying any project bytes", async () => {
    const root = await tempRoot()
    const project = join(root, "project")
    const runtimeRoot = join(root, "runtime")
    await mkdir(project, { recursive: true })
    await writeFile(join(project, "secret.env"), "TOKEN=secret\n")

    await expect(createDiagnosticSandbox({
      runtimeRoot,
      projectDirectory: project,
      projectId: "project-1",
      sessionId: "session-1",
      workflowId: "workflow-1",
      stepId: "diagnostic",
      attempt: 0,
      image: "--privileged",
      imageId: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      network: "none",
      engine: "podman",
    })).rejects.toThrow("image")

    await expect(stat(runtimeRoot)).rejects.toThrow()
  })

  test("destroy stops the deterministic container before deleting sandbox bytes", async () => {
    const root = await tempRoot()
    const sandboxRoot = join(root, "sandbox")
    const workspacePath = join(sandboxRoot, "workspace")
    await mkdir(workspacePath, { recursive: true })
    await writeFile(join(workspacePath, "state.txt"), "experiment\n")

    const sandbox = {
      schemaVersion: 1 as const,
      id: "33333333-3333-4333-8333-333333333333",
      sessionId: "session",
      workflowId: "workflow",
      stepId: "diagnostic",
      attempt: 0,
      projectId: "project",
      rootPath: sandboxRoot,
      workspacePath,
      baselineGitPath: join(sandboxRoot, "baseline.git"),
      image: "local/toolchain:test",
      imageId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      engine: "podman" as const,
      network: "host" as const,
      createdAt: "2026-09-27T00:00:00.000Z",
      materialized: true,
      active: true,
    }
    const calls: Array<{ file: string; args: string[] }> = []
    const run = async (file: string, args: string[]) => {
      calls.push({ file, args })
      return { stdout: "", stderr: "" }
    }

    await destroyDiagnosticSandbox(
      sandbox,
      "2026-09-27T01:00:00.000Z",
      run,
    )

    expect(calls[0]).toEqual({
      file: "podman",
      args: ["rm", "-f", diagnosticSandboxContainerName(sandbox)],
    })
    expect(sandbox.active).toBe(false)
    await expect(stat(sandboxRoot)).rejects.toThrow()
  })

  test("destroy fails closed when the container engine cannot terminate execution", async () => {
    const root = await tempRoot()
    const sandboxRoot = join(root, "sandbox")
    const workspacePath = join(sandboxRoot, "workspace")
    await mkdir(workspacePath, { recursive: true })
    await writeFile(join(workspacePath, "state.txt"), "experiment\n")

    const sandbox = {
      schemaVersion: 1 as const,
      id: "44444444-4444-4444-8444-444444444444",
      sessionId: "session",
      workflowId: "workflow",
      stepId: "diagnostic",
      attempt: 0,
      projectId: "project",
      rootPath: sandboxRoot,
      workspacePath,
      baselineGitPath: join(sandboxRoot, "baseline.git"),
      image: "local/toolchain:test",
      imageId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      engine: "docker" as const,
      network: "host" as const,
      createdAt: "2026-09-27T00:00:00.000Z",
      materialized: true,
      active: true,
    }
    const run = async () => {
      const error: any = new Error("Cannot connect to the Docker daemon")
      error.stderr = "Cannot connect to the Docker daemon"
      throw error
    }

    await expect(destroyDiagnosticSandbox(
      sandbox,
      "2026-09-27T01:00:00.000Z",
      run,
    )).rejects.toThrow("Docker daemon")

    expect(sandbox.active).toBe(true)
    expect(await readFile(join(workspacePath, "state.txt"), "utf8")).toBe("experiment\n")
  })

  test("destroy tolerates a container that already exited and was removed", async () => {
    const root = await tempRoot()
    const sandboxRoot = join(root, "sandbox")
    const workspacePath = join(sandboxRoot, "workspace")
    await mkdir(workspacePath, { recursive: true })

    const sandbox = {
      schemaVersion: 1 as const,
      id: "55555555-5555-4555-8555-555555555555",
      sessionId: "session",
      workflowId: "workflow",
      stepId: "diagnostic",
      attempt: 0,
      projectId: "project",
      rootPath: sandboxRoot,
      workspacePath,
      baselineGitPath: join(sandboxRoot, "baseline.git"),
      image: "local/toolchain:test",
      imageId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      engine: "podman" as const,
      network: "none" as const,
      createdAt: "2026-09-27T00:00:00.000Z",
      materialized: true,
      active: true,
    }
    const run = async () => {
      const error: any = new Error("no container with name or ID found: no such container")
      error.stderr = "no container with name or ID found: no such container"
      throw error
    }

    await destroyDiagnosticSandbox(
      sandbox,
      "2026-09-27T01:00:00.000Z",
      run,
    )

    expect(sandbox.active).toBe(false)
    await expect(stat(sandboxRoot)).rejects.toThrow()
  })

  test("validates bounded image, command, and timeout inputs", () => {
    expect(validateDiagnosticSandboxImage("ghcr.io/example/tool:1")).toBe("ghcr.io/example/tool:1")
    expect(() => validateDiagnosticSandboxImage("--privileged")).toThrow()
    expect(() => validateDiagnosticSandboxImage("image with spaces")).toThrow()

    expect(validateDiagnosticSandboxCommand("go test ./...")).toBe("go test ./...")
    expect(() => validateDiagnosticSandboxCommand("   ")).toThrow()

    expect(normalizeDiagnosticSandboxTimeout()).toBe(120)
    expect(normalizeDiagnosticSandboxTimeout(600)).toBe(600)
    expect(() => normalizeDiagnosticSandboxTimeout(0)).toThrow()
    expect(() => normalizeDiagnosticSandboxTimeout(601)).toThrow()
  })
})
