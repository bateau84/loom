import { test, expect } from "@playwright/test"
import { spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

// Imported by the CI-owned e2e entrypoint. No extra workflow or paid model call.
test.describe("human-readable dashboard context", () => {
  const cwd = resolve(import.meta.dirname, "..")
  const project = "11111111-1111-4111-8111-111111111111"
  const workflow = "22222222-2222-4222-8222-222222222222"
  const coordinator = "ses_zzzzzzzzzzzzzzzzzzzzzzzzzz"
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  let root, runtime, state, server, port
  const workflowUrl = () => `http://127.0.0.1:${port}/#/project/${project}/workflow/${workflow}`
  const snapshotPath = () => join(runtime, "instances/readable-installation/readable-publisher/projects", project + ".json")
  async function runBun(args) {
    await new Promise((resolveRun, reject) => {
      const child = spawn("bun", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
      let output = ""
      child.stdout.on("data", (b) => { output += b })
      child.stderr.on("data", (b) => { output += b })
      child.on("error", reject)
      child.on("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`Fixture producer failed (${code}): ${output}`)))
    })
  }
  async function publish(change = "") {
    await rm(runtime, { recursive: true, force: true })
    await runBun(["--eval", `import { readableFixture } from './dashboard/readability-fixture.ts';
      import { createDashboardPublisher } from './plugins/loom/dashboard.ts';
      const f = readableFixture(${JSON.stringify(runtime)}); ${change}
      await createDashboardPublisher(f.storage, f.runtime, {leaseMs:600000}).publish();`])
  }
  // Deliberate transport/retention fault injection; separate from producer proof.
  async function editSnapshot(change) {
    const value = JSON.parse(await readFile(snapshotPath(), "utf8"))
    change(value); value.generation += 1
    const tmp = snapshotPath() + ".tmp"
    await writeFile(tmp, JSON.stringify(value)); await rename(tmp, snapshotPath())
  }
  test.beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "loom-readable-browser-"))
    runtime = join(root, "runtime"); state = join(root, "state")
    await mkdir(join(state, "loom"), { recursive: true })
    await writeFile(join(state, "loom/runtime-root.json"), JSON.stringify({ schemaVersion: 1, runtimeRoot: runtime }))
    port = await new Promise((resolvePort, reject) => {
      const socket = createServer(); socket.on("error", reject)
      socket.listen(0, "127.0.0.1", () => { const { port } = socket.address(); socket.close(() => resolvePort(port)) })
    })
    server = spawn("bun", ["dashboard/server.ts"], { cwd, env: { ...process.env, XDG_STATE_HOME: state, LOOM_DASHBOARD_PORT: String(port) }, stdio: "pipe" })
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/health`)).ok } catch { return false } }, { timeout: 15_000 }).toBe(true)
  })
  test.beforeEach(async () => { await publish() })
  test.afterAll(async () => {
    if (server && !server.killed) server.kill("SIGTERM")
    await rm(root, { recursive: true, force: true })
  })

  test("real publisher supplies useful titles, question ownership and required checks without visible UUIDs", async ({ page, request }) => {
    const fleet = await (await request.get(`http://127.0.0.1:${port}/api/fleet`)).json()
    const projection = fleet.projects[0].workflows[0].projection
    expect(projection.context.version).toBe(1)
    expect(projection.context.coordinatorSessionId).toBe(coordinator)
    await page.goto(workflowUrl())
    await expect(page.locator("#view-title")).toHaveText("Build persistence layer")
    await expect(page.getByText("How long should completed workflow history be kept?", { exact: true })).toBeVisible()
    await expect(page.getByText("Awaiting your answer.", { exact: true })).toBeVisible()
    await expect(page.getByText("Marked blocking for affected steps; not necessarily the whole workflow.", { exact: true })).toBeVisible()
    await expect(page.getByText("Prove existing workflow history survives a restart.", { exact: true })).toBeVisible()
    await expect(page.getByText("Before: Review implementation", { exact: true })).toBeVisible()
    await expect(page.getByText("Ready to dispatch", { exact: true })).toBeVisible()
    const text = await page.locator("body").innerText()
    expect(text).not.toMatch(uuid)
    expect(text).not.toContain("worker:task:build")
    expect(text).not.toContain("ses_")
    expect(text).not.toContain("Active session")
  })

  test("ownership resolves within the project and technical IDs stay available by keyboard", async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port}/#/project/${project}`)
    const owner = page.locator('a[data-key^="owner:"]')
    await expect(owner).toHaveText("Build persistence layer")
    await owner.focus(); await page.keyboard.press("Enter")
    await expect(page).toHaveURL(workflowUrl())
    const technical = page.locator('details[data-technical]').filter({ has: page.getByText("Workflow ID", { exact: true }) })
    const summary = technical.locator(":scope > summary")
    await expect(technical.locator("dd").filter({ hasText: workflow })).toBeHidden()
    await summary.focus(); await page.keyboard.press("Enter")
    await expect(technical.locator("dd").filter({ hasText: workflow })).toBeVisible()
    await expect(technical).toContainText("worker:task:build")
    await editSnapshot((s) => { s.workflows[0].workflowRevision += 1 })
    await expect(page.locator("#page-heading")).toContainText("revision 8", { timeout: 7_000 })
    await expect(summary).toBeFocused(); await expect(technical).toHaveAttribute("open", "")
  })

  test("the actual coordinator session is named without claiming the alphabetically first session is active", async ({ page }) => {
    await page.goto(workflowUrl())
    const session = page.locator(`a[data-key="session:${coordinator}"]`)
    await expect(session).toContainText("Coordinator session")
    await expect(session).toContainText("Build persistence layer")
    await session.click()
    await expect(page).toHaveURL(workflowUrl() + "/session/" + coordinator)
    // Hash changes precede the routed DOM update. Verify the destination view,
    // not just the URL, before selecting its technical disclosure.
    await expect(page.locator("#view-title")).toHaveText("OpenCode session")
    expect(await page.locator("body").innerText()).not.toMatch(uuid)
    expect(await page.locator("body").innerText()).not.toContain("ses_")
    const technical = page.locator('details[data-technical]').filter({ has: page.getByText("Session ID", { exact: true }) })
    await expect(technical).toHaveCount(1)
    await technical.locator(":scope > summary").click()
    await expect(technical).toContainText(coordinator)
    await page.goBack(); await expect(session).toBeFocused()
  })

  test("answered questions and reported failures are not misrepresented as requests for another answer or verified causes", async ({ page }) => {
    await publish(`f.question.status='answered'; f.question.requiredAuthority='designer';
      f.workflow.steps[0].status='failed'; f.workflow.steps[0].summary='Persistence check could not reach its test service.';`)
    await page.goto(workflowUrl())
    await expect(page.getByText("Answer recorded · affected steps still need to apply or acknowledge it.", { exact: true })).toBeVisible()
    await expect(page.getByText("Awaiting your answer.", { exact: true })).toHaveCount(0)
    await expect(page.getByText("Reported result: Persistence check could not reach its test service.", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Reported failures", exact: true })).toBeVisible()
  })

  test("legacy, malformed and unknown readable context degrades to honest counts-only guidance", async ({ page }) => {
    for (const context of [undefined, { version: 1, questions: [null] }, { version: 999 }]) {
      await publish()
      await editSnapshot((s) => { s.workflows[0].context = context })
      await page.goto(workflowUrl())
      await expect(page.getByText("This publisher shares counts only, or its readable details are incompatible.", { exact: false })).toBeVisible()
      await expect(page.locator('[aria-label="Workflow signals"] strong')).toHaveText(["0/1", "1", "1", "8/40"])
      expect(await page.locator("body").innerText()).not.toMatch(uuid)
      await expect(page.getByText("No unresolved questions recorded.", { exact: true })).toHaveCount(0)
    }
  })

  test("unknown names and missing owners do not borrow titles from another project or print IDs", async ({ page }) => {
    await editSnapshot((s) => {
      delete s.workflows[0].context; delete s.workflows[0].workScope
      s.workflows[0].anchor = workflow
      s.workObjectives[0].phases[0].waves[0].tasks[0].claimedByWorkflowId = "66666666-6666-4666-8666-666666666666"
    })
    await page.goto(workflowUrl()); await expect(page.locator("#view-title")).toHaveText("Unnamed workflow")
    await page.goto(`http://127.0.0.1:${port}/#/project/${project}`)
    await expect(page.locator('a[data-key^="owner:"]')).toHaveText("Workflow outside this view")
    expect(await page.locator("body").innerText()).not.toMatch(uuid)
  })

  test("text previews are bounded, recognized credentials are redacted and HTML remains inert", async ({ page, request }) => {
    await publish(`f.question.question = 'Use "password": "fixture secret with spaces". <img src=x onerror="window.injected=true"> ' + 'detail '.repeat(120);`)
    const fleet = await (await request.get(`http://127.0.0.1:${port}/api/fleet`)).json()
    const q = fleet.projects[0].workflows[0].projection.context.questions[0].description
    expect(q.text).not.toContain("fixture secret with spaces"); expect(q.text).toContain("[REDACTED]")
    expect(q.truncated).toBe(true); expect(q.text.length).toBeLessThanOrEqual(600)
    await page.goto(workflowUrl())
    await expect(page.getByText("(shortened; full text is in Loom)", { exact: true })).toBeVisible()
    await expect(page.locator("img")).toHaveCount(0)
    expect(await page.evaluate(() => window.injected)).toBeUndefined()
    await page.setViewportSize({ width: 320, height: 900 })
    for (const theme of ["light", "dark"]) {
      await page.locator("#theme").selectOption(theme)
      await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true }))
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
  })
})
