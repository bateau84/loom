import type { Episode } from "./learning"

export type SynabunRememberPayload = {
  content: string
  category: "conversations"
  importance: number
  tags: string[]
  project: string
}

export function episodeRecallPayload(episode: Episode): SynabunRememberPayload {
  const tags = [...new Set(["loom", "episode", ...episode.tags.map((tag) => tag.toLowerCase())])]
  const content = [
    `LOOM_EPISODE_ID: ${episode.id}`,
    `Subject: ${episode.subject}`,
    `Lesson: ${episode.lesson}`,
    `Project: ${episode.project}`,
    ...(episode.workflowId ? [`Workflow: ${episode.workflowId}`] : []),
    `Evidence: ${episode.evidenceRefs.join(", ")}`,
  ].join("\n")

  return {
    content,
    category: "conversations",
    importance: 7,
    tags,
    project: episode.project,
  }
}

export function episodeIdFromRememberInput(input: unknown) {
  if (!input || typeof input !== "object") return undefined
  const content = (input as Record<string, unknown>).content
  if (typeof content !== "string") return undefined
  return content.match(/(?:^|\n)LOOM_EPISODE_ID:\s*([a-zA-Z0-9_-]+)/)?.[1]
}

export function rememberedMemoryId(result: unknown) {
  const text = typeof result === "string" ? result : JSON.stringify(result)
  if (!text) return undefined
  return text.match(/Remembered\s*\[([^\]]+)\]/i)?.[1]
}
