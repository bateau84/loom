import type { WorkHierarchy } from "./work"

export const HOLISTIC_PLAN_ADOPTION_ACTION_ID = "holistic-plan-adoption-v1"

export type LoomUpgradeAction = {
  id: typeof HOLISTIC_PLAN_ADOPTION_ACTION_ID
  introducedInRuntimeVersion: 4
  kind: "agent-action"
  scope: "objective"
  status: "ready" | "deferred"
  owner: "general"
  objectiveId: string
  generation: number
  reason: string
  safeBoundary: {
    state: "ready" | "wait-for-current-wave"
    claimedWorkflowIds: string[]
  }
  instructions: string[]
  completion: {
    mode: "state-derived"
    condition: "current-generation-has-rich-plan-snapshot"
  }
}

/**
 * Upgrade actions are derived from authoritative state rather than acknowledged by
 * an agent. Once the invariant is satisfied the action disappears for every
 * session observing this Objective.
 */
export function objectiveUpgradeActions(work?: WorkHierarchy): LoomUpgradeAction[] {
  if (!work || work.generation <= 0) return []
  if (["complete", "cancelled", "superseded"].includes(work.objectiveStatus)) return []

  const richPlan = work.plans?.find((plan) => plan.generation === work.generation)
  if (richPlan) return []

  const currentNodes = work.nodes.filter(
    (node) => node.generation === work.generation && node.status !== "superseded",
  )
  const claimedWorkflowIds = [...new Set(
    currentNodes
      .filter((node) => Boolean(node.claimedByWorkflowId))
      .map((node) => node.claimedByWorkflowId!)
  )].sort()

  const unfinishedTasks = currentNodes.filter(
    (node) =>
      node.type === "task" &&
      !["complete", "cancelled", "superseded"].includes(node.status),
  )
  if (claimedWorkflowIds.length === 0 && unfinishedTasks.length === 0) return []

  const deferred = claimedWorkflowIds.length > 0
  return [{
    id: HOLISTIC_PLAN_ADOPTION_ACTION_ID,
    introducedInRuntimeVersion: 4,
    kind: "agent-action",
    scope: "objective",
    status: deferred ? "deferred" : "ready",
    owner: "general",
    objectiveId: work.objectiveId,
    generation: work.generation,
    reason:
      "This Objective predates holistic Plan snapshots. Rich Plan semantics must be reconstructed from accepted authority and preserved execution evidence rather than inferred mechanically from the old Task DAG.",
    safeBoundary: {
      state: deferred ? "wait-for-current-wave" : "ready",
      claimedWorkflowIds,
    },
    instructions: deferred
      ? [
          "Preserve the currently claimed Wave and its admitted Task contracts.",
          "Let the claimed Wave reach its implementation-review boundary, or explicitly release it only when normal recovery requires that boundary.",
          "Finish the current Wave workflow normally; do not reopen reviewed steps solely to migrate Plan representation.",
          "At the next Objective planning boundary, dispatch a fresh Planner. If a plan step is already naturally runnable, use it; otherwise start/route the next Objective workflow normally.",
          "Planner reconstructs a holistic Plan for the remaining Objective from accepted authority plus durable completed-work evidence; do not fabricate semantic fields from the legacy DAG.",
        ]
      : [
          "Adopt at the next natural Objective planning boundary; do not reopen reviewed/completed workflow steps solely for migration.",
          "If a plan step is already naturally runnable, dispatch its fresh Planner now; otherwise finish the current workflow and start/route the next Objective workflow normally.",
          "Planner reconstructs a holistic Plan for the remaining Objective from accepted authority plus durable completed-work evidence.",
          "Preserve completed work/evidence as historical truth and mark obligations already satisfied only when that evidence actually proves them.",
          "Do not fabricate rationale, acceptance criteria, risks, integration semantics, or authority mappings from the legacy DAG alone.",
        ],
    completion: {
      mode: "state-derived",
      condition: "current-generation-has-rich-plan-snapshot",
    },
  }]
}

export function upgradeCompatibilityNotice(actions: LoomUpgradeAction[]) {
  const action = actions[0]
  if (!action) return undefined
  return action.status === "deferred"
    ? "Loom compatibility action pending for the current Objective. The active Wave keeps its admitted contract; call loom_upgrade_status before planning the next Wave."
    : "Loom compatibility action required for the current Objective. Call loom_upgrade_status before admitting the next implementation Wave."
}
