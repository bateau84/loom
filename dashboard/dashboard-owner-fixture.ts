import { startDashboardServer } from "../plugins/loom/dashboard-server"

const [runtimeRoot, stateRoot, portValue, leaseValue, heartbeatValue] = process.argv.slice(2)
const port = Number(portValue)
const leaseMs = Number(leaseValue)
const heartbeatMs = Number(heartbeatValue)

if (!runtimeRoot || !stateRoot || !Number.isInteger(port) || !Number.isFinite(leaseMs) || !Number.isFinite(heartbeatMs)) {
  throw new Error("usage: dashboard-owner-fixture <runtimeRoot> <stateRoot> <port> <leaseMs> <heartbeatMs>")
}

const dashboard = await startDashboardServer({
  runtimeRoot,
  stateRoot,
  port,
  leaseMs,
  heartbeatMs,
})

const shutdown = () => {
  dashboard.stop()
  process.exit(0)
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

await new Promise<void>(() => {})
