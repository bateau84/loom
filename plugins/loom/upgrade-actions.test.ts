import { describe, expect, test } from "bun:test"
import {
  HOLISTIC_PLAN_ADOPTION_ACTION_ID,
  objectiveUpgradeActions,
  upgradeCompatibilityNotice,
} from "./upgrade-actions"
import type { WorkHierarchy } from "./work"

function legacyWork(overrides: Partial<WorkHierarchy> = {}): WorkHierarchy {
  return {
    objectiveId: "objective:docs/anchors/product/anchor.md",
    anchor: "docs/anchors/product/anchor.md",
    title: "Product",
    objectiveStatus: "active",
    version: 4,
    generation: 2,
    workflowIds: ["wf-current"],
    nodes: [
      {
        id: "phase:2:delivery",
        logicalId: "delivery",
        type: "phase",
        title: "Delivery",
        status: "active",
        generation: 2,
        createdAt: "now",
        updatedAt: "now",
      },
      {
        id: "wave:2:delivery/current",
        logicalId: "current",
        type: "wave",
        title: "Current",
        status: "pending",
        generation: 2,
        parentId: "phase:2:delivery",
        createdAt: "now",
        updatedAt: "now",
      },
      {
        id: "task:2:current",
        logicalId: "current",
        type: "task",
        title: "Current task",
        objective: "Deliver current work",
        status: "pending",
        generation: 2,
        parentId: "wave:2:delivery/current",
        dependsOn: [],
        createdAt: "now",
        updatedAt: "now",
      },
    ],
    createdAt: "now",
    updatedAt: "now",
    ...overrides,
  }
}

describe("Loom semantic upgrade actions", () => {
  test("detects one Objective-scoped rich Plan adoption action for legacy active work", () => {
    const actions = objectiveUpgradeActions(legacyWork())
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({
      id: HOLISTIC_PLAN_ADOPTION_ACTION_ID,
      introducedInRuntimeVersion: 4,
      scope: "objective",
      status: "ready",
      owner: "general",
      generation: 2,
      safeBoundary: { state: "ready", claimedWorkflowIds: [] },
      completion: {
        mode: "state-derived",
        condition: "current-generation-has-rich-plan-snapshot",
      },
    })
    expect(upgradeCompatibilityNotice(actions)).toContain("loom_upgrade_status")
  })

  test("defers semantic adoption while the current generation is claimed", () => {
    const work = legacyWork()
    work.nodes[1].claimedByWorkflowId = "wf-current"
    work.nodes[2].claimedByWorkflowId = "wf-current"

    const actions = objectiveUpgradeActions(work)
    expect(actions[0]).toMatchObject({
      status: "deferred",
      safeBoundary: {
        state: "wait-for-current-wave",
        claimedWorkflowIds: ["wf-current"],
      },
    })
    expect(upgradeCompatibilityNotice(actions)).toContain("active Wave")
  })

  test("self-completes for every observer when the current generation has a rich Plan", () => {
    const work = legacyWork({
      plans: [{
        generation: 2,
        revision: 1,
        amendments: [],
        goal: "Deliver the accepted product.",
        assumptions: [],
        outOfScope: [],
        authorityRefs: ["docs/anchors/product/anchor.md"],
        obligations: [],
        riskBoundaries: [],
        acceptanceCoverage: [],
        relationships: [],
        correctionRouting: [],
        phases: [],
      }],
    })

    expect(objectiveUpgradeActions(work)).toEqual([])
    expect(upgradeCompatibilityNotice(objectiveUpgradeActions(work))).toBeUndefined()
  })

  test("does not create adoption work for unplanned, terminal, or implementation-complete Objectives", () => {
    expect(objectiveUpgradeActions(legacyWork({ generation: 0, nodes: [] }))).toEqual([])
    expect(objectiveUpgradeActions(legacyWork({ objectiveStatus: "complete" }))).toEqual([])

    const implemented = legacyWork()
    for (const node of implemented.nodes) {
      if (node.type === "task") node.status = "complete"
      if (node.type === "wave") node.status = "complete"
      if (node.type === "phase") node.status = "complete"
    }
    expect(objectiveUpgradeActions(implemented)).toEqual([])
  })
})
