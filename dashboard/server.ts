import { aggregateFleetFromDisk, resolveDashboardRuntimeRoot } from "../plugins/loom/dashboard"
import { dashboardHtml } from "./ui"

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
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(dashboardHtml(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        },
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
