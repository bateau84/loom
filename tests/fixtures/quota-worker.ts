import { openSharedQuotaState, type QuotaIdentity } from "../../src/quota-state.js"

const [command, path, accountID = "account-a", modelID = "gpt-6.1-sol", providerID = "opencode-go"] = process.argv.slice(2)
if (!path) throw new Error("Missing database path")
const route: QuotaIdentity = { providerID, accountID, modelID }
const store = await openSharedQuotaState({ path })
try {
  if (command === "exhaust" || command === "exhaust-short") {
    const reservation = store.reserve(route)
    if (!reservation.permit) throw new Error("Unexpectedly blocked")
    console.log(JSON.stringify({ changed: store.recordFailure(route, reservation.permit,
      { kind: "exhausted", resetAt: Date.now() + (command === "exhaust-short" ? 1_200 : 60_000) }) }))
  } else if (command === "read") {
    console.log(JSON.stringify(store.eligibility(route)))
  } else if (command === "probe") {
    const reservation = store.reserve(route)
    console.log(JSON.stringify({ eligible: reservation.eligible, probe: !!reservation.permit?.probeToken }))
  } else if (command === "probe-recover") {
    const reservation = store.reserve(route)
    if (!reservation.eligible || !reservation.permit?.probeToken)
      throw new Error("Expected owned recovery probe in this fixture")
    store.recordSuccess(route, reservation.permit)
    console.log(JSON.stringify({ owned_probe: true }))
  } else if (command === "throttle") {
    const reservation = store.reserve(route)
    if (!reservation.permit) throw new Error("Unexpectedly blocked")
    console.log(JSON.stringify({ changed: store.recordFailure(route, reservation.permit,
      { kind: "throttled", retryAfterMs: 1000 }) }))
  } else {
    throw new Error("Unknown test command")
  }
} finally { store.close() }