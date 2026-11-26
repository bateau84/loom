import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve, join } from "node:path"

// Run only on the isolated CI runner. The input is freshly generated registered-
// tool output from synthetic histories, never a developer's private history.
assert.equal(process.env.GITHUB_ACTIONS, "true", "Browser qualification runs in isolated GitHub CI")
assert.ok(process.env.LOOM_HISTORY_BROWSER_DEPS, "Set the isolated browser dependency prefix")
const deps = createRequire(join(resolve(process.env.LOOM_HISTORY_BROWSER_DEPS), "package.json"))
const { chromium } = deps("playwright")
const { default: AxeBuilder } = deps("@axe-core/playwright")
const versions = { playwright: deps("playwright/package.json").version,
  axePlaywright: deps("@axe-core/playwright/package.json").version }
assert.equal(versions.playwright, "1.65.1")
assert.equal(versions.axePlaywright, "4.14.1")
assert.ok(process.argv[2] && process.argv[3], "Usage: qualify.mjs FIXTURE_DIRECTORY REPORT_DIRECTORY")
const input = resolve(process.argv[2]), output = resolve(process.argv[3])
await mkdir(output, { recursive: true })
const manifestText = await readFile(join(input, "manifest.json"), "utf8")
const manifest = JSON.parse(manifestText)
assert.equal(manifest.format, "loom-engineering-history-browser-fixtures/v1")
assert.equal(manifest.head, process.env.EXPECT_HEAD, "Fixtures must come from the exact qualified head")
assert.ok(manifest.fixtures.length >= 6, "Qualify adversarial planned/unplanned discovery and expansion")
for (const name of ["planned-overview", "planned-discovery", "planned-selected", "planned-historical", "planned-children",
  "unplanned-overview", "unplanned-discovery", "unplanned-selected", "unplanned-children", "unplanned-children-next", "dense-hostile"])
  assert.ok(manifest.fixtures.some(fixture => fixture.name === name), `Required browser scene: ${name}`)
const sha256 = value => createHash("sha256").update(value).digest("hex")
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const report = { format: "loom-engineering-history-browser-qualification/v1", head: manifest.head,
  generated_at: new Date().toISOString(), versions, node: process.version, browser: null,
  fixture_manifest_sha256: sha256(manifestText), source_sha256: manifest.source_sha256,
  boundary_checks: manifest.boundaries, fixtures: [], passed: false,
  limitations: ["Automated Chromium and axe checks do not establish manual screen-reader usability.",
    "390 CSS-pixel reflow is exercised; operating-system magnification and manual browser zoom are not certified.",
    "Fixtures use the actual registered tool and storage with a simulated native registration/permission owner; installed-host authorization is qualified separately."] }
let browser
try {
  browser = await chromium.launch({ headless: true })
  report.browser = browser.version()
  for (const fixture of manifest.fixtures) {
    assert.match(fixture.name, /^[a-z0-9-]+$/)
    const result = { name: fixture.name, query: fixture.request, checks: [], artifacts: [], requests: [], errors: [], passed: false }
    report.fixtures.push(result)
    const directory = join(output, fixture.name)
    await mkdir(directory, { recursive: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce",
      colorScheme: "light", serviceWorkers: "block" })
    context.on("request", request => result.requests.push({ method: request.method(), url: request.url() }))
    await context.route("**/*", route => route.abort("blockedbyclient"))
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    page.on("pageerror", error => result.errors.push(String(error)))
    page.on("dialog", async dialog => { result.errors.push(`Unexpected ${dialog.type()}: ${dialog.message()}`); await dialog.dismiss() })
    const check = async (name, fn) => {
      const started = Date.now()
      try { const evidence = await fn(); result.checks.push({ name, passed: true, elapsed_ms: Date.now() - started, evidence }) }
      catch (error) { result.checks.push({ name, passed: false, error: String(error) }); throw error }
    }
    const screenshot = async name => {
      const file = `${name}.png`
      await page.screenshot({ path: join(directory, file), fullPage: false, animations: "disabled" })
      result.artifacts.push(file)
    }
    const focus = async locator => {
      await locator.focus()
      assert.equal(await locator.evaluate(element => element === document.activeElement), true)
    }
    const inViewport = async locator => {
      const box = await locator.boundingBox(), viewport = page.viewportSize()
      assert.ok(box && viewport && box.width > 0 && box.height > 0)
      assert.ok(box.x >= -1 && box.x + box.width <= viewport.width + 1, `Target fits horizontally: ${JSON.stringify(box)}`)
      assert.ok(box.y >= -1 && box.y < viewport.height, `Target starts in viewport: ${JSON.stringify(box)}`)
      return box
    }
    const noOverflow = async () => {
      const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth, viewport: document.documentElement.clientWidth }))
      assert.ok(widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1, JSON.stringify(widths))
      return widths
    }
    const keyboardToggle = async (summary, key, open) => {
      await focus(summary)
      await page.keyboard.press(key)
      await page.waitForFunction(({ id, expected }) => {
        const element = id ? document.getElementById(id) : document.activeElement
        return element?.tagName === "SUMMARY" && element.parentElement.open === expected
      }, { id: await summary.getAttribute("id"), expected: open })
      assert.equal(await summary.evaluate(element => element === document.activeElement), true)
    }
    try {
      const html = await readFile(join(input, fixture.html), "utf8")
      const jsonText = await readFile(join(input, fixture.json), "utf8")
      const markdown = await readFile(join(input, fixture.markdown), "utf8")
      const view = JSON.parse(jsonText).result
      assert.equal(view.format, "loom-engineering-history/v1")
      await check("exact registered response digests", async () => {
        assert.equal(sha256(html), fixture.sha256.html)
        assert.equal(sha256(jsonText), fixture.sha256.json)
        assert.equal(sha256(markdown), fixture.sha256.markdown)
        assert.deepEqual(fixture.disclosure_sha256, fixture.sha256)
        assert.ok(Buffer.byteLength(html) <= 262144)
        return { ...fixture.sha256, html_bytes: Buffer.byteLength(html) }
      })
      await page.setContent(html, { waitUntil: "load" })
      await check("semantic landmarks, source parity and inert text", async () => {
        assert.equal(await page.locator("html").getAttribute("lang"), "en")
        assert.equal(await page.getByRole("main").count(), 1)
        assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1)
        assert.equal(await page.getByRole("navigation", { name: "History layers" }).count(), 1)
        const text = await page.locator("body").textContent()
        for (const source of fixture.sources) for (const value of [source.record_id, source.sha256, source.ref]) {
          assert.ok(text.includes(value), `HTML contains ${value}`)
          assert.ok(markdown.includes(value), `Markdown contains ${value}`)
        }
        for (const value of fixture.required_text) assert.ok(text.includes(value), `Required view text: ${value}`)
        for (const relationship of view.relationships) for (const value of Object.values(relationship))
          assert.ok(text.includes(value), `Complete relationship value: ${value}`)
        for (const record of [...view.highlights, ...view.records]) if (record.excerpt !== null)
          assert.ok(text.includes(record.excerpt), "The complete projected excerpt remains present after shortening the overview preview")
        const parsedRequests = (await page.locator("pre > code").allTextContents()).flatMap(value => {
          try { return [JSON.parse(value)] } catch { return [] }
        })
        for (const request of fixture.history_requests) assert.ok(parsedRequests.some(value => canonical(value) === canonical(request)),
          `Copyable exact expansion request ${canonical(request)}`)
        const structure = await page.evaluate(() => ({
          unsafe: document.querySelectorAll("script,iframe,frame,object,embed,img,video,audio,form,input,button,link,base").length,
          handlers: [...document.querySelectorAll("*")].flatMap(element => [...element.attributes].filter(attr => /^on/i.test(attr.name))),
          urls: [...document.querySelectorAll("[src],[href],[action]")].map(element => element.getAttribute("src") ?? element.getAttribute("href") ?? element.getAttribute("action")),
          ids: [...document.querySelectorAll("[id]")].map(element => element.id),
          missingTargets: [...document.querySelectorAll("a[href^='#']")].filter(anchor => !document.getElementById(anchor.getAttribute("href").slice(1))).map(anchor => anchor.getAttribute("href")),
          injected: globalThis.__loomHostileExecuted,
        }))
        assert.equal(structure.unsafe, 0)
        assert.equal(structure.handlers.length, 0)
        assert.ok(structure.urls.every(url => url?.startsWith("#")))
        assert.equal(new Set(structure.ids).size, structure.ids.length)
        assert.deepEqual(structure.missingTargets, [])
        assert.equal(structure.injected, undefined)
        for (const hostile of fixture.hostile_text ?? []) assert.ok(text.includes(hostile), "Hostile source remains literal text")
        return { source_count: fixture.sources.length, history_request_count: fixture.history_requests.length,
          fragment_count: structure.urls.length, view_mode: view.mode }
      })
      await check("real Tab order, skip link and native Enter/Space disclosure", async () => {
        await page.keyboard.press("Tab")
        assert.equal(await page.locator(".skip").evaluate(element => element === document.activeElement), true)
        const style = await page.locator(".skip").evaluate(element => ({ visible: element.matches(":focus-visible"),
          width: getComputedStyle(element).outlineWidth, style: getComputedStyle(element).outlineStyle }))
        assert.equal(style.visible, true)
        assert.ok(parseFloat(style.width) >= 2 && style.style !== "none")
        await inViewport(page.locator(".skip"))
        await screenshot("keyboard-focus-desktop")
        for (const anchor of await page.locator("nav[aria-label='History layers'] > a").all()) {
          await page.keyboard.press("Tab")
          assert.equal(await anchor.evaluate(element => element === document.activeElement), true)
        }
        await page.keyboard.press("Tab")
        const summary = page.locator("#overview details > summary").first()
        assert.equal(await summary.evaluate(element => element === document.activeElement), true)
        await keyboardToggle(summary, "Enter", true)
        await keyboardToggle(summary, "Space", false)
        const cdp = await context.newCDPSession(page)
        const { nodes } = await cdp.send("Accessibility.getFullAXTree")
        await cdp.detach()
        assert.ok(nodes.some(node => !node.ignored && node.name?.value === "Source scope and boundary"
          && node.properties?.some(property => property.name === "expanded" && property.value.value === false)),
        "Chromium accessibility tree exposes collapsed disclosure state")
        await page.locator(".skip").press("Enter")
        await page.waitForFunction(() => location.hash === "#overview")
        assert.equal(await page.locator("#overview").evaluate(element => element === document.activeElement), true)
        await inViewport(page.locator("#overview"))
        return style
      })
      await check("source fragment reveals closed details and transfers focus", async () => {
        const sourceLink = page.locator(".source-index a").first()
        assert.ok(await sourceLink.count(), "Fixture includes an original source")
        const href = await sourceLink.getAttribute("href")
        assert.match(href, /^#record-\d+-source$/)
        const target = page.locator(href)
        assert.equal(await target.evaluate(element => element.closest("details").open), false)
        await page.locator("nav[aria-label='History layers'] a[href='#originals']").press("Enter")
        await page.waitForFunction(() => document.activeElement?.id === "originals")
        await page.keyboard.press("Tab")
        assert.equal(await sourceLink.evaluate(element => element === document.activeElement), true)
        await page.keyboard.press("Enter")
        await page.waitForFunction(id => {
          const target = document.getElementById(id)
          return location.hash === `#${id}` && target === document.activeElement && target.closest("details").open
        }, href.slice(1))
        await inViewport(target)
        await screenshot("original-source-revealed")
        const summary = target.locator("xpath=ancestor::details[1]/summary")
        await keyboardToggle(summary, "Space", false)
        return { href, revealed_by: "native fragment navigation after keyboard Enter", closed_by: "keyboard Space" }
      })
      await check("internal record references and typed relationship targets", async () => {
        const link = page.locator(".highlights a[href^='#record-']").first()
        if (await link.count()) {
          const href = await link.getAttribute("href")
          await link.press("Enter")
          await page.waitForFunction(id => document.activeElement?.id === id, href.slice(1))
          await inViewport(page.locator(href))
          await keyboardToggle(page.locator(href), "Enter", true)
          await keyboardToggle(page.locator(href), "Space", false)
        }
        const relationship = page.locator(".relationships a[href^='#record-']").first()
        if (await relationship.count()) {
          const href = await relationship.getAttribute("href")
          await relationship.press("Enter")
          await page.waitForFunction(id => document.activeElement?.id === id, href.slice(1))
          await inViewport(page.locator(href))
        }
        const qualification = page.locator(".relationships a[href^='#qualification-']").first()
        if (await qualification.count()) {
          const href = await qualification.getAttribute("href")
          await qualification.press("Enter")
          await page.waitForFunction(id => document.activeElement?.id === id, href.slice(1))
          await inViewport(page.locator(href))
        }
        return { highlighted_link: await link.count(), relationship_link: await relationship.count(),
          qualification_link: await qualification.count() }
      })
      await page.evaluate(() => scrollTo(0, 0))
      await screenshot("overview-desktop")
      await check("390px collapsed reflow", async () => {
        await page.setViewportSize({ width: 390, height: 844 })
        await page.evaluate(() => scrollTo(0, 0))
        const sizes = await noOverflow()
        await screenshot("overview-390px")
        return sizes
      })
      await check("WCAG automated audit before opening all disclosures", async () => {
        const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()
        await writeFile(join(directory, "axe-collapsed-390px.json"), JSON.stringify(audit, null, 2) + "\n")
        result.artifacts.push("axe-collapsed-390px.json")
        assert.deepEqual(audit.violations, [], "See axe-collapsed-390px.json for violations")
        return { passes: audit.passes.length, incomplete: audit.incomplete.length }
      })
      await check("native expansion of every returned hierarchy and record", async () => {
        const summaries = await page.locator("details > summary").all()
        for (const summary of summaries) if (!await summary.evaluate(element => element.parentElement.open)) {
          await keyboardToggle(summary, "Enter", true)
        }
        assert.equal(await page.locator("details:not([open])").count(), 0)
        assert.equal(await page.locator(".relationships > li").count(), view.relationships.length)
        if (fixture.dense) assert.ok(view.relationships.length >= 100, "Dense qualification retains at least 100 typed edges")
        const sizes = await noOverflow()
        await page.locator("#execution").scrollIntoViewIfNeeded()
        await screenshot("expanded-hierarchy-390px")
        return { expanded_disclosures: summaries.length, relationships: view.relationships.length, ...sizes }
      })
      await check("Chromium accessibility tree exposes native expanded state", async () => {
        const cdp = await context.newCDPSession(page)
        const { nodes } = await cdp.send("Accessibility.getFullAXTree")
        await cdp.detach()
        const exposed = nodes.filter(node => !node.ignored)
        assert.ok(exposed.some(node => node.role?.value === "main"))
        assert.ok(exposed.some(node => node.role?.value === "navigation" && node.name?.value === "History layers"))
        assert.ok(exposed.some(node => ["DisclosureTriangle", "button"].includes(node.role?.value)
          && node.properties?.some(property => property.name === "expanded" && property.value.value === true)))
        await writeFile(join(directory, "chromium-accessibility-tree.json"), JSON.stringify({ nodes }, null, 2) + "\n")
        await writeFile(join(directory, "aria-snapshot.txt"), await page.locator("body").ariaSnapshot() + "\n")
        result.artifacts.push("chromium-accessibility-tree.json", "aria-snapshot.txt")
        return { exposed_nodes: exposed.length }
      })
      await check("WCAG automated audit of expanded 390px document", async () => {
        const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()
        await writeFile(join(directory, "axe-expanded-390px.json"), JSON.stringify(audit, null, 2) + "\n")
        result.artifacts.push("axe-expanded-390px.json")
        assert.deepEqual(audit.violations, [], "See axe-expanded-390px.json for violations")
        return { passes: audit.passes.length, incomplete: audit.incomplete.length }
      })
      await check("forced colors retain visible keyboard focus", async () => {
        await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" })
        const summary = page.locator("#overview details > summary").first()
        await focus(summary)
        await page.keyboard.press("Space")
        const style = await summary.evaluate(element => ({ visible: element.matches(":focus-visible"),
          width: getComputedStyle(element).outlineWidth, style: getComputedStyle(element).outlineStyle,
          forced: matchMedia("(forced-colors: active)").matches }))
        assert.equal(style.forced, true)
        assert.equal(style.visible, true)
        assert.ok(parseFloat(style.width) >= 2 && style.style !== "none")
        await noOverflow()
        await screenshot("forced-colors-focus-390px")
        return style
      })
      await check("no document network activity or injected execution", async () => {
        assert.deepEqual(result.requests, [])
        assert.deepEqual(result.errors, [])
        assert.equal(await page.evaluate(() => globalThis.__loomHostileExecuted), undefined)
        return { requests: 0, page_errors: 0, dialogs: 0 }
      })
      result.passed = true
    } catch (error) {
      result.error = error instanceof Error ? error.stack : String(error)
      try { await screenshot("failure") } catch { /* Preserve the original failure if Chromium terminated. */ }
    } finally {
      await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n")
      await context.close()
    }
    console.log(`${result.passed ? "PASS" : "FAIL"} ${fixture.name}: ${result.checks.filter(check => check.passed).length} checks`)
  }
  report.passed = report.fixtures.every(fixture => fixture.passed)
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error)
} finally {
  await browser?.close()
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n")
}
assert.equal(report.passed, true, "Browser qualification failed; inspect report.json and per-fixture artifacts")
