import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve, join } from "node:path"

// Run only on the isolated CI runner. The input is freshly generated registered-
// tool output from synthetic histories, never a developer's private history.
assert.equal(process.env.GITHUB_ACTIONS, "true", "Browser qualification runs in isolated GitHub CI")
assert.ok(process.env.LOOM_HISTORY_BROWSER_DEPS, "Set the isolated browser dependency prefix")
const dependencyRoot = resolve(process.env.LOOM_HISTORY_BROWSER_DEPS)
const deps = createRequire(join(dependencyRoot, "package.json"))
const { chromium } = deps("playwright")
const { default: AxeBuilder } = deps("@axe-core/playwright")
// Package metadata is not necessarily an exported module subpath (axe's is
// deliberately private). Read the metadata from the explicit CI-only prefix.
const packageVersion = async name => JSON.parse(await readFile(join(dependencyRoot, "node_modules", name, "package.json"), "utf8")).version
const versions = { playwright: await packageVersion("playwright"), axePlaywright: await packageVersion("@axe-core/playwright") }
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
  "unplanned-overview", "unplanned-discovery", "unplanned-selected", "unplanned-children", "unplanned-children-next", "dense-hostile",
  "trajectory-discovery", "trajectory-connected", "trajectory-page", "trajectory-page-next",
  "population-preview", "population-preview-next", "population-frozen", "population-frozen-next", "population-frozen-missing",
  "connections-source", "connections-groups", "connections-edges", "connections-review", "connections-review-next"])
  assert.ok(manifest.fixtures.some(fixture => fixture.name === name), `Required browser scene: ${name}`)
const sha256 = value => createHash("sha256").update(value).digest("hex")
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const populationBoundary = manifest.boundaries.find(boundary => boundary.name === "frozen-population-complete-bounded-readback")
assert.ok(populationBoundary?.pages.length > 1, "Frozen population qualification reconstructs more than one page")
const reconstructed = []
let expectedRequest
for (const name of populationBoundary.pages) {
  const fixture = manifest.fixtures.find(item => item.name === name)
  assert.ok(fixture, `Frozen continuation scene exists: ${name}`)
  const view = JSON.parse(await readFile(join(input, fixture.json), "utf8")).result
  assert.equal(view.format, "loom-retrospective-population-view/v1")
  assert.equal(view.population_id, populationBoundary.population_id)
  assert.equal(view.manifest_sha256, populationBoundary.manifest_sha256)
  assert.equal(view.member_count, populationBoundary.member_count)
  if (expectedRequest) assert.equal(canonical(view.navigation.repeat), canonical(expectedRequest))
  for (const item of view.items) {
    assert.equal(item.ordinal, reconstructed.length + 1)
    reconstructed.push(item.key)
  }
  expectedRequest = view.navigation.next
}
assert.equal(expectedRequest, null)
assert.deepEqual(reconstructed, populationBoundary.source_keys)
assert.equal(new Set(reconstructed).size, populationBoundary.member_count)
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
      assert.ok(["loom-engineering-history/v1", "loom-retrospective-population-view/v1"].includes(view.format))
      const population = view.format === "loom-retrospective-population-view/v1"
      const navigationLabel = population ? "Population sections" : "History layers"
      const firstSummary = population ? "#members details > summary" : "#overview details > summary"
      const skipTarget = population ? "population" : "overview"
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
        assert.equal(await page.getByRole("navigation", { name: navigationLabel }).count(), 1)
        assert.equal(await page.locator("meta[http-equiv='Content-Security-Policy']").getAttribute("content"),
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
        assert.equal(await page.locator("meta[name='referrer']").getAttribute("content"), "no-referrer")
        const text = await page.locator("body").textContent()
        const parsedRequests = (await page.locator("pre > code").allTextContents()).flatMap(value => {
          try { return [JSON.parse(value)] } catch { return [] }
        })
        const markdownRequests = [...markdown.matchAll(/(?:^|\n)((?:    [^\n]*\n)+)/g)].flatMap(match => {
          try { return [JSON.parse(match[1].split("\n").map(line => line.slice(4)).join("\n"))] } catch { return [] }
        })
        if (population) {
          const expected = [{ population_id: view.population_id, manifest_sha256: view.manifest_sha256,
            owner_session: view.owner_session, frozen_by: view.frozen_by, created_at: view.created_at,
            member_count: view.member_count, manifest: view.manifest }, ...view.items,
          { navigation: view.navigation, freeze: view.freeze, availability_scope: view.availability_scope, execution_permit: view.execution_permit }]
          assert.equal(canonical(parsedRequests), canonical(expected),
            "HTML retains every selected member, version, view, relationship basis, qualification and navigation field")
          assert.equal(canonical(markdownRequests), canonical(expected),
            "Markdown retains the same complete population fields as JSON and HTML")
          assert.equal(view.manifest.coverage.objective_count, 1)
          assert.equal(view.manifest.coverage.complete_selected_membership, true)
          assert.equal(view.execution_permit, null)
          assert.equal(await page.locator("#members details.card").count(), view.items.length)
          assert.ok(text.includes(view.manifest.selection.question))
          assert.ok(text.includes(view.state === "frozen" ? "Frozen selected membership" : "Read-only selection preview"))
          const objects = value => value && typeof value === "object" ? [value, ...Object.values(value).flatMap(objects)] : []
          for (const request of fixture.population_requests) {
            assert.ok(parsedRequests.flatMap(objects).some(value => canonical(value) === canonical(request)), "Exact HTML population request")
            assert.ok(markdownRequests.flatMap(objects).some(value => canonical(value) === canonical(request)), "Exact Markdown population request")
          }
          for (const [index, item] of view.items.entries()) {
            assert.equal(item.ordinal, view.navigation.repeat.after + index + 1)
            if (view.state === "frozen") assert.deepEqual(item.inspect, { operation: "population-source",
              population_id: view.population_id, manifest_sha256: view.manifest_sha256, member_key: item.key })
            else assert.equal(item.inspect, null)
          }
          if (view.navigation.next) {
            assert.equal(view.navigation.next.after, view.items.at(-1).ordinal)
            const { after: _repeatAfter, ...repeat } = view.navigation.repeat
            const { after: _nextAfter, ...next } = view.navigation.next
            assert.deepEqual(next, repeat, "Continuation retains the exact population or pinned selection")
          }
          if (fixture.name === "population-frozen-missing") {
            assert.equal(view.items[0].availability, "available")
            assert.equal(view.items[0].current.status, "missing")
            assert.ok(text.includes("frozen available") && text.includes("current missing"))
          }
        } else {
          for (const source of fixture.sources) for (const value of [source.record_id, source.sha256, source.ref]) {
            assert.ok(text.includes(value), `HTML contains ${value}`)
            assert.ok(markdown.includes(value), `Markdown contains ${value}`)
          }
          const values = value => value && typeof value === "object" ? Object.values(value).flatMap(values) : [value]
          for (const relationship of view.relationships) for (const value of values(relationship))
            assert.ok(text.includes(String(value)), `Complete relationship value: ${value}`)
          for (const source of fixture.owner_sources ?? []) for (const value of [source.ref, source.sha256, source.tool])
            assert.ok(text.includes(value) && markdown.includes(value), `Original relationship owner: ${value}`)
          if (view.mode === "trajectory" || view.mode === "connections") {
            assert.equal(await page.getByRole("heading", { name: "Intended Plan", exact: true }).count(), 0)
            assert.equal(await page.getByRole("heading", { name: "Significant recorded work", exact: true }).count(), 0)
            assert.ok(text.includes(view.mode === "connections" ? "Relationship details" : "Connected trajectory"))
            for (const review of view.connections.reviews) {
              assert.ok(text.includes("Exact requested scope and recheck targets"))
              assert.ok(text.includes("Observed and authored evidence scope"))
              for (const exclusion of review.request.mandate.exclusions) assert.ok(text.includes(exclusion))
              assert.ok(text.includes(`${review.relationships_omitted} omitted`))
            }
          }
          if (view.mode === "connections") {
            assert.deepEqual([view.records, view.highlights, view.branches], [[], [], []])
            assert.equal(await page.locator("#overview .metrics, .source-index, #assessment details.card").count(), 0,
              "Relationship pages do not repeat global counts or source record bodies")
            assert.ok(view.connections.context.record_refs.length)
            assert.ok(view.navigation.repeat.connection_cursor)
            for (const ref of view.connections.context.record_refs)
              assert.ok(text.includes(ref) && markdown.includes(ref), "Omitted source bodies retain their exact selected references")
            for (const key of ["action_id", "session_id", "record_id", "through", "owner_boundary", "owner_version", "limit"])
              assert.equal(canonical(view.navigation.repeat[key]), canonical(view.connections.context.read[key]),
                `Connection continuation preserves source ${key}`)
            assert.equal(view.connections.context.read.connection_cursor, undefined)
            assert.ok(!markdown.includes("### Significant recorded work") && !markdown.includes("### Intended Plan"))
          }
          for (const record of [...view.highlights, ...view.records]) if (record.excerpt !== null)
            assert.ok(text.includes(record.excerpt), "The complete projected excerpt remains present after shortening the overview preview")
          for (const request of fixture.history_requests) {
            assert.ok(parsedRequests.some(value => canonical(value) === canonical(request)),
              `Copyable exact HTML expansion request ${canonical(request)}`)
            assert.ok(markdownRequests.some(value => canonical(value) === canonical(request)),
              `Copyable exact Markdown expansion request ${canonical(request)}`)
          }
        }
        for (const value of fixture.required_text) assert.ok(text.includes(value), `Required view text: ${value}`)
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
        return { source_count: fixture.sources.length, history_request_count: fixture.history_requests?.length ?? 0,
          population_request_count: fixture.population_requests?.length ?? 0,
          fragment_count: structure.urls.length, view_mode: population ? view.state : view.mode }
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
        for (const anchor of await page.locator(`nav[aria-label='${navigationLabel}'] > a`).all()) {
          await page.keyboard.press("Tab")
          assert.equal(await anchor.evaluate(element => element === document.activeElement), true)
        }
        await page.keyboard.press("Tab")
        const summary = page.locator(firstSummary).first()
        assert.equal(await summary.evaluate(element => element === document.activeElement), true)
        await keyboardToggle(summary, "Enter", true)
        await keyboardToggle(summary, "Space", false)
        const cdp = await context.newCDPSession(page)
        const { nodes } = await cdp.send("Accessibility.getFullAXTree")
        await cdp.detach()
        assert.ok(nodes.some(node => !node.ignored && (population ? node.name?.value?.includes(view.items[0].source.id) : node.name?.value === "Source scope and boundary")
          && node.properties?.some(property => property.name === "expanded" && property.value.value === false)),
        "Chromium accessibility tree exposes collapsed disclosure state")
        await page.locator(".skip").press("Enter")
        await page.waitForFunction(id => location.hash === `#${id}`, skipTarget)
        assert.equal(await page.locator(`#${skipTarget}`).evaluate(element => element === document.activeElement), true)
        await inViewport(page.locator(`#${skipTarget}`))
        return style
      })
      if (population) await check("population sections and source disclosures preserve keyboard access", async () => {
        await page.locator("nav[aria-label='Population sections'] a[href='#members']").press("Enter")
        await page.waitForFunction(() => document.activeElement?.id === "members")
        await inViewport(page.locator("#members"))
        const summary = page.locator(firstSummary).first()
        await page.keyboard.press("Tab")
        assert.equal(await summary.evaluate(element => element === document.activeElement), true)
        await keyboardToggle(summary, "Enter", true)
        await inViewport(summary)
        await screenshot("population-source-revealed")
        await keyboardToggle(summary, "Space", false)
        for (const id of ["selection", "navigation"]) {
          await page.locator(`nav[aria-label='Population sections'] a[href='#${id}']`).press("Enter")
          await page.waitForFunction(target => document.activeElement?.id === target, id)
          await inViewport(page.locator(`#${id}`))
        }
        return { state: view.state, population_id: view.population_id, manifest_sha256: view.manifest_sha256,
          source_keys: view.items.map(item => item.key), selected_members: view.member_count }
      })
      else if (view.mode === "connections") await check("connection context and owner disclosure preserve keyboard access", async () => {
        await page.locator("nav[aria-label='History layers'] a[href='#connections']").press("Enter")
        await page.waitForFunction(() => document.activeElement?.id === "connections")
        await inViewport(page.locator("#connections"))
        const summary = page.locator("#connections details > summary").first()
        assert.equal(await summary.evaluate(element => element.parentElement.open), false)
        await page.keyboard.press("Tab")
        assert.equal(await summary.evaluate(element => element === document.activeElement), true)
        await keyboardToggle(summary, "Enter", true)
        await inViewport(summary)
        await screenshot("connection-owner-or-coverage-revealed")
        await keyboardToggle(summary, "Space", false)
        return { page: view.connections.coverage.page, selected_source_refs: view.connections.context.record_refs,
          owner_count: fixture.owner_sources.length, disclosure: await summary.textContent(),
          original_record_bodies: "omitted; exact return request checked in both formats" }
      })
      else await check("source fragment reveals closed details and transfers focus", async () => {
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
      if (!population) await check("internal record references and typed relationship targets", async () => {
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
      if (!population) await check("owner and attribution links preserve keyboard navigation", async () => {
        const followed = []
        for (const kind of ["objective", "review", "provenance"]) {
          const link = page.locator(`.relationships a[href^='#${kind}-']`).first()
          if (!await link.count()) continue
          const href = await link.getAttribute("href"), target = page.locator(href)
          await link.press("Enter")
          await page.waitForFunction(id => document.activeElement?.id === id, href.slice(1))
          await inViewport(target)
          if (await target.evaluate(element => element.tagName === "SUMMARY")) {
            await keyboardToggle(target, "Enter", true)
            if (kind === "review") await screenshot("review-request-and-evidence-scope")
            await keyboardToggle(target, "Space", false)
          }
          followed.push({ kind, href })
        }
        if (fixture.name === "trajectory-connected")
          assert.deepEqual(followed.map(item => item.kind), ["objective", "review", "provenance"])
        return followed
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
      await check(population ? "native expansion of every returned population member" : "native expansion of every returned hierarchy and record", async () => {
        const summaries = await page.locator("details > summary").all()
        for (const summary of summaries) if (!await summary.evaluate(element => element.parentElement.open)) {
          await keyboardToggle(summary, "Enter", true)
        }
        assert.equal(await page.locator("details:not([open])").count(), 0)
        if (population) assert.equal(await page.locator("#members details[open]").count(), view.items.length)
        else assert.equal(await page.locator(".relationships > li").count(), view.relationships.length)
        if (fixture.dense) assert.ok(view.relationships.length >= 100, "Dense qualification retains at least 100 typed edges")
        const sizes = await noOverflow()
        await page.locator(population ? "#members" : "#execution").scrollIntoViewIfNeeded()
        await screenshot("expanded-hierarchy-390px")
        return { expanded_disclosures: summaries.length, relationships: view.relationships?.length ?? 0,
          population_members: view.items?.length ?? 0, ...sizes }
      })
      await check("Chromium accessibility tree exposes native expanded state", async () => {
        const cdp = await context.newCDPSession(page)
        const { nodes } = await cdp.send("Accessibility.getFullAXTree")
        await cdp.detach()
        const exposed = nodes.filter(node => !node.ignored)
        assert.ok(exposed.some(node => node.role?.value === "main"))
        assert.ok(exposed.some(node => node.role?.value === "navigation" && node.name?.value === navigationLabel))
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
        const summary = page.locator(firstSummary).first()
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
