import { describe, expect, test } from "bun:test"
import { aggregateFleet, buildProjectSnapshot, type ProjectSnapshotV1 } from "../plugins/loom/dashboard"
import { dashboardText } from "../plugins/loom/dashboard-context"
import { dashboardReadability } from "./readability"
import { reviewFixture, authorizationSamples } from "./review-fixture"

const labels = new Function("resolved", "arr", dashboardReadability + ";return {workflowLabel};")(
  (w: any) => w.consistency === "ok" ? w.projection : undefined,
  (v: unknown) => Array.isArray(v) ? v : [],
)
const record = (snapshot: ProjectSnapshotV1) => ({ snapshot, manifest: {
  schemaVersion: 1 as const, installationId: snapshot.installationId, instanceId: snapshot.instanceId,
  startedAt: snapshot.generatedAt, generatedAt: snapshot.generatedAt, leaseExpiresAt: snapshot.leaseExpiresAt,
  projects: [snapshot.projectId],
} })
async function snapshot(mode = "normal", index = 0) {
  const f = reviewFixture("/tmp/loom-review-unit-no-io", mode, index)
  return buildProjectSnapshot(f.storage, f.runtime, 1, f.options)
}

describe("review regression boundaries", () => {
  test("R1: real scoped projection selects a wave inside its phase, even when wave IDs repeat", async () => {
    const project = aggregateFleet([record(await snapshot("waves"))]).projects[0]
    const w = project.workflows[0]
    expect(w.projection?.workScope).toMatchObject({ phaseId: "delivery", waveId: "build", taskIds: ["package-cli", "package-ui"] })
    expect(labels.workflowLabel(project, w)).toBe("Build release package")
    project.workObjectives[0].projection!.phases.reverse()
    expect(labels.workflowLabel(project, w)).toBe("Build release package")
  })

  test("R1: missing or inconsistent scope cannot borrow another phase, wave, or partial task title", async () => {
    for (const change of [
      (s: any) => { delete s.phaseId },
      (s: any) => { s.phaseId = "unknown" },
      (s: any) => { s.waveId = "unknown" },
      (s: any) => { s.phaseId = "foundation" },
      (s: any) => { s.taskIds = ["package-cli", "missing-task"] },
      (s: any) => { s.generation += 1 },
    ]) {
      const project = aggregateFleet([record(await snapshot("waves"))]).projects[0]
      const w = project.workflows[0]
      change(w.projection!.workScope)
      expect(labels.workflowLabel(project, w)).toBe("Build persistence without losing existing workflow history.")
    }
  })

  test("C1: quoted, escaped, YAML and nested Authorization forms are redacted across all four producer channels", async () => {
    for (let index = 0; index < authorizationSamples.length; index++) {
      const s = await snapshot("secret", index)
      const c = s.workflows[0].context!
      const fields = [c.request, c.questions[0].description, c.verification[0].description, c.steps[0].reportedResult]
      expect(fields).toHaveLength(4)
      for (const field of fields) {
        expect(field?.text).toContain("[REDACTED]")
        expect(field?.text).not.toContain("REVIEW_SENTINEL")
        expect(field?.text).not.toContain("SECRET_TAIL")
      }
      expect(JSON.stringify(s)).not.toContain("REVIEW_SENTINEL")
      expect(JSON.stringify(s)).not.toContain("SECRET_TAIL")
    }
  })

  test("C1: bounded nested decoding cannot leak the encoded tail or corrupt ordinary explanations", () => {
    let value = JSON.stringify({ Authorization: "Bearer REVIEW_SENTINEL" })
    for (let depth = 0; depth < 8; depth++) {
      value = JSON.stringify(value)
      expect(dashboardText("Recorded headers: " + value).text).not.toContain("REVIEW_SENTINEL")
    }
    for (const value of [
      "Authorization policy: use the standard flow.",
      '{"message":"ordinary description", "policy":"authorization decisions"}',
      "'Authorization' describes a header name, not a credential assignment.",
    ]) expect(dashboardText(value).text).toBe(value)
  })

  test("C1: scanning and preview size stay bounded for long escaped or unterminated input", () => {
    const value = '{"Authorization":"Bearer ' + "\\\\".repeat(7900) + 'REVIEW_SENTINEL'
    const result = dashboardText(value)
    expect(result.text).not.toContain("REVIEW_SENTINEL")
    expect(Array.from(result.text).length).toBeLessThanOrEqual(600)
    expect(dashboardText("x".repeat(16001))).toMatchObject({ truncated: true, text: "Long description omitted. Inspect it in Loom." })
    expect(dashboardText("🧪".repeat(601))).toMatchObject({ truncated: true, text: "🧪".repeat(600) })
  })

  test("C2: real retention limits survive aggregation without claiming the union fills the omissions", async () => {
    const limited = await snapshot("history")
    expect(limited.projectionWindow).toEqual({ workflowsTruncated: true, completedObjectivesTruncated: true })
    const complete = await snapshot()
    complete.instanceId = "other-publisher"
    // No workflow-field disagreement is needed to test project-level coverage.
    complete.workflows = []; complete.workObjectives = []
    for (const records of [[record(limited)], [record(limited), record(complete)], [record(complete), record(limited)]]) {
      expect(aggregateFleet(records).projects[0].projectionWindow).toEqual(limited.projectionWindow)
    }
  })

  test("C2: false requires every source to explicitly report false; missing or malformed markers remain unknown", async () => {
    const explicit = await snapshot()
    expect(aggregateFleet([record(explicit)]).projects[0].projectionWindow).toEqual({ workflowsTruncated: false, completedObjectivesTruncated: false })
    const legacy = structuredClone(explicit)
    legacy.instanceId = "legacy"
    delete (legacy as Partial<ProjectSnapshotV1>).projectionWindow
    expect(aggregateFleet([record(explicit), record(legacy)]).projects[0].projectionWindow).toEqual({})
    legacy.projectionWindow = { workflowsTruncated: true, completedObjectivesTruncated: undefined as unknown as boolean }
    expect(aggregateFleet([record(explicit), record(legacy)]).projects[0].projectionWindow).toEqual({ workflowsTruncated: true })
    legacy.projectionWindow = { workflowsTruncated: "false" as unknown as boolean, completedObjectivesTruncated: false }
    expect(aggregateFleet([record(explicit), record(legacy)]).projects[0].projectionWindow).toEqual({ completedObjectivesTruncated: false })
    const limited = await snapshot("history")
    limited.leaseExpiresAt = "2000-01-01T00:00:00.000Z"
    expect(aggregateFleet([record(limited), record(legacy)]).projects[0].projectionWindow?.workflowsTruncated).toBe(true)
  })
})
