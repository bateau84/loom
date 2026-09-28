import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

test("real OpenCode V2 exact tool terminal-call/quiescence observations", async () => {
  const tempRoot = join(import.meta.dir, ".tmp-opencode-host")
  await mkdir(tempRoot, { recursive: true })
  const testRoot = await mkdtemp(join(tempRoot, "lifecycle-only-"))
  const runner = fileURLToPath(new URL("./opencode-host-integration.ts", import.meta.url))
  try {
    const child = Bun.spawn([process.execPath, runner, "--lifecycle-only"], {
      env: { ...process.env, LOOM_OPENCODE_HOST_TEST_BASE: testRoot },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(exitCode, `Isolated OpenCode lifecycle integration failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0)
    expect(stdout).toContain("PASS isolated real OpenCode V2 exact-terminal-call probe")
    const observation = stdout.match(/OPEN_CODE_QUIESCENCE_OBSERVATION (\{[^\n]+\})/)
    expect(observation, stdout).not.toBeNull()
    const proof = JSON.parse(observation![1])
    expect(proof.blockedBeforeRelease).toBe(true)
    expect(proof.prematureIdleEvents).toBe(0)
    expect(proof.prematureTerminalEvents).toBe(0)
    expect(proof.terminalEvent).toBe("session.tool.success")
    expect(proof.terminalEventCount).toBe(1)
    expect(proof.persistedToolPartCount).toBe(1)
    expect(proof.persistedState).toBe("completed")
    expect(proof.executeAfterStatus).toBe("completed")
    console.log(stdout.trim())
  } finally {
    await rm(testRoot, { recursive: true, force: true })
  }
}, 180_000)
