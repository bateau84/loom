import type { Plugin } from "@opencode/plugin"
import type { ConfigSnapshot } from "./config.js"
import { configLoadStatus } from "./config-admission.js"
import type { Learning } from "./learning.js"
import { canonical, ProcessingBudget, uid } from "./model.js"
import { EVALUATOR_BLOCK } from "./automatic-learning.js"

type Options = {
  learning?: Learning; ledgerPath: string; learningPath: string; signal: AbortSignal;
  getConfig: (signal?: AbortSignal) => Promise<ConfigSnapshot>;
  checkedSession: (id: string) => Promise<Record<string, unknown>>;
  warn: (error: unknown) => void;
}
export const EVALUATION_READS = ["evaluation-status", "evaluations", "evaluation", "evaluation-members", "evaluation-sources"] as const

/** Cancellation owns the continuation even when a host RPC has no AbortSignal parameter. */
async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void work.catch(() => {}); signal.throwIfAborted() }
  let onAbort: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Learning cancelled"))
    signal.addEventListener("abort", onAbort, { once: true })
  })
  try { return await Promise.race([work, cancelled]) }
  finally { signal.removeEventListener("abort", onAbort) }
}

/** Existing-source catch-up only. No prompts, native children, routing, or collection expansion. */
export async function registerAutomaticLearning(ctx: Plugin.Context, options: Options) {
  const controller = new AbortController(), signal = AbortSignal.any([options.signal, controller.signal])
  const registrations: Array<{ dispose(): Promise<void> }> = []
  const dirty = new Set<string>()
  let running: Promise<void> | undefined, scheduled: ReturnType<typeof setImmediate> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined, rescan = false, wasEnabled = false
  const engine = options.learning?.automatic
  const enabled = async () => {
    // Optional catch-up yields admission to foreground config loads. It must not
    // consume one of their bounded waiting slots while the native path is busy.
    while (configLoadStatus().active || configLoadStatus().waiting) {
      await abortable(new Promise<void>(resolve => setTimeout(resolve, 10)), signal)
    }
    const config = await abortable(options.getConfig(signal), signal)
    const active = config.errors.length === 0 && config.config.ledger.capture === "automatic"
    if (active && !wasEnabled) rescan = true
    wasEnabled = active
    return active
  }
  const authorize = async (sessionID: string) => {
    if (!await enabled()) throw new Error("Automatic learning disabled")
    const session = await abortable(options.checkedSession(sessionID), signal)
    if (typeof session.agent !== "string" || !session.agent) throw new Error("Native learning principal unavailable")
    // These are source-file permissions for the actual native Session principal,
    // not a recipient-transfer grant or permission inferred from project membership.
    await abortable(ctx.permission.assert({ sessionID, agent: session.agent, action: "read",
      resources: [options.ledgerPath, options.learningPath] }), signal)
    const current = await abortable(options.checkedSession(sessionID), signal)
    if (current.agent !== session.agent || !await enabled()) throw new Error("Native learning principal changed")
    signal.throwIfAborted()
  }
  const yieldTurn = () => abortable(new Promise<void>(resolve => setImmediate(resolve)), signal)

  async function drain() {
    if (!engine || !await enabled()) { dirty.clear(); rescan = false; return }
    if (rescan) {
      rescan = false
      let after = ""
      for (;;) {
        signal.throwIfAborted()
        const sessions = engine.sources.sessions(after, 100)
        for (const id of sessions) engine.history.noteOpportunity(id, "startup-source-discovery")
        if (sessions.length < 100) break
        after = sessions.at(-1)!
        await yieldTurn()
        if (!await enabled()) return
      }
    }
    let more = true, retryAt: number | undefined
    while (more && !signal.aborted) {
      more = false
      for (const id of dirty) engine.history.noteOpportunity(id, "native-source-opportunity")
      dirty.clear()
      let after = ""
      for (;;) {
        const page = engine.history.opportunities(after, 100)
        for (const opportunity of page) {
          if (opportunity.state !== "pending") continue
          signal.throwIfAborted()
          let stage = "native-authorization-unavailable"
          try {
            const result = await engine.run(opportunity.session_id, async () => {
              stage = "native-authorization-unavailable"
              await authorize(opportunity.session_id)
              stage = "source-processing-unavailable"
            }, signal)
            if (result.state === "pending" || (result.state === "complete" && !result.replayed)) more = true
            else if (result.state === "busy") retryAt = Math.min(retryAt ?? Infinity, result.retry_at ?? Date.now() + 30000)
            else engine.history.setOpportunity(opportunity.session_id, "idle", null, opportunity.generation)
          } catch {
            if (signal.aborted) return
            engine.history.setOpportunity(opportunity.session_id, "blocked", stage, opportunity.generation)
            // Do not disclose source identifiers, bodies, or native error payloads in a global diagnostic.
            options.warn("Automatic learning blocked: " + stage + "; inspect authorized evaluation-status")
          }
          await yieldTurn()
          if (!await enabled()) return
        }
        if (page.length < 100) break
        after = page.at(-1)!.session_id
      }
      if (dirty.size) more = true
    }
    if (retryAt !== undefined && !signal.aborted) {
      if (retry) clearTimeout(retry)
      retry = setTimeout(() => { retry = undefined; wake() }, Math.max(1, retryAt - Date.now()))
      retry.unref()
    }
  }
  function wake() {
    if (signal.aborted || running || scheduled || !engine) return
    scheduled = setImmediate(() => {
      scheduled = undefined
      if (signal.aborted) return
      running = drain().catch(() => {
        if (!signal.aborted) options.warn("Automatic learning scheduling unavailable; original sources remain for restart recovery")
      }).finally(() => { running = undefined; if ((dirty.size || rescan) && !signal.aborted) wake() })
    })
  }
  function notify(sessionID: string) {
    if (signal.aborted || !engine) return
    uid(sessionID, "learning Session")
    // Overflow asks the authoritative stores for another bounded discovery walk.
    if (dirty.size < 1000) dirty.add(sessionID)
    else rescan = true
    wake()
  }
  async function dispose() {
    controller.abort()
    if (scheduled) clearImmediate(scheduled)
    if (retry) clearTimeout(retry)
    dirty.clear()
    await running
    await Promise.allSettled(registrations.map(registration => registration.dispose()))
  }
  try {
    registrations.push(await ctx.session.hook("experimental.idle", async event => { notify(event.sessionID) }))
  } catch (error) { await dispose(); throw error }

  return {
    notify, dispose,
    start() { rescan = true; wake() },
    status() { return { registered: true, automatic_model_calls: false, genuine_evaluator: EVALUATOR_BLOCK } },
    /** Read-only. Authorization must be checked for every page by the native calling tool. */
    read(input: Record<string, unknown>, session: string, captureEnabled: boolean): unknown {
      if (!engine) throw new Error("LOOM_LEARNING_UNAVAILABLE: original Action history remains available")
      const operation = input.operation
      const allowed = operation === "evaluation-status" ? ["operation"]
        : operation === "evaluations" ? ["operation", "before", "limit"]
        : operation === "evaluation" ? ["operation", "batch_id", "member_key"]
        : operation === "evaluation-members" ? ["operation", "batch_id", "after", "limit"]
        : operation === "evaluation-sources" ? ["operation", "batch_id", "member_key", "after", "limit"] : []
      if (!allowed.length || Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Invalid evaluation read fields")
      let result: unknown
      if (operation === "evaluation-status") result = { enabled: captureEnabled, scope: "calling-session", queued: dirty.has(session) || rescan, opportunity: engine.history.opportunity(session),
        processing: "deterministic-descriptions-only", genuine_evaluator: EVALUATOR_BLOCK, automatic_model_calls: false,
        Q4: "partial", Q5: "unqualified-transfer-withheld", E11: "unqualified" }
      else if (operation === "evaluations") result = engine.history.list(session, { before: input.before as number | undefined, limit: input.limit as number | undefined ?? 5 })
      else {
        if (typeof input.batch_id !== "string") throw new Error("Evaluation batch_id is required")
        if (operation === "evaluation-members") result = engine.history.reports(input.batch_id, session, { after: input.after as number | undefined, limit: input.limit as number | undefined ?? 10 })
        else {
          const report = engine.history.report(input.batch_id, session, input.member_key as string | undefined)
          if (operation === "evaluation-sources") {
            const after = input.after ?? 0, limit = input.limit ?? 50
            if (!Number.isSafeInteger(after) || (after as number) < 0 || !Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 200)
              throw new Error("Invalid evaluation source page")
            const refs = report?.source_refs ?? [], end = (after as number) + (limit as number)
            const missing = new Set(report?.missing_sources.map(ref => canonical(ref)))
            result = { report_id: report?.id ?? null, availability: report?.availability ?? "not-published", source_ref_count: refs.length,
              items: refs.slice(after as number, end).map(ref => ({ ...ref, available: !missing.has(canonical(ref)) })), next_after: end < refs.length ? end : null }
          } else result = { batch: engine.history.get(input.batch_id, session), report: report ? { ...report,
            source_ref_count: report.source_refs.length, source_refs: report.source_refs.slice(0, 50), next_source_after: report.source_refs.length > 50 ? 50 : null,
            missing_source_count: report.missing_sources.length, missing_sources: report.missing_sources.slice(0, 50),
            sources_operation: "evaluation-sources" } : null }
        }
      }
      canonical(result, new ProcessingBudget(262144))
      return result
    },
  }
}
export type AutomaticLearningRuntime = Awaited<ReturnType<typeof registerAutomaticLearning>>
