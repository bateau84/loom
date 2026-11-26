import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { Store, type SQL } from "../src/store.js"
import { ObjectiveIndex } from "../src/objectives.js"
import { Learning } from "../src/learning.js"
import { LearningSources } from "../src/learning-sources.js"
import { canonical } from "../src/model.js"
import { workReference, type WorkRef } from "../src/collaboration.js"

const actor = (session_id: string, agent = "fixture-engineer") => ({ session_id, agent })
function fixture() {
  const actionDB = new Database(":memory:"), learningDB = new Database(":memory:")
  const store = new Store(actionDB), objectives = new ObjectiveIndex(learningDB, actionDB)
  const primary = actor("primary"), action = store.create("Restore freshness", "Explain and verify the scoped correction.", primary)
  return { actionDB, learningDB, store, objectives, primary, action, close() { learningDB.close(); actionDB.close() } }
}
function review(id: string, ref: WorkRef | null) {
  return { format: "loom-review-request/v1", request_id: id,
    mandate: { question: "  Assess only the corrected subtests.\nPreserve this exact scope.  ", dimensions: ["correctness"],
      criteria: [{ text: "Both controlled index orderings are correct.", source_ref: null }], mode: "independent",
      inclusions: ["corrected subtests"], exclusions: ["complete #182 release acceptance"] },
    intended_recipient: { agent: "reviewer", session_id: null }, members: [{ member_id: `${id}-member`, work_ref: ref,
      producing_attempt_refs: [] as string[], artifact_refs: [{ locator: `artifact:${id}`, version: { kind: "sha256", value: "a".repeat(64) }, content_ref: null }],
      prior_review_request_id: null, membership_source_refs: ["original-request"], gaps: [{ reason: "source-missing", source_ref: null }] }],
    rechecks: [] as Array<{ request_id: string; finding_ids: string[] }> }
}

test("authored typed objective relations preserve original attribution and validate distinct backward ledger sources", () => {
  const f = fixture()
  try {
    const first = f.store.record(actor("investigator"), { action_id: f.action.id }, { kind: "concern", statement: "The original CI failure remains unexplained." })
    const correction = f.store.record(actor("worker"), { action_id: f.action.id }, { kind: "result", statement: "Controlled orderings correct the test." })
    const assessment = f.store.record(actor("reviewer"), { action_id: f.action.id }, { kind: "assessment", verdict: "pass", statement: "The corrected subtests pass; release acceptance remains separate." })
    const objective = f.objectives.create(f.primary, f.objectives.ledgerSource(first.id), "Restore freshness investigation")
    const originalLink = f.objectives.read(objective.id).entries[0]
    const input = { objective_id: objective.id, source: f.objectives.ledgerSource(correction.id), phase: "coordination" as const,
      related_sequence: originalLink.sequence, relation: "addresses" as const, note: "Attributed correction association; no proven historical cause." }
    const linked = f.objectives.link(actor("association-author"), input)
    expect(linked.relation).toBe("addresses")
    expect(f.objectives.link(actor("association-author"), input).existing).toBe(true)
    expect(() => f.objectives.link(actor("association-author"), { ...input, relation: "supports" })).toThrow("another interpretation")
    const checked = f.objectives.link(actor("association-author"), { objective_id: objective.id, source: f.objectives.ledgerSource(assessment.id),
      phase: "verification", assessment: "pass", relation: "assesses", related_sequence: linked.sequence })
    expect(checked.relation).toBe("assesses")
    const view = f.objectives.historySnapshot({ objective_id: objective.id })
    expect(view.links.find(link => link.sequence === linked.sequence)).toMatchObject({ author_session: "association-author", source_session_id: "worker",
      relation: "addresses", source_availability: "record-available", verification: "loom-ledger", current_relationship: "supported" })
    expect(view.contributors).toEqual(["association-author", "investigator", "primary", "reviewer", "worker"])
    expect(() => f.objectives.link(f.primary, { ...input, source: f.objectives.ledgerSource(first.id) })).toThrow("distinct")
    expect(() => f.objectives.link(f.primary, { ...input, source: f.objectives.ledgerSource(first.id), related_sequence: checked.sequence })).toThrow("cycle")
    expect(() => f.objectives.link(f.primary, { ...input, related_sequence: checked.sequence + 100 })).toThrow("earlier link")
    expect(() => f.objectives.link(f.primary, { ...input, phase: "link-correction", assessment: "reject" })).toThrow("association-only")
    expect(() => f.objectives.link(f.primary, { ...input, source: { type: "external-ref", id: "https://example.test/claim", verification: "declared-external" } })).toThrow("original ledger")
    const other = f.objectives.create(f.primary, f.objectives.ledgerSource(assessment.id), "Other objective")
    expect(() => f.objectives.link(f.primary, { ...input, objective_id: other.id })).toThrow("earlier link")
    expect(f.store.records({ record_id: first.id, session_id: "investigator" }).items[0]).toMatchObject(first)
  } finally { f.close() }
})

test("objective scope comes from the actual ledger and hides outside targets, notes and association corrections", () => {
  const f = fixture()
  try {
    const other = f.store.create("Private unrelated work", "Private goal", actor("private-creator"))
    const inside = f.store.record(actor("inside-source"), { action_id: f.action.id }, { kind: "concern", statement: "Relevant failure" })
    const outside = f.store.record(actor("private-source"), { action_id: other.id }, { kind: "result", statement: "PRIVATE ORIGINAL" })
    const objective = f.objectives.create(actor("objective-creator"), f.objectives.ledgerSource(outside.id), "An explicitly shared objective")
    const root = f.objectives.read(objective.id).entries[0]
    const link = f.objectives.link(actor("inside-author"), { objective_id: objective.id, source: f.objectives.ledgerSource(inside.id),
      phase: "coordination", relation: "contests", related_sequence: root.sequence, note: "The relevant record contests the prior interpretation." })
    f.objectives.link(actor("private-author"), { objective_id: objective.id, source: f.objectives.ledgerSource(outside.id), phase: "link-correction",
      related_sequence: link.sequence, assessment: "reject", note: "PRIVATE ASSOCIATION CORRECTION" })
    // A stale/incorrect cached source Action must not create source membership.
    f.learningDB.prepare("UPDATE learning_objective_links SET action_id=? WHERE source_id=?").run(f.action.id, outside.id)
    const sources = f.objectives.historySources({ action_id: f.action.id })
    expect(sources.ledger_record_ids).toEqual([inside.id])
    expect(sources.contributors).toEqual(["inside-author", "inside-source", "objective-creator"])
    expect(JSON.stringify(sources)).not.toContain("explicitly shared")
    const snapshot = f.objectives.historySnapshot({ action_id: f.action.id })
    expect(snapshot.links).toHaveLength(1)
    expect(snapshot.links[0]).toMatchObject({ source_id: inside.id, action_id: f.action.id, related_sequence: null, relation: "contests", current_relationship: "supported" })
    for (const hidden of [outside.id, other.id, "PRIVATE ORIGINAL", "PRIVATE ASSOCIATION CORRECTION", "private-source", "private-author"])
      expect(JSON.stringify(snapshot)).not.toContain(hidden)
    const before = snapshot.digest
    f.learningDB.prepare("UPDATE learning_objective_links SET note=? WHERE source_id=?").run("Changed outside private note", outside.id)
    expect(f.objectives.historySnapshot({ action_id: f.action.id }).digest).toBe(before)
    expect(f.objectives.historySnapshot({ objective_id: objective.id }).links.find(row => row.sequence === link.sequence)?.current_relationship).toBe("rejected")
    // Matching cached Action fields never make the outside source discoverable in
    // a third scope where no original ledger row participates.
    const empty = f.store.create("Empty", "No records", f.primary)
    f.learningDB.prepare("UPDATE learning_objective_links SET action_id=? WHERE source_id=?").run(empty.id, outside.id)
    expect(f.objectives.historySnapshot({ action_id: empty.id }).objectives).toEqual([])
  } finally { f.close() }
})

test("objective owner preflight does not hydrate authored notes, labels or original record bodies", () => {
  const f = fixture()
  try {
    const record = f.store.record(f.primary, { action_id: f.action.id }, { kind: "result", statement: "ORIGINAL BODY" })
    const objective = f.objectives.create(f.primary, f.objectives.ledgerSource(record.id), "PRIVATE LABEL")
    f.objectives.link(f.primary, { objective_id: objective.id, source: f.objectives.ledgerSource(record.id), phase: "coordination", note: "PRIVATE NOTE" })
    const hydrated: string[] = []
    const guard = (db: Database): SQL => ({ exec: sql => db.exec(sql), prepare(sql) {
      const statement = db.prepare(sql)
      const inspect = (value: unknown) => { if (value && typeof value === "object") for (const key of ["data", "note", "label", "source_key"])
        if (Object.hasOwn(value, key)) hydrated.push(key); return value }
      return { get: (...args: unknown[]) => inspect(statement.get(...args as never[])), all: (...args: unknown[]) => statement.all(...args as never[]).map(inspect),
        run: (...args: unknown[]) => statement.run(...args as never[]) }
    } })
    const owner = new ObjectiveIndex(guard(f.learningDB), guard(f.actionDB))
    hydrated.length = 0
    const before = canonical(f.learningDB.prepare("SELECT * FROM learning_objective_links").all())
    const sources = owner.historySources({ action_id: f.action.id })
    expect(hydrated).toEqual([])
    expect(JSON.stringify(sources)).not.toContain("PRIVATE")
    const snapshot = owner.historySnapshot({ action_id: f.action.id })
    expect(hydrated).toContain("note"); expect(hydrated).toContain("label")
    expect(snapshot.digest).toBe(sources.digest)
    expect(snapshot.links.some(row => row.note === "PRIVATE NOTE")).toBe(true)
    expect(canonical(f.learningDB.prepare("SELECT * FROM learning_objective_links").all())).toBe(before)
  } finally { f.close() }
})

test("objective source projection rejects oversized or non-scalar metadata inside SQL before driver hydration", () => {
  const f = fixture()
  try {
    const record = f.store.record(f.primary, { action_id: f.action.id }, { kind: "result", statement: "Small original" })
    f.objectives.create(f.primary, f.objectives.ledgerSource(record.id), "Bounded source metadata")
    const oversized: string[] = []
    const guarded: SQL = { exec: sql => f.actionDB.exec(sql), prepare(sql) {
      const statement = f.actionDB.prepare(sql)
      const inspect = (value: unknown) => {
        if (value && typeof value === "object") for (const [key, maximum] of Object.entries({ node_id: 120, session_id: 120, action_id: 120, kind: 64, occurred_at: 64 })) {
          const scalar = (value as Record<string, unknown>)[key]
          if (typeof scalar === "string" && Buffer.byteLength(scalar, "utf8") > maximum) oversized.push(key)
        }
        return value
      }
      return { get: (...args: unknown[]) => inspect(statement.get(...args as never[])), all: (...args: unknown[]) => statement.all(...args as never[]).map(inspect),
        run: (...args: unknown[]) => statement.run(...args as never[]) }
    } }
    const owner = new ObjectiveIndex(f.learningDB, guarded)
    for (const replacement of [{ node_id: "x".repeat(100000) }, { created_at: "x".repeat(100000) }, { node_id: { nested: "invalid" } }, { created_at: 42 }]) {
      f.actionDB.prepare("UPDATE ledger SET data=? WHERE id=?").run(JSON.stringify({ ...record, ...replacement }), record.id)
      expect(() => owner.ledgerSource(record.id)).toThrow("bounded source projection")
      expect(() => owner.historySources({ action_id: f.action.id })).toThrow("bounded source projection")
    }
    f.actionDB.prepare("UPDATE ledger SET data=?,kind=? WHERE id=?").run(JSON.stringify(record), "x".repeat(100000), record.id)
    expect(() => owner.historySources({ action_id: f.action.id })).toThrow("bounded source projection")
    f.actionDB.prepare("UPDATE ledger SET kind=?,session_id=? WHERE id=?").run(record.kind, "x".repeat(100000), record.id)
    expect(() => owner.historySources({ action_id: f.action.id })).toThrow("source Session")
    expect(oversized).toEqual([])
  } finally { f.close() }
})

test("objective history reserves cumulative original bytes before any refreshed source projection", () => {
  const f = fixture()
  try {
    let objectiveID = ""
    for (let index = 0; index < 700; index++) {
      const record = f.store.record(f.primary, { action_id: f.action.id }, { kind: "result", statement: `Small original ${index}` })
      const source = f.objectives.ledgerSource(record.id)
      if (index === 0) objectiveID = f.objectives.create(f.primary, source, "Bounded cumulative sources").id
      else f.objectives.link(f.primary, { objective_id: objectiveID, phase: "coordination", source })
    }
    // Each original is below its per-record limit, but resolving all of them
    // must fail before a single refreshed source scalar reaches the driver.
    f.actionDB.prepare("UPDATE ledger SET data=json_set(data,'$.node_id',?)").run("x".repeat(100000))
    const size = f.actionDB.prepare("SELECT SUM(octet_length(data)) AS bytes FROM ledger").get() as { bytes: number }
    expect(size.bytes).toBeGreaterThan(64 * 1024 * 1024)
    let projectedSources = 0, projectedNodeBytes = 0
    const guarded: SQL = { exec: sql => f.actionDB.exec(sql), prepare(sql) {
      const statement = f.actionDB.prepare(sql)
      return { get: (...args: unknown[]) => {
        const row = statement.get(...args as never[]) as Record<string, unknown> | undefined
        if (row && Object.hasOwn(row, "original_valid")) projectedSources++
        if (typeof row?.node_id === "string") projectedNodeBytes += Buffer.byteLength(row.node_id, "utf8")
        return row
      }, all: (...args: unknown[]) => statement.all(...args as never[]), run: (...args: unknown[]) => statement.run(...args as never[]) }
    } }
    const owner = new ObjectiveIndex(f.learningDB, guarded)
    expect(() => owner.historySources({ action_id: f.action.id })).toThrow("original bytes exceed bounded source projection")
    expect(() => owner.historySources({ objective_id: objectiveID })).toThrow("original bytes exceed bounded source projection")
    expect(projectedSources).toBe(0)
    expect(projectedNodeBytes).toBe(0)
  } finally { f.close() }
})

test("objective append fences preserve old interpretation and unrelated appends do not change relationship fence", () => {
  const f = fixture()
  try {
    const original = f.store.record(f.primary, { action_id: f.action.id }, { kind: "concern", statement: "Plausible cause, unproven" })
    const objective = f.objectives.create(f.primary, f.objectives.ledgerSource(original.id), "An investigation")
    f.store.record(actor("unrelated-in-action"), { action_id: f.action.id }, { kind: "result", statement: "Different work" })
    const before = f.objectives.historySnapshot({ action_id: f.action.id })
    expect(before.ledger_through).toBe(2)
    const later = f.store.record(f.primary, { action_id: f.action.id }, { kind: "assessment", verdict: "inconclusive", statement: "Historical cause remains unproven after correction" })
    f.objectives.link(f.primary, { objective_id: objective.id, phase: "coordination", source: f.objectives.ledgerSource(later.id), relation: "supersedes", related_sequence: before.links[0].sequence })
    const pinned = f.objectives.historySnapshot({ action_id: f.action.id, ledger_through: before.ledger_through, link_through: before.link_through })
    expect(pinned.content_digest).toBe(before.content_digest)
    expect(pinned.digest).toBe(before.digest)
    expect(f.objectives.historySnapshot({ action_id: f.action.id }).links).toHaveLength(2)
    const privateAction = f.store.create("Unrelated", "Other source scope", actor("private"))
    const privateRecord = f.store.record(actor("private"), { action_id: privateAction.id }, { kind: "result", statement: "Private" })
    const current = f.objectives.historySources({ action_id: f.action.id })
    f.objectives.create(actor("private"), f.objectives.ledgerSource(privateRecord.id), "Private objective")
    expect(f.objectives.historySources({ action_id: f.action.id })).toEqual(current)
    const root = f.objectives.historySources({ objective_id: objective.id })
    expect(root.ledger_through).toBe(3)
  } finally { f.close() }
})

test("objective additive migration preserves legacy links and oversized notes fail before hydration", () => {
  const f = fixture()
  try {
    const record = f.store.record(f.primary, { action_id: f.action.id }, { kind: "result", statement: "Legacy source" })
    f.objectives.create(f.primary, f.objectives.ledgerSource(record.id), "Legacy objective")
    f.learningDB.exec("ALTER TABLE learning_objective_links DROP COLUMN relation")
    const before = f.learningDB.prepare("SELECT * FROM learning_objective_links").all() as Array<Record<string, unknown>>
    const reopened = new ObjectiveIndex(f.learningDB, f.actionDB)
    const after = f.learningDB.prepare("SELECT * FROM learning_objective_links").all() as Array<Record<string, unknown>>
    expect(after.map(({ relation, ...rest }) => { expect(relation).toBeNull(); return rest })).toEqual(before)
    f.learningDB.prepare("UPDATE learning_objective_links SET note=?").run("x".repeat(200000))
    expect(() => reopened.historySources({ action_id: f.action.id })).toThrow("bounded read")
    expect(() => reopened.historySnapshot({ action_id: f.action.id })).toThrow("bounded read")
  } finally { f.close() }
})

test("additive objective migration preserves exact Stage 3 originals and an existing complete frozen batch", async () => {
  const f = fixture()
  try {
    const learning = new Learning(f.learningDB, f.store, f.actionDB)
    const record = f.store.record(f.primary, { action_id: f.action.id }, { kind: "concern", statement: "Original legacy concern" })
    const objective = learning.objectives.create(f.primary, learning.objectives.ledgerSource(record.id), "Legacy complete objective population")
    // Exercise the actual pre-addition table shape, source owner, complete
    // snapshot, deterministic processor and frozen-report readback.
    f.learningDB.exec("ALTER TABLE learning_objective_links DROP COLUMN relation")
    const sourceOwner = new LearningSources(f.store, f.actionDB, f.learningDB)
    const before = sourceOwner.snapshot(f.primary.session_id)
    const values = before.members.flatMap(member => member.source_refs).map(ref => sourceOwner.resolve(ref, sourceOwner.namespace)?.value)
    const first = await learning.automatic.run(f.primary.session_id, async () => {}, new AbortController().signal)
    expect(first.state).toBe("complete")
    if (!first.batch_id) throw new Error("Expected a complete frozen batch")
    const report = learning.automatic.history.report(first.batch_id, f.primary.session_id)
    expect(report?.availability).toBe("available")
    const batchRows = canonical(f.learningDB.prepare("SELECT * FROM learning_evaluation_batches").all())
    const reopened = new ObjectiveIndex(f.learningDB, f.actionDB)
    expect(sourceOwner.snapshot(f.primary.session_id)).toEqual(before)
    expect(before.members.flatMap(member => member.source_refs).map(ref => sourceOwner.resolve(ref, sourceOwner.namespace)?.value)).toEqual(values)
    expect(learning.automatic.history.get(first.batch_id, f.primary.session_id).state).toBe("complete")
    expect(learning.automatic.history.report(first.batch_id, f.primary.session_id)).toEqual(report)
    expect(canonical(f.learningDB.prepare("SELECT * FROM learning_evaluation_batches").all())).toBe(batchRows)
    expect((await learning.automatic.run(f.primary.session_id, async () => {}, new AbortController().signal)).batch_id).toBe(first.batch_id)
    const correction = f.store.record(f.primary, { action_id: f.action.id }, { kind: "result", statement: "New explicit correction" })
    const linked = reopened.link(f.primary, { objective_id: objective.id, source: reopened.ledgerSource(correction.id), phase: "coordination", relation: "addresses", related_sequence: 1 })
    const added = sourceOwner.snapshot(f.primary.session_id).members.flatMap(member => member.source_refs)
      .find(ref => ref.kind === "objective-link" && ref.id === String(linked.sequence))
    if (!added) throw new Error("New explicit relation must remain in the complete source population")
    expect(sourceOwner.resolve(added, sourceOwner.namespace)?.value.relation).toBe("addresses")
  } finally { f.close() }
})

test("review history retains exact requested scope, correction and recheck with qualified actual basis", () => {
  const f = fixture()
  try {
    const plan = f.store.savePlan(f.action.id, 0, [{ id: "subtests", kind: "task", title: "Correct two subtests" }], f.primary)
    const ref = workReference(f.action, plan, "subtests"), r1 = review("r1", ref)
    f.store.reviews.freeze(f.primary, r1)
    const finding = f.store.record(f.primary, { action_id: f.action.id, node_id: "subtests" }, { kind: "concern", statement: "Initial interpretation overstates the historical failure diagnosis." })
    const f1 = f.store.reviews.relate(f.primary, "r1", { relationship: "finding", source_record_id: finding.id, member_ids: ["r1-member"] })
    const correction = f.store.record(f.primary, { action_id: f.action.id, node_id: "subtests" }, { kind: "assessment", verdict: "inconclusive", statement: "Both orderings proved on the corrected revision; original ordering remains unknown." })
    const c1 = f.store.reviews.relate(f.primary, "r1", { relationship: "correction", source_record_id: correction.id, member_ids: ["r1-member"], supersedes: f1.id })
    const r2 = review("r2", ref); r2.rechecks = [{ request_id: "r1", finding_ids: [c1.id] }]
    f.store.reviews.freeze(f.primary, r2)
    const passed = f.store.record(f.primary, { action_id: f.action.id, node_id: "subtests" }, { kind: "assessment", verdict: "pass", statement: "Scoped corrected subtests passed." })
    f.store.reviews.relate(f.primary, "r2", { relationship: "claimed-inspected", source_record_id: passed.id, member_ids: ["r2-member"] })
    const snapshot = f.store.reviews.historySnapshot(f.primary, { action_id: f.action.id })
    expect(snapshot.requests).toHaveLength(2)
    expect(snapshot.requests[0].request.mandate).toEqual(r1.mandate)
    expect(snapshot.requests[1].request.rechecks).toEqual([{ request_id: "r1", finding_ids: [c1.id] }])
    expect(snapshot.requests[0].relationships.find(row => row.id === c1.id)?.supersedes).toBe(f1.id)
    expect(snapshot.requests.flatMap(row => row.relationships).every(row => row.review_binding.status === "unknown")).toBe(true)
    expect(snapshot.requests[1].relationships[0]).toMatchObject({ relationship: "claimed-inspected", declared_verdict: "pass",
      relationship_attribution: { status: "unknown", reason: "authored-association-unverified" } })
    expect(snapshot.requests[1].qualification.rechecks).toContain("requested-only")
    expect(snapshot.requests[1].request.mandate.exclusions).toEqual(["complete #182 release acceptance"])
    expect(snapshot.ledger_record_ids.sort()).toEqual([finding.id, correction.id, passed.id].sort())
    expect(snapshot.digest).toBe(f.store.reviews.historySources(f.primary, { action_id: f.action.id }).digest)
  } finally { f.close() }
})

test("pending no-Plan rechecks remain navigable through exact owned findings without inventing observed work", () => {
  const f = fixture()
  try {
    const original = review("artifact-original", null)
    f.store.reviews.freeze(f.primary, original)
    const finding = f.store.record(f.primary, { action_id: f.action.id }, { kind: "concern", statement: "Original failure; cause remains unknown." })
    const first = f.store.reviews.relate(f.primary, original.request_id, { relationship: "finding", source_record_id: finding.id, member_ids: ["artifact-original-member"] })
    const correction = f.store.record(f.primary, { action_id: f.action.id }, { kind: "result", statement: "Correction on a different revision; assessment pending." })
    const corrected = f.store.reviews.relate(f.primary, original.request_id, { relationship: "correction", source_record_id: correction.id,
      member_ids: ["artifact-original-member"], supersedes: first.id })
    const before = f.store.reviews.historySnapshot(f.primary, { action_id: f.action.id })
    const pending = review("artifact-pending", null)
    pending.rechecks = [{ request_id: original.request_id, finding_ids: [corrected.id] }]
    f.store.reviews.freeze(f.primary, pending)
    const unrelated = review("artifact-unrelated", null)
    unrelated.members[0].artifact_refs = pending.members[0].artifact_refs
    f.store.reviews.freeze(f.primary, unrelated)
    expect(f.store.reviews.read(f.primary, pending.request_id).request.request_id).toBe(pending.request_id)
    for (const selection of [{ action_id: f.action.id }, { session_id: f.primary.session_id }, { record_ids: [finding.id, correction.id] }]) {
      const snapshot = f.store.reviews.historySnapshot(f.primary, selection)
      expect(snapshot.requests.map(row => row.request.request_id)).toEqual([original.request_id, pending.request_id])
      const projected = snapshot.requests.find(row => row.request.request_id === pending.request_id)!
      expect(projected.request.rechecks).toEqual(pending.rechecks)
      expect(projected.request.members[0].work_ref).toBeNull()
      expect(projected.request.members[0].producing_attempt_refs).toEqual([])
      expect(projected.relationships).toEqual([])
      expect(projected.qualification.rechecks).toContain("requested-only")
      expect(snapshot.ledger_record_ids.sort()).toEqual([finding.id, correction.id].sort())
    }
    const pinned = f.store.reviews.historySnapshot(f.primary, { action_id: f.action.id, through: before.through,
      request_through: before.request_through, relationship_through: before.relationship_through })
    expect(pinned).toEqual(before)
    // The correction's original target is a required dependency. Selecting the
    // correction alone cannot retain a pending request with an absent basis.
    const partial = f.store.reviews.historySnapshot(f.primary, { record_ids: [correction.id] })
    expect(partial.requests.some(row => row.request.request_id === pending.request_id)).toBe(false)
  } finally { f.close() }
})

test("review history excludes other requesters and reserved preparation before boundary or metadata disclosure", () => {
  const f = fixture()
  try {
    const plan = f.store.savePlan(f.action.id, 0, [{ id: "task", kind: "task", title: "Original scope" }], f.primary)
    const ref = workReference(f.action, plan, "task")
    f.store.reviews.freeze(f.primary, review("owned", ref))
    const before = f.store.reviews.historySnapshot(f.primary, { action_id: f.action.id })
    f.store.reviews.freeze(actor("other-requester"), review("OTHER-PRIVATE-REQUEST", ref))
    const otherRecord = f.store.record(actor("other-requester"), { action_id: f.action.id }, { kind: "result", statement: "OTHER PRIVATE BODY" })
    f.store.reviews.relate(actor("other-requester"), "OTHER-PRIVATE-REQUEST", { relationship: "finding", source_record_id: otherRecord.id, member_ids: ["OTHER-PRIVATE-REQUEST-member"] })
    f.store.reviews.freezeEvaluatorPreparation(f.primary, { ...review("PREPARATION-PRIVATE", ref), extensions: { classification: "evaluator-preparation", evaluation_batch_id: "batch" } })
    const preparedRecord = f.store.record(f.primary, { action_id: f.action.id }, { kind: "result", statement: "PREPARATION PRIVATE BODY" })
    f.store.reviews.relate(f.primary, "PREPARATION-PRIVATE", { relationship: "finding", source_record_id: preparedRecord.id, member_ids: ["PREPARATION-PRIVATE-member"] })
    const after = f.store.reviews.historySnapshot(f.primary, { action_id: f.action.id, through: before.through })
    expect(after).toEqual(before)
    for (const hidden of ["OTHER-PRIVATE-REQUEST", "other-requester", "PREPARATION-PRIVATE", otherRecord.id, preparedRecord.id]) expect(JSON.stringify(after)).not.toContain(hidden)
    expect(f.store.reviews.historySnapshot(actor("stranger"), { action_id: f.action.id }).requests).toEqual([])
  } finally { f.close() }
})

test("review history omits an entire cross-scope manifest and never projects outside relationship targets", () => {
  const f = fixture()
  try {
    const plan = f.store.savePlan(f.action.id, 0, [{ id: "task", kind: "task", title: "Inside" }], f.primary)
    const ref = workReference(f.action, plan, "task")
    const other = f.store.create("PRIVATE ACTION", "Other scope", f.primary)
    const otherPlan = f.store.savePlan(other.id, 0, [{ id: "private-task", kind: "task", title: "PRIVATE TASK" }], f.primary)
    const mixed = review("MIXED-PRIVATE-MANIFEST", ref)
    mixed.members.push({ ...mixed.members[0], member_id: "PRIVATE-MEMBER", work_ref: workReference(other, otherPlan, "private-task") })
    f.store.reviews.freeze(f.primary, mixed)
    const normal = review("normal", ref); f.store.reviews.freeze(f.primary, normal)
    const outside = f.store.record(f.primary, { action_id: other.id }, { kind: "concern", statement: "PRIVATE FINDING" })
    const outRelation = f.store.reviews.relate(f.primary, "normal", { relationship: "finding", source_record_id: outside.id, member_ids: ["normal-member"] })
    const inside = f.store.record(f.primary, { action_id: f.action.id }, { kind: "result", statement: "Scoped correction" })
    const firstCorrection = f.store.reviews.relate(f.primary, "normal", { relationship: "correction", source_record_id: inside.id, member_ids: ["normal-member"], supersedes: outRelation.id })
    const nextCorrection = f.store.reviews.relate(f.primary, "normal", { relationship: "correction", source_record_id: inside.id, member_ids: ["normal-member"], supersedes: firstCorrection.id })
    const recheck = review("PRIVATE-RECHECK", ref); recheck.rechecks = [{ request_id: "normal", finding_ids: [outRelation.id] }]
    f.store.reviews.freeze(f.primary, recheck)
    const chained = review("CHAINED-RECHECK", ref); chained.rechecks = [{ request_id: "normal", finding_ids: [nextCorrection.id] }]
    f.store.reviews.freeze(f.primary, chained)
    const snapshot = f.store.reviews.historySnapshot(f.primary, { action_id: f.action.id })
    expect(snapshot.requests.map(row => row.request.request_id)).toEqual(["normal"])
    expect(snapshot.requests[0].relationships).toEqual([])
    for (const hidden of [mixed.request_id, other.id, outside.id, outRelation.id, firstCorrection.id, nextCorrection.id, "PRIVATE-RECHECK", "CHAINED-RECHECK", "PRIVATE-MEMBER"])
      expect(JSON.stringify(snapshot)).not.toContain(hidden)
  } finally { f.close() }
})

test("unrelated caller-owned manifests do not consume a selected scope's registry budget or append fences", () => {
  const f = fixture()
  try {
    const plan = f.store.savePlan(f.action.id, 0, [{ id: "task", kind: "task", title: "Selected work" }], f.primary)
    f.store.reviews.freeze(f.primary, review("selected", workReference(f.action, plan, "task")))
    const before = f.store.reviews.historySnapshot(f.primary, { action_id: f.action.id })
    const outside = f.store.create("Unrelated requests", "Outside this history selection", f.primary)
    const outsidePlan = f.store.savePlan(outside.id, 0, [{ id: "other", kind: "task", title: "Different work" }], f.primary)
    const outsideRef = workReference(outside, outsidePlan, "other")
    for (let i = 0; i < 1001; i++) f.store.reviews.freeze(f.primary, review(`outside-${i}`, outsideRef))
    expect(f.store.reviews.historySnapshot(f.primary, { action_id: f.action.id })).toEqual(before)
    const narrow = f.store.reviews.historySnapshot(f.primary, { record_ids: [], through: before.through,
      request_through: before.request_through, relationship_through: before.relationship_through })
    expect(narrow.requests).toEqual([])
  } finally { f.close() }
})

test("review history freezes separate request and relationship append fences while preserving the ledger scope", () => {
  const f = fixture()
  try {
    const plan = f.store.savePlan(f.action.id, 0, [{ id: "task", kind: "task", title: "Frozen subject" }], f.primary)
    const ref = workReference(f.action, plan, "task")
    f.store.reviews.freeze(f.primary, review("original", ref))
    const record = f.store.record(f.primary, { action_id: f.action.id }, { kind: "concern", statement: "Initial concern" })
    f.store.reviews.relate(f.primary, "original", { relationship: "finding", source_record_id: record.id, member_ids: ["original-member"] })
    f.store.record(actor("unrelated-source"), { action_id: f.action.id }, { kind: "result", statement: "Unrelated inside source scope" })
    const before = f.store.reviews.historySnapshot(f.primary, { action_id: f.action.id })
    expect(before.through).toBe(2)
    f.store.reviews.freeze(f.primary, review("later-review", ref))
    f.store.reviews.relate(f.primary, "original", { relationship: "cited", source_record_id: record.id, member_ids: ["original-member"] })
    const pinned = f.store.reviews.historySnapshot(f.primary, { action_id: f.action.id, through: before.through,
      request_through: before.request_through, relationship_through: before.relationship_through })
    expect(pinned).toEqual(before)
    expect(f.store.reviews.historySnapshot(f.primary, { action_id: f.action.id }).requests).toHaveLength(2)
    expect(f.store.reviews.historySnapshot(f.primary, { action_id: f.action.id }).requests[0].relationships).toHaveLength(2)
  } finally { f.close() }
})

test("review preflight returns only metadata and exact record roots cannot widen membership through equal revisions", () => {
  const f = fixture()
  try {
    const plan = f.store.savePlan(f.action.id, 0, [{ id: "task", kind: "task", title: "Recorded scope" }], f.primary)
    const ref = workReference(f.action, plan, "task")
    f.store.reviews.freeze(f.primary, review("own-scope", ref))
    const first = f.store.record(f.primary, { action_id: f.action.id }, { kind: "result", statement: "ORIGINAL BODY" })
    f.store.reviews.relate(f.primary, "own-scope", { relationship: "finding", source_record_id: first.id, member_ids: ["own-scope-member"] })
    const sources = f.store.reviews.historySources(f.primary, { action_id: f.action.id })
    for (const hidden of ["Assess only", "ORIGINAL BODY", "original-request", "complete #182"])
      expect(JSON.stringify(sources)).not.toContain(hidden)
    // An authored source's matching Action alone does not establish the exact
    // WorkRef in an objective-root selection lacking that historical binding.
    expect(f.store.reviews.historySnapshot(f.primary, { record_ids: [first.id] }).requests).toEqual([])
    f.store.select(f.primary.session_id, { action_id: f.action.id, node_id: "task" })
    const start = f.store.startObservation(f.primary, { phase: "started", tool: "read" })
    expect(f.store.reviews.historySnapshot(f.primary, { record_ids: [start.id] }).requests.map(row => row.request.request_id)).toEqual(["own-scope"])
    expect(f.store.reviews.historySnapshot(f.primary, { record_ids: [] }).requests).toEqual([])
  } finally { f.close() }
})
