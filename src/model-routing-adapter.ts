import { Model, Plugin, Provider } from "@opencode/plugin"
import { openSharedQuotaState } from "./quota-state.js"
import {
  quotaIdentity, reserveNativeRoute, recordNativeFailure,
  type QuotaGate, type PendingQuotaRequest,
} from "./model-routing-shared-quota.js"
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
  ctx: Context, config: Config, source?: RouteEligibilitySource, quota?: QuotaGate,
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
    .filter(model => wanted.has(model.id) ||
      // Native ChatGPT utility/title models can be outside Loom model classes.
      // They still require full native billing proof at model.request time.
      (model.providerID === "openai" && model.cost.length === 0))
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
  return { state: planInitialModels(config, models, connections, attestations, Date.now(), quota),
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
  status: "disabled" | "not-connected" | "initial-only"
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
  injectedQuota?: QuotaGate,
): Promise<ModelRoutingRuntime> {
  // Native 2.1.4 runtime routing is not present on old/partial host mocks.
  // Check capability before consuming an admitted config I/O slot; legacy
  // Loom tool tests intentionally saturate that separate admission boundary.
  if (!ctx.model?.list || !ctx.provider?.list || !ctx.integration?.connection?.active) {
    return { status: "not-connected", selected: {}, unavailable: [] }
  }
  const snapshot = await getConfig()
  // Existing Loom treats an invalid/overloaded config read as disabled. Do
  // not make its native tool registry/ledger fail during a routing-disabled
  // startup: that would regress existing multi-instance behavior.
  if (!snapshot.config.modelRouting.enabled) {
    return { status: "disabled", selected: {}, unavailable: [] }
  }
  if (snapshot.errors.length) throw new Error("LOOM_MODEL_ROUTING_CONFIG_UNREADABLE")
  const config = snapshot.config
  const policyVersion = fingerprint(config)
  // A single shared WAL store per plugin process, entirely separate from
  // Loom's Action ledger. Opening fails closed on corrupt/insecure state.
  // Native-only fixtures can inject a quota gate without touching real HOME.
  const ownedQuota = injectedQuota ? undefined : await openSharedQuotaState()
  const quota = injectedQuota ?? ownedQuota!
  if (ownedQuota) disposers.push({ dispose: async () => { ownedQuota.close() } })
  const initial = await catalog(ctx, config, source, quota)
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
  // OpenCode's retry hook has no request/attempt ID or safe-switch flag.
  // Store only the last owned native primary reservation per Session/agent/
  // model; never use it to switch, retry or record unobserved successes.
  const pending = new Map<string, PendingQuotaRequest & { sessionID: string }>()
  const pendingKey = (sessionID: string, agent: string, providerID: string, modelID: string) =>
    JSON.stringify([sessionID, agent, providerID, modelID])
  // Keep callback synchronous to dispatch: hook registration is a supported
  // pre-transport boundary, but thrown rejections need installed-host proof.
  const managedSession = async (sessionID: string) => {
    // Auxiliary title/compaction requests identify their own utility agent.
    // Their parent Session's native agent determines whether Loom's policy
    // applies. A missing Session read remains conservative (guarded), not a
    // reason to authorize an unknown paid utility request.
    if (leases.has(sessionID)) return true
    if (!ctx.session.get) return true
    try {
      const response = await ctx.session.get({ sessionID })
      const info = "data" in response ? response.data : response
      if (!info || typeof info !== "object" || !("agent" in info) || typeof info.agent !== "string")
        return true
      const plan = initial.state.plan[info.agent]
      return plan !== undefined && plan.status !== "disabled" && plan.status !== "no-policy"
    } catch {
      return true
    }
  }
  disposers.push(await ctx.session.hook("model.request", async event => {
    signal.throwIfAborted()
    const currentConfig = await getConfig()
    if (currentConfig.errors.length || fingerprint(currentConfig.config) !== policyVersion) {
      throw new Error("LOOM_MODEL_ROUTING_RESTART_REQUIRED: routing config changed or is unreadable")
    }
    const fresh = await catalog(ctx, config, source, quota)
    const agentPlan = initial.state.plan[event.agent]
    if (event.kind === "primary" &&
        ((agentPlan && agentPlan.status !== "no-policy") || leases.has(event.sessionID))) {
      if (!agentPlan || agentPlan.status === "no-policy")
        throw new Error("LOOM_MODEL_ROUTE_AFFINITY: managed Session switched to an unconfigured agent")
      assertInitialRoute(agentPlan, event.model)
      // A newly exhausted or unverified route fails *before* calling the provider.
      const nativeID = assertAllowedRequest(fresh, event.model, config.modelRouting.paidFallback)
      if (agentPlan.status === "ready" && agentPlan.selected.accountID !== nativeID)
        throw new Error("LOOM_MODEL_ROUTE_AFFINITY: selected account changed after initial planning")
      const lease = JSON.stringify([event.model.providerID, event.model.id, event.model.variant, nativeID])
      const pinned = leases.get(event.sessionID)
      if (pinned && pinned !== lease)
        throw new Error("LOOM_MODEL_ROUTE_AFFINITY: native provider/model/account changed during a Session turn")
      // Reservation is atomic and synchronous, at the last available
      // pre-transport plugin boundary. A shared exhaustion/lease race cannot
      // slip through an earlier read-only eligibility snapshot.
      const reservation = reserveNativeRoute(quota,
        quotaIdentity(event.model.providerID, event.model.id, nativeID))
      pending.set(pendingKey(event.sessionID, event.agent, event.model.providerID, event.model.id),
        { ...reservation, sessionID: event.sessionID })
      leases.set(event.sessionID, lease)
    } else if (event.kind !== "primary" && await managedSession(event.sessionID)) {
      // Guard title/compaction/generate for managed Sessions, without changing
      // native utility behavior for *explicitly unconfigured* Session agents.
      const nativeID = assertAllowedRequest(fresh, event.model, config.modelRouting.paidFallback)
      reserveNativeRoute(quota, quotaIdentity(event.model.providerID, event.model.id, nativeID))
      // Auxiliary request outcomes cannot be reliably paired to a unique
      // reservation. Do not invent provider success/failure accounting.
    }
  }))
  disposers.push(await ctx.session.hook("retry", event => {
    // OpenCode's normalized provider error type is authoritative enough to
    // classify a failed primary request; raw HTTP success is not. The hook
    // does NOT establish that it is safe to change models.
    const found = pending.get(pendingKey(event.sessionID, event.agent, event.model.providerID, event.model.id))
    if (!recordNativeFailure(quota, found, event.error)) return
    pending.delete(pendingKey(event.sessionID, event.agent, event.model.providerID, event.model.id))
    // Never loop on a route that we have just marked exhausted/throttled.
    // This rejects, rather than attempting an unsafe live provider switch.
    event.decision = { retry: false }
  }))

  const run = async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal })) {
        if (signal.aborted) break
        if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted" || event.type === "session.deleted") {
          // V2 event payloads identify the native Session as data.sessionID.
          if ("sessionID" in event.data && typeof event.data.sessionID === "string")
            {
              leases.delete(event.data.sessionID)
              for (const [id, record] of pending) if (record.sessionID === event.data.sessionID) pending.delete(id)
            }
        }
      }
    } catch {
      // A missed release is conservative. The next primary request with a
      // different route is rejected rather than silently changing accounts.
    }
  }
  void run()
  // OpenCode 2.1.1 exposes these plugin APIs but does not consume the
  // agent model at native dispatch. Do not report operational initial routing
  // on an unqualified host version merely because the transform registered.
  return { status: ctx.app?.version === "2.1.4" ? "initial-only" : "not-connected", selected, unavailable }
}
