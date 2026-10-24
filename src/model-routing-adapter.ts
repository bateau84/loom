import { Model, Plugin, Provider } from "@opencode/plugin"
import type { Config, ConfigSnapshot } from "./config.js"
import {
  assertInitialRoute, connectionID, inventoryEntry, nativeChatGPTAttestation,
  planInitialModels, type NativeRoutingConnection, type NativeRoutingModel,
  type NativeRoutingProvider, type RouteAttestation, type RouteEligibilitySource,
  type RoutingSnapshot,
} from "./model-routing-runtime.js"

type Context = Plugin.Context
type Registration = { dispose(): Promise<void> }
const key = (providerID: string, modelID: string) => JSON.stringify([providerID, modelID])

/** A change of role/class/billing policy requires an intentional plugin restart. */
function fingerprint(config: Config): string {
  return JSON.stringify([config.modelRouting, config.modelClasses, config.modelAliases, config.agents, config.roles])
}

type Catalog = {
  state: RoutingSnapshot
  models: NativeRoutingModel[]
  connections: Record<string, NativeRoutingConnection | undefined>
  attestations: Record<string, RouteAttestation | undefined>
}

/**
 * The host is authoritative for the model catalog and active connection.
 * This only inspects public metadata; no connection.resolve(), tokens,
 * credential files, extra quota DB or protocol translation.
 */
async function catalog(
  ctx: Context, config: Config, source?: RouteEligibilitySource,
): Promise<Catalog> {
  const [nativeModels, nativeProviders] = await Promise.all([ctx.model.list(), ctx.provider.list()])
  const wanted = new Set<string>()
  const actualProviders = new Set<string>()
  for (const logicalModel of Object.values(config.modelClasses).flatMap(item => item.models)) {
    wanted.add(logicalModel)
    for (const [providerID, alias] of Object.entries(config.modelAliases[logicalModel] ?? {})) {
      wanted.add(alias)
      actualProviders.add(providerID)
    }
  }
  const models = nativeModels.data
    .filter(model => wanted.has(model.id))
    .map(model => ({
      id: model.id, providerID: model.providerID,
      enabled: model.enabled, capabilities: { tools: model.capabilities.tools },
      variants: model.variants.map(v => ({ id: v.id, settings: v.settings, body: v.body, headers: v.headers })),
      cost: model.cost,
    } satisfies NativeRoutingModel))
  const providerMap = new Map(nativeProviders.data.map(provider => [provider.id, provider]))
  for (const model of models) actualProviders.add(model.providerID)
  const connections: Record<string, NativeRoutingConnection | undefined> = {}
  // No connection => no eligibility; never treat a configured provider as a subscription.
  for (const providerID of actualProviders) {
    const provider = providerMap.get(providerID)
    if (!provider) continue
    try {
      connections[providerID] = await ctx.integration.connection.active(provider.integrationID ?? providerID)
    } catch {
      // Missing/inaccessible connection is unknown, never inferred as included.
    }
  }
  const attestations: Record<string, RouteAttestation | undefined> = {}
  for (const model of models) {
    const provider = providerMap.get(model.providerID) as NativeRoutingProvider | undefined
    const native = nativeChatGPTAttestation(model, provider, connections[model.providerID])
    const id = connectionID(connections[model.providerID])
    const reported = source && id
      ? await source.inspect({ providerID: model.providerID, modelID: model.id, connectionID: id })
      : undefined
    // A supplied negative/unverified claim takes precedence over native evidence.
    attestations[key(model.providerID, model.id)] = reported ?? native
  }
  return { state: planInitialModels(config, models, connections, attestations, Date.now()),
    models, connections, attestations }
}

/** Prevent native fallback or an explicit Session choice from defeating Loom billing policy. */
function assertAllowedRequest(
  snapshot: Catalog,
  model: { providerID: string; id: string },
  paidFallback: boolean,
): string {
  const row = snapshot.models.find(item => item.providerID === model.providerID && item.id === model.id)
  if (!row) throw new Error("LOOM_MODEL_ROUTE_UNAVAILABLE: request model is not in the verified catalog")
  const entry = inventoryEntry(row, snapshot.connections[model.providerID],
    snapshot.attestations[key(model.providerID, model.id)], Date.now())
  if (!entry.enabled || !entry.tools || entry.quota === "exhausted" ||
    !(entry.billing === "included" || (paidFallback && entry.billing === "metered")))
    throw new Error("LOOM_MODEL_ROUTE_UNAVAILABLE: unverified billing, exhausted quota or unsupported model")
  const id = connectionID(snapshot.connections[model.providerID])
  if (!id) throw new Error("LOOM_MODEL_ROUTE_UNAVAILABLE: native connection missing")
  return id
}

export type ModelRoutingRuntime = {
  status: "disabled" | "initial-only"
  selected: Record<string, { provider_id: string; model_id: string; reasoning: string; billing: string }>
  unavailable: string[]
}

/**
 * 2.1.4 honors Agent.Info.model only if Session.model is unset.
 * This adapter never uses retry/switchModel to mutate a running Session.
 * The model.request guard runs before the native transport; when OpenCode
 * falls back to its global default, it blocks instead of risking a paid call.
 */
export async function registerModelRouting(
  ctx: Context,
  getConfig: () => Promise<ConfigSnapshot>,
  disposers: Registration[],
  signal: AbortSignal,
  source?: RouteEligibilitySource,
): Promise<ModelRoutingRuntime> {
  const snapshot = await getConfig()
  if (snapshot.errors.length || !snapshot.config.modelRouting.enabled) {
    if (snapshot.errors.length) {
      // We cannot safely infer whether invalid YAML intended to enable paid
      // routing. Do not attach a policy from partially decoded config.
      throw new Error("Loom routing cannot verify .loom.yaml: " + snapshot.errors.join("; "))
    }
    return { status: "disabled", selected: {}, unavailable: [] }
  }
  const config = snapshot.config
  const policyVersion = fingerprint(config)
  const initial = await catalog(ctx, config, source)
  const selected: ModelRoutingRuntime["selected"] = {}
  const unavailable: string[] = []
  for (const [agent, plan] of Object.entries(initial.state.plan)) {
    if (plan.status === "ready") {
      selected[agent] = { provider_id: plan.selected.providerID, model_id: plan.selected.modelID,
        reasoning: plan.selected.reasoning, billing: plan.selected.billing }
    } else if (plan.status === "unavailable") unavailable.push(agent)
  }
  disposers.push(await ctx.agent.transform(editor => {
    for (const [agentID, plan] of Object.entries(initial.state.plan)) {
      if (plan.status !== "ready" || !editor.get(agentID)) continue
      editor.update(agentID, item => {
        item.model = {
          providerID: Provider.ID.make(plan.selected.providerID),
          id: Model.ID.make(plan.selected.modelID),
          variant: Model.VariantID.make(plan.selected.reasoning),
        }
      })
    }
  }))

  // In-process lease prevents an account/model switch during the Session's
  // primary tool continuations. Only host terminal events release a lease;
  // missed events merely retain an over-conservative lease (not an unsafe one).
  const leases = new Map<string, string>()
  // Keep callback synchronous to dispatch: hook registration is a supported
  // pre-transport boundary, but thrown rejections need installed-host proof.
  disposers.push(await ctx.session.hook("model.request", async event => {
    signal.throwIfAborted()
    const currentConfig = await getConfig()
    if (currentConfig.errors.length || fingerprint(currentConfig.config) !== policyVersion) {
      throw new Error("LOOM_MODEL_ROUTING_RESTART_REQUIRED: routing config changed or is unreadable")
    }
    const fresh = await catalog(ctx, config, source)
    const agentPlan = initial.state.plan[event.agent]
    if (event.kind === "primary" && agentPlan && agentPlan.status !== "no-policy") {
      assertInitialRoute(agentPlan, event.model)
      // A newly exhausted or unverified route fails *before* calling the provider.
      const nativeID = assertAllowedRequest(fresh, event.model, config.modelRouting.paidFallback)
      const lease = JSON.stringify([event.model.providerID, event.model.id, event.model.variant, nativeID])
      const pinned = leases.get(event.sessionID)
      if (pinned && pinned !== lease)
        throw new Error("LOOM_MODEL_ROUTE_AFFINITY: native provider/model/account changed during a Session turn")
      leases.set(event.sessionID, lease)
    } else if (event.kind !== "primary") {
      // Title/compaction/generate are auxiliary native model calls, and can
      // otherwise silently select a metered global default for a routed Session.
      assertAllowedRequest(fresh, event.model, config.modelRouting.paidFallback)
    }
  }))

  const run = async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal })) {
        if (signal.aborted) break
        if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted" || event.type === "session.deleted") {
          // V2 event payloads identify the native Session as data.sessionID.
          if ("sessionID" in event.data && typeof event.data.sessionID === "string")
            leases.delete(event.data.sessionID)
        }
      }
    } catch {
      // A missed release is conservative. The next primary request with a
      // different route is rejected rather than silently changing accounts.
    }
  }
  void run()
  return { status: "initial-only", selected, unavailable }
}
