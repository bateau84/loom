import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  dashboardWorkflowUrl,
  renderStatusHtml,
  renderStatusMarkdown,
  statusPresentation,
  statusPreviewCode,
  writeStatusArtifact,
  type StatusView,
} from "./status-view"
import type { LoomRuntimeIdentity } from "./runtime"
import {
  DEFAULT_DASHBOARD_PORT,
  publishDashboardEndpoint,
  resolveDashboardBaseUrl,
} from "./dashboard-endpoint"

const roots: string[] = []

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

function statusView(): StatusView {
  return {
    workflowId: "wf-status",
    state: "active",
    progress: { finished: 3, total: 7, failed: 0 },
    now: [{ step: "task:implement", agent: "worker", kind: "work" }],
    recent: [],
    upcoming: [{ step: "review", agent: "reviewer", waitsFor: ["task:implement"] }],
    questions: { open: 1, routes: [], reconcile: [] },
    verification: { open: [{ id: "verify-1", before: "review", kind: "test", statement: "Run tests" }], satisfied: 2 },
    budget: { dispatches: 4, maxDispatches: 12 },
    acceptance: "pending",
    knowledge: { valid: true },
    work: {
      version: 3,
      plan: null,
      nextRunnableWaves: [{ id: "wave-2", title: "Follow-up", phaseId: "phase-1", progress: { finished: 0, total: 1 } }],
      tree: {
        objective: { id: "objective:test", title: "Ship <safe> & sound", status: "active", progress: { finished: 1, total: 3 } },
        generation: 1,
        phases: [{
          id: "phase-1",
          title: "Implementation",
          status: "active",
          progress: { finished: 1, total: 3 },
          waves: [{
            id: "wave-1",
            title: "Runtime",
            status: "active",
            progress: { finished: 1, total: 2 },
            tasks: [
              { id: "done", title: "Finished task", status: "complete" },
              { id: "implement", title: "Implement <script>alert(1)</script>", status: "pending" },
            ],
          }],
        }],
      },
    },
  }
}

describe("interactive Loom status presentation", () => {
  test("keeps the tool result compact and exposes the browser preview handoff", () => {
    const output = renderStatusMarkdown(statusView(), {
      path: "/tmp/loom-status.html",
      uri: "file:///tmp/loom-status.html",
      webUrl: "http://127.0.0.1:4318/status/install/project/workflow-test.html",
    })
    expect(output).toContain("## Loom · → active · 3/7")
    expect(output).toContain("**Objective:** → Ship <safe> & sound · 1/3 tasks")
    expect(output).toContain("**worker** · `task:implement`")
    expect(output).toContain("1 OQ")
    expect(output).toContain("1 verification open")
    expect(output).toContain("### Presentation")
    expect(output).toContain("[Interactive workflow status](http://127.0.0.1:4318/status/install/project/workflow-test.html)")
    expect(output).toContain("**Local artifact:** `/tmp/loom-status.html`")
    expect(output).toContain("HTTP link is the normal presentation path")
    expect(output).toContain("browser preview is optional")
    expect(output).not.toContain("Finished task")
  })

  test("provides a structured presentation handoff for JSON and metadata paths", () => {
    const presentation = statusPresentation({
      path: "/tmp/loom-status.html",
      uri: "file:///tmp/loom-status.html",
      webUrl: "http://127.0.0.1:4318/status/install/project/workflow-test.html",
    })
    expect(presentation).toMatchObject({
      kind: "artifact",
      preferred: "web",
      webUrl: "http://127.0.0.1:4318/status/install/project/workflow-test.html",
      path: "/tmp/loom-status.html",
      uri: "file:///tmp/loom-status.html",
      desktopPreview: {
        optional: true,
        tool: "execute",
      },
    })
    expect(presentation?.desktopPreview.code).toContain("tools.browser.preview")
    expect(presentation?.desktopPreview.code).toContain("browser-disconnected")
    expect(presentation?.desktopPreview.code).toContain("retry: false")
    expect(statusPresentation(undefined)).toBeUndefined()
  })

  test("browser preview handoff degrades cleanly when browser capability is absent or disconnected", async () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const code = statusPreviewCode({
      path: "/tmp/loom-status.html",
      uri: "file:///tmp/loom-status.html",
    })
    const run = new AsyncFunction("tools", code)

    await expect(run({})).resolves.toMatchObject({
      kind: "loom-status-preview",
      status: "unavailable",
      reason: "browser-tool-unavailable",
      retry: false,
    })

    await expect(run({
      browser: {
        preview: async () => {
          throw new Error("[browser.disconnected] No desktop browser is connected to this session.")
        },
      },
    })).resolves.toMatchObject({
      kind: "loom-status-preview",
      status: "unavailable",
      reason: "browser-disconnected",
      retry: false,
    })

    await expect(run({
      browser: {
        preview: async ({ path }: { path: string }) => ({ path }),
      },
    })).resolves.toMatchObject({
      kind: "loom-status-preview",
      status: "opened",
      path: "/tmp/loom-status.html",
      retry: false,
    })
  })

  test("renders an accessible, interactive, read-only hierarchy and escapes work content", () => {
    const html = renderStatusHtml(statusView())
    expect(html).toContain("<details")
    expect(html).toContain("<summary>")
    expect(html).toContain('id="search"')
    expect(html).toContain('id="status-filter"')
    expect(html).toContain('id="expand-all"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain("Read-only presentation of Loom-authoritative state")
    expect(html).toContain("Implement &lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).not.toContain("Implement <script>alert(1)</script>")

    const start = html.indexOf("<script>")
    const end = html.lastIndexOf("</script>")
    const script = html.slice(start + "<script>".length, end)
    expect(() => new Function(script)).not.toThrow()
  })

  test("builds stable workflow links from the active shared dashboard endpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-dashboard-endpoint-"))
    roots.push(root)
    const runtime = {
      installationId: "installation-a",
      instanceId: "instance-a",
      projectId: "project a",
      canonicalLocation: "/workspace/project-a",
      runtimeRoot: join(root, "runtime"),
      stateRoot: join(root, "state"),
    } as LoomRuntimeIdentity

    expect(await dashboardWorkflowUrl(runtime, "wf/status")).toBe(
      `http://127.0.0.1:${DEFAULT_DASHBOARD_PORT}/#/project/project%20a/workflow/wf%2Fstatus`,
    )

    const lease = await publishDashboardEndpoint(runtime.stateRoot, "http://127.0.0.1:4999", 1_000)
    expect(await dashboardWorkflowUrl(runtime, "wf/status")).toBe(
      "http://127.0.0.1:4999/#/project/project%20a/workflow/wf%2Fstatus",
    )
    expect(
      await resolveDashboardBaseUrl(
        runtime.stateRoot,
        new Date(Date.parse(lease.leaseExpiresAt) + 1),
      ),
    ).toBe(`http://127.0.0.1:${DEFAULT_DASHBOARD_PORT}`)
  })

  test("writes the artifact under the private Loom runtime root", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-status-view-"))
    roots.push(root)
    const runtime = {
      installationId: "installation-a",
      instanceId: "instance-a",
      projectId: "project-a",
      canonicalLocation: "/workspace/project-a",
      runtimeRoot: root,
      stateRoot: join(root, "state"),
    } as LoomRuntimeIdentity

    const artifact = await writeStatusArtifact(runtime, statusView())
    expect(artifact.path).toStartWith(join(root, "artifacts", "installation-a", "project-a", "workflow-status"))
    expect(artifact.uri).toStartWith("file://")
    expect(artifact.webUrl).toMatch(
      new RegExp(`^http://127\\.0\\.0\\.1:${DEFAULT_DASHBOARD_PORT}/status/installation-a/project-a/workflow-[a-f0-9]{20}\\.html$`),
    )
    expect(await readFile(artifact.path, "utf8")).toContain("Loom workflow status")

    if (process.platform !== "win32") {
      const mode = (await stat(artifact.path)).mode & 0o777
      expect(mode).toBe(0o600)
    }
  })
})
