export type Episode = {
  id: string
  project: string
  workflowId?: string
  subject: string
  lesson: string
  evidenceRefs: string[]
  tags: string[]
  createdBy: string
  createdAt: string
}

export type HeuristicStatus = "provisional" | "validated" | "retired"

export type HeuristicSupport = {
  episodeId: string
  project: string
}

export type Heuristic = {
  id: string
  statement: string
  scope: string
  status: HeuristicStatus
  support: HeuristicSupport[]
  proposedBy: string
  createdAt: string
  reviewedBy?: string
  reviewedAt?: string
  reviewNote?: string
}

function terms(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_-]+/)
      .filter((term) => term.length >= 2),
  )
}

function overlap(query: Set<string>, values: string[]) {
  const candidate = terms(values.join(" "))
  let score = 0
  for (const term of query) if (candidate.has(term)) score++
  return score
}

export function rankEpisodes(query: string, episodes: Episode[]) {
  const q = terms(query)
  return episodes
    .map((episode) => ({
      value: episode,
      score: overlap(q, [episode.subject, episode.lesson, ...episode.tags]),
    }))
    .filter((entry) => entry.score > 0 || query.trim() === "")
    .sort((a, b) => b.score - a.score || b.value.createdAt.localeCompare(a.value.createdAt))
}

export function rankHeuristics(query: string, heuristics: Heuristic[]) {
  const q = terms(query)
  return heuristics
    .filter((heuristic) => heuristic.status !== "retired")
    .map((heuristic) => ({
      value: heuristic,
      score: overlap(q, [heuristic.statement, heuristic.scope]),
    }))
    .filter((entry) => entry.score > 0 || query.trim() === "")
    .sort((a, b) => {
      const status = Number(b.value.status === "validated") - Number(a.value.status === "validated")
      return status || b.score - a.score || b.value.createdAt.localeCompare(a.value.createdAt)
    })
}

export function proposeHeuristic(input: {
  id: string
  statement: string
  scope: string
  proposedBy: string
  episodes: Episode[]
  now: string
}): Heuristic {
  if (input.episodes.length === 0) {
    throw new Error("A heuristic proposal needs at least one supporting episode.")
  }

  const unique = new Map(input.episodes.map((episode) => [episode.id, episode]))
  return {
    id: input.id,
    statement: input.statement,
    scope: input.scope,
    status: "provisional",
    support: [...unique.values()].map((episode) => ({
      episodeId: episode.id,
      project: episode.project,
    })),
    proposedBy: input.proposedBy,
    createdAt: input.now,
  }
}

export function reviewHeuristic(input: {
  heuristic: Heuristic
  reviewer: string
  action: "validate" | "retire"
  episodes: Episode[]
  note: string
  now: string
}) {
  if (input.action === "validate") {
    const all = new Set([
      ...input.heuristic.support.map((support) => support.episodeId),
      ...input.episodes.map((episode) => episode.id),
    ])

    if (all.size < 2) {
      throw new Error("Validating a heuristic requires at least two distinct supporting episodes.")
    }

    const support = new Map(
      input.heuristic.support.map((item) => [item.episodeId, item]),
    )
    for (const episode of input.episodes) {
      support.set(episode.id, { episodeId: episode.id, project: episode.project })
    }

    input.heuristic.support = [...support.values()]
    input.heuristic.status = "validated"
  } else {
    input.heuristic.status = "retired"
  }

  input.heuristic.reviewedBy = input.reviewer
  input.heuristic.reviewedAt = input.now
  input.heuristic.reviewNote = input.note
  return input.heuristic
}
