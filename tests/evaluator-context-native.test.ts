import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { canonical, digest, type Actor } from "../src/model.js"
import { EvaluatorExecution } from "../src/evaluator-execution.js"
import type { EvaluationSourceRef } from "../src/evaluation-store.js"
import type { EvaluatorRetrievedContext, EvaluatorSourceReader } from "../src/evaluator-execution-contract.js"
import { parseEvaluatorInterpretation } from "../src/evaluator-interpretation.js"
import type { RetrospectiveSourceRequest } from "../src/retrospective-populations.js"
import { ACTOR, NOW, openState, pins, freshSignal } from "./helpers/evaluator-execution-fixture.js"
import { publicationFixture } from "./helpers/evaluator-publication-fixture.js"

function setup() {
  const root = mkdtempSync(join(tmpdir(), "loom-context-")), state = openState(join(root, "state"))
  const fixtures: ReturnType<typeof publicationFixture>[] = [], calls: RetrospectiveSourceRequest[] = []
  let selectedRead: (() => void) | undefined
  const create = (name: string, count = 1, session = ACTOR.session_id, existing?: EvaluationSourceRef[]) => {
    const refs = existing ?? Array.from({ length: count }, (_, index) => {
      const original = state.store.record({ session_id: session, agent: "engineer" }, undefined,
        { kind: "result", statement: `${name}: engineering evidence ${index}; distinguish observation from causal interpretation.` })
      return state.learning.automatic.sources.retrospectiveOriginal("ledger-record", original.id, session, ACTOR.session_id)!.ref
    })
    const subject = state.learning.automatic.subjects.establish(ACTOR, { target: { kind: "session", id: session },
      question: "What changed, which earlier findings remain useful, and what remains unresolved?" })
    const manifest = state.learning.populations.fromSources(subject, refs)
    const f = publicationFixture(state, ACTOR, { manifest, claims: 1, authorityPath: join(root, `authority-${fixtures.length}.sqlite`),
      resolve: async request => {
        calls.push(request); selectedRead?.()
        const ref = request.source
        const original = state.learning.automatic.sources.retrospectiveOriginal(ref.kind, ref.id, ref.session_id!, request.recipient_session_id)
        return original ? { ...request, source: original.ref, status: "available", value: original.value } : { ...request, status: "missing" }
      } })
    fixtures.push(f)
    return f
  }
  return { root, state, calls, create, onSource(callback?: () => void) { selectedRead = callback },
    close() { for (const fixture of fixtures) fixture.close(); state.close(); rmSync(root, { recursive: true, force: true }) } }
}
type Fixture = ReturnType<ReturnType<typeof setup>["create"]>
type Published = Awaited<ReturnType<Fixture["publish"]>>

/** The synthetic native owner observes returned tool material and persists its
 * delivery receipts separately from Loom. It performs no real inference. */
function observeContext(fixture: Fixture, receive: (read: EvaluatorSourceReader,
  record: (receipt: Omit<Extract<EvaluatorRetrievedContext, { kind: "prior-interpretation" }>, "receipt_id" | "boundary">
    | Omit<Extract<EvaluatorRetrievedContext, { kind: "prior-original" }>, "receipt_id" | "boundary">) => void) => Promise<void>) {
  fixture.base.db.exec("CREATE TABLE fixture_context(admission_sha256 TEXT PRIMARY KEY, receipts TEXT NOT NULL)")
  const execute = fixture.authority.execute.bind(fixture.authority), readResult = fixture.authority.readResult!.bind(fixture.authority)
  fixture.authority.execute = async (admission, source, signal) => {
    const receipts: EvaluatorRetrievedContext[] = []
    const read = Object.assign(async (memberKey: string, sourceIndex: number) => {
      await receive(source, value => receipts.push({ ...value, receipt_id: `context-${receipts.length + 1}`, boundary: "native-tool-result" }))
      fixture.base.db.query("INSERT INTO fixture_context VALUES(?,?)").run(digest(admission), canonical(receipts))
      return source(memberKey, sourceIndex)
    }, { interpretations: source.interpretations })
    return execute(admission, read, signal)
  }
  fixture.authority.readResult = async (admission, receipt) => {
    const result = await readResult(admission, receipt)
    const saved = fixture.base.db.query("SELECT receipts FROM fixture_context WHERE admission_sha256=?").get(digest(admission)) as { receipts: string } | undefined
    return { ...result, context_retrieved: saved ? JSON.parse(saved.receipts) : [] }
  }
}
function link(fixture: Fixture, report: Published) {
  fixture.interpretation.prior_interpretations.push({ report_id: report.report_id, report_sha256: report.report_sha256,
    relation: "context", reason: "Retain the earlier finding while interpreting this new increment." })
}

test("admitted fresh Evaluator synthesizes reports and selectively retrieves earlier originals without inventing current membership", async () => {
  const f = setup()
  try {
    const prior = f.create("Earlier investigation", 3)
    await prior.execute(); const older = await prior.publish()
    const oldBytes = f.state.derived.query("SELECT body_json FROM learning_evaluation_reports WHERE id=?").get(older.report_id)
    const unrelated = f.create("Different Session goal", 1, "other-session")
    await unrelated.execute(); await unrelated.publish()
    const next = f.create("Later correction"), oldMember = prior.population.manifest.members[0]!
    link(next, older)
    const reference = { kind: "prior-original" as const, report_id: older.report_id, report_sha256: older.report_sha256,
      member_key: oldMember.key, source_index: 0 as const }
    next.interpretation.trajectory[0]!.members = []
    next.interpretation.trajectory[0]!.supporting = [reference]
    next.interpretation.claims[0]!.contradicting = [reference]
    let selectiveReads = 0, bytes = 0, recipient = ""
    observeContext(next, async (read, record) => {
      const list = await read.interpretations.list({ limit: 5 }) as any
      expect(list.items.map((item: any) => item.report_id)).toEqual([older.report_id])
      for (const item of list.items) record({ kind: "prior-interpretation", report_id: item.report_id, report_sha256: item.report_sha256 })
      const report = await read.interpretations.read({ report_id: older.report_id, report_sha256: older.report_sha256, section: "claims" }) as any
      expect(report.items[0].statement).toContain("Preserve the stated verification scope")
      record({ kind: "prior-interpretation", report_id: older.report_id, report_sha256: older.report_sha256 })
      const before = f.calls.length
      const { kind: _kind, ...selection } = reference
      const original = await read.interpretations.source(selection) as any
      selectiveReads = f.calls.length - before
      recipient = original.receiving_session
      expect(original.value.data.statement).toContain("Earlier investigation")
      expect(f.calls.at(-1)).toMatchObject({ recipient_session_id: recipient, purpose: "execute", source: oldMember.source })
      record({ ...reference, source_sha256: original.source.sha256 })
      bytes = Buffer.byteLength(JSON.stringify({ list, report, original }), "utf8")
    })
    await next.execute(); const published = await next.publish()
    expect(selectiveReads).toBe(1)
    expect(recipient).not.toBe(ACTOR.session_id)
    expect(bytes).toBeLessThan(50000)
    expect(f.state.learning.automatic.history.get(older.batch_id, ACTOR.session_id).state).toBe("complete")
    expect(f.state.derived.query("SELECT COUNT(*) AS n FROM learning_evaluation_invalidations WHERE batch_id=?").get(older.batch_id)).toEqual({ n: 0 })
    expect(f.state.derived.query("SELECT body_json FROM learning_evaluation_reports WHERE id=?").get(older.report_id)).toEqual(oldBytes)
    const record = f.state.learning.automatic.history.readEvaluatorInterpretation(published.batch_id, ACTOR.session_id)!
    expect(record.report.source_refs).toHaveLength(prior.population.manifest.members.length + next.population.manifest.members.length)
    expect(record.population.manifest.members.some(member => member.key === oldMember.key)).toBe(false)
    expect(record.report.body.context_retrieved).toHaveLength(3)
    const page = await next.reader().read(ACTOR, { operation: "evaluation-interpretation", batch_id: published.batch_id, section: "sources" }) as any
    const previous = page.items.find((item: any) => item.report_id === older.report_id)
    expect(previous).toMatchObject({ selected: false, retrieved: true, cited: true })
    const exact = await next.reader().read(ACTOR, previous.inspect) as any
    expect(exact.native_evaluator_retrieval).toBe("not-established")
    expect(exact.value.data.statement).toContain("Earlier investigation")
    expect(await next.publish()).toEqual(published)
    expect(next.base.counts().effects).toBe(1)
  } finally { f.close() }
})

test("uncited report-list delivery must appear as an explicit final dependency", async () => {
  const f = setup()
  try {
    const prior = f.create("Earlier finding")
    await prior.execute(); const older = await prior.publish()
    const next = f.create("Next increment")
    observeContext(next, async (read, record) => {
      const list = await read.interpretations.list() as any
      expect(list.items[0].report_id).toBe(older.report_id)
      record({ kind: "prior-interpretation", report_id: older.report_id, report_sha256: older.report_sha256 })
    })
    await next.execute()
    await expect(next.publish()).rejects.toThrow("Every delivered context")
    expect(f.state.learning.automatic.history.readEvaluatorInterpretation(next.prepared.batch_id, ACTOR.session_id)).toBeNull()
    // The completed owner result and accounting survive a rejected publication.
    expect(next.base.counts().effects).toBe(1)
  } finally { f.close() }
})

test("prior-original receipts reject fabricated hashes and inherited members of a differently named report", async () => {
  const f = setup()
  try {
    const first = f.create("First evidence")
    await first.execute(); const earliest = await first.publish()
    const second = f.create("Second evidence"); link(second, earliest)
    await second.execute(); const middle = await second.publish()
    const next = f.create("Current evidence"), earlierMember = first.population.manifest.members[0]!
    link(next, middle)
    observeContext(next, async (read, record) => {
      const before = f.calls.length
      await expect(read.interpretations.source({ report_id: middle.report_id, report_sha256: middle.report_sha256,
        member_key: earlierMember.key, source_index: 0 })).rejects.toThrow("own frozen population")
      expect(f.calls.length).toBe(before)
      const member = second.population.manifest.members[0]!
      await read.interpretations.source({ report_id: middle.report_id, report_sha256: middle.report_sha256, member_key: member.key, source_index: 0 })
      record({ kind: "prior-original", report_id: middle.report_id, report_sha256: middle.report_sha256,
        member_key: member.key, source_index: 0, source_sha256: "f".repeat(64) })
    })
    await next.execute()
    await expect(next.publish()).rejects.toThrow("own frozen available original")
  } finally { f.close() }
})

test("actual recipient union revocation after an earlier original read withholds the returned tool material", async () => {
  const f = setup()
  try {
    const prior = f.create("Prior protected evidence")
    await prior.execute(); const older = await prior.publish()
    const next = f.create("Current protected evidence"), original = prior.population.manifest.members[0]!
    let denied = false, returned = false
    const recipients: Actor[] = []
    const sourceResolve = next.resolve
    const runtime = new EvaluatorExecution(f.state.learning.evaluator, f.state.learning.automatic.history, f.state.store, {
      authority: next.authority, authorize: next.authorize, retrospective: { populations: f.state.learning.populations,
        authorize: async recipient => { recipients.push(recipient); if (denied) throw new Error("Current context union denied") },
        authorizeUnion: async recipient => { recipients.push(recipient); if (denied) throw new Error("Current context union denied") },
        resolve: async request => {
          const result = await sourceResolve(request)
          if (request.source.id === original.source.id && request.purpose === "execute") denied = true
          return result
        } } }, () => NOW)
    observeContext(next, async read => {
      await read.interpretations.source({ report_id: older.report_id, report_sha256: older.report_sha256, member_key: original.key, source_index: 0 })
      returned = true
    })
    await expect(runtime.execute(ACTOR, pins(next.prepared), freshSignal())).rejects.toThrow("Current context union denied")
    expect(returned).toBe(false)
    expect(recipients.some(actor => actor.session_id.startsWith("ses_fixture_") && actor.agent === "evaluator")).toBe(true)
    expect(next.base.counts().effects).toBe(0)
  } finally { f.close() }
})

test("exact typed subject and all owner frontiers gate previous context, and citation variants cannot impersonate current members", async () => {
  const f = setup()
  try {
    const foreign = f.create("Separate Session", 1, "other-session")
    await foreign.execute(); const other = await foreign.publish()
    const next = f.create("Original Session")
    // A later authored association advances independent owners while the ledger
    // frontier stays exactly equal. It cannot enter the earlier interpretation.
    const original = next.population.manifest.members[0]!.source
    f.state.learning.objectives.create(ACTOR, f.state.learning.objectives.ledgerSource(original.id), "Later explicit association")
    const future = f.create("Same ledger with later owner state", 0, ACTOR.session_id, [original])
    await future.execute(); const later = await future.publish()
    observeContext(next, async read => {
      const before = f.calls.length
      await expect(read.interpretations.read({ report_id: other.report_id, report_sha256: other.report_sha256 })).rejects.toThrow("scope or frontier")
      expect(f.calls.length).toBe(before)
      await expect(read.interpretations.read({ report_id: later.report_id, report_sha256: later.report_sha256 })).rejects.toThrow("scope or frontier")
      expect(f.calls.length).toBe(before)
      const eligible = await read.interpretations.list({ limit: 5 }) as any
      expect(eligible.items).toEqual([])
      await expect(read.interpretations.list({ limit: 32 })).rejects.toThrow("page limit")
    })
    await next.execute()
    const raw = structuredClone(next.interpretation)
    raw.claims[0]!.supporting = [{ kind: "prior-original", report_id: other.report_id, report_sha256: other.report_sha256,
      member_key: foreign.population.manifest.members[0]!.key, source_index: 0 }]
    expect(() => parseEvaluatorInterpretation(raw, next.population, next.retrieved)).toThrow("exact trusted context retrieval")
    const current = next.population.manifest.selection
    expect(current.mode).toBe("explicit-subject")
    expect(next.prepared.manifest).toMatchObject({ objective_count: null, target: { kind: "session", id: ACTOR.session_id }, target_count: 1 })
  } finally { f.close() }
})
