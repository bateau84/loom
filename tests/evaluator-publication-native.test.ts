import { expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EvaluatorExecution } from "../src/evaluator-execution.js"
import { evaluatorInterpretationID } from "../src/evaluator-publication.js"
import { digest } from "../src/model.js"
import { ACTOR, NOW, openState, pins } from "./helpers/evaluator-execution-fixture.js"
import { publicationFixture } from "./helpers/evaluator-publication-fixture.js"

function setup(members = 3) {
  const root = mkdtempSync(join(tmpdir(), "loom-publication-")), state = openState(join(root, "state"))
  const fixture = publicationFixture(state, ACTOR, { members, authorityPath: join(root, "authority.sqlite") })
  return { ...fixture, async close() { fixture.close(); state.close(); rmSync(root, { recursive: true, force: true }) } }
}

test("more than 500 frozen anchors publish and exhaust through actual execution-consumer readback", async () => {
  const f = setup(517)
  try {
    await f.execute()
    const report = await f.publish(), reader = f.reader()
    let input: Record<string, unknown> = { operation: "evaluation-interpretation", batch_id: report.batch_id, section: "sources", limit: 37 }
    let count = 0, pageCount = 0
    const keys = new Set<string>()
    for (;;) {
      const page = await reader.read(ACTOR, input) as any
      expect(page.report_id).toBe(report.report_id)
      expect(page.coverage.from).toBe(count)
      for (const source of page.items) { expect(keys.has(source.member_key)).toBe(false); keys.add(source.member_key) }
      count += page.items.length; pageCount++
      if (!page.navigation.next) break
      input = page.navigation.next
      expect(pageCount).toBeLessThan(100)
    }
    expect(count).toBe(517); expect(pageCount).toBeGreaterThan(1)
    const rows = f.state.derived.query("SELECT COUNT(*) AS n FROM learning_evaluation_dependencies").get() as { n: number }
    // The whole union is stored once; each internal member completion points
    // to its parent and its own original. It cannot be read independently.
    expect(rows.n).toBe(517 * 2)
    expect(() => f.state.learning.automatic.history.report(report.batch_id, ACTOR.session_id)).toThrow("authorized Evaluator interpretation reader")
    expect(f.base.counts()).toEqual({ reservations: 1, consumed: 1, execute_calls: 1, effects: 1 })
  } finally { await f.close() }
}, 60000)

test("checkpoint interruption rolls back the complete publication and replay performs no inference", async () => {
  const f = setup()
  try {
    await f.execute()
    f.state.derived.exec("CREATE TRIGGER stop_publication BEFORE INSERT ON learning_evaluation_reports WHEN NEW.member_key IS NOT NULL BEGIN SELECT RAISE(ABORT,'checkpoint interrupted'); END")
    await expect(f.publish()).rejects.toThrow("checkpoint interrupted")
    expect(f.state.derived.query("SELECT COUNT(*) AS n FROM learning_evaluation_reports").get()).toEqual({ n: 0 })
    expect(f.state.learning.automatic.history.readExecution(f.prepared.batch_id, ACTOR.session_id)!.receipts.at(-1)!.budget).toBe("settled")
    f.state.derived.exec("DROP TRIGGER stop_publication")
    const published = await f.publish()
    expect((await f.publish()).report_id).toBe(published.report_id)
    expect(f.base.counts().effects).toBe(1)
  } finally { await f.close() }
})

test("a lost publication commit acknowledgement recovers the original report identity", async () => {
  const f = setup()
  try {
    const completed = await f.execute()
    const expected = evaluatorInterpretationID({ subject: completed.admission.grant.subject, admission_sha256: digest(completed.admission),
      method_sha256: digest(completed.admission.grant.method), result: completed.receipt.result! })
    const exec = f.state.derived.exec.bind(f.state.derived)
    let lost = false
    const spy = spyOn(f.state.derived, "exec").mockImplementation(sql => {
      const result = exec(sql)
      if (sql === "COMMIT" && !lost && (f.state.derived.query("SELECT COUNT(*) AS n FROM learning_evaluation_reports").get() as { n: number }).n) {
        lost = true; throw new Error("Lost publication commit ACK")
      }
      return result
    })
    try { await expect(f.publish()).rejects.toThrow("Lost publication commit ACK") }
    finally { spy.mockRestore() }
    expect(lost).toBe(true)
    expect((await f.publish()).report_id).toBe(expected)
    expect(f.base.counts().effects).toBe(1)
  } finally { await f.close() }
})

test("source revocation during the last caller authorization cannot publish or disclose the report identity", async () => {
  const f = setup()
  try {
    await f.execute()
    let callerChecks = 0, denySources = false
    const runtime = new EvaluatorExecution(f.state.learning.evaluator, f.state.learning.automatic.history, f.state.store, {
      authority: f.authority,
      authorize: async () => { if (++callerChecks === 4) denySources = true },
      retrospective: { populations: f.state.learning.populations, resolve: f.resolve,
        authorize: async () => { if (denySources) throw new Error("Source authority revoked during caller check") } },
    }, () => NOW)
    await expect(runtime.publish(ACTOR, pins(f.prepared))).rejects.toThrow("Source authority revoked during caller check")
    expect(callerChecks).toBe(4)
    expect(f.state.learning.automatic.history.readEvaluatorInterpretation(f.prepared.batch_id, ACTOR.session_id)).toBeNull()
    expect(f.base.counts().effects).toBe(1)
  } finally { await f.close() }
})
