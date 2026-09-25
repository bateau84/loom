import { test, expect } from "@playwright/test"
import { spawn, spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import "./readability-browser.mjs"

const repoRoot = resolve(import.meta.dirname, "..")
let root, stateRoot, runtimeRoot, port, server
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString()

function workflow({ id, revision, digest, status, sessionId, activeAgent = "worker", budgetExhausted = false }) {
  const failed = status === "failed"
  return {
    workflowId: id, workflowRevision: revision, stateDigest: digest,
    anchor: `docs/anchors/${id}/anchor.md`, executionStage: `${activeAgent}:task:build`, status,
    currentSteps: [{ id: "task:build", agent: activeAgent, kind: "work", status: failed ? "failed" : "pending", label: "Build" }],
    runnableSteps: failed ? [] : [{ id: "task:build", agent: activeAgent, kind: "work", status: "pending", label: "Build" }],
    hierarchyProgress: Object.fromEntries(["objective", "phases", "waves", "tasks"].map((key) => [key, { complete: 0, total: 1, active: failed ? 0 : 1, failed: failed ? 1 : 0 }])),
    openOqCount: status === "blocked" ? 1 : 0, openVerificationCount: status === "blocked" ? 1 : 0,
    budget: { used: 2, limit: 40, exhausted: budgetExhausted },
    productAcceptance: { status: "unproven", passed: 0, failed: 0, unproven: 1 },
    knowledgeSync: { valid: true, updatedAt: iso(-1_000) }, recentActivityAt: iso(-1_000),
    participatingSessionIds: [sessionId], activeAgent, activeSessionId: sessionId,
  }
}

function objective(id, claimedByWorkflowId) {
  return {
    objectiveId: id, anchor: `docs/anchors/${id}/anchor.md`, title: "Shared task name", status: "active",
    workVersion: 3, generation: 1, stateDigest: `objective-${id}`,
    phases: [{ phaseId: "phase-build", title: "Build", status: "active", waves: [{
      waveId: "wave-runtime", title: "Runtime", status: "active",
      tasks: [{ taskId: "task-build", title: "Shared task name", status: "active", claimedByWorkflowId }],
    }] }],
  }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const socket = createServer()
    socket.once("error", reject)
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address()
      if (!address || typeof address === "string") {
        socket.close(); reject(new Error("No free dashboard port")); return
      }
      socket.close((error) => error ? reject(error) : resolvePort(address.port))
    })
  })
}

async function writePublisher({ instanceId, projectId, displayName, canonicalLocation, workflows, leaseExpiresAt = iso(600_000) }) {
  const instanceRoot = join(runtimeRoot, "instances", "installation-e2e", instanceId)
  await mkdir(join(instanceRoot, "projects"), { recursive: true })
  const generatedAt = iso()
  await writeFile(join(instanceRoot, "manifest.json"), JSON.stringify({
    schemaVersion: 1, installationId: "installation-e2e", instanceId, processId: 1234,
    startedAt: iso(-10_000), generatedAt, leaseExpiresAt, projects: [projectId],
  }))
  await writeFile(join(instanceRoot, "projects", `${projectId}.json`), JSON.stringify({
    schemaVersion: 1, installationId: "installation-e2e", instanceId, projectId, generation: 1, generatedAt, leaseExpiresAt,
    project: { displayName, canonicalLocation }, projectionWindow: { workflowsTruncated: false, completedObjectivesTruncated: false },
    workObjectives: workflows.length ? [objective(`objective-${projectId}`, workflows[0]?.workflowId)] : [], workflows,
  }))
}

function seedControlState() {
  const dbPath = join(stateRoot, "loom", "execution-state.sqlite")
  const code = String.raw`
import { Database } from "bun:sqlite";
const db = new Database(process.env.LOOM_TEST_DB, { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
db.run("DELETE FROM kv");
const set = (key, value) => db.query("INSERT INTO kv(key,value) VALUES(?1,?2)").run(key, JSON.stringify(value));
set("installation/id", "installation-e2e");
set("installation/runtime-schema", { schemaVersion: 1, currentVersion: 5, initializedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
for (const [projectId, canonicalLocation] of [["project-a","/work/project-a"],["project-d","/work/project-d"]]) {
  set("installation/projects/" + projectId, { projectId, canonicalLocation, identitySource: "loom-project-marker", markerLocation: canonicalLocation + "/.loom/project-id", lastSeenAt: new Date().toISOString() });
}
const active = { id:"workflow-a", projectId:"project-a", revision:4, anchor:"docs/anchors/workflow-a/anchor.md", createdBySession:"session-a", createdAt:new Date().toISOString(), steps:[{id:"task:build",agent:"worker",kind:"work",dependsOn:[],status:"pending"}] };
set("project/project-a/workflow/workflow-a", active);
set("project/project-a/session/session-a", "workflow-a");
for (let i=1; i<=4; i++) {
  const id = "workflow-d" + i;
  const failed = { id, projectId:"project-d", revision:i, anchor:"docs/anchors/" + id + "/anchor.md", createdBySession:"session-d", createdAt:new Date().toISOString(), steps:[{id:"review-implementation",agent:"reviewer",kind:"gate",dependsOn:[],status:"failed"}] };
  set("project/project-d/workflow/" + id, failed);
}
set("project/project-d/session/session-d", "workflow-d4");
db.close();
`
  const result = spawnSync("bun", ["-e", code], {
    cwd: repoRoot,
    env: { ...process.env, LOOM_TEST_DB: dbPath },
    encoding: "utf8",
  })
  if (result.status !== 0) {
    throw new Error(`Unable to seed Loom control state: ${result.stderr || result.stdout}`)
  }
}

async function seed() {
  await rm(runtimeRoot, { recursive: true, force: true })
  await mkdir(runtimeRoot, { recursive: true })

  for (const [letter, instance, revision, status, agent, stale] of [
    ["a", "a", 4, "active", "worker", false],
    ["b", "b1", 7, "blocked", "reviewer", false],
    ["b", "b2", 7, "blocked", "reviewer", false],
    ["c", "c", 2, "active", "worker", true],
  ]) {
    await writePublisher({
      instanceId: `instance-${instance}`, projectId: `project-${letter}`,
      displayName: `Project ${letter.toUpperCase()}`, canonicalLocation: `/work/project-${letter}`,
      workflows: [workflow({ id: `workflow-${letter}`, revision, digest: `digest-${instance}`, status,
        sessionId: `session-${letter}`, activeAgent: agent, budgetExhausted: stale })],
      leaseExpiresAt: iso(stale ? -60_000 : 600_000),
    })
  }

  const failed = Array.from({ length: 4 }, (_, index) =>
    workflow({
      id: `workflow-d${index + 1}`,
      revision: index + 1,
      digest: `digest-d${index + 1}`,
      status: "failed",
      sessionId: "session-d",
    }))
  await writePublisher({
    instanceId: "instance-d", projectId: "project-d",
    displayName: "Project D", canonicalLocation: "/work/project-d", workflows: failed,
  })

  seedControlState()
}

async function waitForServer() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error("Control-panel test server did not start")
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "loom-dashboard-browser-"))
  stateRoot = join(root, "state")
  runtimeRoot = join(root, "runtime")
  await mkdir(join(stateRoot, "loom"), { recursive: true })
  await writeFile(join(stateRoot, "loom", "runtime-root.json"), JSON.stringify({ schemaVersion: 1, runtimeRoot }))
  await seed()
  port = await freePort()
  server = spawn("bun", ["dashboard/server.ts"], {
    cwd: repoRoot,
    env: { ...process.env, XDG_STATE_HOME: stateRoot, LOOM_DASHBOARD_PORT: String(port) },
    stdio: "pipe",
  })
  await waitForServer()
})

test.beforeEach(seed)

test.afterAll(async () => {
  if (server && !server.killed) server.kill("SIGTERM")
  await rm(root, { recursive: true, force: true })
})

async function editSnapshot(instanceId, projectId, change) {
  const path = join(runtimeRoot, "instances", "installation-e2e", instanceId, "projects", `${projectId}.json`)
  const snapshot = JSON.parse(await readFile(path, "utf8"))
  change(snapshot)
  snapshot.generation += 1
  snapshot.generatedAt = iso()
  await writeFile(path, JSON.stringify(snapshot))
}

const directoryUrl = (project = "project-a") => `http://127.0.0.1:${port}/#/directory/${project}`
const sessionUrl = (project = "project-a", session = "session-a") =>
  `http://127.0.0.1:${port}/#/directory/${project}/session/${session}`
const workflowUrl = (project = "project-a", session = "session-a", workflowId = "workflow-a") =>
  `http://127.0.0.1:${port}/#/directory/${project}/session/${session}/workflow/${workflowId}`
const legacyWorkflowUrl = () => `http://127.0.0.1:${port}/#/project/project-a/workflow/workflow-a`

test("dashboard child process publishes its effective endpoint lease", async () => {
  const record = JSON.parse(await readFile(join(stateRoot, "loom", "dashboard-endpoint.json"), "utf8"))
  expect(record).toMatchObject({ schemaVersion: 1, baseUrl: `http://127.0.0.1:${port}` })
  expect(Date.parse(record.leaseExpiresAt)).toBeGreaterThan(Date.now())
})

test("home presents working directories and sessions before workflows", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  await expect(page.getByRole("heading", { name: "Control panel", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Working directories", exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Recent sessions", exact: true })).toBeVisible()
  await expect(page.locator('[data-key="directory:project-a"]')).toContainText("Project A")
  await expect(page.locator('[data-key="session:project-a:session-a"]')).toContainText("Workflow a")
  await expect(page.getByText("Tasks complete", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Live publishers", { exact: true })).toHaveCount(0)
})

test("directory to session to workflow navigation matches the user mental model", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  const directory = page.locator('[data-key="directory:project-a"]')
  await directory.focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(directoryUrl())
  await expect(page.locator("#view-title")).toHaveText("Project A")
  await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible()

  const session = page.locator('[data-key="session:project-a:session-a"]')
  await session.focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(sessionUrl())
  await expect(page.locator("#page-heading")).toContainText("Workflow a")
  await expect(page.getByRole("heading", { name: "Workflows", exact: true })).toBeVisible()

  await page.locator(".workflow-row-link").first().focus()
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(workflowUrl())
  await expect(page.getByText("Current work", { exact: true })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(sessionUrl())
  await page.goBack()
  await expect(page).toHaveURL(directoryUrl())
})

test("legacy workflow deep links remain valid", async ({ page }) => {
  await page.goto(legacyWorkflowUrl())
  await expect(page.locator("#view-title")).toHaveText("Workflow a")
  await expect(page.getByText("Current work", { exact: true })).toBeVisible()
})

test("advanced work map stays available without dominating the directory page", async ({ page }) => {
  await page.goto(directoryUrl())
  const details = page.getByText("Advanced work map", { exact: true }).locator("..")
  await expect(details).toBeVisible()
  await details.locator(":scope > summary").click()
  await expect(page.getByText("Objective → Phase → Wave → Task", { exact: true })).toBeVisible()
  const owner = page.locator('a[data-key^="owner:"]')
  await expect(owner).toHaveText("Workflow a")
  await expect(owner).toHaveAttribute("href", "#/directory/project-a/session/session-a/workflow/workflow-a")
})

test("failed workflow cleanup removes four restart attempts from Loom", async ({ page, request }) => {
  await page.goto(`http://127.0.0.1:${port}/#/directory/project-d/workflows`)
  await expect(page.getByRole("heading", { name: "Workflow records", exact: true })).toBeVisible()
  await expect(page.locator(".workflow-table-row")).toHaveCount(4)

  await page.getByRole("button", { name: "Delete failed/cancelled workflows" }).click()
  const dialog = page.locator("dialog[open]")
  await expect(dialog).toContainText("Delete 4 failed/cancelled workflows?")
  await expect(dialog).toContainText("Your code is not deleted.")
  await expect(dialog).toContainText("durable completed work results")

  let releaseDelete
  const heldDelete = new Promise((resolve) => { releaseDelete = resolve })
  await page.route("**/api/control/workflows/delete", async (route) => {
    await heldDelete
    await route.continue()
  })
  await dialog.getByRole("button", { name: "Delete workflows" }).click()
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled()
  await expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  releaseDelete()

  await expect(dialog).toHaveCount(0)
  await page.unroute("**/api/control/workflows/delete")
  await expect(page.locator("#main")).toBeFocused()
  await expect(page.locator(".workflow-table-row")).toHaveCount(0)
  await expect(page.getByText("No failed workflow clutter", { exact: true })).toBeVisible()

  const fleet = await (await request.get(`http://127.0.0.1:${port}/api/fleet`)).json()
  expect(fleet.projects.find((project) => project.projectId === "project-d").workflows).toHaveLength(0)
})

test("uncertain delete response stays truthful and a retry converges idempotently", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/#/directory/project-d/workflows`)
  await expect(page.locator(".workflow-table-row")).toHaveCount(4)

  let loseFirstResponse = true
  await page.route("**/api/control/workflows/delete", async (route) => {
    if (loseFirstResponse) {
      loseFirstResponse = false
      await route.fetch()
      await route.abort("failed")
      return
    }
    await route.continue()
  })

  await page.getByRole("button", { name: "Delete failed/cancelled workflows" }).click()
  const dialog = page.locator("dialog[open]")
  await dialog.getByRole("button", { name: "Delete workflows" }).click()

  await expect(dialog.getByRole("alert")).toContainText(
    "Could not confirm whether workflow deletion completed",
  )
  await expect(dialog.getByRole("button", { name: "Delete workflows" })).toBeEnabled()

  await dialog.getByRole("button", { name: "Delete workflows" }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator(".workflow-table-row")).toHaveCount(0)
  await page.unroute("**/api/control/workflows/delete")
})

test("session summary does not turn missing workflow question state into zero", async ({ page, request }) => {
  const fleet = await (await request.get(`http://127.0.0.1:${port}/api/fleet`)).json()
  const project = fleet.projects.find((candidate) => candidate.projectId === "project-a")
  delete project.workflows[0].projection.openOqCount
  await page.route("**/api/fleet", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(fleet),
  }))
  await page.goto(sessionUrl())
  const summary = page.locator("section.panel, aside .panel").filter({ hasText: "Session summary" })
  await expect(summary).toContainText("Open questions")
  await expect(summary).toContainText("Unavailable")
  await expect(summary).not.toContainText("Open questions0")
})

test("failed workflows with runnable recovery work do not offer deletion", async ({ page, request }) => {
  const fleet = await (await request.get(`http://127.0.0.1:${port}/api/fleet`)).json()
  const project = fleet.projects.find((candidate) => candidate.projectId === "project-a")
  project.workflows[0].projection.status = "failed"
  project.workflows[0].projection.runnableSteps = [{
    id: "task:recover",
    agent: "worker",
    kind: "work",
    status: "pending",
    label: "Recover",
  }]
  await page.route("**/api/fleet", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(fleet),
  }))
  await page.goto(sessionUrl())
  await expect(page.getByText("failed", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: /Delete/ })).toHaveCount(0)
  await page.goto(`http://127.0.0.1:${port}/#/directory/project-a/workflows`)
  await expect(page.getByText("failed", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: /Delete/ })).toHaveCount(0)
})

test("bulk cleanup stays in a session when valid workflows remain", async ({ page, request }) => {
  const fleet = await (await request.get(`http://127.0.0.1:${port}/api/fleet`)).json()
  const project = fleet.projects.find((candidate) => candidate.projectId === "project-a")
  const failed = structuredClone(project.workflows[0])
  failed.workflowId = "workflow-a-failed"
  failed.workflowRevision += 1
  failed.projection.workflowId = failed.workflowId
  failed.projection.workflowRevision = failed.workflowRevision
  failed.projection.stateDigest = "failed-session-peer"
  failed.projection.status = "failed"
  failed.projection.currentSteps = [{
    id: "review-implementation",
    agent: "reviewer",
    kind: "gate",
    status: "failed",
    label: "Review implementation",
  }]
  failed.projection.runnableSteps = []
  project.workflows.push(failed)

  await page.route("**/api/fleet", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(fleet),
  }))
  await page.goto(sessionUrl())

  const cleanup = page.getByRole("button", { name: "Delete failed/cancelled workflows" })
  await expect(cleanup).toBeVisible()
  await expect(cleanup).toHaveAttribute(
    "data-return-href",
    "#/directory/project-a/session/session-a",
  )
})

test("cleanup endpoint refuses active workflow deletion", async ({ page }) => {
  await page.goto(directoryUrl())
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/control/workflows/delete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-loom-control-token": window.__LOOM_CONTROL_TOKEN__,
      },
      body: JSON.stringify({
        projectId: "project-a",
        workflowIds: ["workflow-a"],
        reason: "negative acceptance test",
      }),
    })
    return { status: response.status, body: await response.json() }
  })
  expect(result.status).toBe(409)
  expect(result.body.error).toContain("not a terminal failed/cancelled workflow")
})

test("workflow cleanup control is absent for active work", async ({ page }) => {
  await page.goto(sessionUrl())
  await expect(page.getByRole("button", { name: /Delete/ })).toHaveCount(0)
  await page.goto(workflowUrl())
  await expect(page.getByRole("button", { name: "Delete workflow" })).toHaveCount(0)
})

test("consistency conflict stays explicit and withholds a winner", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/#/project/project-b/workflow/workflow-b`)
  await expect(page.locator("#main")).toContainText("No winner is selected")
  await expect(page.getByRole("heading", { name: "Current work", exact: true })).toHaveCount(0)
  await expect(page.locator("progress, meter")).toHaveCount(0)
})

test("stale highest revision is distinguished from a live lagging publisher", async ({ page }) => {
  await writePublisher({
    instanceId: "instance-c-live-lagging", projectId: "project-c",
    displayName: "Project C", canonicalLocation: "/work/project-c",
    workflows: [workflow({ id: "workflow-c", revision: 1, digest: "digest-c-lagging", status: "active", sessionId: "session-c-old" })],
  })
  await page.goto(`http://127.0.0.1:${port}/#/project/project-c/workflow/workflow-c`)
  await expect(page.locator("#main")).toContainText("Latest-known state · stale source")
  const publishers = page.locator('details[data-hierarchy-key="publishers:project-c:workflow-c"]')
  await publishers.locator(":scope > summary").click()
  await expect(publishers).toContainText("Revision 1 · live publisher · lagging revision")
  await expect(publishers).toContainText("Revision 2 · stale/offline publisher")
})

test("background refresh preserves focus and disappearance has a predictable fallback", async ({ page }) => {
  await page.goto(directoryUrl())
  const session = page.locator('[data-key="session:project-a:session-a"]')
  await session.focus()
  await expect(session).toBeFocused()
  await page.waitForTimeout(3_400)
  await expect(session).toBeFocused()
  await editSnapshot("instance-a", "project-a", (snapshot) => { snapshot.workflows = [] })
  await expect(page.locator("#live")).toContainText("previously focused item is no longer available", { timeout: 7_000 })
  expect(await page.evaluate(() => document.activeElement?.id === "main" || Boolean(document.activeElement?.dataset?.key))).toBe(true)
})

test("projection refresh failure keeps the last known control panel visible", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  await expect(page.locator('[data-key="directory:project-a"]')).toBeVisible()
  await page.route("**/api/fleet", (route) => route.fulfill({ status: 503, body: "projection unavailable" }))
  await expect(page.locator("#projection-status")).toContainText("Showing the last known Loom projection", { timeout: 7_000 })
  await expect(page.locator('[data-key="directory:project-a"]')).toBeVisible()
})

test("projected markup remains inert and malformed routes recover without rewriting", async ({ page }) => {
  const payload = '\"><img src=x onerror="window.injected=true"><script>window.injected=true</script>'
  await editSnapshot("instance-a", "project-a", (snapshot) => {
    snapshot.project.displayName = payload
    snapshot.workflows[0].anchor = payload
    snapshot.workflows[0].currentSteps[0].label = payload
  })
  const errors = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto(workflowUrl())
  await expect(page.locator("#main")).toContainText(payload)
  await expect(page.locator("img")).toHaveCount(0)
  expect(await page.evaluate(() => window.injected)).toBeUndefined()
  await page.evaluate(() => { location.hash = "#/directory/%E0%A4%A" })
  await expect(page.locator("#view-title")).toHaveText("Invalid control-panel address")
  expect(new URL(page.url()).hash).toBe("#/directory/%E0%A4%A")
  await page.getByRole("link", { name: "Return to control panel", exact: true }).click()
  await expect(page.locator('[data-key="directory:project-b"]')).toBeVisible()
  expect(errors).toEqual([])
})

test("themes and control pages reflow at 320 CSS pixels with visible keyboard focus", async ({ page }) => {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const suffix of ["", "#/directory/project-a", "#/directory/project-a/session/session-a", "#/directory/project-a/session/session-a/workflow/workflow-a", "#/directory/project-d/workflows"]) {
      await page.goto(`http://127.0.0.1:${port}/${suffix}`)
      await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false")
      for (const theme of ["light", "dark"]) {
        await page.locator("#theme").selectOption(theme)
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
    }
  }
  await page.locator("#pause").focus()
  await page.keyboard.press("Tab")
  await expect(page.locator("#theme")).toBeFocused()
  const focus = await page.locator("#theme").evaluate((node) => ({
    width: getComputedStyle(node).outlineWidth,
    style: getComputedStyle(node).outlineStyle,
  }))
  expect(focus.style).not.toBe("none")
  expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(2)
})
