import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { aggregateFleetFromDisk, resolveDashboardRuntimeRoot } from "../plugins/loom/dashboard"
import { dashboardHtml } from "./ui"

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
      return Response.json({ status: "ok", mode: "read-only" }, {
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

if (import.meta.main) {
  const runtimeRoot = await resolveDashboardRuntimeRoot()
  const port = Number(process.env.LOOM_DASHBOARD_PORT || "4318")
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: createDashboardHandler(runtimeRoot),
  })
  console.log(`Loom dashboard (read-only): http://127.0.0.1:${server.port}`)
}
