import { test, expect } from "@playwright/test"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const cwd = resolve(import.meta.dirname, "..")
const project = "11111111-1111-4111-8111-111111111111"
const workflow = "22222222-2222-4222-8222-222222222222"
const coordinator = "ses_zzzzzzzzzzzzzzzzzzzzzzzzzz"
let root, runtime, state, server, port
const workflowURL = () => `http://127.0.0.1:${port}/#/directory/${project}/session/${coordinator}/workflow/${workflow}`
const legacyWorkflowURL = () => `http://127.0.0.1:${port}/#/project/${project}/workflow/${workflow}`
const sessionURL = () => `http://127.0.0.1:${port}/#/directory/${project}/session/${coordinator}`
const projectURL = () => `http://127.0.0.1:${port}/#/directory/${project}`
const snapshotPath = () => join(runtime, "instances/readable-installation/readable-publisher/projects", project + ".json")

async function publish(mode = "normal", index = 0) {
  await rm(runtime, { recursive: true, force: true })
  await new Promise((resolveRun, reject) => {
    const child = spawn("bun", ["dashboard/review-fixture.ts", runtime, mode, String(index)], { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", (b) => { output = (output + b).slice(-20_000) })
    child.stderr.on("data", (b) => { output = (output + b).slice(-20_000) })
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Fixture timed out")) }, 15_000)
    child.once("error", (error) => { clearTimeout(timer); reject(error) })
    child.once("exit", (code) => { clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`Fixture failed (${code}): ${output}`)) })
  })
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
}

function redigest(value) {
  const { stateDigest, ...body } = value
  value.stateDigest = createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex")
}

async function editSnapshot(change) {
  const s = JSON.parse(await readFile(snapshotPath(), "utf8"))
  change(s)
  s.generation += 1
  s.generatedAt = new Date().toISOString()
  s.workflows.forEach(redigest)
  s.workObjectives.forEach(redigest)
  const temp = snapshotPath() + ".tmp"
  await writeFile(temp, JSON.stringify(s))
  await rename(temp, snapshotPath())
}

async function preserveFocusAcrossUpdate(page, target, change = () => {}) {
  await expect(target).toHaveCount(1)
  await target.focus()
  await target.evaluate((node) => { node.dataset.beforeRefresh = "yes" })
  await editSnapshot(change)
  await expect(target).not.toHaveAttribute("data-before-refresh", "yes", { timeout: 8_000 })
  await expect(target).toBeFocused()
}

async function assertUniqueKeys(page) {
  const keys = await page.locator("[data-key]").evaluateAll((nodes) => nodes.map((node) => node.dataset.key))
  expect(keys).not.toContain("")
  expect(new Set(keys).size).toBe(keys.length)
  await expect(page.locator("#main a:not([data-key]), #breadcrumbs a:not([data-key])")).toHaveCount(0)
}

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "loom-review-regressions-"))
  runtime = join(root, "runtime")
  state = join(root, "state")
  await mkdir(join(state, "loom"), { recursive: true })
  await writeFile(join(state, "loom/runtime-root.json"), JSON.stringify({ schemaVersion: 1, runtimeRoot: runtime }))
  port = await new Promise((resolvePort, reject) => {
    const socket = createServer()
    socket.on("error", reject)
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address()
      if (!address || typeof address === "string") {
        socket.close(); reject(new Error("No free port")); return
      }
      socket.close((error) => error ? reject(error) : resolvePort(address.port))
    })
  })
  server = spawn("bun", ["dashboard/server.ts"], {
    cwd,
    env: { ...process.env, XDG_STATE_HOME: state, LOOM_DASHBOARD_PORT: String(port) },
    stdio: "pipe",
  })
  server.stdout.resume()
  server.stderr.resume()
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/health`)).ok } catch { return false }
  }, { timeout: 15_000 }).toBe(true)
})

test.beforeEach(async () => { await publish() })

test.afterAll(async () => {
  if (server && server.exitCode === null) await new Promise((done) => {
    const timer = setTimeout(() => { server.kill("SIGKILL"); done() }, 1500)
    server.once("exit", () => { clearTimeout(timer); done() })
    server.kill("SIGTERM")
  })
  await rm(root, { recursive: true, force: true })
})

test("R1: repeated wave IDs resolve the correct phase and owner route", async ({ page, request }) => {
  await publish("waves")
  const fleet = await (await request.get(`http://127.0.0.1:${port}/api/fleet`)).json()
  expect(fleet.projects[0].workflows[0].projection.workScope).toMatchObject({ phaseId: "delivery", waveId: "build" })

  await page.goto(workflowURL())
  await expect(page.locator("#view-title")).toHaveText("Build release package")

  await page.goto(projectURL())
  const advanced = page.locator('details[data-hierarchy-key^="work-map:"]')
  await advanced.locator(":scope > summary").click()
  const owners = page.locator('a[data-key^="owner:"]')
  await expect(owners).toHaveText(["Build release package", "Build release package"])
  await expect(owners.first()).toHaveAttribute("href", `#/directory/${project}/session/${coordinator}/workflow/${workflow}`)
  await owners.first().click()
  await expect(page.locator("#view-title")).toHaveText("Build release package")
})

test("R2: breadcrumb and work-map links retain focus through heartbeat and changed snapshots", async ({ page }) => {
  await page.goto(workflowURL())
  await expect(page.locator("#view-title")).toHaveText("Build persistence layer")

  for (const key of ["work-map", "crumb:home", "crumb:directory", "crumb:session"]) {
    const target = page.locator(`a[data-key^="link:${key}:"]`)
    await preserveFocusAcrossUpdate(page, target)
    await preserveFocusAcrossUpdate(page, target, (s) => { s.workflows[0].workflowRevision += 1 })
  }
  await assertUniqueKeys(page)
})

test("R2: session workflow link keeps focus when its human label changes", async ({ page }) => {
  await page.goto(sessionURL())
  const target = page.locator(`a[data-key="session:workflow:${workflow}"]`)
  let revision = 1
  await preserveFocusAcrossUpdate(page, target, (s) => {
    s.workObjectives[0].phases[0].waves[0].tasks[0].title = "Renamed persistence task " + revision++
    s.workObjectives[0].workVersion += 1
    s.workflows[0].workflowRevision += 1
  })
  await assertUniqueKeys(page)
})

test("R2: waiting recovery retains exact deep link and vanished targets announce fallback", async ({ page }) => {
  const missing = `http://127.0.0.1:${port}/#/directory/missing/session/missing/workflow/missing`
  await page.goto(missing)
  await expect(page.locator("#view-title")).toHaveText("Waiting for Loom state…")
  await preserveFocusAcrossUpdate(page, page.locator('a[data-key^="link:return:parent:"]'))
  await expect(page).toHaveURL(missing)

  await page.goto(workflowURL())
  const target = page.locator('a[data-key^="link:work-map:"]')
  await target.focus()
  await editSnapshot((s) => { s.workflows = [] })
  await expect(page.locator("#view-title")).toHaveText("Waiting for Loom state…", { timeout: 8_000 })
  await expect(page.locator("#live")).toContainText("previously focused item is no longer available")
  const recovery = page.locator('a[data-key^="link:return:parent:"]')
  await expect(recovery).toBeFocused()
  await expect(page).toHaveURL(workflowURL())
})

test("R3: unbroken requested outcome wraps without clipping at narrow and desktop widths", async ({ page }) => {
  await publish("overflow")
  await page.goto(workflowURL())
  const requestPanel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Requested outcome", exact: true }) })
  const text = "https://example.test/" + "x".repeat(600 - "https://example.test/".length)
  await expect(requestPanel.locator("p")).toHaveText(text)

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const theme of ["light", "dark"]) {
      await page.locator("#theme").selectOption(theme)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await requestPanel.locator("p").evaluate((node) => {
        const css = getComputedStyle(node)
        return css.overflowX !== "hidden" && css.textOverflow !== "ellipsis" && node.scrollWidth <= node.clientWidth
      })).toBe(true)
    }
  }
})

test("R4: home and Needs attention are simple reversible views", async ({ page }) => {
  const attention = `http://127.0.0.1:${port}/#/?status=attention`
  await page.goto(attention)
  await expect(page.locator("#view-title")).toHaveText("Needs attention")
  await page.locator('[data-key="nav:home"]').click()
  await expect(page.locator("#view-title")).toHaveText("Control panel")
  await expect(page).toHaveURL(`http://127.0.0.1:${port}/#/`)
  await page.goBack()
  await expect(page).toHaveURL(attention)
  await expect(page.locator("#view-title")).toHaveText("Needs attention")
})

test("legacy workflow URL remains a compatible navigation entry", async ({ page }) => {
  await page.goto(legacyWorkflowURL())
  await expect(page.locator("#view-title")).toHaveText("Build persistence layer")
  await expect(page.locator('a[data-key^="link:crumb:session:"]')).toBeVisible()
})

test("C1: synthetic Authorization values cannot reach persisted snapshots, API responses or rendered prose", async ({ page, request }) => {
  for (const index of [1, 2, 5, 11]) {
    await publish("secret", index)
    const raw = await readFile(snapshotPath(), "utf8")
    expect(raw).not.toContain("REVIEW_SENTINEL")

    const response = await request.get(`http://127.0.0.1:${port}/api/fleet`)
    const api = await response.text()
    expect(api).not.toContain("REVIEW_SENTINEL")
    const c = JSON.parse(api).projects[0].workflows[0].projection.context
    for (const field of [c.request, c.questions[0].description, c.verification[0].description, c.steps[0].reportedResult]) {
      expect(field.text).toContain("[REDACTED]")
    }

    await page.goto(workflowURL())
    await expect(page.locator("#main")).toContainText("Reported result:")
    expect(await page.locator("body").innerText()).not.toContain("REVIEW_SENTINEL")
  }
})

test("C2: retention warnings stay conservative when history coverage is limited or unknown", async ({ page, request }) => {
  await publish("history")
  const s = JSON.parse(await readFile(snapshotPath(), "utf8"))
  expect(s.projectionWindow).toEqual({ workflowsTruncated: true, completedObjectivesTruncated: true })
  const fleet = await (await request.get(`http://127.0.0.1:${port}/api/fleet`)).json()
  expect(fleet.projects[0].projectionWindow).toEqual(s.projectionWindow)

  await page.goto(projectURL())
  await expect(page.locator('[data-history="limited"]')).toContainText("At least one publisher limits its history")

  await editSnapshot((snapshot) => { delete snapshot.projectionWindow })
  await page.locator("#refresh").click()
  await expect(page.locator('[data-history="unknown"]')).toBeVisible()
  await expect(page.locator('[data-history="limited"]')).toHaveCount(0)
})

test("malformed scalar fields are rejected before adoption and last-good navigation still works", async ({ page, request }) => {
  const baseline = await (await request.get(`http://127.0.0.1:${port}/api/fleet`)).json()
  const errors = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto(workflowURL())
  await expect(page.locator("#view-title")).toHaveText("Build persistence layer")

  let payload = baseline
  await page.route("**/api/fleet", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) }))
  for (const mutate of [
    (p) => { p.workflows[0].projection.productAcceptance = { status: { toString: null } } },
    (p) => { p.workflows[0].projection.openOqCount = { toString: null } },
    (p) => { p.workflows[0].workflowRevision = { toString: null } },
    (p) => { p.workObjectives[0].projection.phases[0].waves[0].tasks[0].status = { toString: null } },
    (p) => { p.workflows[0].participants[0].live = "false" },
    (p) => { p.projectId = "\ud800" },
  ]) {
    payload = structuredClone(baseline)
    mutate(payload.projects[0])
    await page.locator("#refresh").click()
    await expect(page.locator("#refresh")).toBeEnabled()
    await expect(page.locator("#projection-status")).toContainText("Showing the last known Loom projection")
    await expect(page.locator('[aria-label="Workflow signals"] strong')).toHaveText(["0/1", "1", "1", "8/40"])

    await page.locator('a[data-key^="link:work-map:"]').click()
    await expect(page.locator("#view-title")).toHaveText("leash")
    await page.locator(`[data-key="session:${project}:${coordinator}"]`).click()
    await page.locator(`[data-key="session:workflow:${workflow}"]`).click()
    await expect(page.getByRole("heading", { name: "Current work", exact: true })).toBeVisible()
  }

  payload = baseline
  await page.locator("#refresh").click()
  await expect(page.locator("#projection-status")).toBeHidden()
  expect(errors).toEqual([])
})

test("rendered review evidence uses the real control-panel UI and production-style projection fixtures", async ({ page, request }, info) => {
  await page.goto(workflowURL())
  await expect(page.locator("#view-title")).toHaveText("Build persistence layer")
  await assertUniqueKeys(page)

  const html = await (await request.get(`http://127.0.0.1:${port}/`)).text()
  const fleet = await (await request.get(`http://127.0.0.1:${port}/api/fleet`)).text()
  await writeFile(info.outputPath("generated-ui.html"), html)
  await writeFile(info.outputPath("fleet.json"), fleet)

  for (const [theme, width, name] of [
    ["dark", 1440, "workflow-dark.png"],
    ["light", 1440, "workflow-light.png"],
    ["dark", 390, "workflow-mobile.png"],
  ]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.locator("#theme").selectOption(theme)
    await page.screenshot({ path: info.outputPath(name), fullPage: true })
  }
})
