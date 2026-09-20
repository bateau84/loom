import { describe, expect, test } from "bun:test"
import {
  createKnowledgeReport,
  invalidateKnowledgeReport,
  isKnowledgePath,
  isOkfObservation,
} from "./knowledge"
import type { EvidenceObservation } from "./evidence"

function observation(tool = "okf-mcp_list_docs", status: EvidenceObservation["status"] = "completed"): EvidenceObservation {
  return {
    id: "obs-1",
    sessionID: "session",
    agent: "documenter",
    tool,
    status,
    observedAt: "now",
  }
}

describe("Loom living knowledge", () => {
  test("limits documenter knowledge surface", () => {
    expect(isKnowledgePath("docs/system/components/api.md")).toBe(true)
    expect(isKnowledgePath("docs/user/setup.md")).toBe(true)
    expect(isKnowledgePath("README.md")).toBe(true)
    expect(isKnowledgePath("docs/architecture/system.md")).toBe(false)
    expect(isKnowledgePath("../outside.md")).toBe(false)
  })

  test("recognizes successful OKF discovery evidence", () => {
    expect(isOkfObservation(observation())).toBe(true)
    expect(isOkfObservation(observation("okf-mcp_list_docs", "error"))).toBe(false)
    expect(isOkfObservation(observation("bash"))).toBe(false)
  })

  test("changed knowledge requires observed OKF verification", () => {
    expect(() =>
      createKnowledgeReport({
        workflowId: "w",
        changedDocs: ["docs/system/index.md"],
        observations: [],
        recordedBy: "documenter",
        now: "now",
      }),
    ).toThrow()

    const report = createKnowledgeReport({
      workflowId: "w",
      changedDocs: ["docs/system/index.md"],
      observations: [observation()],
      recordedBy: "documenter",
      now: "now",
    })
    expect(report.valid).toBe(true)
    expect(report.changedDocs).toEqual(["docs/system/index.md"])
  })

  test("no-change result requires a concrete reason", () => {
    expect(() =>
      createKnowledgeReport({
        workflowId: "w",
        changedDocs: [],
        observations: [observation()],
        recordedBy: "documenter",
        now: "now",
      }),
    ).toThrow()

    const report = createKnowledgeReport({
      workflowId: "w",
      changedDocs: [],
      unchangedReason: "Only internal refactoring; documented seams and flows are unchanged.",
      observations: [observation("okf-mcp_get_doc")],
      recordedBy: "documenter",
      now: "now",
    })
    expect(report.unchangedReason).toContain("internal refactoring")
  })

  test("report becomes invalid after upstream rework", () => {
    const report = createKnowledgeReport({
      workflowId: "w",
      changedDocs: ["README.md"],
      observations: [observation()],
      recordedBy: "documenter",
      now: "now",
    })
    invalidateKnowledgeReport(report)
    expect(report.valid).toBe(false)
  })
})
