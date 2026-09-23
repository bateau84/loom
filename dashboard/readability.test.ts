import { describe, expect, test } from "bun:test"
import { aggregateFleet, buildProjectSnapshot, projectionDigest, type ProjectSnapshotV1, type WorkflowProjectionV1 } from "../plugins/loom/dashboard"
import { buildDashboardWorkflowContext, dashboardText } from "../plugins/loom/dashboard-context"
import { dashboardReadability } from "./readability"
import { readableFixture, readableIds } from "./readability-fixture"

const labels = new Function("resolved", "arr", dashboardReadability + "; return {workflowLabel,stepName,stageName,sessionName,contextFor,projectLabel};")(
  (w: any) => w.consistency === "ok" ? w.projection : null,
  (v: unknown) => Array.isArray(v) ? v : [],
)
function record(snapshot: ProjectSnapshotV1) {
  return { snapshot, manifest: { schemaVersion: 1 as const, installationId: snapshot.installationId, instanceId: snapshot.instanceId,
    startedAt: snapshot.generatedAt, generatedAt: snapshot.generatedAt, leaseExpiresAt: snapshot.leaseExpiresAt, projects: [snapshot.projectId] } }
}
function redigest(workflow: WorkflowProjectionV1) {
  const { stateDigest: _, ...body } = workflow
  workflow.stateDigest = projectionDigest(body)
}
function legacySnapshot(snapshot: ProjectSnapshotV1) {
  const old = structuredClone(snapshot)
  delete old.workflows[0].context
  redigest(old.workflows[0])
  old.instanceId = "legacy-publisher"
  return old
}
async function projected() {
  const f = readableFixture("/tmp/loom-readability-no-io")
  const snapshot = await buildProjectSnapshot(f.storage, f.runtime, 1)
  const project = aggregateFleet([record(snapshot)]).projects[0]
  return { ...f, snapshot, project, projectedWorkflow: project.workflows[0] }
}

describe("readable dashboard projection and labels", () => {
  test("real workflow projection carries bound questions, answer authority and required evidence", async () => {
    const { snapshot } = await projected()
    const p = snapshot.workflows[0]
    expect(p.openOqCount).toBe(1)
    expect(p.context?.questions[0]).toMatchObject({ id: readableIds.question, status: "open", requiredAuthority: "user", blocking: true,
      description: { text: "How long should completed workflow history be kept?", truncated: false } })
    expect(p.context?.verification[0]).toMatchObject({ description: { text: "Prove existing workflow history survives a restart." },
      beforeStep: { id: "review-implementation", agent: "reviewer", kind: "gate" } })
    expect(p.context?.coordinatorSessionId).toBe(readableIds.coordinator)
    expect(p.participatingSessionIds[0]).toBe(readableIds.participant)
    const { stateDigest, ...body } = p
    expect(stateDigest).toBe(projectionDigest(body))
  })
  test("readable text is digest-covered; actual disagreement conflicts while absent legacy context is compatible", async () => {
    const { snapshot, storage, runtime, question } = await projected()
    question.question = "A different unresolved choice"
    const next = await buildProjectSnapshot(storage, runtime, 2)
    expect(next.workflows[0].stateDigest).not.toBe(snapshot.workflows[0].stateDigest)
    next.instanceId = "new-publisher"
    const combined = aggregateFleet([record(snapshot), record(next)]).projects[0].workflows[0]
    expect(combined.consistency).toBe("conflict"); expect(combined.projection).toBeUndefined()
    const old = legacySnapshot(snapshot)
    expect(aggregateFleet([record(old)]).projects[0].workflows[0].consistency).toBe("ok")
    const mixed = aggregateFleet([record(old), record(snapshot)]).projects[0].workflows[0]
    expect(mixed.consistency).toBe("ok")
    expect(mixed.projection).toBe(snapshot.workflows[0])
    expect(mixed.projection?.stateDigest).toBe(snapshot.workflows[0].stateDigest)
    expect(mixed.participants).toHaveLength(2)
  })
  test("legacy compatibility never hides core differences, corrupt digests, unknown versions or conflicting readable details", async () => {
    const { snapshot } = await projected()
    const old = legacySnapshot(snapshot)
    const changedCore = structuredClone(snapshot)
    changedCore.workflows[0].status = "failed"; redigest(changedCore.workflows[0])
    const corrupt = structuredClone(snapshot)
    corrupt.workflows[0].context!.questions[0].description.text = "Corrupted without a new digest"
    const unsupported = structuredClone(snapshot)
    ;(unsupported.workflows[0].context as any).version = 99
    redigest(unsupported.workflows[0])
    for (const candidate of [changedCore, corrupt, unsupported]) {
      const result = aggregateFleet([record(old), record(candidate)]).projects[0].workflows[0]
      expect(result.consistency).toBe("conflict"); expect(result.projection).toBeUndefined()
    }
    const disputed = structuredClone(snapshot)
    disputed.instanceId = "another-rich-publisher"
    disputed.workflows[0].context!.questions[0].description.text = "Different recorded question"
    redigest(disputed.workflows[0])
    const result = aggregateFleet([record(old), record(snapshot), record(disputed)]).projects[0].workflows[0]
    expect(result.consistency).toBe("conflict"); expect(result.projection).toBeUndefined()
  })
  test("a live legacy source cannot make stale readable details live or replace a higher revision", async () => {
    const { snapshot } = await projected()
    const old = legacySnapshot(snapshot)
    old.leaseExpiresAt = "2026-09-23T12:20:00.000Z"
    snapshot.leaseExpiresAt = "2026-09-23T12:00:00.000Z"
    const at = new Date("2026-09-23T12:10:00.000Z")
    const mixed = aggregateFleet([record(old), record(snapshot)], at).projects[0].workflows[0]
    expect(mixed.consistency).toBe("ok")
    expect(mixed.sourceFreshness).toBe("stale-source")
    expect(mixed.projection).toBe(snapshot.workflows[0])
    expect(mixed.participants.find((p) => p.instanceId === old.instanceId)?.live).toBe(true)
    old.workflows[0].workflowRevision += 1; redigest(old.workflows[0])
    const newer = aggregateFleet([record(old), record(snapshot)], at).projects[0].workflows[0]
    expect(newer.workflowRevision).toBe(old.workflows[0].workflowRevision)
    expect(newer.projection?.context).toBeUndefined()
  })
  test("only explicit same-workflow membership names the coordinator; unrelated questions stay out", async () => {
    const { storage, runtime, question } = await projected()
    storage.values.set("oq/" + readableIds.workflow + "/foreign", { ...question, id: "foreign", workflowId: "other", question: "OTHER PROJECT TEXT" })
    storage.values.set("session/" + readableIds.coordinator, "another-workflow")
    const snapshot = await buildProjectSnapshot(storage, runtime, 2)
    expect(snapshot.workflows[0].openOqCount).toBe(1)
    expect(snapshot.workflows[0].context?.coordinatorSessionId).toBeUndefined()
    expect(JSON.stringify(snapshot)).not.toContain("OTHER PROJECT TEXT")
  })
  test("bounded previews do not change counts, hide truncation, or export answers and evidence bodies", async () => {
    const { workflow, question } = readableFixture("/tmp/no-io")
    const questions = Array.from({ length: 30 }, (_, i) => ({ ...question, id: String(i), question: "x".repeat(800) }))
    questions[0] = { ...questions[0], status: "closed" }
    questions[1] = { ...questions[1], status: "answered", answer: { by: "user", source: "user", text: "UNEXPORTED ANSWER", evidence: ["UNEXPORTED EVIDENCE"], at: "now" } }
    workflow.verification = Array.from({ length: 30 }, (_, i) => ({ ...workflow.verification![0], id: String(i) }))
    const context = buildDashboardWorkflowContext(workflow, questions, [readableIds.coordinator])
    expect(context.questions).toHaveLength(24); expect(context.verification).toHaveLength(24)
    expect(context.truncated).toMatchObject({ questions: true, verification: true })
    expect(context.questions.every((q) => q.description.truncated)).toBe(true)
    expect(context.questions.some((q) => q.id === "0")).toBe(false)
    expect(JSON.stringify(context)).not.toContain("UNEXPORTED")
  })
  test("reaching the question scan bound labels its count as a lower bound", async () => {
    const { storage, runtime, question } = readableFixture("/tmp/no-io")
    for (let i = 0; i < 1001; i++) storage.values.set("oq/" + readableIds.workflow + "/q" + String(i).padStart(4, "0"), { ...question, id: "q" + i })
    const p = (await buildProjectSnapshot(storage, runtime, 1)).workflows[0]
    expect(p.openOqCount).toBe(1000)
    expect(p.context?.questionCountIsLowerBound).toBe(true)
    expect(p.context?.truncated.questions).toBe(true)
  })
  test("recognized secrets are removed before truncation and oversized summaries are omitted", () => {
    const text = dashboardText('"password": "fixture secret with spaces" token=fixture-token Authorization: Basic ZmFrZTpzZWNyZXQ= https://name:fixture-pass@example.test/path')
    expect(text.text).not.toContain("fixture secret")
    expect(text.text).not.toContain("fixture-token")
    expect(text.text).not.toContain("ZmFrZTpzZWNyZXQ=")
    expect(text.text).not.toContain("fixture-pass")
    expect(text.text).toContain("[REDACTED]")
    expect(dashboardText("-----BEGIN PRIVATE KEY-----\nFAKE KEY CONTENT\n-----END PRIVATE KEY-----").text).not.toContain("FAKE KEY CONTENT")
    expect(dashboardText("x".repeat(16001))).toMatchObject({ text: "Long description omitted. Inspect it in Loom.", truncated: true })
    expect(dashboardText("x".repeat(700)).text).toHaveLength(600)
  })
  test("workflow labels use exact objective generation and scope, not another work record", async () => {
    const { project, projectedWorkflow: w } = await projected()
    expect(labels.workflowLabel(project, w)).toBe("Build persistence layer")
    project.workObjectives[0].projection!.generation += 1
    project.workObjectives[0].projection!.title = "OTHER GENERATION"
    expect(labels.workflowLabel(project, w)).toBe("Build persistence without losing existing workflow history.")
    delete w.projection!.context; w.projection!.anchor = readableIds.workflow
    expect(labels.workflowLabel(project, w)).toBe("Unnamed workflow")
  })
  test("duplicate names remain distinct links with numbered labels, and opaque IDs are not names", async () => {
    const { project, projectedWorkflow: w } = await projected()
    const other = structuredClone(w); other.workflowId = "77777777-7777-4777-8777-777777777777"
    project.workflows.push(other)
    expect(labels.workflowLabel(project, w)).toBe("Build persistence layer · Run 1")
    expect(labels.workflowLabel(project, other)).toBe("Build persistence layer · Run 2")
    expect(labels.projectLabel({ projectId: readableIds.project })).toBe("Unnamed project")
    expect(labels.stepName({ id: readableIds.workflow, label: readableIds.workflow, agent: "worker", kind: "work" })).toBe("Implementation task")
  })
  test("stages and sessions use exact known meaning instead of splitting opaque identifiers", async () => {
    const { projectedWorkflow: w } = await projected()
    expect(labels.stageName(w.projection)).toBe("Build persistence layer")
    w.projection!.executionStage = "worker:" + readableIds.workflow
    expect(labels.stageName(w.projection)).toBe("Stage details unavailable")
    expect(labels.stepName({ id: "review-implementation", agent: "reviewer", kind: "gate" })).toBe("Review implementation")
    expect(labels.sessionName(w, readableIds.coordinator)).toBe("Coordinator session")
    expect(labels.sessionName(w, readableIds.participant)).toBe("Session 1")
    delete w.projection!.context
    expect(labels.sessionName(w, readableIds.participant)).toBe("Session 1")
    expect(labels.sessionName(w, "foreign-session")).toBe("Session details unavailable")
  })
  test("malformed or unsupported optional context is unavailable rather than trusted", async () => {
    const { projectedWorkflow: w } = await projected()
    expect(labels.contextFor(w.projection)?.version).toBe(1)
    for (const context of [undefined, { version: 99 }, { ...w.projection!.context, questions: [null] }]) {
      expect(labels.contextFor({ context })).toBeUndefined()
    }
  })
})
