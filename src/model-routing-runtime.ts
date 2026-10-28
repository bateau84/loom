import type { Config, Reasoning } from "./config.js"
import { planModelRoutes, type ModelPlan, type RouteInventory } from "./model-routing.js"
/** Read-only structural boundary: core/Node tests do not import Bun SQLite. */
export type QuotaEligibilityReader = {
  eligibility(route: { providerID: string; modelID: string; accountID: string }):
    { eligible: boolean; quota: "available" | "unknown" | "exhausted" }
}

/** Only public catalog fields and opaque native connection IDs; never credentials. */
export type NativeRoutingModel = {
  id: string
  providerID: string
  enabled: boolean
  capabilities: { tools: boolean }
  variants: readonly { id: string; settings?: Record<string, unknown>; body?: Record<string, unknown>; headers?: Record<string, string> }[]
  cost: readonly unknown[]
}
export type NativeRoutingProvider = {
  id: string
  integrationID?: string
  settings?: Record<string, unknown>
  headers?: Record<string, string>
}
export type NativeRoutingConnection =
  | { type: "credential"; id: string; method: "key" | "oauth" | "external"; status?: { status: string } }
  | { type: "env"; name: string; status?: { status: string } }

/**
 * This interface belongs to the separate shared-quota task. It must classify
 * the *active native connection*, not a provider name. Missing/unverified
 * claims never authorize requests. It owns storage, cooldowns and freshness.
 */
export type RouteAttestation = {
  providerID: string
  modelID: string
  connectionID: string
  billing: "included" | "metered" | "unknown"
  verified: boolean
  quota: "available" | "unknown" | "exhausted"
  cooldownUntil?: number
}
export interface RouteEligibilitySource {
  inspect(input: { providerID: string; modelID: string; connectionID: string }): Promise<RouteAttestation | undefined>
}

export function connectionID(connection: NativeRoutingConnection | undefined): string | undefined {
  if (!connection || connection.status?.status === "needs_auth") return undefined
  return connection.type === "credential" ? connection.id : `env:${connection.name}`
}

/**
 * OpenCode 2.1.4's built-in opencode.provider.openai plugin uses this exact
 * Codex endpoint and headers ONLY for the native ChatGPT OAuth integration,
 * disables incompatible models, and sets their cost list to [].
 * OAuth alone, cost alone, and provider ID alone are never proof.
 *
 * The upstream implementation is version-specific; re-audit on upgrade.
 */
export function nativeChatGPTAttestation(
  model: NativeRoutingModel,
  provider: NativeRoutingProvider | undefined,
  connection: NativeRoutingConnection | undefined,
): RouteAttestation | undefined {
  const id = connectionID(connection)
  if (
    !id || connection?.type !== "credential" || connection.method !== "oauth" ||
    model.providerID !== "openai" || provider?.id !== "openai" ||
    provider.settings?.baseURL !== "https://chatgpt.com/backend-api/codex" ||
    provider.headers?.originator !== "opencode" ||
    provider.headers?.["x-codex-beta-features"] !== "remote_compaction_v2" ||
    !model.enabled || model.cost.length !== 0
  ) return undefined
  return { providerID: model.providerID, modelID: model.id, connectionID: id, billing: "included", verified: true, quota: "unknown" }
}

/**
 * A named native variant is required. Do not convert an unsupported level
 * into a default or lesser level. 2.1.4's Variant.resolve creates these
 * overlays from real provider reasoning controls.
 */
export function supportedReasoning(model: NativeRoutingModel): Reasoning[] {
  return (["low", "medium", "high"] as const).filter(reasoning => {
    const variant = model.variants.find(item => item.id === reasoning)
    return variant !== undefined &&
      (Object.keys(variant.settings ?? {}).length > 0 ||
        Object.keys(variant.body ?? {}).length > 0 ||
        Object.keys(variant.headers ?? {}).length > 0)
  })
}

/**
 * Enforce attestation identity, cooldown, billing confidence and native
 * capability before handing a candidate to the preexisting pure planner.
 */
export function inventoryEntry(
  model: NativeRoutingModel,
  connection: NativeRoutingConnection | undefined,
  attestation: RouteAttestation | undefined,
  now: number,
): RouteInventory {
  // OpenCode environment connections expose only a variable name, not a
  // stable identity of the underlying account. Do not pool them across
  // processes or authorize included subscription usage by that name.
  const nativeID = connection?.type === "credential" ? connectionID(connection) : undefined
  const trusted = nativeID !== undefined &&
    attestation?.verified === true &&
    attestation.providerID === model.providerID &&
    attestation.modelID === model.id &&
    attestation.connectionID === nativeID &&
    (attestation.billing === "included" || attestation.billing === "metered") &&
    (attestation.quota === "unknown" || attestation.quota === "available" || attestation.quota === "exhausted") &&
    (attestation.cooldownUntil === undefined || Number.isFinite(attestation.cooldownUntil))
  return {
    providerID: model.providerID,
    modelID: model.id,
    ...(nativeID ? { accountID: nativeID } : {}),
    billing: trusted ? attestation.billing : "unknown",
    quota: trusted && (attestation.cooldownUntil === undefined || attestation.cooldownUntil <= now)
      ? attestation.quota : "exhausted",
    enabled: model.enabled && nativeID !== undefined,
    tools: model.capabilities.tools,
    reasoning: supportedReasoning(model),
  }
}

export type RoutingSnapshot = {
  plan: Record<string, ModelPlan>
  inventory: RouteInventory[]
  /** Opaque connection identity for guarding subsequent native requests. */
  connections: Record<string, string>
}

export function planInitialModels(
  config: Config,
  models: readonly NativeRoutingModel[],
  connections: Readonly<Record<string, NativeRoutingConnection | undefined>>,
  attestations: Readonly<Record<string, RouteAttestation | undefined>>,
  now: number,
  quota?: QuotaEligibilityReader,
): RoutingSnapshot {
  const inventory = models.map(model => {
    const candidate = inventoryEntry(model, connections[model.providerID],
      attestations[JSON.stringify([model.providerID, model.id])], now)
    // Billing is independently attested; quota state can ONLY narrow the
    // candidate's eligibility. A prior quota report never upgrades billing.
    if (!quota || !candidate.accountID || candidate.billing === "unknown") return candidate
    const current = quota.eligibility({
      providerID: candidate.providerID, modelID: candidate.modelID,
      accountID: candidate.accountID,
    })
    return { ...candidate,
      quota: candidate.quota === "exhausted" || !current.eligible
        ? "exhausted" as const : current.quota }
  })
  const plans: Record<string, ModelPlan> = {}
  for (const id of Object.keys(config.agents)) plans[id] = planModelRoutes(config, id, inventory)
  return {
    plan: plans,
    inventory,
    connections: Object.fromEntries(Object.entries(connections)
      .flatMap(([provider, connection]) => {
        const id = connectionID(connection)
        return id ? [[provider, id]] : []
      })),
  }
}

export function sameRoute(
  actual: { providerID: string; id: string; variant?: string },
  expected: { providerID: string; modelID: string; reasoning: Reasoning },
): boolean {
  return actual.providerID === expected.providerID &&
    actual.id === expected.modelID && actual.variant === expected.reasoning
}

/**
 * Called at the native model.request boundary, before any provider call.
 * Never falls through to OpenCode's global default for a routed agent.
 */
export function assertInitialRoute(
  plan: ModelPlan | undefined,
  actual: { providerID: string; id: string; variant?: string },
): void {
  if (!plan || plan.status === "disabled" || plan.status === "no-policy") return
  if (plan.status !== "ready") throw new Error("LOOM_MODEL_ROUTE_UNAVAILABLE: no verified eligible model for this agent")
  if (!sameRoute(actual, plan.selected)) {
    throw new Error("LOOM_MODEL_ROUTE_MISMATCH: OpenCode selected a different model; request blocked before provider dispatch")
  }
}
