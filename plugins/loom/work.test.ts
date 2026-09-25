import { describe, expect, test } from "bun:test"
import type { TaskSpec } from "./tasks"
import {
  amendWorkPlan,
  assertCompletedWaveForTasks,
  invalidateWorkPlan,
  releaseCancelledWorkflowClaims,
  claimWorkflowWave,
  completeObjective,
  completeWaveForTasks,
  createWorkHierarchy,
  materializeWorkPlan,
  nextRunnableWaves,
  objectiveWorkLevel,
  releaseWorkflowWave,
  reopenWaveForTasks,
  syncWorkTaskStatuses,
  validateWorkPlan,
  validateWorkflowWave,
  workTree,
  workPlanContext,
  workPlanSemanticFingerprint,
  workflowTaskSemanticFingerprint,
  type WorkPlanDefinition,
} from "./work"

const now = "2026-09-21T00:00:00Z"
const PLAN_CONTEXT_TEST_MAX = 340

function plan(): WorkPlanDefinition {
  const richTask = (id: string, title: string, objective: string, dependsOn: string[]) => ({
    id,
    title,
    objective,
    rationale: `${title} is a required contribution to the product plan.`,
    dependsOn,
    authorityRefs: ["docs/architecture/product.md"],
    constraints: ["Preserve accepted behavior outside this Task."],
    acceptanceCriteria: [`${title} is complete and integrated.`],
    subtasks: [`Implement ${title}`],
    integration: [`${title} composes with the surrounding plan.`],
    verify: ["go test ./..."],
  })

  return {
    goal: "Deliver the accepted product outcome.",
    assumptions: ["Accepted architecture remains current."],
    outOfScope: ["Unrelated product changes."],
    authorityRefs: ["docs/anchors/product/anchor.md", "docs/architecture/product.md"],
    obligations: [
      {
        id: "obl-product",
        sourceRef: "docs/anchors/product/anchor.md",
        statement: "Deliver the assembled product behavior.",
        disposition: "implement",
        taskIds: ["a", "b", "c"],
        verification: ["pa-product proves the assembled behavior"],
      },
    ],
    riskBoundaries: [],
    acceptanceCoverage: [
      {
        id: "pa-product",
        title: "Product outcome",
        criterion: "The assembled product behavior works end to end.",
        taskIds: ["a", "b", "c"],
      },
    ],
    relationships: [
      { summary: "Foundation enables runtime.", taskIds: ["a", "b", "c"] },
    ],
    correctionRouting: [
      { condition: "Task-local implementation defect", routeTo: "worker" },
      { condition: "Plan coverage gap", routeTo: "planner" },
    ],
    phases: [
      {
        id: "core",
        title: "Core",
        objective: "Build the core product capabilities.",
        waves: [
          {
            id: "foundation",
            title: "Foundation",
            objective: "Establish reviewed foundations for dependent runtime work.",
            constraints: ["Complete before the runtime Wave."],
            tasks: [
              richTask("a", "A", "Build A", []),
              richTask("b", "B", "Build B", ["a"]),
            ],
          },
          {
            id: "runtime",
            title: "Runtime",
            objective: "Integrate the runtime outcome on reviewed foundations.",
            constraints: [],
            tasks: [richTask("c", "C", "Build C", ["b"])],
          },
        ],
      },
    ],
  }
}

function task(id: string, dependsOn: string[] = []): TaskSpec {
  const source = plan().phases.flatMap((phase) => phase.waves).flatMap((wave) => wave.tasks).find((item) => item.id === id)!
  return {
    id,
    title: source.title,
    objective: source.objective,
    rationale: source.rationale,
    dependsOn,
    authorityRefs: source.authorityRefs,
    constraints: source.constraints,
    acceptanceCriteria: source.acceptanceCriteria,
    subtasks: source.subtasks,
    integration: source.integration,
    write: [`internal/${id}/**`],
    skills: ["golang"],
    verify: source.verify,
  }
}

describe("Loom persistent work hierarchy", () => {
  test("rejects oversized persistent Plan identifiers", () => {
    const oversized = plan()
    oversized.phases[0].id = "p".repeat(97)
    expect(() => validateWorkPlan(oversized))
      .toThrow("Phase id exceeds maximum of 96 characters")
  })

  test("projects holistic context without duplicating the full rich Phase tree", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    const large = plan()
    large.goal = "G".repeat(500)
    materializeWorkPlan(work, "wf-1", large, now)

    const context = workPlanContext(work, undefined, "full")!
    expect(context.goal.length).toBeLessThanOrEqual(PLAN_CONTEXT_TEST_MAX)
    expect(context.goal).toContain("[truncated]")
    expect((context as any).phases).toBeUndefined()
    expect(context.planMap[0].waves[0].tasks[0].objective).toBe("Build A")
    expect(context.projection).toMatchObject({ bounded: true, amendmentsOmitted: 0 })
  })

  test("bounds large Plan ownership maps in model context without truncating durable state", () => {
    const wide = plan()
    const template = wide.phases[0].waves[0].tasks[0]
    const tasks = Array.from({ length: 40 }, (_, index) => ({
      ...structuredClone(template),
      id: `wide-${index + 1}`,
      title: `Wide Task ${index + 1}`,
      objective: `Deliver wide contribution ${index + 1}`,
      rationale: `Wide Task ${index + 1} is required by accepted authority.`,
      dependsOn: [],
      acceptanceCriteria: [`Wide Task ${index + 1} is complete.`],
      subtasks: [],
      integration: [],
    }))
    wide.phases[0].waves = [
      {
        id: "wide-a",
        title: "Wide A",
        objective: "Deliver the first half.",
        constraints: [],
        tasks: tasks.slice(0, 20),
      },
      {
        id: "wide-b",
        title: "Wide B",
        objective: "Deliver the second half.",
        constraints: [],
        tasks: tasks.slice(20),
      },
    ]
    const taskIds = tasks.map((task) => task.id)
    wide.obligations[0].taskIds = taskIds
    wide.acceptanceCoverage[0].taskIds = taskIds
    wide.relationships[0].taskIds = taskIds

    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-wide", now)
    materializeWorkPlan(work, "wf-wide", wide, now)

    expect(work.plans?.[0].relationships[0].taskIds).toHaveLength(40)
    const context = workPlanContext(work, undefined, "full")!
    expect(context.relationships[0].taskIds).toHaveLength(32)
    expect(context.relationships[0].taskIdsOmitted).toBe(8)
    expect(context.obligations[0].taskIds).toHaveLength(32)
    expect(context.obligations[0].taskIdsOmitted).toBe(8)
    expect(context.acceptanceCoverage[0].taskIds).toHaveLength(32)
    expect(context.acceptanceCoverage[0].taskIdsOmitted).toBe(8)
  })

  test("materializes Objective -> Phase -> Wave -> Task and reports progress", () => {
    const work = createWorkHierarchy("docs/anchors/leash-v1/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)

    const tree = workTree(work)
    expect(tree.objective.title).toBe("leash v1")
    expect(tree.objective.progress).toEqual({ finished: 0, total: 3 })
    expect(tree.phases[0].waves.map((wave) => wave.id)).toEqual(["foundation", "runtime"])

    const context = workPlanContext(work, "b")
    expect(context?.goal).toBe("Deliver the accepted product outcome.")
    expect(context?.obligations.map((item) => item.id)).toEqual(["obl-product"])
    expect(context?.focus?.task.acceptanceCriteria).toEqual(["B is complete and integrated."])
    expect(context?.focus?.dependencies.map((item) => item.id)).toEqual(["a"])
    expect(context?.acceptanceCoverage.map((item) => item.id)).toEqual(["pa-product"])

    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(work, "wf-1", work.generation, [{
      taskId: "a",
      complete: true,
      result: {
        workflowId: "wf-1",
        summary: "Foundation A completed and exposed its accepted interface.",
        evidenceClaimIds: ["claim-a"],
        completedAt: now,
      },
    }], now)
    const dependentContext = workPlanContext(work, "b")
    expect(dependentContext?.focus?.dependencies[0].result).toEqual({
      workflowId: "wf-1",
      summary: "Foundation A completed and exposed its accepted interface.",
      evidenceClaimIds: ["claim-a"],
      completedAt: now,
    })
    const progressed = workTree(work)
    expect(progressed.objective.progress).toEqual({ finished: 1, total: 3 })
    expect(progressed.phases[0].status).toBe("active")
    expect(progressed.phases[0].waves[0].status).toBe("active")
    expect(progressed.objective.status).toBe("active")
  })

  test("rejects Plan coverage that drops ownership or invents undeclared authority", () => {
    const missingOwner = plan()
    missingOwner.obligations[0].taskIds = []
    expect(() => validateWorkPlan(missingOwner)).toThrow("requires at least one owning Task")

    const undeclaredAuthority = plan()
    undeclaredAuthority.phases[0].waves[0].tasks[0].authorityRefs = ["docs/architecture/undeclared.md"]
    expect(() => validateWorkPlan(undeclaredAuthority)).toThrow("not declared by the parent Plan")

    const unauthorizedDefer = plan()
    unauthorizedDefer.obligations[0] = {
      ...unauthorizedDefer.obligations[0],
      disposition: "authorized-defer",
      taskIds: [],
      verification: [],
    }
    expect(() => validateWorkPlan(unauthorizedDefer)).toThrow("requires dispositionAuthorityRef")

    const unownedRisk = plan()
    unownedRisk.riskBoundaries = [{
      id: "risk-unowned",
      title: "Unowned risk",
      description: "A material risk must have executable ownership.",
      taskIds: [],
    }]
    expect(() => validateWorkPlan(unownedRisk)).toThrow("requires at least one owning Task")

    const unownedAcceptance = plan()
    unownedAcceptance.acceptanceCoverage[0].taskIds = []
    expect(() => validateWorkPlan(unownedAcceptance)).toThrow("requires at least one owning Task")

    const nonCrossTaskRelationship = plan()
    nonCrossTaskRelationship.relationships[0].taskIds = ["a"]
    expect(() => validateWorkPlan(nonCrossTaskRelationship)).toThrow(
      "must reference at least two Tasks",
    )
  })

  test("rejects a persistent Wave that exceeds the executable Task-plan limit", () => {
    const oversized = structuredClone(plan())
    const template = oversized.phases[0].waves[0].tasks[0]
    oversized.phases[0].waves[0].tasks = Array.from({ length: 25 }, (_, index) => ({
      ...structuredClone(template),
      id: `task-${index + 1}`,
      title: `Task ${index + 1}`,
      objective: `Build task ${index + 1}`,
      rationale: `Task ${index + 1} is required by the plan.`,
      dependsOn: [],
      acceptanceCriteria: [`Task ${index + 1} is complete.`],
      subtasks: [`Implement task ${index + 1}`],
      integration: [],
    }))
    oversized.obligations[0].taskIds = oversized.phases[0].waves[0].tasks.map((task) => task.id)
    oversized.acceptanceCoverage[0].taskIds = [...oversized.obligations[0].taskIds]
    oversized.relationships[0].taskIds = [...oversized.obligations[0].taskIds]

    expect(() => validateWorkPlan(oversized)).toThrow("exceeds executable maximum of 24 Tasks")
  })

  test("retains immutable Plan revisions and stales only semantically affected Wave contracts", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)

    const foundationBefore = workflowTaskSemanticFingerprint(work, ["a", "b"])
    const runtimeBefore = workflowTaskSemanticFingerprint(work, ["c"])

    const futureAmendment = amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Clarify future runtime checklist.",
      operations: [{
        action: "patch-task",
        taskId: "c",
        patch: { subtasks: ["Implement C", "Exercise runtime recovery"] },
      }],
    }, "r2")

    expect(futureAmendment.plan.revision).toBe(2)
    expect(workflowTaskSemanticFingerprint(work, ["a", "b"])).toBe(foundationBefore)
    expect(workflowTaskSemanticFingerprint(work, ["c"])).not.toBe(runtimeBefore)
    expect(workPlanContext(work, "c", "focused", 1, 1)?.focus?.task.subtasks).toEqual(["Implement C"])
    expect(workPlanContext(work, "c")?.focus?.task.subtasks).toEqual([
      "Implement C",
      "Exercise runtime recovery",
    ])

    const currentAmendment = amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Clarify foundation acceptance.",
      operations: [{
        action: "patch-task",
        taskId: "b",
        patch: { acceptanceCriteria: ["B is complete, integrated, and observable."] },
      }],
    }, "r3")

    expect(currentAmendment.plan.revision).toBe(3)
    expect(workflowTaskSemanticFingerprint(work, ["a", "b"])).not.toBe(foundationBefore)
    const snapshots = work.plans?.filter((snapshot) => snapshot.generation === 1) ?? []
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].revision).toBe(3)
    expect(snapshots[0].amendments.map((amendment) => amendment.revision)).toEqual([2, 3])
    expect(snapshots[0].amendments.every((amendment) =>
      (amendment.inverseOperations?.length ?? 0) > 0 ||
      amendment.inversePlanPatch !== undefined
    )).toBe(true)
    expect(workPlanContext(work, "c", "focused", 1, 1)?.focus?.task.subtasks)
      .toEqual(["Implement C"])
    expect(workPlanContext(work, "c", "focused", 1, 2)?.focus?.task.subtasks)
      .toEqual(["Implement C", "Exercise runtime recovery"])
  })

  test("preserves early full-snapshot revision history when converting to delta-backed amendments", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    const revision1 = structuredClone(work.plans![0])
    const revision2 = structuredClone(revision1)
    revision2.revision = 2
    revision2.amendments = [{
      revision: 2,
      by: "planner",
      reason: "Early full-snapshot amendment",
      operations: ["patch-task:c"],
      at: "r2",
    }]
    revision2.phases[0].waves[1].tasks[0].subtasks = ["Implement C", "Early revision check"]
    work.plans = [revision1, revision2]

    const amended = amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Convert future amendments to delta-backed history.",
      operations: [{
        action: "patch-task",
        taskId: "c",
        patch: { subtasks: ["Implement C", "Current revision check"] },
      }],
    }, "r3")

    expect(amended.plan.revision).toBe(3)
    expect(work.plans?.filter((snapshot) => snapshot.generation === 1).map((snapshot) => snapshot.revision))
      .toEqual([1, 2, 3])
    expect(workPlanContext(work, "c", "focused", 1, 1)?.focus?.task.subtasks)
      .toEqual(["Implement C"])
    expect(workPlanContext(work, "c", "focused", 1, 2)?.focus?.task.subtasks)
      .toEqual(["Implement C", "Early revision check"])
    expect(workPlanContext(work, "c")?.focus?.task.subtasks)
      .toEqual(["Implement C", "Current revision check"])
  })

  test("amends one pending Task in-place without replacing the Plan generation", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    const generation = work.generation
    const version = work.version

    const result = amendWorkPlan(work, {
      expectedVersion: version,
      by: "planner",
      reason: "Make the local checklist explicit before dispatch.",
      operations: [{
        action: "patch-task",
        taskId: "b",
        patch: {
          subtasks: ["Implement B", "Exercise B through A's produced interface"],
          acceptanceCriteria: [
            "B is complete and integrated.",
            "B consumes A's reviewed interface without bypassing it.",
          ],
        },
      }],
    }, "later")

    expect(work.generation).toBe(generation)
    expect(result.plan.revision).toBe(2)
    expect(result.amendment.operations).toEqual(["patch-task:b"])
    expect(workPlanContext(work, "b")?.focus?.task.subtasks).toEqual([
      "Implement B",
      "Exercise B through A's produced interface",
    ])
    expect(workPlanContext(work, "a")?.focus?.task.subtasks).toEqual(["Implement A"])
  })

  test("adds missing future work to the same Plan while preserving completed Task result context", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(work, "wf-1", work.generation, [{
      taskId: "a",
      complete: true,
      result: {
        workflowId: "wf-1",
        summary: "A established the durable foundation.",
        evidenceClaimIds: ["claim-a"],
        completedAt: now,
      },
    }], now)
    releaseCancelledWorkflowClaims(work, "wf-1", "released")

    const amendedPlan = structuredClone(plan())
    amendedPlan.obligations.push({
      id: "obl-missing",
      sourceRef: "docs/anchors/product/anchor.md",
      statement: "Exercise the recovery edge.",
      disposition: "implement",
      taskIds: ["recovery-edge"],
      verification: ["Focused recovery check"],
    })

    const result = amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Reviewer found an accepted obligation with no owner.",
      planPatch: { obligations: amendedPlan.obligations },
      operations: [{
        action: "add-task",
        phaseId: "core",
        waveId: "foundation",
        task: {
          id: "recovery-edge",
          title: "Recovery edge",
          objective: "Implement the missing recovery edge",
          rationale: "The accepted obligation was previously unowned.",
          dependsOn: ["a"],
          authorityRefs: ["docs/anchors/product/anchor.md"],
          constraints: ["Preserve completed Task A."],
          acceptanceCriteria: ["The recovery edge is observable and verified."],
          subtasks: ["Add the missing recovery path"],
          integration: ["Consume Task A's durable foundation."],
                      verify: ["Focused recovery check"],
        },
      }],
    }, "amended")

    expect(result.plan.generation).toBe(1)
    expect(result.plan.revision).toBe(2)
    expect(workPlanContext(work, "recovery-edge", "focused", 1, 1)?.focus?.task).toBeUndefined()
    expect(workPlanContext(work, undefined, "full", 1, 1)?.obligations.map((item) => item.id))
      .toEqual(["obl-product"])
    expect(workPlanContext(work, "recovery-edge")?.focus?.dependencies[0].result).toEqual({
      workflowId: "wf-1",
      summary: "A established the durable foundation.",
      evidenceClaimIds: ["claim-a"],
      completedAt: now,
    })
    expect(work.nodes.find((node) => node.logicalId === "a")?.status).toBe("complete")
  })

  test("refuses to rewrite completed Task semantics in-place", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(work, "wf-1", work.generation, [{ taskId: "a", complete: true }], now)
    releaseCancelledWorkflowClaims(work, "wf-1", "released")

    expect(() => amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Unsafe retroactive change",
      operations: [{
        action: "patch-task",
        taskId: "a",
        patch: { objective: "A different meaning" },
      }],
    }, "later")).toThrow("cannot rewrite semantic context")
  })

  test("fails closed on malformed local amendment shapes and claimed semantic changes", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)

    expect(() => amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Malformed patch",
      operations: [{
        action: "patch-phase",
        phaseId: "core",
        patch: { subtasks: ["not a Phase field"] } as any,
      }],
    }, "later")).toThrow("does not accept fields")

    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    const obligations = structuredClone(plan().obligations)
    obligations[0].statement = "Different obligation meaning"
    expect(() => amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Unsafe claimed contract rewrite",
      planPatch: { obligations },
      operations: [],
    }, "later")).toThrow("claimed/completed Task")
    const correctionRouting = structuredClone(plan().correctionRouting)
    correctionRouting.unshift({
      condition: "New global recovery route",
      routeTo: "planner",
    })
    expect(() => amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Unsafe claimed correction-route rewrite",
      planPatch: { correctionRouting },
      operations: [],
    }, "later")).toThrow("correction routing for claimed/completed Task")
    expect(() => invalidateWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Cannot invalidate under a live claim",
    }, "later")).toThrow("cannot be amended")
  })

  test("whole-Plan fingerprint changes when the current Plan is invalidated", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "workflow-plan-fingerprint", now)
    materializeWorkPlan(work, "workflow-plan-fingerprint", plan(), now)
    const before = workPlanContext(work, undefined, "full")
    const beforeFingerprint = workPlanSemanticFingerprint(work)
    expect(before?.revision).toBe(1)
    expect(beforeFingerprint).toBeDefined()

    invalidateWorkPlan(work, {
      expectedVersion: work.version,
      reason: "New evidence invalidates the decomposition.",
      by: "planner",
    }, "2026-09-21T01:00:00Z")

    const after = workPlanContext(work, undefined, "full")
    expect(after?.revision).toBe(1)
    expect(after?.invalidated).toBeDefined()
    expect(workPlanSemanticFingerprint(work)).not.toBe(beforeFingerprint)
  })

  test("invalidates a Plan explicitly and permits a fresh generation", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    const oldGeneration = work.generation

    const invalidated = invalidateWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "The decomposition premise is no longer valid.",
    }, "invalidated")

    expect(invalidated.plan.invalidated?.reason).toContain("premise")
    expect(nextRunnableWaves(work)).toEqual([])
    expect(() => validateWorkflowWave(work, [task("a"), task("b", ["a"])], false)).toThrow()

    materializeWorkPlan(work, "wf-2", plan(), "replacement")
    expect(work.generation).toBe(oldGeneration + 1)
    expect(workPlanContext(work)?.invalidated).toBeUndefined()
  })

  test("keeps Objective active until explicit objective completion", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(
      work,
      "wf-1",
      work.generation,
      [
        { taskId: "a", complete: true },
        { taskId: "b", complete: true },
      ],
      now,
    )
    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now)

    claimWorkflowWave(work, "wf-2", work.generation, [task("c")], true, now)
    syncWorkTaskStatuses(
      work,
      "wf-2",
      work.generation,
      [{ taskId: "c", complete: true }],
      now,
    )
    completeWaveForTasks(work, "wf-2", work.generation, ["c"], now)

    expect(workTree(work).phases[0].status).toBe("complete")
    expect(work.objectiveStatus).toBe("active")

    completeObjective(work, work.generation, now)
    expect(work.objectiveStatus).toBe("complete")
  })

  test("refuses Objective completion while a mandatory Plan obligation remains blocked", () => {
    const blocked = plan()
    blocked.obligations[0] = {
      ...blocked.obligations[0],
      disposition: "blocked",
      taskIds: [],
      verification: [],
    }

    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", blocked, now)
    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(
      work,
      "wf-1",
      work.generation,
      [
        { taskId: "a", complete: true },
        { taskId: "b", complete: true },
      ],
      now,
    )
    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now)

    claimWorkflowWave(work, "wf-2", work.generation, [task("c")], true, now)
    syncWorkTaskStatuses(
      work,
      "wf-2",
      work.generation,
      [{ taskId: "c", complete: true }],
      now,
    )
    completeWaveForTasks(work, "wf-2", work.generation, ["c"], now)

    expect(workTree(work).phases[0].status).toBe("complete")
    expect(() => completeObjective(work, work.generation, now)).toThrow(
      "Plan obligations remain blocked: obl-product",
    )
    expect(work.objectiveStatus).toBe("active")
  })

  test("exposes only dependency-eligible waves", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)

    expect(nextRunnableWaves(work).map((wave) => wave.id)).toEqual(["foundation"])

    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(
      work,
      "wf-1",
      work.generation,
      [
        { taskId: "a", complete: true },
        { taskId: "b", complete: true },
      ],
      now,
    )
    expect(nextRunnableWaves(work)).toHaveLength(0)

    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now)
    expect(nextRunnableWaves(work).map((wave) => wave.id)).toEqual(["runtime"])
  })

  test("requires one whole remaining wave in a bounded workflow", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)

    expect(() => validateWorkflowWave(work, [task("a")], false)).toThrow(
      "exactly the remaining Tasks",
    )

    const wave = validateWorkflowWave(work, [task("a"), task("b", ["a"])], false)
    expect(wave.logicalId).toBe("foundation")
  })

  test("derives bounded Wave scope until only one Wave remains", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)

    expect(objectiveWorkLevel(work)).toBe("wave")

    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(
      work,
      "wf-1",
      work.generation,
      [
        { taskId: "a", complete: true },
        { taskId: "b", complete: true },
      ],
      now,
    )
    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now)

    expect(objectiveWorkLevel(work)).toBe("objective")
  })

  test("objective-scoped workflow may execute only the final remaining wave", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)

    expect(() => validateWorkflowWave(work, [task("a"), task("b", ["a"])], true)).toThrow(
      "final remaining Wave",
    )

    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(
      work,
      "wf-1",
      work.generation,
      [
        { taskId: "a", complete: true },
        { taskId: "b", complete: true },
      ],
      now,
    )
    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now)

    expect(() => validateWorkflowWave(work, [task("c")], true)).not.toThrow()
  })

  test("replanning preserves old completed history and creates a new generation", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(work, "wf-1", work.generation, [{ taskId: "a", complete: true }], now)

    const oldGeneration = work.generation
    releaseWorkflowWave(work, "wf-1", oldGeneration, ["a", "b"], "release-before-replan")
    materializeWorkPlan(work, "wf-2", plan(), "later")

    expect(work.generation).toBe(oldGeneration + 1)
    expect(
      work.nodes.some(
        (node) =>
          node.generation === oldGeneration &&
          node.type === "task" &&
          node.logicalId === "a" &&
          node.status === "complete",
      ),
    ).toBe(true)
    expect(workTree(work).objective.progress).toEqual({ finished: 0, total: 3 })
  })

  test("reopening implementation review invalidates Wave and Objective roll-up", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(
      work,
      "wf-1",
      work.generation,
      [
        { taskId: "a", complete: true },
        { taskId: "b", complete: true },
      ],
      now,
    )
    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now)
    expect(workTree(work).phases[0].waves[0].status).toBe("complete")

    reopenWaveForTasks(work, "wf-1", work.generation, ["a", "b"], "later")
    expect(workTree(work).phases[0].waves[0].status).toBe("active")
    expect(workTree(work).phases[0].status).toBe("active")
  })


  test("rejects stale workflow completion after a new plan generation", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-old", now)
    materializeWorkPlan(work, "wf-old", plan(), now)
    const oldGeneration = work.generation

    claimWorkflowWave(
      work,
      "wf-old",
      oldGeneration,
      [task("a"), task("b", ["a"])],
      false,
      now,
    )
    releaseWorkflowWave(work, "wf-old", oldGeneration, ["a", "b"], "release-before-replan")

    materializeWorkPlan(work, "wf-new", plan(), "later")
    expect(work.generation).toBe(oldGeneration + 1)

    expect(() =>
      syncWorkTaskStatuses(
        work,
        "wf-old",
        oldGeneration,
        [{ taskId: "a", complete: true }],
        "stale-completion",
      ),
    ).toThrow("Stale workflow generation")
  })

  test("rejects a second workflow claiming the same Wave", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    const generation = work.generation
    const tasks = [task("a"), task("b", ["a"])]

    claimWorkflowWave(work, "wf-1", generation, tasks, false, now)

    expect(() =>
      claimWorkflowWave(work, "wf-2", generation, tasks, false, "later"),
    ).toThrow(/already claimed/)
  })

  test("explicit release lets another workflow recover the Wave", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    const generation = work.generation
    const tasks = [task("a"), task("b", ["a"])]

    claimWorkflowWave(work, "wf-1", generation, tasks, false, now)
    releaseWorkflowWave(work, "wf-1", generation, ["a", "b"], "released")

    expect(() =>
      claimWorkflowWave(work, "wf-2", generation, tasks, false, "later"),
    ).not.toThrow()
  })


  test("blocks replanning while a Wave claim is active", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    claimWorkflowWave(
      work,
      "wf-1",
      work.generation,
      [task("a"), task("b", ["a"])],
      false,
      now,
    )

    expect(() => materializeWorkPlan(work, "wf-2", plan(), "later")).toThrow(
      "while a Wave is claimed",
    )
  })

})


describe("reviewed Wave history and cancellation claims", () => {
  function completedFoundation() {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(work, "wf-1", work.generation, [
      { taskId: "a", complete: true }, { taskId: "b", complete: true },
    ], now)
    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now)
    return work
  }

  test("completion proof is exact to owner, generation and reviewed task set", () => {
    const work = completedFoundation()
    const before = structuredClone(work)
    expect(assertCompletedWaveForTasks(work, "wf-1", work.generation, ["b", "a"]).completion!.provenance).toBe("implementation-review")
    for (const ids of [[], ["a"], ["a", "a"], ["a", "c"], ["missing"]]) {
      expect(() => assertCompletedWaveForTasks(work, "wf-1", work.generation, ids)).toThrow()
    }
    expect(() => assertCompletedWaveForTasks(work, "wf-other", work.generation, ["a", "b"])).toThrow()
    expect(() => assertCompletedWaveForTasks(work, "wf-1", work.generation + 1, ["a", "b"])).toThrow()
    expect(work).toEqual(before)
    const wave = work.nodes.find((node) => node.type === "wave" && node.logicalId === "foundation")!
    wave.completion!.reviewedTaskIds = ["a"]
    expect(() => assertCompletedWaveForTasks(work, "wf-1", work.generation, ["a", "b"])).toThrow()
  })

  test("cancellation preserves partial completion and a successor can review the assembled Wave", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(work, "wf-1", work.generation, [{ taskId: "a", complete: true }], now)
    expect(releaseCancelledWorkflowClaims(work, "wf-1", "cancelled")).toHaveLength(3)
    const priorTask = structuredClone(work.nodes.find((node) => node.logicalId === "a")!)
    expect(priorTask.status).toBe("complete")
    expect(priorTask.updatedAt).toBe(now)
    expect(releaseCancelledWorkflowClaims(work, "wf-1", "retry")).toEqual([])
    claimWorkflowWave(work, "wf-2", work.generation, [task("b")], false, "resumed")
    syncWorkTaskStatuses(work, "wf-2", work.generation, [{ taskId: "b", complete: true }], "finished")
    completeWaveForTasks(work, "wf-2", work.generation, ["b"], "reviewed")
    expect(work.nodes.find((node) => node.logicalId === "a")).toEqual(priorTask)
    expect(assertCompletedWaveForTasks(work, "wf-2", work.generation, ["b"]).completion).toMatchObject({
      workflowId: "wf-2", taskIds: ["b"], reviewedTaskIds: ["a", "b"],
    })
    expect(work.objectiveStatus).toBe("active")
    expect(() => assertCompletedWaveForTasks(work, "wf-1", work.generation, ["a", "b"])).toThrow()
  })

  test("reopen cannot steal another workflow's completed receipt or invalidate a claimed downstream Wave", () => {
    const work = completedFoundation()
    const before = structuredClone(work)
    expect(() => reopenWaveForTasks(work, "wf-other", work.generation, ["a", "b"], "bad")).toThrow()
    expect(work).toEqual(before)
    claimWorkflowWave(work, "wf-2", work.generation, [task("c")], false, "next")
    const claimed = structuredClone(work)
    expect(() => reopenWaveForTasks(work, "wf-1", work.generation, ["a", "b"], "bad")).toThrow("downstream")
    expect(work).toEqual(claimed)
    syncWorkTaskStatuses(work, "wf-2", work.generation, [{ taskId: "c", complete: true }], "done")
    completeWaveForTasks(work, "wf-2", work.generation, ["c"], "reviewed")
    expect(() => reopenWaveForTasks(work, "wf-1", work.generation, ["a", "b"], "bad")).toThrow("downstream")
  })

  test("claim cancellation is owner-scoped across generations and does not alter completed receipts", () => {
    const work = completedFoundation()
    const prior = structuredClone(work.nodes)
    const generation = work.generation
    materializeWorkPlan(work, "wf-2", plan(), "new-plan")
    claimWorkflowWave(work, "wf-2", work.generation, [task("a"), task("b", ["a"])], false, "new-claim")
    // Simulate an old-generation claim left by an interrupted compatibility transition.
    const stale = work.nodes.find((node) => node.generation === generation && node.logicalId === "c")!
    stale.claimedByWorkflowId = "wf-stale"
    stale.claimedAt = "old"
    const live = structuredClone(work.nodes.filter((node) => node.generation === work.generation))
    expect(releaseCancelledWorkflowClaims(work, "wf-stale", "recover")).toEqual([stale.id])
    expect(work.nodes.filter((node) => node.generation === work.generation)).toEqual(live)
    expect(work.nodes.find((node) => node.id === prior.find((node) => node.logicalId === "a")!.id)).toEqual(prior.find((node) => node.logicalId === "a"))
    expect(work.nodes.find((node) => node.generation === generation && node.logicalId === "foundation")!.completion).toEqual(prior.find((node) => node.logicalId === "foundation")!.completion)
  })
})
