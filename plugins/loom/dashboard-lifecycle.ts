import {
  startDashboardServer,
  type DashboardServerHandle,
} from "./dashboard-server"
import {
  configuredDashboardPort,
  dashboardStateRoot,
  readActiveDashboardEndpoint,
  type DashboardEndpointRecordV1,
} from "./dashboard-endpoint"

export const DASHBOARD_AUTOSTART_INTERVAL_MS = 5_000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const disabledValues = new Set(["0", "false", "no", "off"])

export function dashboardAutostartEnabled(
  value = process.env.LOOM_DASHBOARD_AUTOSTART,
) {
  const normalized = value?.trim().toLowerCase()
  return !normalized || !disabledValues.has(normalized)
}

type EnsureDashboardOptions = {
  enabled?: boolean
  stateRoot?: string
  port?: number
  readActive?: (stateRoot: string) => Promise<DashboardEndpointRecordV1 | undefined>
  start?: (options: {
    stateRoot: string
    port: number
    unref: boolean
  }) => Promise<DashboardServerHandle>
  settle?: () => Promise<void>
}

export type DashboardAvailability =
  | { state: "disabled" }
  | { state: "reused"; baseUrl: string }
  | { state: "started"; baseUrl: string; owner: DashboardServerHandle }
  | { state: "failed"; error: unknown }

export async function ensureDashboardAvailable(
  options: EnsureDashboardOptions = {},
): Promise<DashboardAvailability> {
  if (!(options.enabled ?? dashboardAutostartEnabled())) return { state: "disabled" }

  const stateRoot = options.stateRoot ?? dashboardStateRoot()
  const readActive = options.readActive ?? readActiveDashboardEndpoint
  const active = await readActive(stateRoot)
  if (active) return { state: "reused", baseUrl: active.baseUrl }

  const port = options.port ?? configuredDashboardPort()
  const start = options.start ?? ((input) => startDashboardServer(input))

  try {
    const owner = await start({ stateRoot, port, unref: true })
    return { state: "started", baseUrl: owner.baseUrl, owner }
  } catch (error) {
    // Two OpenCode processes may observe an expired/missing lease together.
    // Port binding chooses one owner; give that winner a moment to publish its
    // endpoint before treating the loser's bind error as a real failure.
    await (options.settle ?? (() => sleep(25)))()
    const raced = await readActive(stateRoot)
    if (raced) return { state: "reused", baseUrl: raced.baseUrl }
    return { state: "failed", error }
  }
}

type DashboardLifecycleOptions = EnsureDashboardOptions & {
  intervalMs?: number
  warn?: (message: string) => void
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function createDashboardLifecycle(
  options: DashboardLifecycleOptions = {},
) {
  const enabled = options.enabled ?? dashboardAutostartEnabled()
  if (!enabled) {
    const disabled = Promise.resolve<DashboardAvailability>({ state: "disabled" })
    return {
      ready: disabled,
      check: () => disabled,
      stop: () => {},
    }
  }

  let owner: DashboardServerHandle | undefined
  let inFlight: Promise<DashboardAvailability> | undefined
  let stopped = false
  let warned = false
  const warn = options.warn ?? ((message: string) => console.warn(message))

  const check = () => {
    if (stopped) return Promise.resolve<DashboardAvailability>({ state: "disabled" })
    if (owner) {
      return Promise.resolve<DashboardAvailability>({
        state: "started",
        baseUrl: owner.baseUrl,
        owner,
      })
    }
    if (inFlight) return inFlight

    inFlight = ensureDashboardAvailable({ ...options, enabled: true })
      .then((result) => {
        if (result.state === "started") owner = result.owner
        if (result.state === "failed") {
          if (!warned) {
            warn(`Loom dashboard auto-start unavailable: ${errorMessage(result.error)}`)
            warned = true
          }
        } else {
          warned = false
        }
        return result
      })
      .finally(() => {
        inFlight = undefined
      })
    return inFlight
  }

  const ready = check()
  const timer = setInterval(() => {
    void check()
  }, options.intervalMs ?? DASHBOARD_AUTOSTART_INTERVAL_MS)
  ;(timer as any).unref?.()

  return {
    ready,
    check,
    stop: () => {
      stopped = true
      clearInterval(timer)
      owner?.stop()
      owner = undefined
    },
  }
}

let processDashboardLifecycle: ReturnType<typeof createDashboardLifecycle> | undefined

export function ensureDashboardServerLifecycle() {
  processDashboardLifecycle ??= createDashboardLifecycle()
  return processDashboardLifecycle.ready
}
