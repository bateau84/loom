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
 * Only consume an explicit, normalized native Retry-After delay. Never infer
 * a reset time, numeric remaining balance, or provider-wide scope from tags.
 */
export function classifiedNativeFailure(
  error: { readonly type: string; readonly status?: number; readonly retryAfterMs?: number },
): QuotaFailure | undefined {
  // OpenCode's normalized delay is already in milliseconds. The SQLite
  // manager validates its numeric bounds before persisting a deadline.
  const timing = error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }
  switch (error.type) {
    case "provider.quota":
    case "provider.free-limit":
      return { kind: "exhausted", ...timing }
    case "provider.rate-limit":
      return { kind: "throttled", ...timing }
    case "provider.auth":
      // 401 indicates rejected credentials. A 403 can instead be model-level
      // authorization denial: it cannot justify an indefinite account-wide
      // block. Never infer authentication loss from text or bare status.
      return error.status === 401 ? { kind: "authentication" } : undefined
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
  error: { readonly type: string; readonly status?: number; readonly retryAfterMs?: number },
): boolean {
  const failure = classifiedNativeFailure(error)
  if (!pending || !failure) return false
  quota.recordFailure(pending.route, pending.permit, failure)
  return true
}
