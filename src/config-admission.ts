/** Configuration I/O admission only; never schedules or cancels native agent work. */
export const CONFIG_LOAD_LIMITS = Object.freeze({ active: 1, waiting: 8 })
const KEY = Symbol.for("loom.config-admission.v1")
type Waiting = { start(): void }
type Admission = { version: 1; active: boolean; waiting: Waiting[] }

export class ConfigLoadAdmissionError extends Error {
  constructor(readonly code: "LOOM_CONFIG_LOAD_CANCELLED" | "LOOM_CONFIG_LOAD_OVERFLOW") {
    super(code === "LOOM_CONFIG_LOAD_CANCELLED"
      ? "LOOM_CONFIG_LOAD_CANCELLED: configuration load cancelled; no settings applied"
      : "LOOM_CONFIG_LOAD_OVERFLOW: one configuration load is active and eight are waiting; retry later")
    this.name = "ConfigLoadAdmissionError"
  }
}
export function checkConfigCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ConfigLoadAdmissionError("LOOM_CONFIG_LOAD_CANCELLED")
}
function admission(): Admission {
  const host = globalThis as typeof globalThis & { [KEY]?: Admission }
  // A single object survives module replacement. There is no per-project map to grow.
  return host[KEY] ??= { version: 1, active: false, waiting: [] }
}
export function configLoadStatus() {
  const state = admission()
  return { active: Number(state.active), waiting: state.waiting.length,
    limits: CONFIG_LOAD_LIMITS, scope: "host-js-realm", wait_deadline: null }
}

/**
 * FIFO, one active operation, eight waiting. A cancelled waiter is removed now.
 * An active cancellation settles its caller now but retains the slot until the
 * real operation (including file close) settles. Never race a timeout and free
 * capacity while abandoned I/O can still be running.
 */
export function admitConfigLoad<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new ConfigLoadAdmissionError("LOOM_CONFIG_LOAD_CANCELLED"))
  const state = admission()
  if (state.active && state.waiting.length >= CONFIG_LOAD_LIMITS.waiting) {
    return Promise.reject(new ConfigLoadAdmissionError("LOOM_CONFIG_LOAD_OVERFLOW"))
  }
  return new Promise<T>((resolve, reject) => {
    let started = false, settled = false
    const settle = (ok: boolean, value: unknown) => {
      if (settled) return
      settled = true
      signal?.removeEventListener("abort", cancel)
      if (ok) resolve(value as T)
      else reject(value)
    }
    const cancel = () => {
      if (!started) {
        const index = state.waiting.indexOf(waiter)
        if (index !== -1) state.waiting.splice(index, 1)
      }
      settle(false, new ConfigLoadAdmissionError("LOOM_CONFIG_LOAD_CANCELLED"))
    }
    const complete = (ok: boolean, value: unknown) => {
      state.active = false
      if (signal?.aborted) settle(false, new ConfigLoadAdmissionError("LOOM_CONFIG_LOAD_CANCELLED"))
      else settle(ok, value)
      // Reserve the next slot synchronously, before resolved callers can overtake it.
      state.waiting.shift()?.start()
    }
    const waiter: Waiting = { start() {
      started = true
      state.active = true
      Promise.resolve().then(() => {
        checkConfigCancellation(signal)
        return operation()
      }).then(value => complete(true, value), error => complete(false, error))
    } }
    signal?.addEventListener("abort", cancel, { once: true })
    if (state.active) state.waiting.push(waiter)
    else waiter.start()
  })
}
