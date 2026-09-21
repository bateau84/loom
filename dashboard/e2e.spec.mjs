import { test, expect } from "@playwright/test"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const repoRoot = resolve(import.meta.dirname, "..")
let root
let stateRoot
let runtimeRoot
let port
let server

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString()
}

function workflow({
  id,
  revision,
  digest,
  status,
  sessionId,
  activeAgent = "worker",
}) {
  return {
    workflowId: id,
    workflowRevision: revision,
    stateDigest: digest,
    anchor: `docs/anchors/${id}/anchor.md`,
    executionStage: `${activeAgent}:task:build`,
    status,
    currentSteps: [
      { id: "task:build", agent: activeAgent, kind: "work", status: "pending", label: "Build" },
    ],
    runnableSteps: [
      { id: "task:build", agent: activeAgent, kind: "work", status: "pending", label: "Build" },
    ],
    hierarchyProgress: {
      objective: { complete: 0, total: 1, active: 1 },
      phases: { complete: 0, total: 1, active: 1 },
      waves: { complete: 0, total: 1, active: 1 },
      tasks: { complete: 0, total: 1, active: 1 },
    },
    openOqCount: 1,
    openVerificationCount: 1,
    budget: { used: 2, limit: 40, exhausted: false },
    productAcceptance: { status: "unproven", passed: 0, failed: 0, unproven: 1 },
    knowledgeSync: { valid: true, updatedAt: iso(-1_000) },
    recentActivityAt: iso(-1_000),
    participatingSessionIds: [sessionId],
    activeAgent,
    activeSessionId: sessionId,
  }
}

function objective(id) {
  return {
    objectiveId: id,
    anchor: `docs/anchors/${id}/anchor.md`,
    title: "Shared task name",
    status: "active",
    workVersion: 3,
    generation: 1,
    stateDigest: `objective-${id}`,
    phases: [{
      phaseId: "phase-build",
      title: "Build",
      status: "active",
      waves: [{
        waveId: "wave-runtime",
        title: "Runtime",
        status: "active",
        tasks: [{
          taskId: "task-build",
          title: "Shared task name",
          status: "active",
        }],
      }],
    }],
  }
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const socket = createServer()
    socket.once("error", reject)
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address()
      if (!address || typeof address === "string") {
        socket.close()
        reject(new Error("No free dashboard test port"))
        return
      }
      socket.close((error) => error ? reject(error) : resolvePort(address.port))
    })
  })
}

async function writePublisher({
  instanceId,
  projectId,
  displayName,
  canonicalLocation,
  workflows,
  leaseExpiresAt = iso(60_000),
}) {
  const instanceRoot = join(runtimeRoot, "instances", "installation-e2e", instanceId)
  await mkdir(join(instanceRoot, "projects"), { recursive: true })
  const generatedAt = iso()
  await writeFile(
    join(instanceRoot, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      installationId: "installation-e2e",
      instanceId,
      processId: 1234,
      startedAt: iso(-10_000),
      generatedAt,
      leaseExpiresAt,
      projects: [projectId],
    }, null, 2),
  )
  await writeFile(
    join(instanceRoot, "projects", `${projectId}.json`),
    JSON.stringify({
      schemaVersion: 1,
      installationId: "installation-e2e",
      instanceId,
      projectId,
      generation: 1,
      generatedAt,
      leaseExpiresAt,
      project: { displayName, canonicalLocation },
      projectionWindow: {
        workflowsTruncated: false,
        completedObjectivesTruncated: false,
      },
      workObjectives: [objective(`objective-${projectId}`)],
      workflows,
    }, null, 2),
  )
}

async function seed() {
  await rm(runtimeRoot, { recursive: true, force: true })
  await mkdir(runtimeRoot, { recursive: true })

  await writePublisher({
    instanceId: "instance-a",
    projectId: "project-a",
    displayName: "Project A",
    canonicalLocation: "/work/project-a",
    workflows: [workflow({
      id: "workflow-a",
      revision: 4,
      digest: "digest-a",
      status: "active",
      sessionId: "session-a",
    })],
  })

  await writePublisher({
    instanceId: "instance-b1",
    projectId: "project-b",
    displayName: "Project B",
    canonicalLocation: "/work/project-b",
    workflows: [workflow({
      id: "workflow-b",
      revision: 7,
      digest: "digest-b1",
      status: "blocked",
      sessionId: "session-b",
      activeAgent: "reviewer",
    })],
  })
  await writePublisher({
    instanceId: "instance-b2",
    projectId: "project-b",
    displayName: "Project B",
    canonicalLocation: "/work/project-b",
    workflows: [workflow({
      id: "workflow-b",
      revision: 7,
      digest: "digest-b2",
      status: "blocked",
      sessionId: "session-b",
      activeAgent: "reviewer",
    })],
  })

  await writePublisher({
    instanceId: "instance-c",
    projectId: "project-c",
    displayName: "Project C",
    canonicalLocation: "/work/project-c",
    workflows: [workflow({
      id: "workflow-c",
      revision: 2,
      digest: "digest-c",
      status: "active",
      sessionId: "session-c",
    })],
    leaseExpiresAt: iso(-60_000),
  })
}

async function waitForServer() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error("Dashboard test server did not start")
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "loom-dashboard-browser-"))
  stateRoot = join(root, "state")
  runtimeRoot = join(root, "runtime")
  await mkdir(join(stateRoot, "loom"), { recursive: true })
  await writeFile(
    join(stateRoot, "loom", "runtime-root.json"),
    JSON.stringify({ schemaVersion: 1, runtimeRoot }, null, 2),
  )
  await seed()
  port = await freePort()
  server = spawn("bun", ["dashboard/server.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      XDG_STATE_HOME: stateRoot,
      LOOM_DASHBOARD_PORT: String(port),
    },
    stdio: "pipe",
  })
  await waitForServer()
})

test.beforeEach(async () => {
  await seed()
})

test.afterAll(async () => {
  if (server && !server.killed) server.kill("SIGTERM")
  await rm(root, { recursive: true, force: true })
})

test("keyboard drill-down and browser back preserve Fleet filters", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  await expect(page.getByText("consistency conflict", { exact: true })).toBeVisible()
  await expect(page.getByText("stale/offline", { exact: true })).toBeVisible()

  await page.locator("#status-filter").selectOption("active")
  await page.locator("#project-filter").fill("Project A")

  const card = page.locator('a[data-key="project-a:workflow-a"]')
  await expect(card).toBeVisible()
  await card.focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/#\/project\/project-a\/workflow\/workflow-a$/)
  await expect(page.getByText("OpenCode sessions", { exact: true })).toBeVisible()

  const session = page.locator('a[data-key="session:session-a"]')
  await session.focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/session\/session-a$/)
  await expect(page.getByText("OpenCode session", { exact: true })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/workflow\/workflow-a$/)
  await page.goBack()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.locator("#status-filter")).toHaveValue("active")
  await expect(page.locator("#project-filter")).toHaveValue("Project A")
})

test("background refresh preserves focus and disappearance has predictable fallback", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  const card = page.locator('a[data-key="project-a:workflow-a"]')
  await card.focus()
  await expect(card).toBeFocused()

  await page.waitForTimeout(3_400)
  await expect(card).toBeFocused()

  const snapshotPath = join(
    runtimeRoot,
    "instances",
    "installation-e2e",
    "instance-a",
    "projects",
    "project-a.json",
  )
  const snapshot = JSON.parse(await (await import("node:fs/promises")).readFile(snapshotPath, "utf8"))
  snapshot.workflows = []
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2))

  await page.waitForTimeout(3_400)
  await expect(page.locator("#live")).toContainText("previously focused item is no longer available")
  const activeId = await page.evaluate(() => document.activeElement?.id)
  expect(["status-filter", "project-filter"]).toContain(activeId)
})

test("narrow layout keeps identity and status usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto(`http://127.0.0.1:${port}/`)

  await expect(page.getByText("Project A", { exact: false })).toBeVisible()
  await expect(page.getByText("consistency conflict", { exact: true })).toBeVisible()
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth)
})

test("dashboard HTTP observation surface remains read-only in the real server", async ({ request }) => {
  const response = await request.post(`http://127.0.0.1:${port}/api/fleet`, {
    data: { mutate: true },
  })
  expect(response.status()).toBe(405)
  expect(response.headers().allow).toBe("GET")
})
