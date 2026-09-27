import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createDiagnosticSandbox,
  destroyDiagnosticSandbox,
  diffDiagnosticSandbox,
  executeDiagnosticSandbox,
  type DiagnosticSandboxRecord,
} from "../plugins/loom/diagnostic-sandbox"

const image = process.argv[2] || process.env.OPENCODE_EVAL_RUNNER_OPENCODE_IMAGE
if (!image) throw new Error("Usage: bun scripts/verify-diagnostic-sandbox.ts <local-image>")

const root = await mkdtemp(join(tmpdir(), "loom-diagnostic-smoke-"))
const project = join(root, "project")
const runtimeRoot = join(root, "runtime")
let sandbox: DiagnosticSandboxRecord | undefined

try {
  await mkdir(project, { recursive: true })
  await writeFile(join(project, "state.txt"), "host-original\n")

  sandbox = await createDiagnosticSandbox({
    runtimeRoot,
    projectDirectory: project,
    projectId: "ci-diagnostic-project",
    sessionId: "ci-diagnostic-session",
    workflowId: "ci-diagnostic-workflow",
    stepId: "diagnostic",
    attempt: 0,
    image,
    network: "none",
    engine: "docker",
  })

  process.env.HTTP_PROXY = "http://user:secret@127.0.0.1:9"
  process.env.HTTPS_PROXY = "http://user:secret@127.0.0.1:9"
  process.env.ALL_PROXY = "socks5://user:secret@127.0.0.1:9"

  const result = await executeDiagnosticSandbox(sandbox, {
    command: [
      'test -z "${HTTP_PROXY:-}"',
      'test -z "${HTTPS_PROXY:-}"',
      'test -z "${ALL_PROXY:-}"',
      'test -z "${http_proxy:-}"',
      'test -z "${https_proxy:-}"',
      'test -z "${all_proxy:-}"',
      "git rev-parse --verify HEAD >/dev/null",
      "printf 'sandbox-mutated\\n' > state.txt",
      "printf 'container-proof\\n' > proof.txt",
      "if git add state.txt 2>/dev/null; then echo 'sandbox baseline became writable' >&2; exit 42; fi",
    ].join(" && "),
    timeoutSeconds: 30,
  })
  assert.equal(result.ok, true, result.stderr || result.cleanupError || "sandbox execution failed")

  assert.equal(await readFile(join(project, "state.txt"), "utf8"), "host-original\n")
  assert.equal(await readFile(join(sandbox.workspacePath, "state.txt"), "utf8"), "sandbox-mutated\n")
  assert.equal(await readFile(join(sandbox.workspacePath, "proof.txt"), "utf8"), "container-proof\n")

  const second = await executeDiagnosticSandbox(sandbox, {
    command: "grep -Fx 'sandbox-mutated' state.txt >/dev/null && printf 'second-experiment\\n' > second-proof.txt",
    timeoutSeconds: 30,
  })
  assert.equal(second.ok, true, second.stderr || second.cleanupError || "second sandbox execution failed")
  assert.equal(await readFile(join(project, "state.txt"), "utf8"), "host-original\n")
  assert.equal(await readFile(join(sandbox.workspacePath, "second-proof.txt"), "utf8"), "second-experiment\n")

  const diff = await diffDiagnosticSandbox(sandbox)
  assert.match(diff.status, /M state\.txt/)
  assert.match(diff.status, /\?\? proof\.txt/)

  const sandboxRoot = sandbox.rootPath
  await destroyDiagnosticSandbox(sandbox)
  await assert.rejects(stat(sandboxRoot))

  console.log("PASS Diagnostic sandbox real-container isolation")
} finally {
  if (sandbox?.active) {
    await destroyDiagnosticSandbox(sandbox).catch(() => undefined)
  }
  await rm(root, { recursive: true, force: true })
}
