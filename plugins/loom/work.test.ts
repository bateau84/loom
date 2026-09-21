import { describe, expect, test } from "bun:test"
import type { TaskSpec } from "./tasks"
import {
  completeObjective,
  completeWaveForTasks,
  createWorkHierarchy,
  materializeWorkPlan,
  nextRunnableWaves,
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

    syncWorkTaskStatuses(work, [{ taskId: "a", complete: true }], now)
    const progressed = workTree(work)
    expect(progressed.objective.progress).toEqual({ finished: 1, total: 3 })
    expect(progressed.phases[0].status).toBe("active")
    expect(progressed.phases[0].waves[0].status).toBe("active")
    expect(progressed.objective.status).toBe("active")
  })

  test("keeps Objective active until explicit objective completion", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    syncWorkTaskStatuses(
      work,
      [
        { taskId: "a", complete: true },
        { taskId: "b", complete: true },
        { taskId: "c", complete: true },
      ],
      now,
    )
    completeWaveForTasks(work, ["a", "b"], now)
    completeWaveForTasks(work, ["c"], now)

    expect(workTree(work).phases[0].status).toBe("complete")
    expect(work.objectiveStatus).toBe("active")

    completeObjective(work, now)
    expect(work.objectiveStatus).toBe("complete")
  })

  test("exposes only dependency-eligible waves", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)

    expect(nextRunnableWaves(work).map((wave) => wave.id)).toEqual(["foundation"])

    syncWorkTaskStatuses(
      work,
      [
        { taskId: "a", complete: true },
        { taskId: "b", complete: true },
      ],
      now,
    )
    expect(nextRunnableWaves(work)).toHaveLength(0)

    completeWaveForTasks(work, ["a", "b"], now)
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

    syncWorkTaskStatuses(
      work,
      [
        { taskId: "a", complete: true },
        { taskId: "b", complete: true },
      ],
      now,
    )
    completeWaveForTasks(work, ["a", "b"], now)

    expect(() => validateWorkflowWave(work, [task("c")], true)).not.toThrow()
  })

  test("replanning preserves old completed history and creates a new generation", () => {
    const work = createWorkHierarchy("docs/anchors/product/anchor.md", "wf-1", now)
    materializeWorkPlan(work, "wf-1", plan(), now)
    syncWorkTaskStatuses(work, [{ taskId: "a", complete: true }], now)

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
    syncWorkTaskStatuses(
      work,
      [
        { taskId: "a", complete: true },
        { taskId: "b", complete: true },
      ],
      now,
    )
    completeWaveForTasks(work, ["a", "b"], now)
    expect(workTree(work).phases[0].waves[0].status).toBe("complete")

    reopenWaveForTasks(work, ["a", "b"], "later")
    expect(workTree(work).phases[0].waves[0].status).toBe("active")
    expect(workTree(work).phases[0].status).toBe("active")
  })

})
