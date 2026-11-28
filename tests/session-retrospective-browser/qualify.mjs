import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"

assert.ok(process.env.LOOM_HISTORY_BROWSER_DEPS, "Set the isolated browser dependency prefix")
assert.ok(process.argv[2] && process.argv[3], "Usage: node qualify.mjs FIXTURE_DIRECTORY REPORT_DIRECTORY")
const input = resolve(process.argv[2]), output = resolve(process.argv[3])
const dependencyRoot = resolve(process.env.LOOM_HISTORY_BROWSER_DEPS), deps = createRequire(join(dependencyRoot, "package.json"))
const { chromium } = deps("playwright"), { default: AxeBuilder } = deps("@axe-core/playwright")
const version = async name => JSON.parse(await readFile(join(dependencyRoot, "node_modules", name, "package.json"), "utf8")).version
const versions = { playwright: await version("playwright"), axePlaywright: await version("@axe-core/playwright") }
assert.equal(versions.playwright, "1.65.1")
assert.equal(versions.axePlaywright, "4.14.1")
const fixtureText = await readFile(join(input, "manifest.json"), "utf8"), manifest = JSON.parse(fixtureText)
assert.equal(manifest.format, "loom-session-retrospective-browser-fixtures/v1")
if (process.env.EXPECT_HEAD) assert.equal(manifest.head, process.env.EXPECT_HEAD)
const required = ["session-preview", "preview-original", "established-preview", "session-frozen", "evaluation-report", "evaluation-sources",
  "learning-progress", "learning-resumed", "learning-latest", "learning-earlier-original"]
for (const name of required) assert.ok(manifest.fixtures.some(item => item.name === name), "Required scene: " + name)
assert.deepEqual(manifest.boundaries.no_prerequisites, { actions: 0, plans: 0, objectives: 0 })
assert.equal(manifest.boundaries.preview_unchanged, true)
assert.equal(manifest.boundaries.membership_unchanged_after_evaluation, true)
assert.ok(!manifest.boundaries.frozen_member_ids.includes(manifest.boundaries.concurrent_append))
assert.equal(manifest.resources.native_history_enumerations, 0)
assert.equal(manifest.resources.native_context_injections, 0)
assert.equal(manifest.resources.native_model_prompts, 0)
const sha256 = value => createHash("sha256").update(value).digest("hex")
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const report = { format: "loom-session-retrospective-browser-qualification/v1", head: manifest.head,
  generated_at: new Date().toISOString(), execution_environment: process.env.GITHUB_ACTIONS === "true" ? "isolated-github-actions" : "local-controlled-fixture",
  versions, node: process.version, browser: null, fixture_manifest_sha256: sha256(fixtureText), source_sha256: manifest.source_sha256,
  fixtures: [], selected_reads: [], resources: manifest.resources, passed: false,
  limitations: [...manifest.limitations, "Scripted task assertions are separate from a fresh agent's independent comprehension assessment.",
    "Keyboard, Chromium, axe and 390px reflow checks do not certify manual screen-reader use or operating-system magnification."] }
await mkdir(output, { recursive: true })
function readOriginal(tool, request) {
  const started = performance.now()
  const response = execFileSync(process.env.LOOM_BROWSER_BUN ?? "bun", ["tests/session-retrospective-browser/read.ts", input, tool, JSON.stringify(request)],
    { cwd: root, encoding: "utf8", maxBuffer: 300000 })
  report.selected_reads.push({ tool, request, elapsed_ms: performance.now() - started, returned_bytes: Buffer.byteLength(response), sha256: sha256(response) })
  return JSON.parse(response).result
}
let browser
try {
  browser = await chromium.launch({ headless: true })
  report.browser = browser.version()
  for (const fixture of manifest.fixtures) {
    const result = { name: fixture.name, checks: [], network_requests: [], errors: [], artifacts: [], passed: false }
    report.fixtures.push(result)
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce", colorScheme: "light", serviceWorkers: "block" })
    context.on("request", request => result.network_requests.push({ method: request.method(), url: request.url() }))
    await context.route("**/*", route => route.abort("blockedbyclient"))
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    page.on("pageerror", error => result.errors.push(String(error)))
    page.on("dialog", async dialog => { result.errors.push(dialog.message()); await dialog.dismiss() })
    const check = async (name, task) => {
      const started = performance.now()
      try { const evidence = await task(); result.checks.push({ name, elapsed_ms: performance.now() - started, evidence, passed: true }) }
      catch (error) { result.checks.push({ name, passed: false, error: String(error) }); throw error }
    }
    try {
      const html = await readFile(join(input, fixture.html), "utf8"), json = await readFile(join(input, fixture.json), "utf8"), markdown = await readFile(join(input, fixture.markdown), "utf8")
      const view = JSON.parse(json).result
      await check("exact protected representations", async () => {
        const digests = { html: sha256(html), json: sha256(json), markdown: sha256(markdown) }
        assert.deepEqual(digests, fixture.sha256)
        assert.deepEqual(digests, fixture.disclosure_sha256)
        assert.ok(Buffer.byteLength(html) <= 262144)
        return { bytes: Buffer.byteLength(html), digests }
      })
      await page.setContent(html, { waitUntil: "load" })
      await check("semantic document, inert content and working local anchors", async () => {
        assert.equal(await page.locator("html").getAttribute("lang"), "en")
        assert.equal(await page.getByRole("main").count(), 1)
        assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1)
        assert.equal(await page.locator("meta[http-equiv='Content-Security-Policy']").getAttribute("content"), "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
        assert.equal(await page.locator("script,iframe,img,form").count(), 0)
        const anchors = await page.locator('a[href^="#"]').evaluateAll(links => links.map(link => ({ href: link.getAttribute("href"), exists: !!document.getElementById(link.hash.slice(1)) })))
        assert.ok(anchors.length)
        assert.ok(anchors.every(link => link.exists), JSON.stringify(anchors))
        const ids = await page.locator("[id]").evaluateAll(elements => elements.map(element => element.id))
        assert.equal(new Set(ids).size, ids.length)
        return { headings: await page.getByRole("heading").allTextContents(), anchors: anchors.length }
      })
      await check("keyboard skip link and native disclosure", async () => {
        await page.keyboard.press("Tab")
        const active = page.locator(":focus")
        assert.ok((await active.getAttribute("class"))?.includes("skip"))
        const target = (await active.getAttribute("href")).slice(1)
        await page.keyboard.press("Enter")
        assert.equal(await page.evaluate(() => document.activeElement?.id), target)
        const summary = page.locator("details > summary").first()
        if (await summary.count()) {
          await summary.focus(); await page.keyboard.press("Enter")
          assert.equal(await summary.evaluate(element => element.parentElement.open), true)
          assert.equal(await summary.evaluate(element => element === document.activeElement), true)
          await page.keyboard.press("Space")
          assert.equal(await summary.evaluate(element => element.parentElement.open), false)
        }
        return { target }
      })
      if (["session-preview", "established-preview", "session-frozen"].includes(fixture.name)) await check("understand the chronological foundation and inspect before freezing", async () => {
        const visible = await page.locator("body").innerText()
        assert.ok(visible.includes("The original user request is not independently established"))
        assert.ok(visible.includes("does not establish that the Session"))
        const trajectory = page.locator("#trajectory")
        const steps = await trajectory.locator("ol > li").allTextContents()
        assert.equal(steps.length, 6)
        assert.ok(steps[0].includes("Intent: investigate"))
        assert.ok(steps[1].includes("Restarting Waybar did not"))
        assert.ok(steps[3].includes("Correction:"))
        assert.ok(steps[5].includes("Aborted alternative"))
        assert.ok(!visible.includes("Later continuation:"))
        const link = trajectory.getByRole("link").nth(2), target = (await link.getAttribute("href")).slice(1)
        await link.click()
        const card = page.locator("#" + target), summary = card.locator("summary")
        if (!await card.evaluate(element => element.open)) { await summary.focus(); await page.keyboard.press("Enter") }
        assert.equal(await card.getAttribute("open"), "")
        await card.getByText("Exact original request and source metadata", { exact: true }).click()
        const item = JSON.parse(await card.locator("pre code").textContent())
        assert.ok(item.inspect)
        if (fixture.name === "session-preview") {
          assert.equal(item.inspect.operation, "preview-source")
          const original = readOriginal("history", item.inspect)
          assert.ok(JSON.stringify(original).includes("Ethernet was not retested"))
        }
        return { ordered_steps: steps, inspect_operation: item.inspect.operation, later_continuation_included: false }
      })
      if (fixture.name === "evaluation-report") await check("follow a conclusion through counterevidence and return to the finding", async () => {
        const finding = page.locator("#claims-item-0")
        assert.ok((await finding.innerText()).includes("unresolved Ethernet coverage limit"))
        assert.ok((await finding.innerText()).includes("does not contradict the reported Wi-Fi pass"))
        const link = finding.locator('a[href^="#evidence-"]').last(), id = (await link.getAttribute("href")).slice(1)
        await link.click()
        assert.equal(await page.evaluate(() => document.activeElement?.id), id)
        const evidence = page.locator("#" + id)
        assert.ok((await evidence.innerText()).includes("Ethernet was not retested"))
        const inspect = evidence.locator("details").filter({ has: page.getByText("Read this exact original", { exact: true }) })
        await inspect.locator("summary").click()
        const request = JSON.parse(await inspect.locator("pre code").textContent())
        const original = readOriginal("history", request)
        assert.ok(JSON.stringify(original).includes("Ethernet was not retested"))
        await evidence.locator('a[href="#claims-item-0"]').click()
        assert.equal(await page.evaluate(() => document.activeElement?.id), "claims-item-0")
        assert.equal(await page.locator("#report-technical").getAttribute("open"), null)
        return { source_request: request, support_and_scope_limit_distinguished: true, backlink_target: "claims-item-0" }
      })
      if (fixture.name === "learning-progress") await check("distinguish catch-up from completion and retrieve an earlier finding", async () => {
        const body = await page.locator("body").innerText()
        assert.ok(body.includes("not proof that the Session"))
        assert.ok(body.includes("Processed through the observed boundary"))
        const latest = page.locator("#increment-0")
        assert.ok((await latest.innerText()).includes("3 new eligible sources"))
        assert.ok((await latest.innerText()).includes("Ethernet was not retested"))
        const details = latest.locator("details").filter({ has: page.getByText("Read the linked original", { exact: true }) }).first()
        await details.locator("summary").click()
        const request = JSON.parse(await details.locator("pre code").textContent())
        assert.equal(request.batch_id, manifest.boundaries.increments.first)
        assert.notEqual(request.batch_id, manifest.boundaries.increments.second)
        assert.ok(JSON.stringify(readOriginal("insights", request)).includes("Ethernet was not retested"))
        return { repeated_idle_reused_batch: manifest.boundaries.increments.repeated === manifest.boundaries.increments.first,
          new_sources_only: 3, original_request: request, caught_up_is_completion: false }
      })
      if (fixture.name === "learning-resumed") await check("show resumed work pending after an earlier caught-up boundary", async () => {
        assert.equal(view.state, "pending")
        const body = await page.locator("body").innerText()
        assert.ok(body.includes("New evidence is waiting"))
        assert.ok(body.includes("Ethernet was not retested"))
        assert.ok(view.observed.ledger > view.committed.ledger)
        return { observed: view.observed, committed: view.committed, original_concern_retained: true }
      })
      await check("accessibility and mobile reflow", async () => {
        const desktop = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
        assert.deepEqual(desktop.violations, [], "Desktop axe violations")
        const desktopFile = fixture.name + "-desktop.png"
        await page.screenshot({ path: join(output, desktopFile), fullPage: false, animations: "disabled" })
        result.artifacts.push(desktopFile)
        await page.setViewportSize({ width: 390, height: 844 })
        const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: document.documentElement.clientWidth }))
        assert.ok(widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1, JSON.stringify(widths))
        const mobile = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
        assert.deepEqual(mobile.violations, [], "Mobile axe violations")
        const mobileFile = fixture.name + "-mobile.png"
        await page.screenshot({ path: join(output, mobileFile), fullPage: false, animations: "disabled" })
        result.artifacts.push(mobileFile)
        return { widths, desktop_passes: desktop.passes.length, mobile_passes: mobile.passes.length }
      })
      assert.deepEqual(result.network_requests, [])
      assert.deepEqual(result.errors, [])
      result.passed = true
    } finally { await context.close() }
  }
  report.passed = report.fixtures.length === manifest.fixtures.length && report.fixtures.every(item => item.passed)
} finally {
  await browser?.close()
  await writeFile(join(output, "qualification.json"), JSON.stringify(report, null, 2))
}
assert.equal(report.passed, true)
console.log(JSON.stringify({ passed: report.passed, fixtures: report.fixtures.length, selected_reads: report.selected_reads.length,
  selected_bytes: report.selected_reads.reduce((total, row) => total + row.returned_bytes, 0), output }))
