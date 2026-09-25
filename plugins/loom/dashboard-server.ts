import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { join } from "node:path"
import { aggregateFleetFromDisk, resolveDashboardRuntimeRoot } from "./dashboard"
import {
  configuredDashboardBaseUrl,
  configuredDashboardPort,
  dashboardStateRoot,
  publishDashboardEndpoint,
} from "./dashboard-endpoint"
import { dashboardHtml } from "./dashboard-web/ui"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const statusFile = /^workflow-[a-f0-9]{20}\.html$/

function statusArtifactPath(runtimeRoot: string, pathname: string) {
  const parts = pathname.split("/").filter(Boolean)
  if (parts.length !== 4 || parts[0] !== "status") return undefined
  const [, installationId, projectId, file] = parts.map((part) => decodeURIComponent(part))
  if (!uuid.test(installationId) || !uuid.test(projectId) || !statusFile.test(file)) return undefined
  return join(runtimeRoot, "artifacts", installationId, projectId, "workflow-status", file)
}

const statusHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
}

export function createDashboardHandler(runtimeRoot: string) {
  return async (request: Request) => {
    const url = new URL(request.url)
    if (request.method !== "GET") {
      return new Response("Read-only dashboard", {
        status: 405,
        headers: { Allow: "GET" },
      })
    }
    if (url.pathname === "/api/fleet") {
      const fleet = await aggregateFleetFromDisk(runtimeRoot)
      return Response.json(fleet, {
        headers: { "Cache-Control": "no-store" },
      })
    }
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", service: "loom-dashboard", mode: "read-only" }, {
        headers: { "Cache-Control": "no-store" },
      })
    }
    if (url.pathname.startsWith("/status/")) {
      let path: string | undefined
      try {
        path = statusArtifactPath(runtimeRoot, url.pathname)
      } catch {
        return new Response("Not found", { status: 404 })
      }
      if (!path) return new Response("Not found", { status: 404 })
      try {
        return new Response(await readFile(path, "utf8"), { headers: statusHeaders })
      } catch {
        return new Response("Not found", { status: 404 })
      }
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(dashboardHtml(), {
        headers: statusHeaders,
      })
    }
    return new Response("Not found", { status: 404 })
  }
}

async function writeWebResponse(
  response: Awaited<ReturnType<ReturnType<typeof createDashboardHandler>>>,
  target: import("node:http").ServerResponse,
) {
  target.statusCode = response.status
  for (const [name, value] of response.headers) target.setHeader(name, value)
  target.end(Buffer.from(await response.arrayBuffer()))
}

function createNodeDashboardServer(runtimeRoot: string) {
  const handler = createDashboardHandler(runtimeRoot)
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    void handler(new Request(url, { method: request.method ?? "GET" }))
      .then((result) => writeWebResponse(result, response))
      .catch((error) => {
        console.error("Loom dashboard request failed:", error)
        if (!response.headersSent) response.statusCode = 500
        response.end("Dashboard request failed")
      })
  })
}

export type DashboardServerHandle = {
  server: Server
  port: number
  baseUrl: string
  stop: () => void
}

export type StartDashboardServerOptions = {
  runtimeRoot?: string
  stateRoot?: string
  port?: number
  unref?: boolean
  leaseMs?: number
  heartbeatMs?: number
}

export async function startDashboardServer(
  options: StartDashboardServerOptions = {},
): Promise<DashboardServerHandle> {
  const runtimeRoot = options.runtimeRoot ?? await resolveDashboardRuntimeRoot()
  const stateRoot = options.stateRoot ?? dashboardStateRoot()
  const requestedPort = options.port ?? configuredDashboardPort()
  const server = createNodeDashboardServer(runtimeRoot)

  server.listen(requestedPort, "127.0.0.1")
  await once(server, "listening")

  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("Loom dashboard did not receive a TCP listen address.")
  }
  const port = address.port
  const advertisedBaseUrl = configuredDashboardBaseUrl(port)
  const publishEndpoint = () =>
    publishDashboardEndpoint(stateRoot, advertisedBaseUrl, options.leaseMs).catch((error) => {
      console.error("Unable to publish Loom dashboard endpoint:", error)
    })

  try {
    await publishDashboardEndpoint(stateRoot, advertisedBaseUrl, options.leaseMs)
  } catch (error) {
    server.closeAllConnections?.()
    server.close()
    throw error
  }

  const endpointHeartbeat = setInterval(publishEndpoint, options.heartbeatMs ?? 5_000)
  ;(endpointHeartbeat as any).unref?.()
  if (options.unref) server.unref()

  return {
    server,
    port,
    baseUrl: advertisedBaseUrl,
    stop: () => {
      clearInterval(endpointHeartbeat)
      server.closeAllConnections?.()
      server.close()
    },
  }
}
