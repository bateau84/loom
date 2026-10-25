import type {
  QuotaFailure, QuotaIdentity, QuotaPermit, QuotaReservation, SharedQuotaState,
} from "./quota-state.js"

/** Only the operations the request guard needs; SQLite remains in quota-state.ts. */
export type QuotaGate = Pick<SharedQuotaState, "eligibility" | "reserve" | "recordFailure" | "recordSuccess">
export type PendingQuotaRequest = { route: QuotaIdentity; permit: QuotaPermit }

/** All three values come from a native model and an opaque active connection ID. */
export function quotaIdentity(providerID: string, modelID: string, accountID: string): QuotaIdentity {
  return { providerID, modelID, accountID }
}

/** Reserve at the last synchronous point of a supported pre-transport hook. */
export function reserveNativeRoute(quota: QuotaGate, route: QuotaIdentity): PendingQuotaRequest {
  const reservation: QuotaReservation = quota.reserve(route)
  if (!reservation.eligible || !reservation.permit) {
    throw new Error("LOOM_MODEL_QUOTA_UNAVAILABLE: shared quota state denies the selected native route")
  }
  return { route, permit: reservation.permit }
}

/**
 * These are OpenCode 2.1.4's structured, normalized SessionError.type tags
 * (see packages/core/src/session/to-session-error.ts). A bare HTTP status,
 * textual error message, or successful HTTP handshake is NOT quota evidence.
 *
 * Never infer a provider reset time, retry-after, numeric remaining balance,
 * or a provider-wide scope from these tags.
 */
export function classifiedNativeFailure(
  error: { readonly type: string; readonly status?: number },
): QuotaFailure | undefined {
  switch (error.type) {
    case "provider.quota":
    case "provider.free-limit":
      return { kind: "exhausted" }
    case "provider.rate-limit":
      return { kind: "throttled" }
    case "provider.auth":
      return { kind: "authentication" }
    default:
      return undefined
  }
}

/**
 * A host retry callback confirms a provider failure, not a safe switch point.
 * This records only the exact reserved account+model and leaves all actual
 * credential, tool, and stream execution with native OpenCode.
 */
export function recordNativeFailure(
  quota: QuotaGate,
  pending: PendingQuotaRequest | undefined,
  error: { readonly type: string; readonly status?: number },
): boolean {
  const failure = classifiedNativeFailure(error)
  if (!pending || !failure) return false
  quota.recordFailure(pending.route, pending.permit, failure)
  return true
}
