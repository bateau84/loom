import { describe, expect, test } from "bun:test"
import {
  episodeIdFromRememberInput,
  episodeRecallPayload,
  rememberedMemoryId,
} from "./synabun"
import type { Episode } from "./learning"

const episode: Episode = {
  id: "episode-1",
  project: "/repo",
  workflowId: "workflow-1",
  subject: "database retries",
  lesson: "Treat quota exhaustion as deferred work",
  evidenceRefs: ["evidence-1"],
  tags: ["quota", "youtube"],
  createdBy: "reviewer",
  createdAt: "now",
  status: "active",
  synabun: { status: "pending" },
}

describe("Loom SynaBun bridge", () => {
  test("produces semantic recall payload with canonical Loom id", () => {
    const payload = episodeRecallPayload(episode)
    expect(payload.content).toContain("LOOM_EPISODE_ID: episode-1")
    expect(payload.tags).toContain("episode")
    expect(payload.project).toBe("/repo")
  })

  test("extracts Loom episode id from remember input", () => {
    expect(episodeIdFromRememberInput(episodeRecallPayload(episode))).toBe("episode-1")
  })

  test("parses SynaBun remembered id", () => {
    expect(rememberedMemoryId("Remembered [memory-123] successfully")).toBe("memory-123")
  })
})
