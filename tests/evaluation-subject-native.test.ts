import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { canonical, digest, type Actor } from "../src/model.js"
import { Store } from "../src/store.js"
import { Learning } from "../src/learning.js"
import { EMPTY_LEARNING_FRONTIER } from "../src/learning-sources.js"
import { EvaluationSubjects, type EvaluationSubject, type EvaluationTarget } from "../src/evaluation-subject.js"
import { compatibleRetrospectiveContext, parseRetrospectiveManifest, retrospectiveDigest } from "../src/retrospective-contract.js"
import { subjectSelection, type RetrospectiveHistory, type RetrospectiveSourceResolver } from "../src/retrospective-populations.js"
import type { EngineeringHistoryQuery } from "../src/engineering-history.js"

function fixture() {
  const action = new Database(":memory:"), derived = new Database(":memory:"), store = new Store(action), learning = new Learning(derived, store, action)
  const actor: Actor = { session_id: "reader", agent: "investigator" }, engineer: Actor = { session_id: "work", agent: "evaluator" }
  const source = learning.automatic.sources, subjects = learning.automatic.subjects
  const resolver: RetrospectiveSourceResolver = async request => {
    const ref = request.source
    const original = ref.session_id ? source.retrospectiveOriginal(ref.kind, ref.id, ref.session_id, request.recipient_session_id) : null
    return { ...request, ...(original ? { status: "available" as const, source: original.ref, value: original.value } : { status: "missing" as const }) }
  }
  const record = (statement: string, session = engineer.session_id) => store.record({ session_id: session, agent: "evaluator" }, undefined,
    { kind: "result", statement, evidence_ids: [], artifact_refs: [] })
  const history = (target: EvaluationTarget, subject?: EvaluationSubject): RetrospectiveHistory => {
    const frontier = subject?.through ?? source.targetFrontier(target)
    const scope = target.kind === "session" ? { session_id: target.id } : target.kind === "action" ? { action_id: target.id } : { objective_id: target.id }
    const query: EngineeringHistoryQuery = { ...scope, through: frontier.ledger, limit: 20,
      owner_boundary: { objective_links: frontier.objective_links, review_requests: frontier.review_requests, review_relationships: frontier.review_relationships } }
    const objectives = learning.objectives.historySnapshot({ ...scope, ledger_through: query.through, link_through: frontier.objective_links })
    const record_ids = target.kind === "objective" ? store.engineeringHistory.objectiveEvidenceSources(objectives.ledger_record_ids, frontier.ledger) : undefined
    const reviews = store.reviews.historySnapshot(actor, { ...scope, through: query.through, request_through: frontier.review_requests,
      relationship_through: frontier.review_relationships, ...(record_ids ? { record_ids } : {}) })
    const owners = { objectives, reviews, record_ids, boundary: query.owner_boundary!, version: digest({ objectives: objectives.content_digest, reviews: reviews.content_digest }) }
    query.owner_version = owners.version
    return { query, owners, view: store.engineeringHistory.read(query, owners), contributors: store.engineeringHistory.authorizationSessions(query, record_ids),
      ...(target.kind === "objective" ? { associations: learning.objectives.retrospectiveSources(target.id, frontier.objective_links) } : {}) }
  }
  return { action, derived, store, learning, source, subjects, actor, engineer, resolver, record, history,
    close() { derived.close(); action.close() } }
}

test("ordinary Session preview reads every source without creating an Action, Plan, objective or subject", async () => {
  const f = fixture()
  try {
    const expected = Array.from({ length: 73 }, (_, index) => f.record(`Engineering step ${index}`))
    const target: EvaluationTarget = { kind: "session", id: "work" }
    const before = f.derived.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
    const proposal = f.subjects.propose(f.actor, { target, question: "Explain the recorded engineering work." })
    const history = f.history(target)
    expect(history.view.mode).toBe("overview")
    expect(history.view.records).toHaveLength(0)
    const manifest = await f.learning.populations.preview(f.actor, { mode: "explicit-subject", target, question: proposal.question,
      frontier: proposal.through, cutoff: proposal.cutoff, exclusions: [] }, history, f.resolver)
    expect(manifest.format).toBe("loom-retrospective-population/v2")
    expect(manifest.members.map(member => member.source.id).sort()).toEqual(expected.map(record => record.id).sort())
    expect(manifest.selection).not.toHaveProperty("objective_id")
    expect(manifest.coverage.objective_count).toBeNull()
    const page = await f.learning.populations.page(f.actor, manifest, f.resolver, { limit: 5 })
    expect(page.freeze).toBeNull()
    expect(page).toHaveProperty("establish.operation", "establish-subject")
    expect(page.items[0]!.inspect?.operation).toBe("preview-source")
    expect(f.derived.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()).toEqual(before)
    expect(f.action.prepare("SELECT COUNT(*) AS n FROM actions").get()).toEqual({ n: 0 })
    expect(f.action.prepare("SELECT COUNT(*) AS n FROM plans").get()).toEqual({ n: 0 })
    expect(f.derived.prepare("SELECT COUNT(*) AS n FROM learning_objectives").get()).toEqual({ n: 0 })
  } finally { f.close() }
})

test("established subject excludes concurrent appends and distinguishes recorded completion from a point cutoff", async () => {
  const f = fixture()
  try {
    const original = f.record("Original investigation")
    const completion = f.store.append({ session_id: "work", agent: "engineer", kind: "completion", data: { statement: "Reported scoped completion" } })
    f.record("Later resumed investigation")
    const target: EvaluationTarget = { kind: "session", id: "work" }
    const completed = f.subjects.establish(f.actor, { target, question: "Assess the reported completion", cutoff: { kind: "recorded-completion", record_id: completion.id } })
    const point = f.subjects.establish(f.actor, { target, question: "Assess ongoing work" })
    expect(completed.cutoff.kind).toBe("recorded-completion")
    expect(point.cutoff.kind).toBe("point-in-time")
    expect(point.through.ledger).toBeGreaterThan(completed.through.ledger)
    const frozenBody = canonical(completed)
    const late = f.record("Concurrent append after establishment")
    const history = f.history(target, completed), selection = subjectSelection(completed, history.owners.version)
    const manifest = await f.learning.populations.preview(f.actor, selection, history, f.resolver)
    const frozen = f.learning.automatic.history.freezeRetrospective(f.actor, manifest)
    expect(frozen.manifest.members.map(member => member.source.id).sort()).toEqual([original.id, completion.id].sort())
    expect(frozen.manifest.members.some(member => member.source.id === late.id)).toBe(false)
    expect(canonical(f.subjects.read(completed.subject_id, "reader", completed.sha256))).toBe(frozenBody)
    expect(() => f.subjects.establish(f.actor, { target, question: "Fake completion", cutoff: { kind: "recorded-completion", record_id: original.id } })).toThrow("completion")
    expect(() => f.subjects.read(completed.subject_id, "another-reader")).toThrow("unavailable")
  } finally { f.close() }
})

test("learning purpose is bound to the exact call, while role names and sibling calls remain engineering evidence", () => {
  const f = fixture()
  try {
    const call = { session_id: "work", message_id: "shared-message", call_id: "retrieval" }
    const wrapper = f.store.observe(f.engineer, undefined, { phase: "started", message_id: call.message_id, call_id: call.call_id, tool: "codemode" })
    const sibling = f.store.observe(f.engineer, undefined, { phase: "finished", message_id: call.message_id, call_id: "engineering", status: "error", tool: "shell" })
    const before = f.source.snapshot("work")
    expect(before.members.flatMap(member => member.source_refs).map(ref => ref.id)).toEqual([wrapper.id, sibling.id])
    const subject = f.subjects.establish(f.engineer, { target: { kind: "session", id: "work" }, question: "Evaluate the engineering attempt" }, call)
    const refs = before.members.flatMap(member => member.source_refs)
    expect(f.source.isEvaluation(refs[0]!)).toBe(true)
    expect(f.source.isEvaluation(refs[1]!)).toBe(false)
    const ledgerCount = f.action.prepare("SELECT COUNT(*) AS n FROM ledger").get()
    f.subjects.recordActivity({ subject_id: subject.subject_id, actor: f.engineer, invocation: call,
      phase: "evidence-retrieval", outcome: "failed", returned_bytes: 0, elapsed_ms: 21, detail: "Supported source denied" })
    expect(f.subjects.activities(subject.subject_id, "work").items[0]).toMatchObject({ outcome: "failed", returned_bytes: 0, elapsed_ms: 21 })
    expect(f.action.prepare("SELECT COUNT(*) AS n FROM ledger").get()).toEqual(ledgerCount)
    expect(f.source.snapshot("work").members.flatMap(member => member.source_refs).map(ref => ref.id)).toEqual([sibling.id])
    expect(f.source.isEvaluationSession("work")).toBe(false)
  } finally { f.close() }
})

test("late wrapper classification withholds affected current reports without rewriting persisted evidence", async () => {
  const f = fixture()
  try {
    const wrapper = f.store.observe(f.engineer, undefined, { phase: "started", message_id: "m", call_id: "c", tool: "codemode" })
    const result = await f.learning.automatic.run("work", async () => {}, new AbortController().signal)
    const before = f.derived.prepare("SELECT body_json FROM learning_evaluation_reports ORDER BY id").all()
    const membership = f.derived.prepare("SELECT source_refs FROM learning_evaluation_members ORDER BY ordinal").all()
    expect(f.learning.automatic.history.report(result.batch_id!, "work")!.availability).toBe("available")
    f.subjects.recordActivity({ actor: f.engineer, invocation: { session_id: "work", message_id: "m", call_id: "c" }, phase: "evidence-retrieval", outcome: "failed" })
    expect(f.learning.automatic.history.report(result.batch_id!, "work")).toMatchObject({ availability: "source-unavailable", body: null })
    expect(f.derived.prepare("SELECT body_json FROM learning_evaluation_reports ORDER BY id").all()).toEqual(before)
    expect(f.derived.prepare("SELECT source_refs FROM learning_evaluation_members ORDER BY ordinal").all()).toEqual(membership)
    expect(f.source.snapshot("work").members.flatMap(member => member.source_refs).some(ref => ref.id === wrapper.id)).toBe(false)
  } finally { f.close() }
})

test("verified learning descendants and their descendants are excluded without role-name classification", () => {
  const f = fixture()
  try {
    const parent = { session_id: "work", message_id: "dispatch-message", call_id: "dispatch-call" }
    f.subjects.recordActivity({ actor: f.engineer, invocation: parent, phase: "research", outcome: "started" })
    f.subjects.registerDescendant({ parent, child_session_id: "worker-child", native_parent_session_id: "work" })
    f.subjects.registerSessionDescendant({ child_session_id: "worker-grandchild", native_parent_session_id: "worker-child" })
    f.record("Researcher failed retrieval", "worker-child")
    f.record("Researcher retry failed", "worker-grandchild")
    f.record("Independent ordinary work", "unrelated")
    expect(f.source.snapshot("worker-child").members).toHaveLength(0)
    expect(f.source.snapshot("worker-grandchild").members).toHaveLength(0)
    expect(f.source.snapshot("unrelated").members).toHaveLength(1)
    expect(() => f.subjects.registerSessionDescendant({ child_session_id: "invented", native_parent_session_id: "unrelated" })).toThrow("unestablished")
    expect(() => f.subjects.registerDescendant({ parent, child_session_id: "wrong-parent", native_parent_session_id: "unrelated" })).toThrow("unestablished")
  } finally { f.close() }
})

test("bounded increments retain exact source identity, advance exclusions and do not rescan older history", () => {
  const f = fixture()
  try {
    for (let i = 0; i < 25; i++) f.record(`Source ${i}`)
    const upper = f.source.captureFrontier("work"), first = f.source.selectIncrement("work", EMPTY_LEARNING_FRONTIER, upper, 10)
    expect(first.eligible).toBe(10); expect(first.examined).toBe(10); expect(first.more).toBe(true)
    const late = f.record("Concurrent later source")
    const second = f.source.selectIncrement("work", first.through, upper, 10)
    const third = f.source.selectIncrement("work", second.through, upper, 10)
    const selected = [...first.members, ...second.members, ...third.members].flatMap(member => member.source_refs)
    expect(selected).toHaveLength(25)
    expect(new Set(selected.map(ref => ref.id)).size).toBe(25)
    expect(selected.some(ref => ref.id === late.id)).toBe(false)
    expect(third.more).toBe(false)
    const next = f.source.selectIncrement("work", third.through, f.source.captureFrontier("work"), 10)
    expect(next.members.flatMap(member => member.source_refs).map(ref => ref.id)).toEqual([late.id])
  } finally { f.close() }
})

test("single-source increments rotate source owners while ledger work remains pending", () => {
  const f = fixture()
  try {
    const original = f.record("One investigation source")
    for (let index = 0; index < 10; index++) f.record("Continued engineering work " + index)
    f.learning.objectives.create(f.engineer, f.learning.objectives.ledgerSource(original.id), "Explicitly authored goal")
    const upper = f.source.captureFrontier("work")
    const first = f.source.selectIncrement("work", EMPTY_LEARNING_FRONTIER, upper, 1, 0)
    const second = f.source.selectIncrement("work", first.through, upper, 1, first.next_owner)
    const third = f.source.selectIncrement("work", second.through, upper, 1, second.next_owner)
    expect([first, second, third].map(value => value.members[0]!.source_refs[0]!.kind))
      .toEqual(["ledger-record", "objective", "objective-link"])
    expect(third.through.ledger).toBeLessThan(upper.ledger)
    expect([first, second, third].every(value => value.examined === 1)).toBe(true)
    expect(() => f.source.selectIncrement("work", EMPTY_LEARNING_FRONTIER, upper, 1, 5)).toThrow("owner cursor")
  } finally { f.close() }
})

test("automatic subject establishment is idempotent across competing workers and exact prior context fences every owner", () => {
  const f = fixture()
  try {
    f.record("One source")
    const method = { id: "bounded-method", instruction_sha256: digest("bounded instructions") }
    const first = f.subjects.establishAutomatic("work", method, EMPTY_LEARNING_FRONTIER)
    const other = new EvaluationSubjects(f.derived, f.source, () => Date.now() + 1000).establishAutomatic("work", method, EMPTY_LEARNING_FRONTIER)
    expect(other).toEqual(first)
    const refs = f.source.selectIncrement("work", EMPTY_LEARNING_FRONTIER, first.through).members.flatMap(member => member.source_refs)
    const manifest = f.learning.populations.fromSources(first, refs)
    expect(manifest.selection).not.toHaveProperty("objective_id")
    expect(compatibleRetrospectiveContext(manifest, manifest)).toBe(true)
    const future = structuredClone(manifest)
    if (future.selection.mode !== "explicit-subject") throw new Error("Expected subject fixture")
    future.selection.frontier.review_relationships++
    future.selection.owner_boundary.review_relationships++
    expect(compatibleRetrospectiveContext(manifest, parseRetrospectiveManifest(future))).toBe(false)
    const unrelated = structuredClone(manifest)
    if (unrelated.selection.mode !== "explicit-subject") throw new Error("Expected subject fixture")
    unrelated.selection.target.kind = "action"
    expect(compatibleRetrospectiveContext(manifest, unrelated)).toBe(false)
    expect(retrospectiveDigest(manifest)).toBe(retrospectiveDigest(parseRetrospectiveManifest(manifest)))
  } finally { f.close() }
})
