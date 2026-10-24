import type { Config, Reasoning } from "./config.js"

/**
 * Pure selection policy; it never sends a request or assumes that an OpenCode
 * provider is billed through a subscription. A runtime adapter must supply
 * verified billing and current quota/cooldown state.
 */
export type RouteInventory = {
  providerID: string
  modelID: string
  billing: "included" | "metered" | "unknown"
  quota: "available" | "unknown" | "exhausted"
  enabled: boolean
  tools: boolean
  reasoning?: readonly Reasoning[]
}

export type ModelPolicy = { modelClass: string; reasoning: Reasoning }
export type ModelRoute = {
  logicalModel: string
  providerID: string
  modelID: string
  billing: "included" | "metered"
  quota: "available" | "unknown"
  reasoning: Reasoning
}
export type ModelPlan =
  | { status: "disabled"; candidates: [] }
  | { status: "no-policy"; candidates: [] }
  | { status: "unavailable"; policy: ModelPolicy; candidates: [] }
  | { status: "ready"; policy: ModelPolicy; selected: ModelRoute; candidates: ModelRoute[] }

function uniqueRoleValue<T extends string>(values: (T | undefined)[], label: string, agentID: string): T | undefined {
  const present = [...new Set(values.filter((value): value is T => value !== undefined))]
  if (present.length > 1) throw new Error(`agents.${agentID} has conflicting role ${label}; set an explicit agent override`)
  return present[0]
}

export function resolveModelPolicy(config: Config, agentID: string): ModelPolicy | undefined {
  if (!config.modelRouting.enabled) return undefined
  const agent = config.agents[agentID]
  if (!agent || !agent.enabled) return undefined
  const roles = agent.roles.map(id => config.roles[id]).filter((r): r is NonNullable<typeof r> => !!r)
  const modelClass = agent.modelClass ?? uniqueRoleValue(roles.map(r => r.modelClass), "model-class", agentID)
    ?? config.modelRouting.defaultClass
  const reasoning = agent.reasoning ?? uniqueRoleValue(roles.map(r => r.reasoning), "reasoning", agentID)
    ?? config.modelRouting.defaultReasoning
  if (!modelClass) throw new Error(`agents.${agentID} has no model-class and no default-class`)
  if (!config.modelClasses[modelClass]) throw new Error(`agents.${agentID} references unknown model-class ${modelClass}`)
  return { modelClass, reasoning }
}

export function validateModelRouting(config: Config): void {
  if (!config.modelRouting.enabled) return
  if (!Object.keys(config.modelClasses).length) throw new Error("model-routing enabled without model-classes")
  if (config.modelRouting.defaultClass && !config.modelClasses[config.modelRouting.defaultClass]) {
    throw new Error(`model-routing.default-class references unknown model-class ${config.modelRouting.defaultClass}`)
  }
  for (const [id, agent] of Object.entries(config.agents)) {
    if (agent.enabled) resolveModelPolicy(config, id)
  }
}

/**
 * Order is model-first, provider-second. If preferred model M is exhausted
 * at provider A, M at provider B comes before model N at provider A.
 *
 * When paid-fallback is enabled, all included candidates are exhausted first
 * (across the entire class) before considering a metered provider.
 * A billing state of "unknown" is never authorization for metered usage.
 */
export function planModelRoutes(config: Config, agentID: string, inventory: readonly RouteInventory[]): ModelPlan {
  if (!config.modelRouting.enabled) return { status: "disabled", candidates: [] }
  const policy = resolveModelPolicy(config, agentID)
  if (!policy) return { status: "no-policy", candidates: [] }

  const preferredProviders = new Map(config.modelRouting.providerOrder.map((id, index) => [id, index]))
  const providerRank = (provider: string) => preferredProviders.get(provider) ?? Number.MAX_SAFE_INTEGER
  const available = inventory.filter(model =>
    model.enabled && model.tools && model.quota !== "exhausted" &&
    (model.billing === "included" || (config.modelRouting.paidFallback && model.billing === "metered")) &&
    (!model.reasoning || model.reasoning.includes(policy.reasoning)))
    .sort((a, b) => providerRank(a.providerID) - providerRank(b.providerID)
      || a.providerID.localeCompare(b.providerID)
      || a.modelID.localeCompare(b.modelID))

  const candidates: ModelRoute[] = []
  const seen = new Set<string>()
  const billingOrder: Array<"included" | "metered"> = config.modelRouting.paidFallback ? ["included", "metered"] : ["included"]
  for (const billing of billingOrder) {
    for (const logicalModel of config.modelClasses[policy.modelClass].models) {
      for (const model of available) {
        if (model.billing !== billing) continue
        const expectedID = config.modelAliases[logicalModel]?.[model.providerID] ?? logicalModel
        if (model.modelID !== expectedID) continue
        const key = JSON.stringify([model.providerID, model.modelID])
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push({
          logicalModel, providerID: model.providerID, modelID: model.modelID,
          billing, quota: model.quota, reasoning: policy.reasoning,
        })
      }
    }
  }
  if (!candidates.length) return { status: "unavailable", policy, candidates: [] }
  return { status: "ready", policy, selected: candidates[0], candidates }
}
