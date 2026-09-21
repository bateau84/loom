import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
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

  test("generated browser script is syntactically valid JavaScript", () => {
    const html = dashboardHtml()
    const start = html.indexOf("<script>")
    const end = html.lastIndexOf("</script>")
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const script = html.slice(start + "<script>".length, end)
    expect(() => new Function(script)).not.toThrow()
  })

  test("UI contains accessible Fleet to Project to Workflow to Session semantics and explicit provenance", () => {
    const html = dashboardHtml()
    expect(html).toContain("Loom Operations")
    expect(html).toContain('aria-label="Fleet filters"')
    expect(html).toContain('id="agent-filter"')
    expect(html).toContain('aria-label="Location"')
    expect(html).toContain('id="projection-status"')
    expect(html).toContain("Objective → Phase → Wave → Task")
    expect(html).toContain("Budget used/limit")
    expect(html).toContain("Tasks complete")
    expect(html).toContain("claimed by")
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
