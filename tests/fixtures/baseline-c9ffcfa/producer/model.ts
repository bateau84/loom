import { createHash } from "node:crypto"
export type NodeKind = "phase" | "wave" | "task" | "subtask"
export type PlanNode = { id: string; kind: NodeKind; title: string; parent?: string; depends_on?: string[]; outcome?: string; context?: string; criteria?: string[]; skills?: string[]; roles?: string[]; agent?: string }
export type Action = { id: string; title: string; goal: string; state: "active" | "paused" | "completed" | "cancelled"; revision: number; created_at: string }
export type Plan = { revision: number; nodes: PlanNode[] }
export type Focus = { action_id: string; node_id?: string }
export type Actor = { session_id: string; agent: string }
export type RecordKind = "observation" | "claim" | "result" | "assessment" | "qa" | "completion" | "reopen" | "question" | "answer" | "assignment" | "delivery-intent" | "continuation-authorization" | "continuation-withdrawal" | "delivery-event"
export type LedgerRecord = Actor & { id: string; action_id?: string; node_id?: string; kind: RecordKind; created_at: string; fingerprint?: string; data: Record<string, unknown> }
export const uid = (value: unknown, label = "id"): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(value)) throw new Error(`${label} must be a simple identifier of 1-120 characters`)
  return value
}
// Limits count UTF-16 code units in serialized JSON, not model tokens or elapsed time.
export const PROCESSING_LIMITS = Object.freeze({
  planChars: 262144, storedPlanChars: 524288, recordChars: 131072,
  valueChars: 1048576, values: 32768, depth: 48,
  contextHashChars: 1048576, contextHashValues: 131072,
})
export class ProcessingLimitError extends Error {
  readonly code = "LOOM_PROCESSING_LIMIT"
  constructor(message: string) { super(`Loom processing limit: ${message}`) }
}
/** A monotonic operation budget. Exhaustion never restarts the allowance. */
export class ProcessingBudget {
  chars = 0
  values = 0
  private exhausted = false
  constructor(readonly maxChars: number = PROCESSING_LIMITS.valueChars, readonly maxValues: number = PROCESSING_LIMITS.values) {
    if (!Number.isSafeInteger(maxChars) || maxChars < 1 || !Number.isSafeInteger(maxValues) || maxValues < 1) throw new Error("Invalid processing budget")
  }
  fail(reason: string): never { this.exhausted = true; throw new ProcessingLimitError(reason) }
  take(chars: number, values = 0) {
    if (this.exhausted || chars > this.maxChars - this.chars || values > this.maxValues - this.values) this.fail(`serialization exceeds ${this.maxChars} characters or ${this.maxValues} values; reduce the payload`)
    this.chars += chars; this.values += values
  }
}
/** Canonical bytes for plain data stay unchanged; no partial digest is returned. */
export function canonical(value: unknown, budget = new ProcessingBudget()): string {
  const chunks: string[] = [], active = new Set<object>()
  const emit = (text: string) => { budget.take(text.length); chunks.push(text) }
  function quote(text: string) {
    // Reject before allocating the escaped form of a huge scalar. Escape expansion
    // of an admitted scalar is at most sixfold and is charged before it is retained.
    if (text.length + 2 > budget.maxChars - budget.chars) budget.fail("string exceeds remaining serialization allowance")
    emit(JSON.stringify(text))
  }
  function walk(v: unknown, depth: number) {
    budget.take(0, 1)
    if (depth > PROCESSING_LIMITS.depth) budget.fail(`nesting exceeds ${PROCESSING_LIMITS.depth}`)
    if (typeof v === "string") { quote(v); return }
    if (v === null || v === undefined) { emit("null"); return }
    if (typeof v === "number" || typeof v === "boolean") { emit(JSON.stringify(v)); return }
    if (typeof v !== "object") budget.fail("only plain data can be serialized")
    const object = v as object
    if (active.has(object)) budget.fail("cyclic data cannot be serialized")
    active.add(object)
    try {
      if (Array.isArray(v)) {
        if (v.length > budget.maxValues - budget.values) budget.fail("array exceeds remaining value allowance")
        emit("[")
        for (let i = 0; i < v.length; i++) {
          if (i) emit(",")
          const item = Object.getOwnPropertyDescriptor(v, String(i))
          if (item && !("value" in item)) budget.fail("accessors cannot be serialized")
          walk(item?.value, depth + 1)
        }
        emit("]"); return
      }
      const prototype = Object.getPrototypeOf(v)
      if (prototype !== Object.prototype && prototype !== null) budget.fail("only plain mappings can be serialized")
      const keys = Object.keys(v)
      if (keys.length > budget.maxValues - budget.values) budget.fail("mapping exceeds remaining value allowance")
      // Bound key material before sorting. Engine-level key enumeration and proxies
      // are not a sandbox boundary; these limits govern ordinary host data.
      let keyChars = 0
      for (const key of keys) {
        keyChars += key.length
        if (keyChars > budget.maxChars - budget.chars) budget.fail("keys exceed remaining serialization allowance")
      }
      emit("{")
      let first = true
      for (const key of keys.sort((a, b) => a.localeCompare(b))) {
        const item = Object.getOwnPropertyDescriptor(v, key)!
        if (!("value" in item)) budget.fail("accessors cannot be serialized")
        if (item.value === undefined) continue
        if (!first) emit(",")
        first = false; quote(key); emit(":"); walk(item.value, depth + 1)
      }
      emit("}")
    } finally { active.delete(object) }
  }
  walk(value, 0)
  return chunks.join("")
}
export const digest = (value: unknown, budget?: ProcessingBudget) => createHash("sha256").update(canonical(value, budget)).digest("hex")
export function validatePlan(input: unknown): PlanNode[] {
  if (!Array.isArray(input) || input.length > 300) throw new Error("Plan nodes must be an array of at most 300 nodes")
  // Aggregate admission precedes cloning and graph traversal. Per-field limits remain.
  canonical(input, new ProcessingBudget(PROCESSING_LIMITS.planChars))
  const order: Record<NodeKind, number> = { phase: 0, wave: 1, task: 2, subtask: 3 }
  const nodes: PlanNode[] = [], map = new Map<string, PlanNode>()
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Every plan node must be a mapping")
    const n = raw as Record<string, unknown>
    for (const k of Object.keys(n)) if (!["id", "kind", "title", "parent", "depends_on", "outcome", "context", "criteria", "skills", "roles", "agent"].includes(k)) throw new Error(`Unknown plan node field: ${k}`)
    uid(n.id, "node id")
    if (typeof n.kind !== "string" || !Object.hasOwn(order, n.kind)) throw new Error("Invalid node kind")
    if (typeof n.title !== "string" || !n.title.trim() || n.title.length > 500) throw new Error("Node title must be 1-500 characters")
    for (const k of ["outcome", "context", "agent"]) if (n[k] !== undefined && (typeof n[k] !== "string" || String(n[k]).length > 8000)) throw new Error(`Invalid ${k}`)
    if (n.parent !== undefined) uid(n.parent, "parent")
    for (const k of ["depends_on", "criteria", "skills", "roles"]) {
      if (n[k] !== undefined && (!Array.isArray(n[k]) || (n[k] as unknown[]).length > 50 || (n[k] as unknown[]).some(x => typeof x !== "string" || x.length > 2000))) throw new Error(`Invalid ${k}`)
    }
    const node = structuredClone(n) as unknown as PlanNode
    if (map.has(node.id)) throw new Error(`Duplicate node: ${node.id}`)
    map.set(node.id, node); nodes.push(node)
  }
  for (const n of nodes) {
    if (n.parent) {
      const p = map.get(n.parent)
      if (!p || order[p.kind] >= order[n.kind]) throw new Error(`Invalid parent of ${n.id}`)
    }
    for (const dep of n.depends_on ?? []) if (dep === n.id || !map.has(dep)) throw new Error(`Invalid dependency of ${n.id}: ${dep}`)
  }
  const visiting = new Set<string>(), visited = new Set<string>()
  function visit(id: string) {
    if (visiting.has(id)) throw new Error("Plan contains a dependency/parent cycle")
    if (visited.has(id)) return
    visiting.add(id)
    const n = map.get(id)!
    for (const dep of [...(n.depends_on ?? []), ...(n.parent ? [n.parent] : [])]) visit(dep)
    visiting.delete(id); visited.add(id)
  }
  for (const n of nodes) visit(n.id)
  return nodes
}
/** Unrelated plan edits do not change a task's subject fingerprint. */
export function subject(action: Action, plan: Plan, nodeID?: string, budget?: ProcessingBudget): string {
  if (!Array.isArray(plan.nodes) || plan.nodes.length > 300) throw new ProcessingLimitError("subject plan exceeds 300 nodes")
  const goal = { title: action.title, goal: action.goal }
  if (!nodeID) return digest({ goal, nodes: plan.nodes }, budget)
  const map = new Map(plan.nodes.map(n => [n.id, n])), selected = new Map<string, PlanNode>()
  function add(id: string) {
    if (selected.has(id)) return
    const n = map.get(id)
    if (!n) throw new Error(`Unknown or removed node: ${id}`)
    selected.set(id, n)
    if (n.parent) add(n.parent)
    for (const dep of n.depends_on ?? []) add(dep)
  }
  add(nodeID)
  return digest({ goal, nodes: [...selected.values()].sort((a,b) => a.id.localeCompare(b.id)) }, budget)
}
