import type { Plugin } from "@opencode/plugin"
import type { ConfigSnapshot } from "./config.js"
import { configLoadStatus } from "./config-admission.js"
import type { Learning } from "./learning.js"
import type { EvaluationReport, EvaluationSourceRef } from "./evaluation-store.js"
import { canonical, ProcessingBudget, ProcessingLimitError, uid } from "./model.js"
import { EVALUATOR_BLOCK } from "./automatic-learning.js"

type Options = {
  learning?: Learning; ledgerPath: string; learningPath: string; signal: AbortSignal;
  getConfig: (signal?: AbortSignal) => Promise<ConfigSnapshot>;
  checkedSession: (id: string) => Promise<Record<string, unknown>>;
  warn: (error: unknown) => void;
}
export const EVALUATION_READS = ["evaluation-status", "evaluations", "evaluation", "evaluation-members", "evaluation-sources", "evaluation-observations",
  "evaluation-preparation", "evaluation-preparation-members", "evaluation-preparation-source", "evaluation-admission"] as const

const PUBLIC_READ_CHARS = 262144
/** A failed fit test must never consume a cursor or silently drop an observation. */
function fitsRead(value: unknown): boolean {
  try { canonical(value, new ProcessingBudget(PUBLIC_READ_CHARS)); return true }
  catch (error) { if (error instanceof ProcessingLimitError) return false; throw error }
}
function observationsOf(report: Pick<EvaluationReport, "body">): unknown[] | null {
  const body = report.body
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  return Array.isArray((body as Record<string, unknown>).observations)
    ? (body as { observations: unknown[] }).observations : null
}
function compactReport(report: EvaluationReport) {
  return { ...report, source_ref_count: report.source_refs.length,
    source_refs: report.source_refs.slice(0, 50), next_source_after: report.source_refs.length > 50 ? 50 : null,
    missing_source_count: report.missing_sources.length, missing_sources: report.missing_sources.slice(0, 50),
    sources_operation: "evaluation-sources" }
}
function pagedReport(report: ReturnType<typeof compactReport>) {
  const observations = observationsOf(report)
  if (!observations) throw new ProcessingLimitError("Oversized evaluation body has no observation pages")
  return { ...report, body: null, body_paginated: true, observation_count: observations.length,
    observations_operation: "evaluation-observations" }
}
function compactMember<T extends { source_refs: EvaluationSourceRef[]; report: EvaluationReport | null; ordinal: number }>(member: T) {
  return { ...member, source_ref_count: member.source_refs.length, source_refs: member.source_refs.slice(0, 50),
    next_source_after: member.source_refs.length > 50 ? 50 : null,
    report: member.report ? compactReport(member.report) : null }
}
function pageNumber(value: unknown, fallback: number, minimum: number, maximum: number, name: string) {
  const number = value ?? fallback
  if (!Number.isSafeInteger(number) || (number as number) < minimum || (number as number) > maximum)
    throw new Error("Invalid evaluation " + name)
  return number as number
}

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
      if (operation === "evaluation-admission") {
        const allowed = ["operation", "batch_id", "request_id", "manifest_sha256", "attempt_id"]
        if (Object.keys(input).some(key => !allowed.includes(key)) || typeof input.batch_id !== "string")
          throw new Error("Invalid evaluator admission read fields")
        const result = options.learning!.evaluator.admission(session, input.batch_id, input.request_id,
          input.manifest_sha256, input.attempt_id, captureEnabled)
        canonical(result, new ProcessingBudget(PUBLIC_READ_CHARS))
        return result
      }
      if (typeof operation === "string" && operation.startsWith("evaluation-preparation")) {
        const allowed = operation === "evaluation-preparation" ? ["operation", "batch_id"]
          : operation === "evaluation-preparation-members" ? ["operation", "batch_id", "request_id", "manifest_sha256", "after", "limit"]
          : operation === "evaluation-preparation-source" ? ["operation", "batch_id", "request_id", "manifest_sha256", "member_key", "source_index"] : []
        if (!allowed.length || Object.keys(input).some(key => !allowed.includes(key)) || typeof input.batch_id !== "string")
          throw new Error("Invalid evaluator preparation read fields")
        const evaluator = options.learning!.evaluator
        const result = operation === "evaluation-preparation" ? evaluator.read(session, input.batch_id)
          : operation === "evaluation-preparation-members" ? evaluator.members(session, input.batch_id, input.request_id, input.manifest_sha256, input.after, input.limit)
          : evaluator.sourceView(session, input.batch_id, input.request_id, input.manifest_sha256, input.member_key, input.source_index)
        canonical(result, new ProcessingBudget(PUBLIC_READ_CHARS))
        return result
      }
      const allowed = operation === "evaluation-status" ? ["operation"]
        : operation === "evaluations" ? ["operation", "before", "limit"]
        : operation === "evaluation" ? ["operation", "batch_id", "member_key"]
        : operation === "evaluation-members" ? ["operation", "batch_id", "after", "limit"]
        : operation === "evaluation-sources" ? ["operation", "batch_id", "member_key", "after", "limit"]
        : operation === "evaluation-observations" ? ["operation", "batch_id", "member_key", "report_id", "after", "limit"] : []
      if (!allowed.length || Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Invalid evaluation read fields")
      let result: unknown
      if (operation === "evaluation-status") result = { enabled: captureEnabled, scope: "calling-session", queued: dirty.has(session) || rescan, opportunity: engine.history.opportunity(session),
        processing: "deterministic-descriptions-only", genuine_evaluator: EVALUATOR_BLOCK, automatic_model_calls: false,
        Q4: "partial", Q5: "unqualified-transfer-withheld", E11: "unqualified" }
      else if (operation === "evaluations") result = engine.history.list(session, { before: input.before as number | undefined,
        limit: input.limit as number | undefined ?? 5, exclude_scope: ["evaluator-preparation/calling-session", "evaluator-preparation/retrospective"] })
      else {
        if (typeof input.batch_id !== "string") throw new Error("Evaluation batch_id is required")
        if (["evaluator-preparation/calling-session", "evaluator-preparation/retrospective"].includes(engine.history.get(input.batch_id, session).scope_key))
          throw new Error("Evaluation unavailable")
        if (operation === "evaluation-members") {
          const page = engine.history.reports(input.batch_id, session, { after: input.after as number | undefined, limit: input.limit as number | undefined ?? 10 })
          const items: Array<ReturnType<typeof compactMember>> = []
          for (const member of page.items) {
            let item = compactMember(member)
            const candidate = () => ({ items: [...items, item], next_after: member.ordinal })
            if (!fitsRead(candidate()) && item.report?.body !== null && item.report !== null)
              item = { ...item, report: pagedReport(item.report) }
            if (!fitsRead(candidate())) {
              if (!items.length) throw new ProcessingLimitError("One evaluation member exceeds the public read budget")
              break
            }
            items.push(item)
          }
          result = { items, next_after: items.length < page.items.length ? items.at(-1)!.ordinal : page.next_after }
        } else {
          if (operation === "evaluation-observations") {
            if (typeof input.member_key !== "string" || typeof input.report_id !== "string")
              throw new Error("Evaluation observations require member_key and report_id")
            const after = pageNumber(input.after, 0, 0, Number.MAX_SAFE_INTEGER, "observation cursor")
            const limit = pageNumber(input.limit, 20, 1, 200, "observation page")
            const report = engine.history.report(input.batch_id, session, input.member_key)
            if (!report || report.id !== input.report_id) throw new Error("Evaluation member report identity unavailable")
            const observations = observationsOf(report)
            if (report.availability === "available" && !observations)
              throw new Error("Evaluation member observations unavailable")
            const page = { batch_id: report.batch_id, member_key: report.member_key, report_id: report.id,
              report_sha256: report.sha256, availability: report.availability,
              observation_count: observations?.length ?? null, items: [] as unknown[],
              next_after: null as number | null }
            if (observations) {
              for (let i = after; i < Math.min(observations.length, after + limit); i++) {
                const candidate = { ...page, items: [...page.items, observations[i]], next_after: i + 1 < observations.length ? i + 1 : null }
                if (!fitsRead(candidate)) {
                  if (!page.items.length) throw new ProcessingLimitError("One evaluation observation exceeds the public read budget")
                  break
                }
                page.items.push(observations[i])
              }
              page.next_after = after + page.items.length < observations.length ? after + page.items.length : null
            }
            result = page
          } else {
            const report = engine.history.report(input.batch_id, session, input.member_key as string | undefined)
            if (operation === "evaluation-sources") {
              const after = input.after ?? 0, limit = input.limit ?? 50
              if (!Number.isSafeInteger(after) || (after as number) < 0 || !Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 200)
                throw new Error("Invalid evaluation source page")
              const refs = report?.source_refs ?? [], end = (after as number) + (limit as number)
              const missing = new Set(report?.missing_sources.map(ref => canonical(ref)))
              result = { report_id: report?.id ?? null, availability: report?.availability ?? "not-published", source_ref_count: refs.length,
                items: refs.slice(after as number, end).map(ref => ({ ...ref, available: !missing.has(canonical(ref)) })), next_after: end < refs.length ? end : null }
            } else {
              const batch = engine.history.get(input.batch_id, session)
              let shown = report ? compactReport(report) : null
              if (!fitsRead({ batch, report: shown }) && shown && shown.body !== null) shown = pagedReport(shown)
              result = { batch, report: shown }
            }
          }
        }
      }
      canonical(result, new ProcessingBudget(PUBLIC_READ_CHARS))
      return result
    },
  }
}
export type AutomaticLearningRuntime = Awaited<ReturnType<typeof registerAutomaticLearning>>
