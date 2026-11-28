import { expect, test } from "bun:test"
import { renderIncrementalLearningHTML, renderIncrementalLearningMarkdown } from "../src/incremental-learning-view.js"

const frontier = { ledger: 6, objectives: 0, objective_links: 0, review_requests: 0, review_relationships: 0 }
const fixture = () => ({ format: "loom-incremental-learning-progress/v1", session_id: "ordinary-session", state: "caught-up", observed: frontier, committed: frontier,
  inference: { state: "unavailable", reasons: ["Qualified execution authority is unavailable"] }, items: [{ batch: { id: "batch-2", state: "complete" },
    report: { id: "report-2", sha256: "a".repeat(64), availability: "available", body: { new_sources: 3, excluded_sources: 2, earlier_context_sources: 0,
      retained: { concerns: [{ excerpt: "Ethernet was not retested.", source: { id: "concern" }, origin: { batch_id: "batch-1", member_key: "source-original", source_index: 0 } }], unfinished: [] },
      previous: { batch_id: "batch-1", report_id: "report-1", sha256: "b".repeat(64) } } } }], navigation: { next: null } })

test("increment progress distinguishes idle catch-up from engineering completion and retains exact earlier sources", () => {
  const value = fixture(), html = renderIncrementalLearningHTML(value)
  expect(html).toContain("Processed through the observed boundary")
  expect(html).toContain("not proof that the Session")
  expect(html).toContain("Ethernet was not retested")
  expect(html).toContain("Earlier sources selected as context: 0. Carried concerns are retained separately")
  expect(html).toContain("learning-source")
  expect(html).toContain("batch-1")
  expect(html).toContain('id="learning-technical"')
  expect(html).not.toContain('id="learning-technical" open')
  expect(html).toContain("configured model does not grant execution authority")
  expect(renderIncrementalLearningMarkdown(value)).toContain(JSON.stringify(value, null, 2))
})

test("report empty unmatched work and hostile evidence do not imply completion or execute markup", () => {
  const body = fixture().items[0]!.report.body
  body.retained.concerns[0]!.excerpt = "<script>alert(1)</script>\n```json\nunsafe"
  const value = { format: "loom-incremental-learning-report-view/v1", body, section: "summary" }
  const html = renderIncrementalLearningHTML(value), markdown = renderIncrementalLearningMarkdown(value)
  expect(html).toContain("not a statement that all work or descendants have completed")
  expect(html).not.toContain("<script")
  expect(html).toContain("&lt;script&gt;")
  expect(markdown).toContain("````json")
  expect(html).toContain("default-src 'none'")
})

test("increment presentation enforces actual escaped response byte limits", () => {
  const value = fixture()
  value.items[0]!.report.body.retained.concerns[0]!.excerpt = "<&💡".repeat(40000)
  expect(() => renderIncrementalLearningHTML(value)).toThrow("page byte budget")
})

test("runtime progress body and bounded retained continuation render through supported requests", () => {
  const prior = fixture(), body = prior.items[0]!.report.body
  const value = { ...prior, items: [{ batch: { id: "batch-2", state: "complete" }, report: { ...body,
    retained: { ...body.retained, concern_count: 10, unfinished_count: 0,
      concerns_next: { operation: "learning-report", batch_id: "batch-2", section: "concerns", after: 8 } } } }],
    next: { operation: "learning-progress", before: 2, limit: 5 } }
  const html = renderIncrementalLearningHTML(value)
  expect(html).toContain("3 new eligible sources; 2 learning or otherwise excluded sources")
  expect(html).toContain("Ethernet was not retested")
  expect(html).toContain("Retained concern coverage: 1 shown of 10")
  expect(html).toContain("Continue retained concerns")
  expect(html).toContain("learning-progress")
  expect(html).not.toContain("no available published report")
})

test("model coordinator status exposes the authorized synthesis request and a separate pending boundary", () => {
  const value = { ...fixture(), inference: { state: "pending", reason: "New evidence is waiting for the configured resource window.",
    interpreted: { inspect: { operation: "evaluation-interpretation", batch_id: "interpretation-1" } },
    pending: { batch_id: "interpretation-2" }, qualifications: ["Idle is a processing opportunity, not completion."] } }
  const html = renderIncrementalLearningHTML(value)
  expect(html).toContain("Interpretation is pending")
  expect(html).toContain("New evidence is waiting for the configured resource window")
  expect(html).toContain("Read the current interpretation and its evidence")
  expect(html).toContain("evaluation-interpretation")
  expect(html).toContain("has not replaced the last successfully published interpretation")
})

test("saved increment order and unavailable inference have descriptive stable labels", () => {
  const initial = fixture()
  const value = { ...initial, inference: { state: "blocked", reason: "evaluator-execution-authority-unavailable" },
    items: [{ ...initial.items[0], batch: { ...initial.items[0]!.batch, revision: 7, created_at: "2026-11-28T10:00:00Z" } }] }
  const html = renderIncrementalLearningHTML(value)
  expect(html).toContain("Saved increment 7")
  expect(html).not.toContain("Saved increment 1")
  expect(html).toContain("Newest increments appear first")
  expect(html).toContain("Saved: 2026-11-28T10:00:00Z")
  expect(html).toContain("The host has no qualified authority to run an Evaluator")
})
