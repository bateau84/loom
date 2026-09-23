import { test, expect } from "@playwright/test"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
  budgetExhausted = false,
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
    budget: { used: 2, limit: 40, exhausted: budgetExhausted },
    productAcceptance: { status: "unproven", passed: 0, failed: 0, unproven: 1 },
    knowledgeSync: { valid: true, updatedAt: iso(-1_000) },
    recentActivityAt: iso(-1_000),
    participatingSessionIds: [sessionId],
    activeAgent,
    activeSessionId: sessionId,
  }
}

function objective(id, claimedByWorkflowId) {
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
          claimedByWorkflowId,
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
      workObjectives: [objective(`objective-${projectId}`, workflows[0]?.workflowId)],
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
      budgetExhausted: true,
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

test("dashboard child process publishes its effective endpoint lease", async () => {
  const record = JSON.parse(
    await readFile(join(stateRoot, "loom", "dashboard-endpoint.json"), "utf8"),
  )
  expect(record).toMatchObject({
    schemaVersion: 1,
    baseUrl: `http://127.0.0.1:${port}`,
  })
  expect(Date.parse(record.leaseExpiresAt)).toBeGreaterThan(Date.now())
})

test("workflow deep link survives projection lag and opens when the project/workflow appears", async ({ page }) => {
  await rm(
    join(runtimeRoot, "instances", "installation-e2e", "instance-a"),
    { recursive: true, force: true },
  )

  const url = `http://127.0.0.1:${port}/#/project/project-a/workflow/workflow-a`
  await page.goto(url)
  await expect(page.getByText("Waiting for Loom projection…", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#\/project\/project-a\/workflow\/workflow-a$/)

  // Multiple successful reads of the same lagging projection must not be
  // interpreted as proof that the requested authoritative workflow vanished.
  await page.waitForTimeout(6_400)
  await expect(page.getByText("Waiting for Loom projection…", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/#\/project\/project-a\/workflow\/workflow-a$/)

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

  await page.waitForTimeout(3_400)
  await expect(page).toHaveURL(/#\/project\/project-a\/workflow\/workflow-a$/)
  await expect(page.getByText("Workflow workflow-a", { exact: false })).toBeVisible()
})

test("keyboard drill-down and browser back preserve Fleet filters", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  await expect(page.getByText("consistency conflict", { exact: true })).toBeVisible()
  await expect(page.getByText("stale/offline", { exact: true })).toBeVisible()
  await expect(page.getByText("budget exhausted", { exact: true })).toBeVisible()

  const card = page.locator('a[data-key="project-a:workflow-a"]')
  await expect(card).toContainText("Tasks complete")
  await expect(card).toContainText("0/1")
  await expect(card).toContainText("2/40")

  await page.locator("#status-filter").selectOption("active")
  await page.locator("#project-filter").fill("Project A")
  await page.locator("#agent-filter").fill("worker")

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
  await expect(page).toHaveURL(`http://127.0.0.1:${port}/#/?status=active&project=Project+A&agent=worker`)
  await expect(card).toBeFocused()
  await expect(page.locator("#status-filter")).toHaveValue("active")
  await expect(page.locator("#project-filter")).toHaveValue("Project A")
  await expect(page.locator("#agent-filter")).toHaveValue("worker")

  await page.locator("#project-filter").fill("No such project")
  await expect(page.getByText("No workflows match the current filters.", { exact: true })).toBeVisible()
})

test("stable workflow dashboard deep link opens the requested workflow directly", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/#/project/project-a/workflow/workflow-a`)
  await expect(page).toHaveURL(/#\/project\/project-a\/workflow\/workflow-a$/)
  await expect(page.getByText("Workflow workflow-a", { exact: false })).toBeVisible()
  await expect(page.getByText("OpenCode sessions", { exact: true })).toBeVisible()
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
  const focus = await page.evaluate(() => ({
    id: document.activeElement?.id || "",
    key: document.activeElement?.dataset?.key || "",
  }))
  expect(
    focus.key === "project-b:workflow-b" ||
    ["status-filter", "project-filter", "agent-filter"].includes(focus.id),
  ).toBe(true)
})

test("project hierarchy exposes active workflow claims", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/#/project/project-a`)
  await expect(page.getByText("Objective → Phase → Wave → Task", { exact: true })).toBeVisible()
  await expect(page.getByText(/claimed by workflow-a/)).toBeVisible()
})

test("project hierarchy preserves manual expansion state across background refresh", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/#/project/project-a`)
  const wave = page.locator('details[data-hierarchy-key="project:project-a:objective:objective-project-a:phase:phase-build:wave:wave-runtime"]')
  await expect(wave).toHaveAttribute("open", "")

  const summary = wave.locator("summary")
  await summary.click()
  await expect(wave).not.toHaveAttribute("open", "")
  await summary.focus()
  await expect(summary).toBeFocused()

  await page.waitForTimeout(3_400)
  await expect(wave).not.toHaveAttribute("open", "")
  await expect(summary).toBeFocused()
})

test("refresh failure keeps last known Fleet visible and marks projection degradation", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  const card = page.locator('a[data-key="project-a:workflow-a"]')
  await expect(card).toBeVisible()

  await page.route("**/api/fleet", async (route) => {
    await route.fulfill({ status: 503, body: "projection unavailable" })
  })
  await page.waitForTimeout(3_400)

  await expect(page.locator("#projection-status")).toBeVisible()
  await expect(page.locator("#projection-status")).toContainText("Showing the last known Loom projection")
  await expect(card).toBeVisible()
})

test("narrow layout keeps identity and status usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto(`http://127.0.0.1:${port}/`)

  await expect(page.locator('a[data-key="project-a:workflow-a"]')).toContainText("Project A")
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

// Redesign regressions use the real dashboard server and aggregation above.
// Only transport failure/degraded-data tests explicitly intercept the API.
async function editSnapshot(instanceId, projectId, change) {
  const path = join(runtimeRoot, "instances", "installation-e2e", instanceId, "projects", `${projectId}.json`)
  const snapshot = JSON.parse(await readFile(path, "utf8"))
  change(snapshot)
  snapshot.generation += 1
  snapshot.generatedAt = iso()
  await writeFile(path, JSON.stringify(snapshot, null, 2))
}

const aCard = 'a[data-key="project-a:workflow-a"]'
const aWorkflowUrl = () => `http://127.0.0.1:${port}/#/project/project-a/workflow/workflow-a`

test("Fleet triages conflicts and open boundaries, with reloadable filters and clear recovery", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  await expect(page.locator(".workflow").first()).toHaveAttribute("data-key", "project-b:workflow-b")
  await expect(page.locator('button[data-status="attention"] strong')).toHaveText("3")
  await page.locator("#status-filter").selectOption("attention")
  // Active work with an OQ/verification item must not disappear from attention.
  await expect(page.locator(aCard)).toBeVisible()
  await page.locator("#project-filter").fill("/work/project-a")
  await page.locator("#agent-filter").fill("worker")
  await expect(page.locator(".workflow")).toHaveCount(1)
  const filteredUrl = page.url()
  await page.reload()
  await expect(page).toHaveURL(filteredUrl)
  await expect(page.locator("#project-filter")).toHaveValue("/work/project-a")
  await expect(page.locator("#agent-filter")).toHaveValue("worker")
  await expect(page.locator(".workflow")).toHaveCount(1)
  await page.locator("#project-filter").fill("missing project")
  await page.locator("[data-clear-filters]").click()
  await expect(page.locator(".workflow")).toHaveCount(3)
  await expect(page.locator("#status-filter")).toBeFocused()
})

test("workflow title uses an explicit matching objective generation, never an unrelated title", async ({ page }) => {
  await editSnapshot("instance-a", "project-a", (snapshot) => {
    snapshot.workflows[0].workScope = { objectiveId: "objective-project-a", generation: 1 }
  })
  await page.goto(aWorkflowUrl())
  await expect(page.locator("#view-title")).toHaveText("Shared task name")
  await editSnapshot("instance-a", "project-a", (snapshot) => {
    snapshot.workObjectives[0].generation = 2
    snapshot.workObjectives[0].workVersion += 1
    snapshot.workObjectives[0].stateDigest = "new-objective-generation"
    snapshot.workObjectives[0].title = "Unrelated new generation"
  })
  await page.locator("#refresh").click()
  await expect(page.locator("#view-title")).toHaveText("workflow-a")
  await expect(page.locator("#page-heading")).toContainText("docs/anchors/workflow-a/anchor.md")
})

test("sessions stay secondary and expanded state and focus survive a changed revision", async ({ page }) => {
  await editSnapshot("instance-a", "project-a", (snapshot) => {
    snapshot.workflows[0].participatingSessionIds = ["session-a", "session-a2", "session-a3"]
  })
  await page.goto(aWorkflowUrl())
  const extra = page.locator('a[data-key="session:session-a2"]')
  await expect(page.getByText("Active session", { exact: true })).toBeVisible()
  await expect(extra).toBeHidden()
  const details = page.locator('details[data-hierarchy-key="sessions:project-a:workflow-a"]')
  const summary = details.locator("summary")
  await summary.focus()
  await page.keyboard.press("Enter")
  await expect(extra).toBeVisible()
  await editSnapshot("instance-a", "project-a", (snapshot) => {
    snapshot.workflows[0].workflowRevision = 5
    snapshot.workflows[0].stateDigest = "digest-a-5"
  })
  await expect(page.locator("#page-heading")).toContainText("revision 5", { timeout: 7_000 })
  await expect(details).toHaveAttribute("open", "")
  await expect(summary).toBeFocused()
  await expect(page.getByText("Counts are signals, not causal explanations.", { exact: false })).toBeVisible()
})

test("pausing display rejects an in-flight automatic read but permits explicit refresh", async ({ page }) => {
  await page.goto(aWorkflowUrl())
  await expect(page.locator("#page-heading")).toContainText("revision 4")
  let release
  let intercepted = false
  const held = new Promise((resolveHeld) => { release = resolveHeld })
  await page.route("**/api/fleet", async (route) => {
    intercepted = true
    await held
    await route.continue()
  })
  await expect.poll(() => intercepted, { timeout: 7_000 }).toBe(true)
  await page.locator("#pause").click()
  await editSnapshot("instance-a", "project-a", (snapshot) => {
    snapshot.workflows[0].workflowRevision = 5
    snapshot.workflows[0].stateDigest = "digest-a-5"
  })
  release()
  await expect(page.locator("#refresh")).toBeEnabled()
  await page.unroute("**/api/fleet")
  await expect(page.locator("#page-heading")).toContainText("revision 4")
  await page.waitForTimeout(3_400)
  await expect(page.locator("#page-heading")).toContainText("revision 4")
  await page.locator("#refresh").click()
  await expect(page.locator("#page-heading")).toContainText("revision 5")
  await expect(page.locator("#pause")).toHaveAttribute("aria-pressed", "true")
  await editSnapshot("instance-a", "project-a", (snapshot) => {
    snapshot.workflows[0].workflowRevision = 6
    snapshot.workflows[0].stateDigest = "digest-a-6"
  })
  await page.locator("#pause").click()
  await expect(page.locator("#page-heading")).toContainText("revision 6")
  await expect(page.locator("#pause")).toHaveAttribute("aria-pressed", "false")
})

test("consistency conflict withholds progress and current work including session membership", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/#/project/project-b/workflow/workflow-b`)
  await expect(page.locator("#main")).toContainText("No winner is selected")
  await expect(page.locator("#main")).toContainText("digest-b1")
  await expect(page.locator("#main")).toContainText("digest-b2")
  await expect(page.getByRole("heading", { name: "Current work", exact: true })).toHaveCount(0)
  await expect(page.locator("progress, meter")).toHaveCount(0)
  await page.goto(`http://127.0.0.1:${port}/#/project/project-b/workflow/workflow-b/session/session-b`)
  await expect(page.locator("#main")).toContainText("Session membership unresolved")
  await expect(page.locator("#main")).toContainText("Missing telemetry is not treated as zero or success")
})

test("stale highest revision is distinguished from a live lagging publisher", async ({ page }) => {
  await writePublisher({
    instanceId: "instance-c-live-lagging", projectId: "project-c", displayName: "Project C",
    canonicalLocation: "/work/project-c", workflows: [workflow({
      id: "workflow-c", revision: 1, digest: "digest-c-lagging", status: "active", sessionId: "session-c-old",
    })],
  })
  await page.goto(`http://127.0.0.1:${port}/#/project/project-c/workflow/workflow-c`)
  await expect(page.locator("#page-heading")).toContainText("revision 2")
  await expect(page.locator("#main")).toContainText("Latest-known state · stale source")
  const publishers = page.locator('details[data-hierarchy-key="publishers:project-c:workflow-c"]')
  await publishers.locator("summary").click()
  await expect(publishers).toContainText("Revision 1 · live publisher · lagging revision")
  await expect(publishers).toContainText("Revision 2 · stale/offline publisher")
})

test("malformed API payload retains the last valid projection and refresh can recover", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  await expect(page.locator(aCard)).toBeVisible()
  const errors = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.route("**/api/fleet", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: '{"projects":[{"projectId":"bad","workflows":[null]}]}',
  }))
  await page.locator("#refresh").click()
  await expect(page.locator("#projection-status")).toContainText("Showing the last known Loom projection")
  await expect(page.locator(aCard)).toBeVisible()
  await page.unroute("**/api/fleet")
  await page.locator("#refresh").click()
  await expect(page.locator("#projection-status")).toBeHidden()
  expect(errors).toEqual([])
})

test("degraded API fields display unavailable rather than healthy zero", async ({ page, request }) => {
  // Deliberate API degradation: this tests presentation, not publisher validity.
  const response = await request.get(`http://127.0.0.1:${port}/api/fleet`)
  const fleet = await response.json()
  const projection = fleet.projects.find((p) => p.projectId === "project-a").workflows[0].projection
  for (const key of ["openOqCount", "openVerificationCount", "hierarchyProgress", "budget", "productAcceptance", "knowledgeSync"]) delete projection[key]
  await page.route("**/api/fleet", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fleet) }))
  await page.goto(`http://127.0.0.1:${port}/`)
  await expect(page.locator(aCard)).toContainText("Open questions: Unavailable")
  await page.locator(aCard).click()
  await expect(page.locator('[aria-label="Workflow signals"] strong')).toHaveText(["Unavailable", "Unavailable", "Unavailable", "Unavailable"])
  await expect(page.locator("progress, meter")).toHaveCount(0)
  await expect(page.locator("#main")).toContainText("Not projected")
})

test("projected markup remains inert and malformed hash routes recover without rewriting", async ({ page }) => {
  const payload = '\"><img src=x onerror="window.injected=true"><script>window.injected=true</script>'
  await editSnapshot("instance-a", "project-a", (snapshot) => {
    snapshot.project.displayName = payload
    snapshot.workflows[0].anchor = payload
    snapshot.workflows[0].currentSteps[0].label = payload
  })
  const errors = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto(aWorkflowUrl())
  await expect(page.locator("#main")).toContainText(payload)
  await expect(page.locator("img")).toHaveCount(0)
  expect(await page.evaluate(() => window.injected)).toBeUndefined()
  await page.evaluate(() => { location.hash = "#/project/%E0%A4%A" })
  await expect(page.locator("#view-title")).toHaveText("Invalid dashboard address")
  expect(new URL(page.url()).hash).toBe("#/project/%E0%A4%A")
  await page.getByRole("link", { name: "Return to Fleet", exact: true }).click()
  await expect(page.locator(aCard)).toBeVisible()
  expect(errors).toEqual([])
})

test("themes and expanded details reflow at 320 CSS pixels, with visible keyboard focus", async ({ page }) => {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const suffix of ["", "#/project/project-a", "#/project/project-a/workflow/workflow-a"]) {
      await page.goto(`http://127.0.0.1:${port}/${suffix}`)
      await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false")
      for (const theme of ["light", "dark"]) {
        await page.locator("#theme").selectOption(theme)
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true }))
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
    }
  }
  await page.locator("#pause").focus()
  await page.keyboard.press("Tab")
  await expect(page.locator("#theme")).toBeFocused()
  const focus = await page.locator("#theme").evaluate((node) => ({
    width: getComputedStyle(node).outlineWidth, style: getComputedStyle(node).outlineStyle,
  }))
  expect(focus.style).not.toBe("none")
  expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(2)
  await page.locator("#theme").selectOption("light")
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
})
