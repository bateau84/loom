/** Routing advice only. Never consume this table in Task/OQ admission or permissions. */
const LOOM_PLANNING_INSIGHTS = {
  general: {
    nativeWork: "Coordinate accepted work and route unresolved expertise to its owner.",
    caution: "Primary coordinator, not a planned subagent Task recipient; coordination is not specialist authority.",
  },
  planner: {
    nativeWork: "Create or amend the persistent holistic Plan and compile its bounded Wave.",
    caution: "Use the planning step or a Planner OQ; planned Planner Tasks are not supported. Independent review-plan is required; a draft grants no execution authority.",
  },
  worker: {
    nativeWork: "Implement and verify bounded work inside resolved accepted authority.",
    caution: "Implementation cannot supply missing specialist meaning or replace independent review.",
  },
  designer: {
    nativeWork: "Resolve human-facing experience and author accepted design artifacts.",
    caution: "Design authority is distinct from implementation and product acceptance.",
  },
  specifier: {
    nativeWork: "Define falsifiable behavioral obligations and correctness-sensitive shared guarantees.",
    caution: "Do not invent product scope or silently choose technical architecture.",
  },
  architect: {
    nativeWork: "Resolve structural realization decisions and implementation-facing technical contracts.",
    caution: "Architecture realizes accepted behavior; it cannot redefine product meaning.",
  },
  documenter: {
    nativeWork: "Maintain current-reality repository knowledge and verify OKF documentation.",
    caution: "Documentation is not new product, design, or architecture authority.",
  },
  research: {
    nativeWork: "Contribute bounded sourced facts, uncertainty, and counterevidence.",
    caution: "Research evidence does not itself resolve another role's authority.",
  },
  diagnostic: {
    nativeWork: "Investigate root cause with bounded experiments and causal evidence.",
    caution: "Disposable experiment changes are not product implementation or acceptance.",
  },
  brainstorm: {
    nativeWork: "Explore bounded alternatives, assumptions, and trade-offs for a named receiving authority.",
    caution: "Advisory OQs are supported; planned Brainstorm Tasks are not supported. Advice is not acceptance or a specialist decision; the receiving authority must resolve meaning.",
  },
  reviewer: {
    nativeWork: "Independently judge named work against authority and observed evidence.",
    caution: "Use the review responsibility/path, not a generic producer; never approve one's own work.",
  },
  critic: {
    nativeWork: "Independently challenge the assembled solution or product holistically.",
    caution: "Use applicable selective gates or OQs; planned Critic Tasks are not supported. An OQ answer is not a gate verdict.",
  },
  acceptance: {
    nativeWork: "Exercise product-owned scenarios and record observed acceptance proof.",
    caution: "Use the Product Acceptance step or OQs; planned Acceptance Tasks are not supported. A summary or OQ answer cannot substitute for scenario evidence.",
  },
} satisfies Record<string, { nativeWork: string; caution: string }>

/** Project only valid, bounded advice for exact live names; never manufacture roster entries. */
export function projectPlanningInsights(names: readonly string[], advice: unknown) {
  const hints: Array<{ name: string; nativeWork: string; caution: string }> = []
  if (advice && typeof advice === "object" && !Array.isArray(advice)) {
    for (const name of new Set(names.slice(0, 200))) {
      if (name.length > 128 || !Object.hasOwn(advice, name)) continue
      const entry: unknown = Reflect.get(advice, name)
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
      if (!("nativeWork" in entry) || !("caution" in entry)) continue
      if (typeof entry.nativeWork !== "string" || typeof entry.caution !== "string") continue
      if (!entry.nativeWork.trim() || !entry.caution.trim()) continue
      hints.push({ name, nativeWork: entry.nativeWork.slice(0, 1_000), caution: entry.caution.slice(0, 1_000) })
    }
  }
  return {
    advisoryOnly: true,
    source: "loom-plugin",
    boundary: "Routing inputs only: neither advice nor its absence establishes permissions, product authority, Task contracts, or native path feasibility. Validate the exact Task/OQ path at runtime.",
    hints,
  }
}

export function loomPlanningInsights(names: readonly string[]) {
  return projectPlanningInsights(names, LOOM_PLANNING_INSIGHTS)
}
