import { createHash } from "node:crypto"
export type NodeKind = "phase" | "wave" | "task" | "subtask"
export type PlanNode = { id: string; kind: NodeKind; title: string; parent?: string; depends_on?: string[]; outcome?: string; context?: string; criteria?: string[]; skills?: string[]; roles?: string[]; agent?: string }
export type Action = { id: string; title: string; goal: string; state: "active" | "paused" | "completed" | "cancelled"; revision: number; created_at: string }
export type Plan = { revision: number; nodes: PlanNode[] }
export type Focus = { action_id: string; node_id?: string }
export type Actor = { session_id: string; agent: string }
export type RecordKind = "observation" | "claim" | "result" | "assessment" | "qa"
export type LedgerRecord = Actor & { id: string; action_id?: string; node_id?: string; kind: RecordKind; created_at: string; fingerprint?: string; data: Record<string, unknown> }
export const uid = (value: unknown, label = "id"): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(value)) throw new Error(`${label} must be a simple identifier of 1-120 characters`)
  return value
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b))
    return "{" + entries.map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",") + "}"
  }
  return JSON.stringify(value) ?? "null"
}
export const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex")
export function validatePlan(input: unknown): PlanNode[] {
  if (!Array.isArray(input) || input.length > 300) throw new Error("Plan nodes must be an array of at most 300 nodes")
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
export function subject(action: Action, plan: Plan, nodeID?: string): string {
  const goal = { title: action.title, goal: action.goal }
  if (!nodeID) return digest({ goal, nodes: plan.nodes })
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
  return digest({ goal, nodes: [...selected.values()].sort((a,b) => a.id.localeCompare(b.id)) })
}
