import { Model, Provider, type Plugin } from "@opencode/plugin"
import type { ConfigSnapshot } from "./config.js"
import type { RouteInventory } from "./model-routing.js"
import { assertInitialRoute, sameRoute } from "./model-routing-runtime.js"
import { planWorkloadRoutes, type WorkloadAssignment } from "./workload-routing.js"

type Registration = { dispose(): Promise<void> }
type RequestIdentity = {
  sessionID: string
  agent: string
  kind: "primary" | "title" | "compaction" | "generate"
}

/**
 * Internal mechanics candidate, supplied explicitly by qualification fixtures.
 * `agent` is the native Session's owner (also the primary/generate agent),
 * not an auxiliary title/compaction agent. The source must keep the workload
 * binding stable and re-read current policy/eligibility at each invocation.
 *
 * These inputs are NOT an authenticated workload, permission, account or
 * included-only billing receipt. Production has no qualified source yet.
 */
export type RequestLocalCandidateSource = (input: Readonly<RequestIdentity>) => Promise<{
  snapshot: ConfigSnapshot
  inventory: readonly RouteInventory[]
  assignment: WorkloadAssignment
}>

/**
 * @internal OpenCode 2.3.0 request-local selection/validation mechanics only.
 * The production plugin deliberately never calls this function. Fixtures
 * compose it with the existing planner and a local, non-billable provider.
 *
 * No agent transform, Session switch, journal, reservation, retry accounting
 * or one-shot resolve receipt: title resolution may be speculative, compaction
 * can reuse a primary model, and auxiliary retries reuse a prepared request.
 * model.request validates preparation, NOT every physical transport attempt.
 */
export async function registerRequestLocalModelSelectionCandidate(
  ctx: Plugin.Context,
  load: RequestLocalCandidateSource,
  disposers: Registration[],
  signal: AbortSignal,
): Promise<void> {
  if (ctx.app?.version !== "2.3.0" || !ctx.session?.hook || !ctx.session?.get)
    throw new Error("LOOM_REQUEST_LOCAL_HOST_UNQUALIFIED: candidate requires exact OpenCode 2.3.0 Session APIs")
  signal.throwIfAborted()

  let ready = false
  let disposed = false
  const active = () => {
    signal.throwIfAborted()
    if (!ready || disposed)
      throw new Error("LOOM_REQUEST_LOCAL_NOT_READY: candidate hooks are not fully registered or have been disposed")
  }
  disposers.push({ dispose: async () => { disposed = true } })

  const current = async (event: RequestIdentity) => {
    active()
    // Resolve events do not identify whether the native model was explicitly
    // selected. Do not turn an unavailable Session read into permission to
    // overwrite the user's choice, or guess the owner of a utility request.
    const session = await ctx.session.get({ sessionID: event.sessionID })
    active()
    if (!session || session.id !== event.sessionID || !session.agent ||
        ((event.kind === "primary" || event.kind === "generate") && session.agent !== event.agent))
      throw new Error("LOOM_REQUEST_LOCAL_CONTEXT_UNAVAILABLE: native Session/agent binding is unknown or changed")
    const input = await load({ sessionID: event.sessionID, agent: session.agent, kind: event.kind })
    active()
    if (input.snapshot.errors.length)
      throw new Error("LOOM_REQUEST_LOCAL_CONFIG_UNREADABLE: candidate policy could not be loaded")
    const result = planWorkloadRoutes(input.snapshot.config, session.agent, input.inventory, input.assignment)
    if (result.status !== "ready")
      throw new Error("LOOM_REQUEST_LOCAL_UNAVAILABLE: no eligible workload candidate")
    // Preserve the existing managed-choice contract: exact compatible manual
    // selections pass; conflicting choices are denied rather than replaced.
    if (session.model && !sameRoute(session.model, result.plan.selected))
      throw new Error("LOOM_REQUEST_LOCAL_EXPLICIT_CHOICE: explicit Session model conflicts with workload policy")
    return result.plan
  }

  // Install denial/validation first. If resolver registration fails, this
  // guard remains not-ready until the caller disposes its registrations.
  disposers.push(await ctx.session.hook("model.request", async event => {
    const plan = await current(event)
    // Independently validate the actual native ref. A later resolver hook may
    // replace our selection, and the source may now deny an exhausted route.
    // Source inputs intentionally cannot depend on this mutable model ref.
    assertInitialRoute(plan, event.model)
  }))
  disposers.push(await ctx.session.hook("experimental.model.resolve", async event => {
    const plan = await current(event)
    if (event.model.providerID !== plan.selected.providerID)
      throw new Error("LOOM_REQUEST_LOCAL_PROVIDER_MISMATCH: cross-provider selection requires a separate native boundary")
    // Replace the whole ref. Mutating the original in place also changes the
    // host's comparison baseline and can incorrectly keep its original model.
    event.model = {
      providerID: Provider.ID.make(plan.selected.providerID),
      id: Model.ID.make(plan.selected.modelID),
      variant: Model.VariantID.make(plan.selected.reasoning),
    }
  }))
  ready = true
}
