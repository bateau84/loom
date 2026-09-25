import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createDashboardHandler, startDashboardServer } from "./server"
import { dashboardHtml } from "./ui"

const roots: string[] = []

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

describe("Loom control panel", () => {
  test("serves an empty projection without requiring Loom execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-dashboard-app-"))
    roots.push(root)
    const handler = createDashboardHandler(root)
    const response = await handler(new Request("http://localhost/api/fleet"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ projects: [] })
  })

  test("starts a real local server with control-panel health identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-dashboard-server-"))
    roots.push(root)
    const dashboard = await startDashboardServer({
      runtimeRoot: root,
      stateRoot: join(root, "state"),
      port: 0,
      unref: true,
    })

    try {
      const response = await fetch(`http://127.0.0.1:${dashboard.port}/health`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        status: "ok",
        service: "loom-dashboard",
        mode: "control-panel",
      })
    } finally {
      dashboard.stop()
    }
  })

  test("keeps observation routes read-only and rejects unauthorised cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-dashboard-app-"))
    roots.push(root)

    const readOnly = createDashboardHandler(root)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await readOnly(new Request("http://localhost/api/fleet", { method }))
      expect(response.status).toBe(405)
      expect(response.headers.get("Allow")).toBe("GET, POST")
    }
    const unavailable = await readOnly(new Request("http://localhost/api/control/workflows/delete", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project-a", workflowIds: ["workflow-a"] }),
    }))
    expect(unavailable.status).toBe(503)

    const controlled = createDashboardHandler(root, {
      stateRoot: join(root, "state"),
      controlToken: "secret-control-token",
    })
    const rejected = await controlled(new Request("http://localhost/api/control/workflows/delete", {
      method: "POST",
      headers: {
        origin: "http://evil.example",
        "x-loom-control-token": "secret-control-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId: "project-a", workflowIds: ["workflow-a"] }),
    }))
    expect(rejected.status).toBe(403)

    const rebound = await controlled(new Request("http://attacker.example/api/control/workflows/delete", {
      method: "POST",
      headers: {
        origin: "http://attacker.example",
        "x-loom-control-token": "secret-control-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId: "project-a", workflowIds: ["workflow-a"] }),
    }))
    expect(rebound.status).toBe(403)

    const configuredProxy = createDashboardHandler(root, {
      stateRoot: join(root, "state"),
      controlToken: "secret-control-token",
      allowedControlOrigins: ["https://loom.example.test"],
    })
    const proxyAdmission = await configuredProxy(new Request("http://loom.example.test/api/control/workflows/delete", {
      method: "POST",
      headers: {
        origin: "https://loom.example.test",
        "x-loom-control-token": "secret-control-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ projectId: "project-a", workflowIds: ["workflow-a"] }),
    }))
    // The configured proxy Origin/Host passes browser admission. The missing
    // canonical test database then fails at the next boundary, not as 403.
    expect(proxyAdmission.status).toBe(409)
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
    const html = dashboardHtml("fixture-control-token")
    const start = html.indexOf("<script>")
    const end = html.lastIndexOf("</script>")
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const script = html.slice(start + "<script>".length, end)
    expect(() => new Function(script)).not.toThrow()
  })

  test("generated CSS keeps status glyphs rather than JavaScript Unicode escape text", () => {
    const html = dashboardHtml()
    const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"))
    expect(css).toContain('content:"● "')
    expect(css).toContain('content:"Ⅱ "')
    expect(css).toContain('content:"✓"')
    expect(css).not.toContain("\\u25CF")
    expect(css).not.toContain("\\u2713")
  })

  test("UI exposes directory to session to workflow hierarchy and bounded cleanup controls", () => {
    const html = dashboardHtml("fixture-control-token")
    expect(html).toContain("Loom Control Panel")
    expect(html).toContain("Working directories")
    expect(html).toContain("Control panel")
    expect(html).toContain("Recent sessions")
    expect(html).toContain("Session summary")
    expect(html).toContain("Manage workflows")
    expect(html).toContain("Delete failed/cancelled workflows")
    expect(html).toContain("Your code is not deleted.")
    expect(html).toContain("/api/control/workflows/delete")
    expect(html).toContain("x-loom-control-token")
    expect(html).toContain('aria-label="Location"')
    expect(html).toContain('id="projection-status"')
    expect(html).toContain("Advanced work map")
    expect(html).toContain("consistency conflict")
    expect(html).toContain("stale/offline")
    expect(html).toContain("Loom-authoritative")
    expect(html).toContain(":focus-visible")
    expect(html).toContain("prefers-reduced-motion")
    expect(html).toContain("The previously focused item is no longer available")
    expect(html).toContain("showModal()")
  })
})
