import { describe, expect, test } from "bun:test"
import type { TaskSpec } from "./tasks"
import {
  claimWorkflowWave,
  completeObjective,
  completeWaveForTasks,
  createWorkHierarchy,
  materializeWorkPlan,
  nextRunnableWaves,
  releaseWorkflowWave,
  reopenWaveForTasks,
  syncWorkTaskStatuses,
  validateWorkflowWave,
  workTree,
  type WorkPlanPhase,
} from "./work"

const now = "2026-09-21T00:00:00Z"

function plan(): WorkPlanPhase[] {
  return [
    {
      id: "core",
      title: "Core",
      waves: [
        {
          id: "foundation",
          title: "Foundation",
          tasks: [
            { id: "a", title: "A", objective: "Build A", dependsOn: [] },
            { id: "b", title: "B", objective: "Build B", dependsOn: ["a"] },
          ],
        },
        {
          id: "runtime",
          title: "Runtime",
          tasks: [
            { id: "c", title: "C", objective: "Build C", dependsOn: ["b"] },
          ],
        },
      ],
    },
  ]
}

function task(id: string, dependsOn: string[] = []): TaskSpec {
  const source = plan().flatMap((phase) => phase.waves).flatMap((wave) => wave.tasks).find((item) => item.id === id)!
  return {
    id,
    title: source.title,
    objective: source.objective,
    dependsOn,
    write: [`internal/${id}/**`],
    skills: ["golang"],
    verify: ["go test ./..."],
  }
}

describe("Loom persistent work hierarchy", () => {
  test("materializes Objective -> Phase -> Wave -> Task and reports progress", () => {
    const work = createWorkHierarchy("docs/anchors/leash-v1/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)

    const tree = workTree(work)
    expect(tree.objective.title).toBe("leash v1")
    expect(tree.objective.progress).toEqual({ finished: 0, total: 3 })
    expect(tree.phases[0].waves.map((wave) => wave.id)).toEqual(["foundation", "runtime"])

    claimWorkflowWave(work, "wf-1", work.generation, [task("a"), task("b", ["a"])], false, now)
    syncWorkTaskStatuses(work, "wf-1", work.generation, [{ taskId: "a", complete: true }], now)
    const progressed = workTree(work)
    expect(progressed.objective.progress).toEqual({ finished: 1, total: 3 })
    expect(progressed.phases[0].status).toBe("active")
    expect(progressed.phases[0].waves[0].status).toBe("active")
    expect(progressed.objective.status).toBe("active")
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
