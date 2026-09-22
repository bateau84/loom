import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"
import { homedir } from "node:os"

export type DashboardEndpointRecordV1 = {
  schemaVersion: 1
  baseUrl: string
  publishedAt: string
  leaseExpiresAt: string
  processId: number
}

export function dashboardStateRoot() {
  const stateBase = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(stateBase, "loom")
}

export function normalizeDashboardBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "")
  if (!trimmed) throw new Error("Dashboard base URL is empty.")
  const parsed = new URL(trimmed)
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Dashboard base URL must use http or https.")
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Dashboard base URL must not contain credentials, query parameters, or a fragment.")
  }
  return trimmed
}

export function configuredDashboardBaseUrl(portOverride?: number) {
  const configured = process.env.LOOM_DASHBOARD_URL?.trim()
  if (configured) return normalizeDashboardBaseUrl(configured)

  const requestedPort = portOverride ?? Number(process.env.LOOM_DASHBOARD_PORT || "4318")
  const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535
    ? requestedPort
    : 4318
  return `http://127.0.0.1:${port}`
}

export function dashboardEndpointPath(stateRoot: string) {
  return join(stateRoot, "dashboard-endpoint.json")
}

async function syncDirectory(path: string) {
  const handle = await open(path, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function atomicWrite(path: string, content: string) {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const temp = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`
  const handle = await open(temp, "wx", 0o600)
  let replaced = false
  try {
    await handle.writeFile(content, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temp, path)
    replaced = true
    await syncDirectory(directory)
  } finally {
    if (!replaced) await unlink(temp).catch(() => {})
  }
}

export async function publishDashboardEndpoint(
  stateRoot: string,
  baseUrl: string,
  leaseMs = 15_000,
) {
  const normalized = normalizeDashboardBaseUrl(baseUrl)
  const now = new Date()
  const record: DashboardEndpointRecordV1 = {
    schemaVersion: 1,
    baseUrl: normalized,
    publishedAt: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    processId: process.pid,
  }
  await atomicWrite(
    dashboardEndpointPath(stateRoot),
    JSON.stringify(record, null, 2) + "\n",
  )
  return record
}

export async function resolveDashboardBaseUrl(
  stateRoot: string,
  now = new Date(),
) {
  try {
    const parsed = JSON.parse(await readFile(dashboardEndpointPath(stateRoot), "utf8")) as DashboardEndpointRecordV1
    if (
      parsed?.schemaVersion === 1 &&
      typeof parsed.baseUrl === "string" &&
      typeof parsed.leaseExpiresAt === "string" &&
      Date.parse(parsed.leaseExpiresAt) > now.getTime()
    ) {
      return normalizeDashboardBaseUrl(parsed.baseUrl)
    }
  } catch {
    // An active dashboard heartbeat is optional. Fall back to explicit
    // configuration/defaults when no current endpoint lease is available.
  }
  return configuredDashboardBaseUrl()
}
