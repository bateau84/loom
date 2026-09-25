import { startDashboardServer } from "../plugins/loom/dashboard-server"
export * from "../plugins/loom/dashboard-server"

if (import.meta.main) {
  const dashboard = await startDashboardServer()
  console.log(`Loom dashboard (read-only): ${dashboard.baseUrl}`)
}
