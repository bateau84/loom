import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  createDashboardLifecycle,
  dashboardAutostartEnabled,
  ensureDashboardAvailable,
} from "./dashboard-lifecycle"
import { startDashboardServer, type DashboardServerHandle } from "./dashboard-server"
import {
  DEFAULT_DASHBOARD_PORT,
  configuredDashboardPort,
  readActiveDashboardEndpoint,
  type DashboardEndpointRecordV1,
} from "./dashboard-endpoint"

function endpoint(baseUrl = `http://127.0.0.1:${DEFAULT_DASHBOARD_PORT}`): DashboardEndpointRecordV1 {
  return {
    schemaVersion: 1,
    baseUrl,
    publishedAt: "2026-09-24T18:00:00.000Z",
    leaseExpiresAt: "2099-09-24T18:00:15.000Z",
    processId: 123,
  }
}

function owner(baseUrl = `http://127.0.0.1:${DEFAULT_DASHBOARD_PORT}`): DashboardServerHandle {
  return {
    server: {} as DashboardServerHandle["server"],
    port: Number(new URL(baseUrl).port),
    baseUrl,
    stop: () => {},
  }
}

const roots: string[] = []

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

async function unusedPort() {
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") })
  const port = probe.port
  probe.stop(true)
  return port
}

describe("dashboard auto-start lifecycle", () => {
  test("uses a private-range default port and honors explicit overrides", () => {
    expect(DEFAULT_DASHBOARD_PORT).toBe(54318)
    expect(configuredDashboardPort(undefined)).toBe(DEFAULT_DASHBOARD_PORT)
    expect(configuredDashboardPort("4318")).toBe(4318)
    expect(configuredDashboardPort("not-a-port")).toBe(DEFAULT_DASHBOARD_PORT)
  })

  test("is enabled by default and supports an explicit opt-out", () => {
    expect(dashboardAutostartEnabled(undefined)).toBe(true)
    for (const value of ["0", "false", "FALSE", "no", "off"]) {
      expect(dashboardAutostartEnabled(value)).toBe(false)
    }
    expect(dashboardAutostartEnabled("1")).toBe(true)
  })

  test("reuses an active dashboard lease without starting another server", async () => {
    let starts = 0
    const result = await ensureDashboardAvailable({
      enabled: true,
      stateRoot: "/state",
      readActive: async () => endpoint("http://127.0.0.1:4999"),
      start: async () => {
        starts++
        return owner()
      },
    })

    expect(result).toEqual({ state: "reused", baseUrl: "http://127.0.0.1:4999" })
    expect(starts).toBe(0)
  })

  test("starts an unrefed local server when no active lease exists", async () => {
    const calls: unknown[] = []
    const result = await ensureDashboardAvailable({
      enabled: true,
      stateRoot: "/state",
      port: 4999,
      readActive: async () => undefined,
      start: async (options) => {
        calls.push(options)
        return owner("http://127.0.0.1:4999")
      },
    })

    expect(result.state).toBe("started")
    expect(calls).toEqual([{ stateRoot: "/state", port: 4999, unref: true }])
  })

  test("treats a concurrent winner as reuse instead of a startup failure", async () => {
    let reads = 0
    const result = await ensureDashboardAvailable({
      enabled: true,
      stateRoot: "/state",
      readActive: async () => (++reads === 1 ? undefined : endpoint()),
      start: async () => {
        throw new Error("address already in use")
      },
      settle: async () => {},
    })

    expect(result).toEqual({ state: "reused", baseUrl: `http://127.0.0.1:${DEFAULT_DASHBOARD_PORT}` })
  })

  test("takes over the real socket after a separate owner process exits", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-dashboard-takeover-"))
    roots.push(root)
    const runtimeRoot = join(root, "runtime")
    const stateRoot = join(root, "state")
    const port = await unusedPort()
    const leaseMs = 120
    const heartbeatMs = 30
    const fixture = join(import.meta.dir, "../../dashboard/dashboard-owner-fixture.ts")
    const child = Bun.spawn([
      process.execPath,
      fixture,
      runtimeRoot,
      stateRoot,
      String(port),
      String(leaseMs),
      String(heartbeatMs),
    ], {
      stdout: "ignore",
      stderr: "pipe",
    })

    let childLease: Awaited<ReturnType<typeof readActiveDashboardEndpoint>> = undefined
    for (let attempt = 0; attempt < 50; attempt++) {
      childLease = await readActiveDashboardEndpoint(stateRoot)
      if (childLease?.processId === child.pid) break
      if (child.exitCode !== null) {
        const stderr = child.stderr ? await new Response(child.stderr).text() : ""
        throw new Error(`dashboard owner fixture exited before publishing its lease: ${stderr}`)
      }
      await Bun.sleep(10)
    }
    expect(childLease?.processId).toBe(child.pid)
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200)

    const start = (options: { stateRoot: string; port: number; unref: boolean }) =>
      startDashboardServer({
        ...options,
        runtimeRoot,
        leaseMs,
        heartbeatMs,
      })
    const successor = createDashboardLifecycle({
      enabled: true,
      stateRoot,
      port,
      intervalMs: 60_000,
      start,
      warn: () => {},
    })

    try {
      expect((await successor.ready).state).toBe("reused")

      child.kill()
      await child.exited
      await Bun.sleep(leaseMs + heartbeatMs + 30)

      expect((await successor.check()).state).toBe("started")
      expect((await readActiveDashboardEndpoint(stateRoot))?.processId).toBe(process.pid)
      expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200)
    } finally {
      if (child.exitCode === null) {
        child.kill()
        await child.exited
      }
      successor.stop()
    }
  })

  test("keeps one in-process owner across lifecycle checks", async () => {
    let starts = 0
    const lifecycle = createDashboardLifecycle({
      enabled: true,
      intervalMs: 60_000,
      readActive: async () => undefined,
      start: async () => {
        starts++
        return owner()
      },
      warn: () => {},
    })

    try {
      expect((await lifecycle.ready).state).toBe("started")
      expect((await lifecycle.check()).state).toBe("started")
      expect(starts).toBe(1)
    } finally {
      lifecycle.stop()
    }
  })
})
