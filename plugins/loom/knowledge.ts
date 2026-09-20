import type { EvidenceObservation } from "./evidence"

export type KnowledgeReport = {
  workflowId: string
  stepId: "knowledge-sync"
  changedDocs: string[]
  unchangedReason?: string
  okfObservationIds: string[]
  recordedBy: string
  recordedAt: string
  valid: boolean
}

const allowedRoots = ["docs/system/", "docs/user/"]

function normalize(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "")
}

export function isKnowledgePath(path: string) {
  const value = normalize(path)
  return (
    value === "README.md" ||
    allowedRoots.some((root) => value.startsWith(root))
  )
}

export function isOkfObservation(observation: EvidenceObservation) {
  const tool = observation.tool.toLowerCase()
  return (
    observation.status === "completed" &&
    tool.includes("okf-mcp") &&
    (
      tool.endsWith("list_docs") ||
      tool.endsWith("list_tags") ||
      tool.endsWith("get_doc") ||
      tool.endsWith("validate_doc") ||
      tool.endsWith("graph_trace") ||
      tool.endsWith("graph_relationships")
    )
  )
}

export function createKnowledgeReport(input: {
  workflowId: string
  changedDocs: string[]
  unchangedReason?: string
  observations: EvidenceObservation[]
  recordedBy: string
  now: string
}): KnowledgeReport {
  const changedDocs = [...new Set(input.changedDocs.map(normalize).filter(Boolean))]

  if (changedDocs.some((path) => !isKnowledgePath(path))) {
    throw new Error("Knowledge sync may report only README.md, docs/system/**, or docs/user/** changes.")
  }

  if (changedDocs.length === 0 && !input.unchangedReason?.trim()) {
    throw new Error("Knowledge sync must record changed documents or explain why current knowledge was already accurate.")
  }

  const okf = input.observations.filter(isOkfObservation)
  if (okf.length === 0) {
    throw new Error("Knowledge sync requires an observed successful OKF-MCP discovery/verification call.")
  }

  return {
    workflowId: input.workflowId,
    stepId: "knowledge-sync",
    changedDocs,
    ...(input.unchangedReason?.trim()
      ? { unchangedReason: input.unchangedReason.trim() }
      : {}),
    okfObservationIds: [...new Set(okf.map((observation) => observation.id))],
    recordedBy: input.recordedBy,
    recordedAt: input.now,
    valid: true,
  }
}

export function invalidateKnowledgeReport(report: KnowledgeReport) {
  report.valid = false
  return report
}
