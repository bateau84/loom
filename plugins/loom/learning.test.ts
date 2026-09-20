import { describe, expect, test } from "bun:test"
import {
  heuristicsForEpisodes,
  proposeHeuristic,
  rankEpisodes,
  rankHeuristics,
  removeEpisodeSupport,
  retireEpisode,
  reviewHeuristic,
  type Episode,
} from "./learning"

function episode(
  id: string,
  project = "p",
  lesson = "Prefer explicit state transitions",
  workflowId = "w-" + id,
): Episode {
  return {
    id,
    project,
    workflowId,
    subject: "workflow state",
    lesson,
    evidenceRefs: ["e:" + id],
    tags: ["workflow", "state"],
    createdBy: "reviewer",
    createdAt: id,
    status: "active",
    synabun: { status: "pending" },
  }
}

describe("Loom learning memory", () => {
  test("retrieves relevant active episodes without making them authority", () => {
    const results = rankEpisodes("workflow state", [
      episode("2"),
      episode("1", "p", "CSS spacing lesson"),
    ])

    expect(results[0]?.value.id).toBe("2")
  })

  test("retired episodes are not returned", () => {
    const retired = episode("1")
    retireEpisode({ episode: retired, reviewer: "reviewer", reason: "stale", now: "later" })
    expect(rankEpisodes("workflow", [retired])).toHaveLength(0)
  })

  test("new heuristics are provisional", () => {
    const heuristic = proposeHeuristic({
      id: "h1",
      statement: "Prefer explicit state transitions",
      scope: "workflow engines",
      proposedBy: "architect",
      episodes: [episode("1")],
      now: "now",
    })

    expect(heuristic.status).toBe("provisional")
  })

  test("one episode cannot validate a heuristic", () => {
    const heuristic = proposeHeuristic({
      id: "h1",
      statement: "Prefer explicit state transitions",
      scope: "workflow engines",
      proposedBy: "architect",
      episodes: [episode("1")],
      now: "now",
    })

    expect(() =>
      reviewHeuristic({
        heuristic,
        reviewer: "critic",
        action: "validate",
        episodes: [episode("1")],
        note: "same evidence only",
        now: "later",
      }),
    ).toThrow()
  })

  test("two episodes from the same workflow cannot validate a heuristic", () => {
    const first = episode("1", "project-a", "lesson", "workflow-a")
    const second = episode("2", "project-a", "lesson", "workflow-a")
    const heuristic = proposeHeuristic({
      id: "h1",
      statement: "Prefer explicit state transitions",
      scope: "workflow engines",
      proposedBy: "architect",
      episodes: [first],
      now: "now",
    })

    expect(() =>
      reviewHeuristic({
        heuristic,
        reviewer: "reviewer",
        action: "validate",
        episodes: [second],
        note: "same workflow",
        now: "later",
      }),
    ).toThrow()
  })

  test("independent repeated evidence can validate a heuristic", () => {
    const heuristic = proposeHeuristic({
      id: "h1",
      statement: "Prefer explicit state transitions",
      scope: "workflow engines",
      proposedBy: "architect",
      episodes: [episode("1", "project-a", "lesson", "workflow-a")],
      now: "now",
    })

    reviewHeuristic({
      heuristic,
      reviewer: "reviewer",
      action: "validate",
      episodes: [episode("2", "project-b", "lesson", "workflow-b")],
      note: "recurred independently",
      now: "later",
    })

    expect(heuristic.status).toBe("validated")
    expect(heuristic.support).toHaveLength(2)
  })

  test("validated heuristics rank before provisional peers", () => {
    const provisional = proposeHeuristic({
      id: "h1",
      statement: "Prefer explicit state transitions",
      scope: "workflow",
      proposedBy: "architect",
      episodes: [episode("1")],
      now: "1",
    })
    const validated = proposeHeuristic({
      id: "h2",
      statement: "Explicit state transitions reduce workflow ambiguity",
      scope: "workflow",
      proposedBy: "architect",
      episodes: [episode("2", "project-a", "lesson", "workflow-a")],
      now: "2",
    })
    reviewHeuristic({
      heuristic: validated,
      reviewer: "critic",
      action: "validate",
      episodes: [episode("3", "project-b", "lesson", "workflow-b")],
      note: "confirmed",
      now: "3",
    })

    expect(rankHeuristics("workflow state", [provisional, validated])[0]?.value.id).toBe("h2")
  })

  test("retired heuristics are not returned", () => {
    const heuristic = proposeHeuristic({
      id: "h1",
      statement: "Prefer explicit state transitions",
      scope: "workflow",
      proposedBy: "architect",
      episodes: [episode("1")],
      now: "1",
    })
    reviewHeuristic({
      heuristic,
      reviewer: "critic",
      action: "retire",
      episodes: [],
      note: "contradicted by current evidence",
      now: "2",
    })

    expect(rankHeuristics("workflow", [heuristic])).toHaveLength(0)
  })

  test("retiring support demotes a validated heuristic when evidence is no longer independent", () => {
    const heuristic = proposeHeuristic({
      id: "h1",
      statement: "Prefer explicit state transitions",
      scope: "workflow",
      proposedBy: "architect",
      episodes: [episode("1", "project-a", "lesson", "workflow-a")],
      now: "1",
    })
    reviewHeuristic({
      heuristic,
      reviewer: "reviewer",
      action: "validate",
      episodes: [episode("2", "project-b", "lesson", "workflow-b")],
      note: "independent support",
      now: "2",
    })

    expect(heuristic.status).toBe("validated")
    removeEpisodeSupport(heuristic, "2")
    expect(heuristic.status).toBe("provisional")
    expect(heuristic.support.map((item) => item.episodeId)).toEqual(["1"])
  })

  test("canonical lookup can relate recalled episodes to current heuristics", () => {
    const heuristic = proposeHeuristic({
      id: "h1",
      statement: "Prefer explicit state transitions",
      scope: "workflow",
      proposedBy: "architect",
      episodes: [episode("1")],
      now: "1",
    })

    expect(heuristicsForEpisodes(["1"], [heuristic]).map((item) => item.id)).toEqual(["h1"])
  })
})
