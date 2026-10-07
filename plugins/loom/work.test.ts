import { describe, expect, test } from "bun:test"
import type { TaskSpec } from "./tasks"
import {
  amendWorkPlan,
  assertCompletedWaveForTasks,
  invalidateWorkPlan,
  invalidateWorkflowTaskResults,
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
  taskSemanticFingerprintAtRevision,
  taskSemanticClosureFingerprintAtRevision,
  workflowTaskSemanticFingerprint,
  validatePlanRoleFeasibility,
  type WorkPlanDefinition,
  type WorkPlanAmendOperation,
} from "./work"

const now = "2026-09-21T00:00:00Z"
const PLAN_CONTEXT_TEST_MAX = 340
const graphFingerprint = "a".repeat(64)

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
    role: "worker",
    responsibility: "execute" as const,
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

function historicalOrderPlan(kind: "phase" | "wave" | "task") {
  const definition = plan()
  const tasks = new Map(
    definition.phases.flatMap((phase) => phase.waves.flatMap((wave) => wave.tasks))
      .map((item) => [item.id, { ...item, dependsOn: [] }]),
  )
  const wave = (id: string, taskId: string): WorkPlanDefinition["phases"][number]["waves"][number] => ({
    id,
    title: `${id} Wave`,
    objective: `${id} wave objective`,
    constraints: [],
    tasks: [tasks.get(taskId)!],
  })
  const phase = (id: string, taskId: string): WorkPlanDefinition["phases"][number] => ({
    id,
    title: `${id} Phase`,
    objective: `${id} phase objective`,
    waves: [wave(`${id}-wave`, taskId)],
  })

  if (kind === "phase") {
    definition.phases = [phase("current", "a"), phase("middle", "b"), phase("last", "c")]
  } else if (kind === "wave") {
    definition.phases = [{
      id: "current",
      title: "Current Phase",
      objective: "Keep the claimed Wave first.",
      waves: [wave("current", "a"), wave("middle", "b"), wave("last", "c")],
    }]
  } else {
    definition.phases = [{
      id: "current",
      title: "Current Phase",
      objective: "Keep the task order explicit.",
      waves: [{
        id: "current",
        title: "Current Wave",
        objective: "Three ordered unclaimed Tasks.",
        constraints: [],
        tasks: [tasks.get("a")!, tasks.get("b")!, tasks.get("c")!],
      }],
    }]
  }
  return definition
}

function phaseFrom(definition: WorkPlanDefinition, phaseId: string) {
  return structuredClone(definition.phases.find((phase) => phase.id === phaseId)!)
}

function waveFrom(definition: WorkPlanDefinition, phaseId: string, waveId: string) {
  return structuredClone(definition.phases.find((phase) => phase.id === phaseId)!.waves.find((wave) => wave.id === waveId)!)
}

function taskFrom(definition: WorkPlanDefinition, taskId: string) {
  return structuredClone(definition.phases.flatMap((phase) => phase.waves)
    .flatMap((wave) => wave.tasks).find((task) => task.id === taskId)!)
}

function planOrder(definition: { phases?: Array<any>; planMap?: Array<any> }, kind: "phase" | "wave" | "task") {
  const phases = definition.phases ?? definition.planMap ?? []
  if (kind === "phase") return phases.map((phase) => phase.id)
  if (kind === "wave") return phases[0]?.waves.map((wave: any) => wave.id) ?? []
  return phases[0]?.waves[0]?.tasks.map((task: any) => task.id) ?? []
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
    role: source.role,
    responsibility: source.responsibility,
  }
}

describe("Loom persistent work hierarchy", () => {
  test("role feasibility examines later Waves and rejects roles without a real runtime route", () => {
    const candidate = plan()
    candidate.phases[0]!.waves[1]!.tasks[0] = {
      ...candidate.phases[0]!.waves[1]!.tasks[0]!,
      role: "future-specialist",
      responsibility: "produce",
    }
    expect(() => validatePlanRoleFeasibility(candidate)).toThrow(
      "Plan role path unavailable for Task c (obligations: obl-product) in core/runtime: role future-specialist has no supported Task execution slot",
    )
    candidate.phases[0]!.waves[1]!.tasks[0]!.role = "worker"
    expect(validatePlanRoleFeasibility(candidate)).toBe(true)
  })

  test("legacy role-less Plan Tasks fail executable Wave admission instead of defaulting to Worker", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-legacy", now)
    materializeWorkPlan(work, "wf-legacy", plan(), now)
    const snapshot = work.plans?.find((candidate) => candidate.generation === work.generation)
    const legacyTask = snapshot?.phases[0]?.waves[0]?.tasks.find((candidate) => candidate.id === "a")
    expect(legacyTask).toBeDefined()
    delete legacyTask!.role
    delete legacyTask!.responsibility
    expect(() => validateWorkflowWave(work, [task("a"), task("b")], false)).toThrow(
      "Legacy Plan Task a has no accountable role/responsibility; amend and independently review the Plan before admission.",
    )
  })
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

  test("amends large Plan authority sets atomically without rewriting protected Task semantics", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-authority-amend", now)
    const definition = plan()
    definition.authorityRefs.push(
      ...Array.from({ length: 40 }, (_, index) => `docs/authority/ref-${String(index + 1).padStart(2, "0")}.md`),
    )
    materializeWorkPlan(work, "wf-authority-amend", definition, now)

    const generation = work.generation
    const protectedFingerprint = workflowTaskSemanticFingerprint(work, ["a", "b"])
    const focused = workPlanContext(work, "c", "focused")
    const full = workPlanContext(work, undefined, "full")

    expect(focused?.authorityRefs).toHaveLength(32)
    expect(focused?.projection.authorityRefsOmitted).toBe(10)
    expect(full?.authorityRefs).toHaveLength(42)
    expect(full?.projection.authorityRefsOmitted).toBe(0)

    claimWorkflowWave(
      work,
      "wf-authority-amend",
      generation,
      [task("a"), task("b", ["a"])],
      false,
      now,
    )
    syncWorkTaskStatuses(
      work,
      "wf-authority-amend",
      generation,
      [{ taskId: "a", complete: true }],
      now,
    )
    releaseCancelledWorkflowClaims(work, "wf-authority-amend", "released")

    const amended = amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "New accepted authority applies to future work.",
      operations: [{ action: "add-authority-ref", authorityRef: "ARS-025" }],
    }, "r2")

    expect(amended.plan.authorityRefs).toContain("ARS-025")
    expect(amended.amendment.operations).toEqual(["add-authority-ref:ARS-025"])
    expect(workflowTaskSemanticFingerprint(work, ["a", "b"])).toBe(protectedFingerprint)
    expect(workPlanContext(work, undefined, "full", generation, 1)?.authorityRefs).not.toContain("ARS-025")
    expect(workPlanContext(work, undefined, "full")?.authorityRefs).toHaveLength(43)

    expect(() => amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Replace-all authority mutation must not be reachable from bounded context.",
      planPatch: { authorityRefs: ["docs/anchors/product/anchor.md"] } as any,
      operations: [],
    }, "unsafe-replace")).toThrow("must be amended with add-authority-ref/remove-authority-ref")

    const removedUnused = amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Remove future authority that no current Task consumes.",
      operations: [{ action: "remove-authority-ref", authorityRef: "docs/authority/ref-01.md" }],
    }, "r3")
    expect(removedUnused.plan.revision).toBe(3)
    expect(removedUnused.plan.authorityRefs).not.toContain("docs/authority/ref-01.md")
    expect(workflowTaskSemanticFingerprint(work, ["a", "b"])).toBe(protectedFingerprint)
    expect(workPlanContext(work, undefined, "full", generation, 2)?.authorityRefs)
      .toContain("docs/authority/ref-01.md")
    expect(workPlanContext(work, undefined, "full")?.authorityRefs)
      .not.toContain("docs/authority/ref-01.md")

    expect(() => amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Removing authority consumed by existing Tasks is unsafe.",
      operations: [{ action: "remove-authority-ref", authorityRef: "docs/architecture/product.md" }],
    }, "r4")).toThrow("not declared by the parent Plan")
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

  test("delta history restores exact non-final Phase, Wave, and Task ordering and fingerprints", () => {
    const scenarios: Array<{
      kind: "phase" | "wave" | "task"
      operations: WorkPlanAmendOperation[]
      historicalOrder: string[]
      currentOrder: string[]
    }> = [
      {
        kind: "phase",
        operations: [
          { action: "remove-phase", phaseId: "middle" },
          { action: "add-phase", phase: phaseFrom(historicalOrderPlan("phase"), "middle") },
        ],
        historicalOrder: ["current", "middle", "last"],
        currentOrder: ["current", "last", "middle"],
      },
      {
        kind: "wave",
        operations: [
          { action: "remove-wave", phaseId: "current", waveId: "middle" },
          { action: "add-wave", phaseId: "current", wave: waveFrom(historicalOrderPlan("wave"), "current", "middle") },
        ],
        historicalOrder: ["current", "middle", "last"],
        currentOrder: ["current", "last", "middle"],
      },
      {
        kind: "task",
        operations: [
          { action: "remove-task", taskId: "b" },
          { action: "add-task", phaseId: "current", waveId: "current", task: taskFrom(historicalOrderPlan("task"), "b") },
        ],
        historicalOrder: ["a", "b", "c"],
        currentOrder: ["a", "c", "b"],
      },
    ]

    for (const scenario of scenarios) {
      const baseline = historicalOrderPlan(scenario.kind)
      const work = createWorkHierarchy("docs/anchors/product/anchor.md", `wf-history-${scenario.kind}`, now)
      materializeWorkPlan(work, `wf-history-${scenario.kind}`, baseline, now)
      const generation = work.generation
      const originalPlanFingerprint = workPlanSemanticFingerprint(work, generation)
      const originalTaskFingerprint = taskSemanticFingerprintAtRevision(work, "a", generation, 1)
      const originalWaveFingerprint = workflowTaskSemanticFingerprint(work, ["a"], generation)

      const amendment = amendWorkPlan(work, {
        expectedVersion: work.version,
        by: "planner",
        reason: `Reorder a non-final ${scenario.kind} without changing the reviewed current Task contract.`,
        operations: scenario.operations,
      }, "r2")
      expect(amendment.plan.revision, scenario.kind).toBe(2)
      expect(planOrder(amendment.plan, scenario.kind), scenario.kind).toEqual(scenario.currentOrder)

      const historical = workPlanContext(work, undefined, "full", generation, 1)
      expect(historical, scenario.kind).toBeDefined()
      expect(planOrder(historical!, scenario.kind), scenario.kind).toEqual(scenario.historicalOrder)
      expect(workPlanSemanticFingerprint(work, generation, 1), scenario.kind).toBe(originalPlanFingerprint)
      expect(taskSemanticFingerprintAtRevision(work, "a", generation, 1), scenario.kind)
        .toBe(originalTaskFingerprint)
      expect(workflowTaskSemanticFingerprint(work, ["a"], generation, 1), scenario.kind)
        .toBe(originalWaveFingerprint)
    }
  })

  test("Task semantic closure changes when a transitive dependency contract changes", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-closure", now)
    materializeWorkPlan(work, "wf-closure", plan(), now)
    const generation = work.generation

    const beforeA = taskSemanticClosureFingerprintAtRevision(work, "a", generation, 1)
    const beforeB = taskSemanticClosureFingerprintAtRevision(work, "b", generation, 1)
    expect(beforeA).toBeDefined()
    expect(beforeB).toBeDefined()

    const amended = amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Change the upstream Task contract before execution.",
      operations: [{
        action: "patch-task",
        taskId: "a",
        patch: { acceptanceCriteria: ["A now carries a materially different acceptance contract."] },
      }],
    }, "r2")
    expect(amended.plan.revision).toBe(2)

    expect(taskSemanticClosureFingerprintAtRevision(work, "a", generation, 2)).not.toBe(beforeA)
    expect(taskSemanticClosureFingerprintAtRevision(work, "b", generation, 2)).not.toBe(beforeB)
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

  test("Planner can add Tasks and Waves as a new revision while the current Wave is claimed", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-adaptive-plan", now)
    materializeWorkPlan(work, "wf-adaptive-plan", plan(), now)
    claimWorkflowWave(
      work,
      "wf-adaptive-plan",
      work.generation,
      [task("a"), task("b", ["a"])],
      false,
      now,
    )
    syncWorkTaskStatuses(work, "wf-adaptive-plan", work.generation, [{
      taskId: "a",
      complete: true,
      result: {
        workflowId: "wf-adaptive-plan",
        summary: "A is already complete.",
        evidenceClaimIds: ["claim-a"],
        completedAt: now,
      },
    }], now)

    const extraTask = {
      id: "extra",
      title: "Extra",
      objective: "Handle a newly discovered execution hurdle.",
      rationale: "Execution revealed a missing bounded contribution.",
      dependsOn: ["a"],
      authorityRefs: ["docs/architecture/product.md"],
      constraints: ["Preserve the completed foundation."],
      acceptanceCriteria: ["The newly discovered path is covered."],
      subtasks: ["Implement the additional path"],
      integration: ["Consume A without rerunning it."],
      verify: ["go test ./..."],
      role: "worker",
      responsibility: "execute" as const,
    }
    const lateTask = {
      id: "late",
      title: "Late follow-up",
      objective: "Complete newly discovered follow-up work.",
      rationale: "The Plan adapts to execution findings.",
      dependsOn: ["extra"],
      authorityRefs: ["docs/architecture/product.md"],
      constraints: [],
      acceptanceCriteria: ["The follow-up is integrated."],
      subtasks: [],
      integration: ["Build on Extra."],
      verify: ["go test ./..."],
      role: "worker",
      responsibility: "execute" as const,
    }

    const amended = amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Execution exposed additional work; layer it onto the current Plan.",
      operations: [
        { action: "add-task", phaseId: "core", waveId: "foundation", task: extraTask },
        {
          action: "add-wave",
          phaseId: "core",
          wave: {
            id: "follow-up",
            title: "Follow-up",
            objective: "Address the newly discovered follow-up.",
            constraints: [],
            tasks: [lateTask],
          },
        },
      ],
    }, "adaptive-r2")

    expect(amended.plan.revision).toBe(2)
    expect(amended.changedTaskIds).toEqual(expect.arrayContaining(["extra", "late"]))
    expect(amended.changedWaveKeys).toEqual(expect.arrayContaining(["core/foundation", "core/follow-up"]))
    expect(workPlanContext(work, "extra")?.focus?.task.objective)
      .toBe("Handle a newly discovered execution hurdle.")
    expect(workPlanContext(work, "late")?.focus?.task.objective)
      .toBe("Complete newly discovered follow-up work.")
    expect(workPlanContext(work, "extra", "focused", 1, 1)?.focus?.task).toBeUndefined()

    const a = work.nodes.find(
      (node) => node.generation === work.generation && node.type === "task" && node.logicalId === "a",
    )
    expect(a?.status).toBe("complete")
    expect(a?.result?.summary).toBe("A is already complete.")
    expect(work.nodes.find(
      (node) => node.generation === work.generation && node.type === "task" && node.logicalId === "extra",
    )?.status).toBe("pending")
  })

  test("reopening unverified execution archives a receipt even after its claim was released", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    const result = {
      workflowId: "wf-1",
      summary: "Completed under old receipt contract.",
      evidenceClaimIds: ["claim-a"],
      completedAt: now,
    }
    syncWorkTaskStatuses(work, "wf-1", work.generation, [{ taskId: "a", complete: true, result }], now)
    releaseCancelledWorkflowClaims(work, "wf-1", "released")
    invalidateWorkflowTaskResults(work, "wf-1", work.generation, ["a"], "Unverified receipt", "review")
    const node = work.nodes.find((candidate) => candidate.type === "task" && candidate.logicalId === "a")
    expect(node?.status).toBe("pending")
    expect(node?.result).toBeUndefined()
    expect(node?.priorResults?.at(-1)).toMatchObject({
      ...result, invalidatedReason: "Unverified receipt", invalidatedByRevision: 1,
    })
  })

  test("retains a reopened Task result as historical evidence rather than silently discarding it", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    const result = {
      workflowId: "wf-1",
      summary: "Legacy result awaiting re-attestation",
      evidenceClaimIds: ["claim-a"],
      completedAt: now,
    }
    syncWorkTaskStatuses(work, "wf-1", work.generation, [{ taskId: "a", complete: true, result }], now)
    syncWorkTaskStatuses(work, "wf-1", work.generation, [{ taskId: "a", complete: false }], "reopened")
    const node = work.nodes.find((candidate) => candidate.type === "task" && candidate.logicalId === "a")
    expect(node?.result).toBeUndefined()
    expect(node?.status).toBe("pending")
    expect(node?.priorResults).toEqual([{
      ...result,
      invalidatedAt: "reopened",
      invalidatedByRevision: 1,
      invalidatedReason: expect.stringContaining("reopened"),
    }])
  })

  test("records a new Plan revision and invalidates only completion receipts affected by the semantic delta", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(work, "wf-1", work.generation, [{
      taskId: "a",
      complete: true,
      result: {
        workflowId: "wf-1",
        summary: "A completed under revision 1.",
        evidenceClaimIds: ["claim-a"],
        completedAt: now,
      },
    }], now)
    releaseCancelledWorkflowClaims(work, "wf-1", "released")

    const amended = amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "The foundation contract changed after execution.",
      operations: [{
        action: "patch-task",
        taskId: "a",
        patch: { objective: "A different meaning" },
      }],
    }, "later")

    expect(amended.plan.revision).toBe(2)
    expect(amended.changedTaskIds).toContain("a")
    expect(amended.affectedTaskIds).toEqual(expect.arrayContaining(["a", "b", "c"]))
    expect(workPlanContext(work, "a", "focused", 1, 1)?.focus?.task.objective).toBe("Build A")
    expect(workPlanContext(work, "a")?.focus?.task.objective).toBe("A different meaning")

    const a = work.nodes.find((node) => node.logicalId === "a" && node.generation === work.generation)!
    expect(a.status).toBe("pending")
    expect(a.result).toBeUndefined()
    expect(a.priorResults?.at(-1)).toMatchObject({
      workflowId: "wf-1",
      summary: "A completed under revision 1.",
      evidenceClaimIds: ["claim-a"],
      invalidatedByRevision: 2,
    })
  })

  test("rejects malformed deltas but lets Planner revise claimed Plan semantics as a new revision", () => {
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
    const first = amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Adapt the claimed Plan without rewriting revision 1.",
      planPatch: { obligations },
      operations: [],
    }, "later")
    expect(first.plan.revision).toBe(2)
    expect(first.affectedTaskIds).toEqual(expect.arrayContaining(["a", "b", "c"]))

    const correctionRouting = structuredClone(first.plan.correctionRouting)
    correctionRouting.unshift({
      condition: "New global recovery route",
      routeTo: "planner",
    })
    const second = amendWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Layer another Planner correction on the effective Plan.",
      planPatch: { correctionRouting },
      operations: [],
    }, "later-2")
    expect(second.plan.revision).toBe(3)
    expect(workPlanContext(work, "a", "focused", 1, 1)?.revision).toBe(1)
    expect(workPlanContext(work, "a", "focused", 1, 2)?.revision).toBe(2)

    expect(() => invalidateWorkPlan(work, {
      expectedVersion: work.version,
      by: "planner",
      reason: "Generation invalidation still requires released live claims",
    }, "later-3")).toThrow("cannot be amended")
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
    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now, graphFingerprint)

    claimWorkflowWave(work, "wf-2", work.generation, [task("c")], true, now)
    syncWorkTaskStatuses(
      work,
      "wf-2",
      work.generation,
      [{ taskId: "c", complete: true }],
      now,
    )
    completeWaveForTasks(work, "wf-2", work.generation, ["c"], now, graphFingerprint)

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
    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now, graphFingerprint)

    claimWorkflowWave(work, "wf-2", work.generation, [task("c")], true, now)
    syncWorkTaskStatuses(
      work,
      "wf-2",
      work.generation,
      [{ taskId: "c", complete: true }],
      now,
    )
    completeWaveForTasks(work, "wf-2", work.generation, ["c"], now, graphFingerprint)

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

    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now, graphFingerprint)
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
    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now, graphFingerprint)

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
    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now, graphFingerprint)

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
    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now, graphFingerprint)
    expect(workTree(work).phases[0].waves[0].status).toBe("complete")

    expect(() => reopenWaveForTasks(work, "wf-1", work.generation, ["a", "b"], "stale-review", "b".repeat(64))).toThrow(
      "does not match the current Task role/slot graph and independent gates",
    )
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
    completeWaveForTasks(work, "wf-1", work.generation, ["a", "b"], now, graphFingerprint)
    return work
  }

  test("completion proof is exact to owner, generation and reviewed task set", () => {
    const work = completedFoundation()
    const before = structuredClone(work)
    expect(assertCompletedWaveForTasks(work, "wf-1", work.generation, ["b", "a"], graphFingerprint).completion!.provenance).toBe("implementation-review")
    expect(() => assertCompletedWaveForTasks(work, "wf-1", work.generation, ["a", "b"], "b".repeat(64))).toThrow(
      "does not match the current Task role/slot graph and independent gates",
    )
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
      completeWaveForTasks(work, "wf-2", work.generation, ["b"], "reviewed", graphFingerprint)
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
      completeWaveForTasks(work, "wf-2", work.generation, ["c"], "reviewed", graphFingerprint)
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
