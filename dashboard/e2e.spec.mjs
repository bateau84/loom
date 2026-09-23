import { test, expect } from "@playwright/test"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import "./readability-browser.mjs"

const repoRoot = resolve(import.meta.dirname, "..")
let root, stateRoot, runtimeRoot, port, server
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString()

function workflow({ id, revision, digest, status, sessionId, activeAgent = "worker", budgetExhausted = false }) {
  return {
    workflowId: id, workflowRevision: revision, stateDigest: digest,
    anchor: `docs/anchors/${id}/anchor.md`, executionStage: `${activeAgent}:task:build`, status,
    currentSteps: [{ id: "task:build", agent: activeAgent, kind: "work", status: "pending", label: "Build" }],
    runnableSteps: [{ id: "task:build", agent: activeAgent, kind: "work", status: "pending", label: "Build" }],
    hierarchyProgress: Object.fromEntries(["objective", "phases", "waves", "tasks"].map((key) => [key, { complete: 0, total: 1, active: 1 }])),
    openOqCount: 1, openVerificationCount: 1, budget: { used: 2, limit: 40, exhausted: budgetExhausted },
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
      if (!address || typeof address === "string") { socket.close(); reject(new Error("No free dashboard port")); return }
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
    workObjectives: [objective(`objective-${projectId}`, workflows[0]?.workflowId)], workflows,
  }))
}
async function seed() {
  await rm(runtimeRoot, { recursive: true, force: true })
  await mkdir(runtimeRoot, { recursive: true })
  for (const [letter, instance, revision, status, agent, stale] of [
    ["a", "a", 4, "active", "worker", false], ["b", "b1", 7, "blocked", "reviewer", false],
    ["b", "b2", 7, "blocked", "reviewer", false], ["c", "c", 2, "active", "worker", true],
  ]) {
    await writePublisher({ instanceId: `instance-${instance}`, projectId: `project-${letter}`,
      displayName: `Project ${letter.toUpperCase()}`, canonicalLocation: `/work/project-${letter}`,
      workflows: [workflow({ id: `workflow-${letter}`, revision, digest: `digest-${instance}`, status,
        sessionId: `session-${letter}`, activeAgent: agent, budgetExhausted: stale })],
      leaseExpiresAt: iso(stale ? -60_000 : 600_000),
    })
  }
}
async function waitForServer() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("Dashboard test server did not start")
}
test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "loom-dashboard-browser-"))
  stateRoot = join(root, "state"); runtimeRoot = join(root, "runtime")
  await mkdir(join(stateRoot, "loom"), { recursive: true })
  await writeFile(join(stateRoot, "loom", "runtime-root.json"), JSON.stringify({ schemaVersion: 1, runtimeRoot }))
  await seed(); port = await freePort()
  server = spawn("bun", ["dashboard/server.ts"], { cwd: repoRoot,
    env: { ...process.env, XDG_STATE_HOME: stateRoot, LOOM_DASHBOARD_PORT: String(port) }, stdio: "pipe" })
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
  change(snapshot); snapshot.generation += 1; snapshot.generatedAt = iso()
  await writeFile(path, JSON.stringify(snapshot))
}
const aCard = 'a[data-key="project-a:workflow-a"]'
const aWorkflowUrl = () => `http://127.0.0.1:${port}/#/project/project-a/workflow/workflow-a`

test("dashboard child process publishes its effective endpoint lease", async () => {
  const record = JSON.parse(await readFile(join(stateRoot, "loom", "dashboard-endpoint.json"), "utf8"))
  expect(record).toMatchObject({ schemaVersion: 1, baseUrl: `http://127.0.0.1:${port}` })
  expect(Date.parse(record.leaseExpiresAt)).toBeGreaterThan(Date.now())
})
test("workflow deep link survives projection lag and opens when the project/workflow appears", async ({ page }) => {
  await rm(join(runtimeRoot, "instances", "installation-e2e", "instance-a"), { recursive: true, force: true })
  await page.goto(aWorkflowUrl())
  await expect(page.getByText("Waiting for Loom projection…", { exact: true })).toBeVisible()
  await page.waitForTimeout(6_400)
  await expect(page.getByText("Waiting for Loom projection…", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(aWorkflowUrl())
  await writePublisher({ instanceId: "instance-a", projectId: "project-a", displayName: "Project A", canonicalLocation: "/work/project-a",
    workflows: [workflow({ id: "workflow-a", revision: 4, digest: "digest-a", status: "active", sessionId: "session-a" })] })
  await expect(page.locator("#view-title")).toHaveText("Workflow a", { timeout: 7_000 })
  await expect(page).toHaveURL(aWorkflowUrl())
})
test("keyboard drill-down and browser back preserve Fleet filters", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  for (const state of ["consistency conflict", "stale/offline", "budget exhausted"]) await expect(page.getByText(state, { exact: true })).toBeVisible()
  const card = page.locator(aCard)
  for (const text of ["Tasks complete", "0/1", "2/40"]) await expect(card).toContainText(text)
  await page.locator("#status-filter").selectOption("active")
  await page.locator("#project-filter").fill("Project A")
  await page.locator("#agent-filter").fill("worker")
  await card.focus(); await page.keyboard.press("Enter")
  await expect(page).toHaveURL(aWorkflowUrl())
  await expect(page.getByText("OpenCode sessions", { exact: true })).toBeVisible()
  await page.locator('a[data-key="session:session-a"]').focus(); await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/session\/session-a$/)
  await expect(page.getByText("OpenCode session", { exact: true })).toBeVisible()
  await page.goBack(); await expect(page).toHaveURL(aWorkflowUrl())
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
  await page.goto(aWorkflowUrl())
  await expect(page).toHaveURL(aWorkflowUrl())
  await expect(page.locator("#view-title")).toHaveText("Workflow a")
  await expect(page.getByText("OpenCode sessions", { exact: true })).toBeVisible()
})
test("background refresh preserves focus and disappearance has predictable fallback", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  const card = page.locator(aCard)
  await card.focus(); await expect(card).toBeFocused()
  await page.waitForTimeout(3_400); await expect(card).toBeFocused()
  await editSnapshot("instance-a", "project-a", (s) => { s.workflows = [] })
  await expect(page.locator("#live")).toContainText("previously focused item is no longer available", { timeout: 7_000 })
  const focus = await page.evaluate(() => ({ id: document.activeElement?.id, key: document.activeElement?.dataset?.key }))
  expect(focus.key === "project-b:workflow-b" || ["status-filter", "project-filter", "agent-filter"].includes(focus.id)).toBe(true)
})
test("project hierarchy exposes active workflow claims", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/#/project/project-a`)
  await expect(page.getByText("Objective → Phase → Wave → Task", { exact: true })).toBeVisible()
  const owner = page.locator('a[data-key^="owner:"]')
  await expect(owner).toHaveText("Workflow a")
  await expect(owner).toHaveAttribute("href", "#/project/project-a/workflow/workflow-a")
  await expect(owner.locator("..")).toContainText("Owned by:")
})
test("project hierarchy preserves manual expansion state across background refresh", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/#/project/project-a`)
  const wave = page.locator('details[data-hierarchy-key="project:project-a:objective:objective-project-a:phase:phase-build:wave:wave-runtime"]')
  await expect(wave).toHaveAttribute("open", "")
  const summary = wave.locator(":scope > summary")
  await summary.click(); await expect(wave).not.toHaveAttribute("open", "")
  await summary.focus(); await page.waitForTimeout(3_400)
  await expect(wave).not.toHaveAttribute("open", ""); await expect(summary).toBeFocused()
})
test("refresh failure keeps last known Fleet visible and marks projection degradation", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  await expect(page.locator(aCard)).toBeVisible()
  await page.route("**/api/fleet", (route) => route.fulfill({ status: 503, body: "projection unavailable" }))
  await expect(page.locator("#projection-status")).toContainText("Showing the last known Loom projection", { timeout: 7_000 })
  await expect(page.locator(aCard)).toBeVisible()
})
test("narrow layout keeps identity and status usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 }); await page.goto(`http://127.0.0.1:${port}/`)
  await expect(page.locator(aCard)).toContainText("Project A")
  await expect(page.getByText("consistency conflict", { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
test("dashboard HTTP observation surface remains read-only in the real server", async ({ request }) => {
  const response = await request.post(`http://127.0.0.1:${port}/api/fleet`, { data: { mutate: true } })
  expect(response.status()).toBe(405); expect(response.headers().allow).toBe("GET")
})
test("Fleet triages conflicts and open boundaries, with reloadable filters and clear recovery", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`)
  await expect(page.locator(".workflow").first()).toHaveAttribute("data-key", "project-b:workflow-b")
  await expect(page.locator('button[data-status="attention"] strong')).toHaveText("3")
  await page.locator("#status-filter").selectOption("attention"); await expect(page.locator(aCard)).toBeVisible()
  await page.locator("#project-filter").fill("/work/project-a"); await page.locator("#agent-filter").fill("worker")
  await expect(page.locator(".workflow")).toHaveCount(1)
  const url = page.url(); await page.reload(); await expect(page).toHaveURL(url)
  await expect(page.locator("#project-filter")).toHaveValue("/work/project-a")
  await expect(page.locator("#agent-filter")).toHaveValue("worker"); await expect(page.locator(".workflow")).toHaveCount(1)
  await page.locator("#project-filter").fill("missing project"); await page.locator("[data-clear-filters]").click()
  await expect(page.locator(".workflow")).toHaveCount(3); await expect(page.locator("#status-filter")).toBeFocused()
})
test("workflow title uses an explicit matching objective generation, never an unrelated title", async ({ page }) => {
  await editSnapshot("instance-a", "project-a", (s) => { s.workflows[0].workScope = { objectiveId: "objective-project-a", generation: 1 } })
  await page.goto(aWorkflowUrl()); await expect(page.locator("#view-title")).toHaveText("Shared task name")
  await editSnapshot("instance-a", "project-a", (s) => {
    s.workObjectives[0].generation = 2; s.workObjectives[0].workVersion += 1
    s.workObjectives[0].stateDigest = "new-objective-generation"; s.workObjectives[0].title = "Unrelated new generation"
  })
  await page.locator("#refresh").click(); await expect(page.locator("#view-title")).toHaveText("Workflow a")
  const technical = page.locator('details[data-technical]').filter({ has: page.getByText("Workflow ID", { exact: true }) })
  await technical.locator(":scope > summary").click()
  await expect(technical).toContainText("docs/anchors/workflow-a/anchor.md")
})
test("sessions stay secondary and expanded state and focus survive a changed revision", async ({ page }) => {
  await editSnapshot("instance-a", "project-a", (s) => { s.workflows[0].participatingSessionIds = ["session-a", "session-a2", "session-a3"] })
  await page.goto(aWorkflowUrl())
  // Legacy activeSessionId is only an alphabetical locator, not activity evidence.
  await expect(page.getByText("Active session", { exact: true })).toHaveCount(0)
  const extra = page.locator('a[data-key="session:session-a3"]'); await expect(extra).toBeHidden()
  const details = page.locator('details[data-hierarchy-key="sessions:project-a:workflow-a"]')
  const summary = details.locator(":scope > summary")
  await summary.focus(); await page.keyboard.press("Enter"); await expect(extra).toBeVisible()
  await editSnapshot("instance-a", "project-a", (s) => { s.workflows[0].workflowRevision = 5; s.workflows[0].stateDigest = "digest-a-5" })
  await expect(page.locator("#page-heading")).toContainText("revision 5", { timeout: 7_000 })
  await expect(details).toHaveAttribute("open", ""); await expect(summary).toBeFocused()
  await expect(page.getByText("Counts are signals, not causal explanations.", { exact: false })).toBeVisible()
})
test("pausing display rejects an in-flight automatic read but permits explicit refresh", async ({ page }) => {
  await page.goto(aWorkflowUrl()); await expect(page.locator("#page-heading")).toContainText("revision 4")
  let release, intercepted = false
  const held = new Promise((r) => { release = r })
  await page.route("**/api/fleet", async (route) => { intercepted = true; await held; await route.continue() })
  await expect.poll(() => intercepted, { timeout: 7_000 }).toBe(true)
  await page.locator("#pause").click()
  await editSnapshot("instance-a", "project-a", (s) => { s.workflows[0].workflowRevision = 5; s.workflows[0].stateDigest = "digest-a-5" })
  release(); await expect(page.locator("#refresh")).toBeEnabled(); await page.unroute("**/api/fleet")
  await expect(page.locator("#page-heading")).toContainText("revision 4"); await page.waitForTimeout(3_400)
  await expect(page.locator("#page-heading")).toContainText("revision 4")
  await page.locator("#refresh").click(); await expect(page.locator("#page-heading")).toContainText("revision 5")
  await expect(page.locator("#pause")).toHaveAttribute("aria-pressed", "true")
  await editSnapshot("instance-a", "project-a", (s) => { s.workflows[0].workflowRevision = 6; s.workflows[0].stateDigest = "digest-a-6" })
  await page.locator("#pause").click(); await expect(page.locator("#page-heading")).toContainText("revision 6")
  await expect(page.locator("#pause")).toHaveAttribute("aria-pressed", "false")
})
test("consistency conflict withholds progress and current work including session membership", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/#/project/project-b/workflow/workflow-b`)
  await expect(page.locator("#main")).toContainText("No winner is selected")
  for (const digest of ["digest-b1", "digest-b2"]) {
    const details = page.locator('details[data-technical]').filter({ hasText: digest })
    await details.locator(":scope > summary").click(); await expect(details).toContainText(digest)
  }
  await expect(page.getByRole("heading", { name: "Current work", exact: true })).toHaveCount(0)
  await expect(page.locator("progress, meter")).toHaveCount(0)
  await page.goto(`http://127.0.0.1:${port}/#/project/project-b/workflow/workflow-b/session/session-b`)
  await expect(page.locator("#main")).toContainText("Session membership unresolved")
  await expect(page.locator("#main")).toContainText("Missing telemetry is not treated as zero or success")
})
test("stale highest revision is distinguished from a live lagging publisher", async ({ page }) => {
  await writePublisher({ instanceId: "instance-c-live-lagging", projectId: "project-c", displayName: "Project C", canonicalLocation: "/work/project-c",
    workflows: [workflow({ id: "workflow-c", revision: 1, digest: "digest-c-lagging", status: "active", sessionId: "session-c-old" })] })
  await page.goto(`http://127.0.0.1:${port}/#/project/project-c/workflow/workflow-c`)
  await expect(page.locator("#page-heading")).toContainText("revision 2")
  await expect(page.locator("#main")).toContainText("Latest-known state · stale source")
  const publishers = page.locator('details[data-hierarchy-key="publishers:project-c:workflow-c"]')
  await publishers.locator(":scope > summary").click()
  await expect(publishers).toContainText("Revision 1 · live publisher · lagging revision")
  await expect(publishers).toContainText("Revision 2 · stale/offline publisher")
})
test("malformed API payload retains the last valid projection and refresh can recover", async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/`); await expect(page.locator(aCard)).toBeVisible()
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)))
  await page.route("**/api/fleet", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"projects":[{"projectId":"bad","workflows":[null]}]}' }))
  await page.locator("#refresh").click()
  await expect(page.locator("#projection-status")).toContainText("Showing the last known Loom projection")
  await expect(page.locator(aCard)).toBeVisible()
  await page.unroute("**/api/fleet"); await page.locator("#refresh").click()
  await expect(page.locator("#projection-status")).toBeHidden(); expect(errors).toEqual([])
})
test("degraded API fields display unavailable rather than healthy zero", async ({ page, request }) => {
  const fleet = await (await request.get(`http://127.0.0.1:${port}/api/fleet`)).json()
  const projection = fleet.projects.find((p) => p.projectId === "project-a").workflows[0].projection
  for (const key of ["openOqCount", "openVerificationCount", "hierarchyProgress", "budget", "productAcceptance", "knowledgeSync"]) delete projection[key]
  await page.route("**/api/fleet", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fleet) }))
  await page.goto(`http://127.0.0.1:${port}/`); await expect(page.locator(aCard)).toContainText("Open questions: Unavailable")
  await page.locator(aCard).click()
  await expect(page.locator('[aria-label="Workflow signals"] strong')).toHaveText(["Unavailable", "Unavailable", "Unavailable", "Unavailable"])
  await expect(page.locator("progress, meter")).toHaveCount(0); await expect(page.locator("#main")).toContainText("Not projected")
})
test("projected markup remains inert and malformed hash routes recover without rewriting", async ({ page }) => {
  const payload = '\"><img src=x onerror="window.injected=true"><script>window.injected=true</script>'
  await editSnapshot("instance-a", "project-a", (s) => { s.project.displayName = payload; s.workflows[0].anchor = payload; s.workflows[0].currentSteps[0].label = payload })
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)))
  await page.goto(aWorkflowUrl()); await expect(page.locator("#main")).toContainText(payload)
  await expect(page.locator("img")).toHaveCount(0); expect(await page.evaluate(() => window.injected)).toBeUndefined()
  await page.evaluate(() => { location.hash = "#/project/%E0%A4%A" })
  await expect(page.locator("#view-title")).toHaveText("Invalid dashboard address")
  expect(new URL(page.url()).hash).toBe("#/project/%E0%A4%A")
  await page.getByRole("link", { name: "Return to Fleet", exact: true }).click()
  await expect(page.locator(aCard)).toBeVisible(); expect(errors).toEqual([])
})
test("themes and expanded details reflow at 320 CSS pixels, with visible keyboard focus", async ({ page }) => {
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const suffix of ["", "#/project/project-a", "#/project/project-a/workflow/workflow-a"]) {
      await page.goto(`http://127.0.0.1:${port}/${suffix}`)
      await expect(page.locator("#main")).toHaveAttribute("aria-busy", "false")
      for (const theme of ["light", "dark"]) {
        await page.locator("#theme").selectOption(theme); await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true }))
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      }
    }
  }
  await page.locator("#pause").focus(); await page.keyboard.press("Tab"); await expect(page.locator("#theme")).toBeFocused()
  const focus = await page.locator("#theme").evaluate((node) => ({ width: getComputedStyle(node).outlineWidth, style: getComputedStyle(node).outlineStyle }))
  expect(focus.style).not.toBe("none"); expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(2)
  await page.locator("#theme").selectOption("light"); await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
})
