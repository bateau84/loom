import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createDashboardHandler } from "./server"
import { dashboardHtml } from "./ui"

const roots: string[] = []

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

describe("Loom external dashboard", () => {
  test("serves an empty read-only fleet without requiring Loom execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-dashboard-app-"))
    roots.push(root)
    const handler = createDashboardHandler(root)
    const response = await handler(new Request("http://localhost/api/fleet"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ projects: [] })
  })

  test("rejects mutation methods at the observation boundary", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-dashboard-app-"))
    roots.push(root)
    const handler = createDashboardHandler(root)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await handler(new Request("http://localhost/api/fleet", { method }))
      expect(response.status).toBe(405)
      expect(response.headers.get("Allow")).toBe("GET")
    }
  })

  test("serves only generated workflow-status artifacts through the browser-safe route", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-dashboard-status-"))
    roots.push(root)
    const installationId = "11111111-1111-4111-8111-111111111111"
    const projectId = "22222222-2222-4222-8222-222222222222"
    const file = "workflow-0123456789abcdefabcd.html"
    const directory = join(root, "artifacts", installationId, projectId, "workflow-status")
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, file), "<!doctype html><title>Loom workflow status</title>")

    const handler = createDashboardHandler(root)
    const response = await handler(new Request(`http://localhost/status/${installationId}/${projectId}/${file}`))
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8")
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(await response.text()).toContain("Loom workflow status")

    const malformed = await handler(new Request(`http://localhost/status/not-a-uuid/${projectId}/${file}`))
    expect(malformed.status).toBe(404)

    await writeFile(join(directory, "other.html"), "secret")
    const arbitrary = await handler(new Request(`http://localhost/status/${installationId}/${projectId}/other.html`))
    expect(arbitrary.status).toBe(404)
  })

  test("generated browser script is syntactically valid JavaScript", () => {
    const html = dashboardHtml()
    const start = html.indexOf("<script>")
    const end = html.lastIndexOf("</script>")
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const script = html.slice(start + "<script>".length, end)
    expect(() => new Function(script)).not.toThrow()
  })

  test("generated CSS keeps status glyphs rather than JavaScript Unicode escape text", () => {
    // Bun may escape non-ASCII source while transpiling tagged raw templates.
    // CSS does not understand JavaScript's backslash-u escape syntax.
    const html = dashboardHtml()
    const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"))
    expect(css).toContain('content:"● "')
    expect(css).toContain('content:"Ⅱ "')
    expect(css).toContain('content:"✓"')
    expect(css).not.toContain("\\u25CF")
    expect(css).not.toContain("\\u2713")
  })

  test("UI contains accessible Fleet to Project to Workflow to Session semantics and explicit provenance", () => {
    const html = dashboardHtml()
    expect(html).toContain("Loom Operations")
    expect(html).toContain('aria-label="Fleet filters"')
    expect(html).toContain('id="agent-filter"')
    expect(html).toContain('aria-label="Location"')
    expect(html).toContain('id="projection-status"')
    expect(html).toContain("Objective → Phase → Wave → Task")
    expect(html).toContain("<details")
    expect(html).toContain("<summary data-key=")
    expect(html).toContain("hierarchyOpen")
    expect(html).toContain("Budget used/limit")
    expect(html).toContain("Tasks complete")
    expect(html).toContain("claimed by")
    expect(html).toContain("Loading Loom projection…")
    expect(html).toContain("No Loom instances discovered.")
    expect(html).toContain("No active or recent workflows.")
    expect(html).toContain("No workflows match the current filters.")
    expect(html).toContain("Showing the last known Loom projection")
    expect(html).toContain("consistency conflict")
    expect(html).toContain("No winner is selected")
    expect(html).toContain("OpenCode sessions")
    expect(html).toContain("stale/offline")
    expect(html).toContain('.badge[data-state="consistency conflict"]::before')
    expect(html).toContain('.badge[data-state="stale/offline"]::before')
    expect(html).toContain("Missing telemetry is not treated as zero or success")
    expect(html).toContain("Loom-authoritative")
    expect(html).toContain(":focus-visible")
    expect(html).toContain("prefers-reduced-motion")
    expect(html).toContain("The previously focused item is no longer available")
    expect(html).toContain("fallback?.focus()")
    expect(html).not.toContain("<form")
  })
})
