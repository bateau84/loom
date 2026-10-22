import { canonical, ProcessingBudget, ProcessingLimitError, uid, type Focus, type PlanNode } from "./model.js"
import type { Store } from "./store.js"
import { workReference } from "./collaboration.js"
import { taskContextOrRecovery } from "./context.js"

export type ContextSelection = Focus & {
  context_mode?: "continuation" | "independent"
  handoff_id?: string
}
type ContextInput = { action_id?: unknown; node_id?: unknown; mode?: unknown; handoff_id?: unknown }
type Options = { selectForSession?: string; envelopeChars?: number }

/** Selection preferences are navigation, never permissions or task completion. */
export function contextSelection(value: Focus): ContextSelection {
  const raw = value as ContextSelection
  const action_id = uid(raw.action_id, "action_id")
  const node_id = raw.node_id === undefined ? undefined : uid(raw.node_id, "node_id")
  if (raw.context_mode !== undefined && raw.context_mode !== "continuation" && raw.context_mode !== "independent")
    throw new Error("Context mode must be continuation or independent")
  const handoff_id = raw.handoff_id === undefined ? undefined : uid(raw.handoff_id, "handoff_id")
  if (raw.context_mode === "independent" && handoff_id !== undefined)
    throw new Error("Independent context cannot include a handoff; use continuation for prior results")
  return { action_id, ...(node_id === undefined ? {} : { node_id }),
    ...(raw.context_mode === undefined ? {} : { context_mode: raw.context_mode }),
    ...(handoff_id === undefined ? {} : { handoff_id }) }
}

/** Keep an explicitly chosen view across reads/reselection; drop a pin on new work. */
export function resolveContextSelection(input: ContextInput, selected: () => Focus | undefined): ContextSelection | undefined {
  if (input.mode !== undefined && input.mode !== "independent" && input.mode !== "continuation")
    throw new Error("Context mode must be continuation or independent")
  if (input.node_id !== undefined && input.action_id === undefined) throw new Error("node_id requires action_id")
  if (input.handoff_id !== undefined && input.handoff_id !== null) uid(input.handoff_id, "handoff_id")
  const explicit = input.action_id !== undefined
  let previous: ContextSelection | undefined
  try {
    const saved = selected()
    previous = saved === undefined ? undefined : contextSelection(saved)
  } catch (error) {
    if (!explicit) throw error
    // Explicit navigation preserves legacy continuation behavior when no mode
    // is requested. Independent assessment must request its mode explicitly.
  }
  const focus = explicit
    ? { action_id: uid(input.action_id, "action_id"), ...(input.node_id === undefined ? {} : { node_id: uid(input.node_id, "node_id") }) }
    : previous
  if (!focus) {
    // With no Action there is no inherited Loom work history to read. An
    // independent Session view needs no persisted work selection.
    if ((input.mode !== undefined && input.mode !== "independent") || input.handoff_id !== undefined)
      throw new Error("Select work with action_id before setting context options")
    return undefined
  }
  const same = previous?.action_id === focus.action_id && previous?.node_id === focus.node_id
  const mode = input.mode ?? previous?.context_mode
  const pin = input.handoff_id === null ? undefined : input.handoff_id ?? (same ? previous?.handoff_id : undefined)
  if (mode === "independent" && typeof input.handoff_id === "string")
    throw new Error("Independent context cannot include a handoff; use continuation for prior results")
  return contextSelection({ ...focus,
    ...(mode === undefined ? {} : { context_mode: mode }),
    handoff_id: mode === "independent" ? undefined : pin,
  } as ContextSelection)
}

const INDEPENDENT_NOTE = "Loom ledger, results, reviews, progress and questions are withheld, not absent or resolved. Read current sources and evidence independently. Record your observations, then use continuation and reconcile earlier findings before a final verdict. This view cannot sanitize task text, block explicit history queries or native messages, or erase an existing conversation."

/** One result is a handoff; the stable pointer survives context sampling. */
export function workContext(store: Store, requested: Focus, maxChars = 16000, agent?: string, options: Options = {}) {
  if (!Number.isSafeInteger(maxChars) || maxChars < 2000 || maxChars > 64000) throw new Error("Context budget must be 2000-64000 characters")
  const budget = maxChars - (options.envelopeChars ?? 0)
  const focus = contextSelection(requested)
  if (focus.context_mode === "independent") return independentContext(store, focus, budget, options.selectForSession)

  // A handoff can come from an earlier/dependency task, but never another Action.
  // Read it by exact immutable identity, not the newest sampled result.
  const pin = focus.handoff_id === undefined ? undefined : store.records({ action_id: focus.action_id, record_id: focus.handoff_id, limit: 1 }).items[0]
  if (focus.handoff_id !== undefined && (!pin || pin.kind !== "result" || pin.action_id !== focus.action_id))
    throw new Error("handoff_id must name an existing result in this Action")
  const view = { context_mode: "continuation" as const,
    ...(pin ? { handoff: { record_id: pin.id, ...(pin.node_id === undefined ? {} : { source_node_id: pin.node_id }) },
      handoff_note: "Read the full result with loom_record query using action_id and record_id, without node_id. Check its revision, evidence and limits; a pin is not proof." } : {}) }
  // Reserve the exact extra JSON envelope before the existing context renderer.
  const overhead = JSON.stringify(view).length - 2 + 1
  const result = taskContextOrRecovery(store, focus, maxChars, agent, {
    ...options, envelopeChars: (options.envelopeChars ?? 0) + overhead,
  })
  const output = { ...result, ...view }
  if (JSON.stringify(output).length > budget) throw new ProcessingLimitError("context envelope exceeds budget; increase context.max_chars")
  return output
}

function independentContext(store: Store, focus: ContextSelection, budget: number, selectForSession?: string) {
  // No contextRecords/collaboration call: opinions cannot leak through results,
  // progress, answers, missing-task recovery, or their truncated previews.
  const read = store.contextSnapshot(focus.action_id, (action, plan) => {
    if (!Array.isArray(plan.nodes) || plan.nodes.length > 300) throw new ProcessingLimitError("context plan exceeds 300 nodes")
    const task = focus.node_id === undefined ? undefined : plan.nodes.find(node => node.id === focus.node_id)
    const byID = new Map(plan.nodes.map(node => [node.id, node]))
    const seen = new Set<string>(), related: PlanNode[] = []
    const pending = task ? [...(task.parent ? [task.parent] : []), ...(task.depends_on ?? [])] : []
    for (let i = 0; i < pending.length; i++) {
      if (seen.has(pending[i])) continue
      seen.add(pending[i])
      const node = byID.get(pending[i])
      if (!node) continue
      related.push(node)
      if (node.parent) pending.push(node.parent)
      pending.push(...(node.depends_on ?? []))
    }
    let work_ref: ReturnType<typeof workReference> | null = null
    let work_ref_reason: string | undefined
    if (task) {
      try { work_ref = workReference(action, plan, task.id) }
      catch (error) {
        if (!(error instanceof ProcessingLimitError)) throw error
        work_ref_reason = "processing-limit"
      }
    }
    return { action: { id: action.id, revision: action.revision, title: action.title, goal: action.goal },
      plan_revision: plan.revision, task: task ?? null, related_tasks: related, work_ref,
      ...(work_ref_reason ? { work_ref_reason } : {}),
      read_plan: { tool: "loom_plan", input: { operation: "read", action_id: action.id } } }
  })
  const base = { context_mode: "independent" as const, history_withheld: true, ...read,
    records: [], progress: [], questions: [], note: INDEPENDENT_NOTE }
  if (focus.node_id !== undefined && read.task === null) {
    return { context_mode: "independent" as const, history_withheld: true, action_id: focus.action_id,
      node_id: focus.node_id, plan_revision: read.plan_revision, task: null, selection_unchanged: true,
      recovery: { code: "task-not-in-current-plan", read_plan: { tool: "loom_plan", input: { operation: "read", action_id: focus.action_id } } },
      note: "Task removed or unknown; selection is unchanged. Read the plan and select current work explicitly. " + INDEPENDENT_NOTE }
  }

  const diagnostic = (text: string) => {
    let low = 0, high = Math.min(text.length, 120)
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (JSON.stringify(text.slice(0, middle)).length <= 120) low = middle
      else high = middle - 1
    }
    return text.slice(0, low)
  }
  let selection: Record<string, unknown> | undefined
  if (selectForSession !== undefined) {
    try { store.select(selectForSession, focus) }
    catch (error) {
      let persisted: ContextSelection | null | "unknown" = "unknown", readError: string | undefined
      try { const saved = store.selected(selectForSession); persisted = saved === undefined ? null : contextSelection(saved) }
      catch (error) { readError = error instanceof Error ? error.message : String(error) }
      selection = { status: "save-failed", persisted, diagnostics_excerpted: true,
        warning: "Context read only. View was NOT saved; later automatic context follows persisted selection. Do not assume isolation. Retry in a fresh session before independent work.",
        error: diagnostic(error instanceof Error ? error.message : String(error)),
        ...(readError === undefined ? {} : { read_error: diagnostic(readError) }) }
    }
  }
  const full = { ...base, ...(selection ? { selection } : {}), truncated: false }
  try { canonical(full, new ProcessingBudget(budget)); return full }
  catch (error) { if (!(error instanceof ProcessingLimitError)) throw error }

  // Keep useful text, exact identities and the withholding notice at small budgets.
  const compact = { context_mode: base.context_mode, history_withheld: true,
    action: { id: read.action.id, revision: read.action.revision, title: "", goal: "" },
    plan_revision: read.plan_revision, work_ref: read.work_ref, ...(read.work_ref_reason ? { work_ref_reason: read.work_ref_reason } : {}), read_plan: read.read_plan,
    task: read.task ? { id: read.task.id, kind: read.task.kind, title: "" } as Record<string, unknown> : null,
    related_tasks: [] as Array<Record<string, unknown>>, records: [], progress: [], questions: [],
    ...(selection ? { selection } : {}), truncated: true, related_tasks_omitted: read.related_tasks.length,
    note: selection
      ? "Loom history withheld, not resolved. Selection save failed; the old view still controls injection. Read the full plan and evidence; reconcile prior findings after recording your observations. Text is excerpted."
      : INDEPENDENT_NOTE + " Text is excerpted; read loom_plan before relying on omitted requirements." }
  const size = () => JSON.stringify(compact).length
  if (size() > budget) throw new ProcessingLimitError("independent context envelope exceeds budget; increase context.max_chars")
  function put(target: Record<string, unknown>, key: string, text: unknown, cap: number) {
    if (typeof text !== "string") return
    const previous = target[key]
    let low = 0, high = Math.min(text.length, cap)
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      target[key] = text.slice(0, middle)
      if (size() <= budget) low = middle
      else high = middle - 1
    }
    if (low) target[key] = text.slice(0, low)
    else if (previous !== undefined) target[key] = previous
    else delete target[key]
  }
  put(compact.action, "title", read.action.title, 80)
  put(compact.action, "goal", read.action.goal, 240)
  if (read.task) {
    put(compact.task!, "title", read.task.title, 80)
    put(compact.task!, "outcome", read.task.outcome, 240)
    put(compact.task!, "context", read.task.context, 240)
    put(compact.task!, "criteria_excerpt", read.task.criteria?.join("\n"), 240)
  }
  for (const node of read.related_tasks) {
    const entry = { id: node.id, kind: node.kind, title: node.title.slice(0, 80), truncated: true }
    compact.related_tasks.push(entry); compact.related_tasks_omitted--
    if (size() > budget) { compact.related_tasks.pop(); compact.related_tasks_omitted++; break }
  }
  return compact
}
