import { randomUUID, timingSafeEqual } from "node:crypto"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { join } from "node:path"
import { aggregateFleetFromDisk, resolveDashboardRuntimeRoot } from "./dashboard"
import { createDashboardControl } from "./dashboard-control"
import {
  configuredDashboardBaseUrl,
  configuredDashboardPort,
  dashboardStateRoot,
  publishDashboardEndpoint,
} from "./dashboard-endpoint"
import { dashboardHtml } from "./dashboard-web/ui"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const statusFile = /^workflow-[a-f0-9]{20}\.html$/
const MAX_REQUEST_BODY_BYTES = 128 * 1024

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
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
}

const jsonHeaders = {
  "Cache-Control": "no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
}

function sameToken(expected: string, actual: string | null) {
  if (!actual) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(actual)
  return left.length === right.length && timingSafeEqual(left, right)
}

export type DashboardHandlerOptions = {
  stateRoot?: string
  controlToken?: string
  allowedControlOrigins?: string[]
}

function loopbackHostname(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost"
}

function controlOriginAllowed(request: Request, url: URL, allowedOrigins: string[]) {
  const origin = request.headers.get("origin")
  if (!origin) return false

  // The default local surface accepts only literal loopback origins. This
  // prevents DNS-rebinding hosts from becoming "same origin" merely because
  // they resolve to 127.0.0.1.
  if (loopbackHostname(url.hostname) && origin === url.origin) return true

  // A reverse-proxy origin must be explicitly configured and its Host must be
  // preserved by the proxy. The browser's public scheme may differ from the
  // local HTTP hop, so compare Origin plus Host rather than url.origin here.
  return allowedOrigins.some((candidate) => {
    try {
      const configured = new URL(candidate)
      return origin === configured.origin && url.host === configured.host
    } catch {
      return false
    }
  })
}

export function createDashboardHandler(
  runtimeRoot: string,
  options: DashboardHandlerOptions = {},
) {
  const control = options.stateRoot
    ? createDashboardControl(runtimeRoot, options.stateRoot)
    : undefined

  return async (request: Request) => {
    const url = new URL(request.url)

    if (request.method === "POST" && url.pathname === "/api/control/workflows/delete") {
      if (!control || !options.controlToken) {
        return Response.json({ error: "Dashboard controls are unavailable." }, {
          status: 503,
          headers: jsonHeaders,
        })
      }

      if (
        !controlOriginAllowed(request, url, options.allowedControlOrigins ?? []) ||
        !sameToken(options.controlToken, request.headers.get("x-loom-control-token"))
      ) {
        return Response.json({ error: "Dashboard control request was not authorized." }, {
          status: 403,
          headers: jsonHeaders,
        })
      }

      let body: unknown
      try {
        body = await request.json()
      } catch {
        return Response.json({ error: "Invalid JSON request." }, {
          status: 400,
          headers: jsonHeaders,
        })
      }

      const value = body as {
        projectId?: unknown
        workflowIds?: unknown
        reason?: unknown
      }
      if (
        !value ||
        typeof value !== "object" ||
        typeof value.projectId !== "string" ||
        !Array.isArray(value.workflowIds) ||
        !value.workflowIds.every((id) => typeof id === "string")
      ) {
        return Response.json({ error: "projectId and workflowIds are required." }, {
          status: 400,
          headers: jsonHeaders,
        })
      }

      try {
        const result = await control.deleteWorkflows(value.projectId, {
          workflowIds: value.workflowIds,
          reason:
            typeof value.reason === "string" && value.reason.trim()
              ? value.reason
              : "Removed from the Loom control panel to clean up failed/cancelled workflow state.",
        })
        return Response.json(result, { headers: jsonHeaders })
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : String(error),
        }, {
          status: 409,
          headers: jsonHeaders,
        })
      }
    }

    if (request.method !== "GET") {
      return new Response("Unsupported dashboard operation", {
        status: 405,
        headers: { Allow: "GET, POST" },
      })
    }

    if (url.pathname === "/api/fleet") {
      const fleet = await aggregateFleetFromDisk(runtimeRoot)
      const visible = control
        ? await control.filterDeletedWorkflows(fleet)
        : fleet
      return Response.json(visible, { headers: jsonHeaders })
    }

    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "loom-dashboard",
        mode: control ? "control-panel" : "read-only",
      }, {
        headers: jsonHeaders,
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
      return new Response(dashboardHtml(options.controlToken ?? ""), {
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

function createNodeDashboardServer(
  runtimeRoot: string,
  stateRoot: string,
  controlToken: string,
  allowedControlOrigins: string[] = [],
) {
  const handler = createDashboardHandler(runtimeRoot, {
    stateRoot,
    controlToken,
    allowedControlOrigins,
  })
  return createServer((request, response) => {
    const host = request.headers.host ?? "127.0.0.1"
    const url = new URL(request.url ?? "/", `http://${host}`)
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) {
        for (const entry of value) headers.append(name, entry)
      } else if (value !== undefined) {
        headers.set(name, value)
      }
    }

    const chunks: Buffer[] = []
    let bodyBytes = 0
    let rejected = false
    request.on("data", (chunk) => {
      if (rejected) return
      const data = Buffer.from(chunk)
      bodyBytes += data.byteLength
      if (bodyBytes > MAX_REQUEST_BODY_BYTES) {
        rejected = true
        chunks.length = 0
        response.statusCode = 413
        response.setHeader("Cache-Control", "no-store")
        response.setHeader("X-Content-Type-Options", "nosniff")
        response.end("Request body too large")
        return
      }
      chunks.push(data)
    })
    request.on("end", () => {
      if (rejected) return
      const body = chunks.length ? Buffer.concat(chunks) : undefined
      void handler(new Request(url, {
        method: request.method ?? "GET",
        headers,
        ...(body ? { body } : {}),
      }))
        .then((result) => writeWebResponse(result, response))
        .catch((error) => {
          console.error("Loom dashboard request failed:", error)
          if (!response.headersSent) response.statusCode = 500
          response.end("Dashboard request failed")
        })
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
  const controlToken = randomUUID()
  const explicitControlOrigin = process.env.LOOM_DASHBOARD_URL?.trim()
    ? configuredDashboardBaseUrl(requestedPort)
    : undefined
  const server = createNodeDashboardServer(
    runtimeRoot,
    stateRoot,
    controlToken,
    explicitControlOrigin ? [explicitControlOrigin] : [],
  )

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
