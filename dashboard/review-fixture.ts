import { createDashboardPublisher } from "../plugins/loom/dashboard"
import { readableFixture } from "./readability-fixture"

// Synthetic sentinels only. These variants must exercise every default prose channel.
export const authorizationSamples = [
  'Authorization: Bearer REVIEW_SENTINEL',
  '{"Authorization":"Bearer REVIEW_SENTINEL"}',
  '{"Authorization":"Basic REVIEW_SENTINEL"}',
  "'aUtHoRiZaTiOn' : 'Bearer REVIEW_SENTINEL'",
  '"Authorization": Bearer REVIEW_SENTINEL',
  String.raw`{"Author\u0069zation":"Bearer REVIEW_SENTINEL"}`,
  String.raw`{"Authorization":"Bearer REVIEW_SENTINEL\"SECRET_TAIL"}`,
  "'Authorization': 'Bearer REVIEW_SENTINEL''SECRET_TAIL'",
  'Authorization: |\n  Bearer REVIEW_SENTINEL',
  '{"Authorization":"Bearer REVIEW_SENTINEL',
  '"Proxy-Authorization" = "Basic REVIEW_SENTINEL"',
  'Recorded headers: ' + JSON.stringify(JSON.stringify({ Authorization: "Bearer REVIEW_SENTINEL" })),
  'Authorization: Digest username="someone", response="REVIEW_SENTINEL"',
  'authorization\u202e: Bearer REVIEW_SENTINEL',
  String.raw`{"Author\u202Eization":"Bearer REVIEW_SENTINEL"}`,
]

export function reviewFixture(root: string, mode = "normal", sample = 0) {
  const f = readableFixture(root)
  if (mode === "waves") {
    const [phase, wave, task] = f.work.nodes
    phase.logicalId = "foundation"; phase.title = "Foundation"
    wave.logicalId = "build"; wave.title = "Build foundations"
    delete wave.claimedByWorkflowId; delete task.claimedByWorkflowId
    f.work.nodes.push(
      { ...phase, id: "phase:1:delivery", logicalId: "delivery", title: "Delivery" },
      { ...wave, id: "wave:1:delivery/build", parentId: "phase:1:delivery", title: "Build release package", claimedByWorkflowId: f.workflow.id },
      { ...task, id: "task:1:package-cli", logicalId: "package-cli", parentId: "wave:1:delivery/build", title: "Package CLI", claimedByWorkflowId: f.workflow.id },
      { ...task, id: "task:1:package-ui", logicalId: "package-ui", parentId: "wave:1:delivery/build", title: "Package UI", claimedByWorkflowId: f.workflow.id },
    )
  } else if (mode === "overflow") {
    f.workflow.request = "https://example.test/" + "x".repeat(580)
  } else if (mode === "secret") {
    const text = authorizationSamples[sample]
    if (text === undefined) throw new Error("Unknown authorization fixture")
    f.workflow.request = text
    f.question.question = text
    f.workflow.verification![0].statement = text
    f.workflow.steps[0].status = "failed"
    f.workflow.steps[0].summary = text
  } else if (mode === "history") {
    f.storage.values.set("workflow/history", {
      ...f.workflow, id: "history-workflow", work: undefined, verification: [],
      steps: [{ id: "worker", agent: "worker", kind: "work", dependsOn: [], status: "complete" }],
    })
    f.storage.values.set("work/history", {
      ...f.work, objectiveId: "history-objective", objectiveStatus: "complete", nodes: [], workflowIds: [],
    })
  } else if (mode !== "normal") throw new Error("Unknown review fixture mode")
  return { ...f, options: { leaseMs: 600_000, ...(mode === "history" ? { maxWorkflows: 1, maxObjectives: 1 } : {}) } }
}

if (import.meta.main) {
  const root = process.argv[2]
  if (!root) throw new Error("Fixture runtime root required")
  const sample = Number(process.argv[4] ?? 0)
  if (!Number.isSafeInteger(sample) || sample < 0) throw new Error("Invalid fixture index")
  const f = reviewFixture(root, process.argv[3] ?? "normal", sample)
  await createDashboardPublisher(f.storage, f.runtime, f.options).publish()
}
