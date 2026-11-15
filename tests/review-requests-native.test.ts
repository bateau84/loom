import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Store, type SQL } from "../src/store.js"
import { workReference } from "../src/collaboration.js"
import { canonical } from "../src/model.js"

const actor = { session_id: "requester", agent: "reviewer" }
function request(id = "request-A", count = 1): any {
  return { format: "loom-review-request/v1", request_id: id,
    mandate: { question: "  Assess the original artifact A.\nPreserve this exact question.  ", dimensions: ["correctness"],
      criteria: [{ text: "The original error contract holds.", source_ref: "requirement:BR-004" }],
      mode: "independent", inclusions: ["artifact A"], exclusions: ["later work"] },
    intended_recipient: { agent: "reviewer", session_id: null }, members: Array.from({ length: count }, (_, i) => ({
      member_id: `member-${i}`, work_ref: null, producing_attempt_refs: [],
      artifact_refs: [{ locator: `artifact:${i}`, version: { kind: "sha256", value: i.toString(16).padStart(64, "0") }, content_ref: null }],
      prior_review_request_id: null, membership_source_refs: ["request:original"], gaps: [{ reason: "source-missing", source_ref: null }],
    })), rechecks: [] }
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "loom-review-requests-")), path = join(root, "ledger.sqlite")
  const db = new Database(path), store = new Store(db)
  return { root, path, db, store, close() { db.close(); rmSync(root, { recursive: true, force: true }) } }
}

test("frozen request preserves authored whitespace and duplicate identity through reopen", () => {
  const f = fixture()
  try {
    const original = request()
    expect(f.store.reviews.freeze(actor, original).status).toBe("created")
    const storeID = f.store.reviews.storeID
    const reopened = new Database(f.path)
    try {
      const store = new Store(reopened)
      expect(store.reviews.storeID).toBe(storeID)
      expect(store.reviews.freeze(actor, original).status).toBe("existing")
      expect(store.reviews.freeze(actor, { ...original, mandate: { ...original.mandate, question: "A later interpretation" } }).status).toBe("conflict")
      expect(store.reviews.read(actor, original.request_id).request.mandate).toEqual(original.mandate)
      expect(store.reviews.read(actor, original.request_id).request.requester).toEqual(actor)
    } finally { reopened.close() }
    expect(f.db.prepare("SELECT count(*) n FROM review_requests").get()).toEqual({ n: 1 })
    expect(f.db.prepare("SELECT count(*) n FROM ledger").get()).toEqual({ n: 0 })
  } finally { f.close() }
})

for (const conflict of [false, true]) test(`two real processes publish one immutable request (${conflict ? "conflicting" : "equivalent"})`, async () => {
  const f = fixture()
  try {
    const script = `import {Database} from 'bun:sqlite'; import {Store} from ${JSON.stringify(new URL("../src/store.ts", import.meta.url).pathname)};
      import {writeFileSync,existsSync} from 'node:fs';
      const db=new Database(process.env.REVIEW_RACE_DB),store=new Store(db);
      writeFileSync(process.env.REVIEW_RACE_READY,'ready');
      while(!existsSync(process.env.REVIEW_RACE_GATE)) await Bun.sleep(2);
      try {console.log(JSON.stringify(store.reviews.freeze(${JSON.stringify(actor)},JSON.parse(process.env.REVIEW_RACE_INPUT))));}finally{db.close();}`
    const gate = join(f.root, "gate"), one = request(), two = request()
    if (conflict) two.mandate.question = "Distinct conflicting original mandate"
    const children = [one, two].map((input, index) => Bun.spawn([process.execPath, "-e", script], {
      env: { ...process.env, REVIEW_RACE_DB: f.path, REVIEW_RACE_GATE: gate, REVIEW_RACE_READY: join(f.root, `ready-${index}`), REVIEW_RACE_INPUT: JSON.stringify(input) },
      stdout: "pipe", stderr: "pipe",
    }))
    try {
      const deadline = Date.now() + 10000
      while (![0, 1].every(i => existsSync(join(f.root, `ready-${i}`)))) {
        if (Date.now() > deadline) throw new Error("Request race workers did not reach the barrier")
        await Bun.sleep(5)
      }
      writeFileSync(gate, "release")
      const results = await Promise.all(children.map(async child => {
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
        expect(stderr).toBe(""); expect(code).toBe(0)
        return JSON.parse(stdout)
      }))
      expect(results.map(r => r.status).sort()).toEqual(conflict ? ["conflict", "created"] : ["created", "existing"])
      expect(f.db.prepare("SELECT count(*) n FROM review_requests").get()).toEqual({ n: 1 })
      const saved = f.store.reviews.read(actor, one.request_id)
      expect([one.mandate.question, two.mandate.question]).toContain(saved.request.mandate.question)
    } finally { for (const child of children) child.kill() }
  } finally { f.close() }
})

test("request rollback and lost COMMIT acknowledgement never publish partial or replacement membership", () => {
  const f = fixture()
  try {
    let fault: "before" | "after" | undefined
    const db: SQL = { prepare: sql => f.db.prepare(sql), exec(sql) {
      if (sql === "COMMIT" && fault === "before") { fault = undefined; throw new Error("commit rejected") }
      const result = f.db.exec(sql)
      if (sql === "COMMIT" && fault === "after") { fault = undefined; throw new Error("commit acknowledgement lost") }
      return result
    } }
    const store = new Store(db), original = request("atomic", 100)
    fault = "before"
    expect(() => store.reviews.freeze(actor, original)).toThrow("commit rejected")
    expect(f.db.prepare("SELECT count(*) n FROM review_requests").get()).toEqual({ n: 0 })
    fault = "after"
    expect(() => store.reviews.freeze(actor, original)).toThrow("commit acknowledgement lost")
    expect(store.reviews.freeze(actor, original).status).toBe("existing")
    const first = store.reviews.read(actor, original.request_id, { limit: 50 })
    const second = store.reviews.read(actor, original.request_id, { after: first.next_after!, limit: 50 })
    expect([...first.members, ...second.members]).toEqual(original.members)
    expect(second.next_after).toBeNull()
  } finally { f.close() }
})

test("historical A remains claimable after B while original currentness mandate rejects stale work", () => {
  const f = fixture()
  try {
    const action = f.store.create("Original A", "Original goal A", actor)
    const plan = f.store.savePlan(action.id, 0, [{ id: "task-A", kind: "task", title: "Contract A", criteria: ["A criterion"] }])
    const ref = workReference(action, plan, "task-A"), historical = request("historical"), current = request("current")
    historical.members[0].work_ref = ref; current.members[0].work_ref = ref
    current.mandate.currentness = "current-at-issue-claim"
    for (const input of [historical, current]) f.store.reviews.freeze(actor, input)
    const hi = f.store.reviews.prepareIssue(actor, "historical", { kind: "initial" })
    const ci = f.store.reviews.prepareIssue(actor, "current", { kind: "initial" })
    f.store.savePlan(action.id, 1, [{ id: "task-B", kind: "task", title: "Different contract B" }])
    f.store.update(action.id, 1, { title: "Revised B", goal: "Revised goal B" })
    const work = f.store.reviews.work(actor, "historical", "member-0")
    expect(work).toMatchObject({ status: "established", action: { title: "Original A", goal: "Original goal A", revision: 1 },
      plan: { revision: 1 }, node: { id: "task-A", title: "Contract A", criteria: ["A criterion"] } })
    expect(f.store.reviews.claimIssue(actor, hi.intent, "historical-owner").status).toBe("claimed-now")
    expect(f.store.reviews.claimIssue(actor, ci.intent, "current-owner")).toMatchObject({ status: "rejected", attempt: { rejection_reason: "stale-scope" } })
    expect(f.store.reviews.read(actor, "historical").members[0].work_ref).toEqual(ref)
    const unexplained = request("bad-default")
    unexplained.work_revision_policy = "current-at-issue-claim"
    expect(() => f.store.reviews.freeze(actor, unexplained)).toThrow("original mandate")
  } finally { f.close() }
})

test("requested sources, cited claims and qualified retrieval remain separate across correction", () => {
  const f = fixture()
  try {
    const original = request(), sha = "a".repeat(64)
    original.members[0].artifact_refs = [{ locator: "skill://engineering/QA.md", version: { kind: "sha256", value: sha }, content_ref: null }]
    f.store.reviews.freeze(actor, original)
    const finding = f.store.record(actor, undefined, { kind: "qa", verdict: "pass", statement: "I cite and inspected engineering QA." })
    const cited = f.store.reviews.relate(actor, original.request_id, { relationship: "cited", source_record_id: finding.id, member_ids: ["member-0"] })
    f.store.reviews.relate(actor, original.request_id, { relationship: "claimed-inspected", source_record_id: finding.id, member_ids: ["member-0"] })
    expect(() => f.store.reviews.relate(actor, original.request_id, { relationship: "retrieved", source_record_id: finding.id, member_ids: ["member-0"] })).toThrow("host observation")
    const generic = f.store.observe(actor, undefined, { phase: "finished", status: "completed", output_digest: sha })
    expect(() => f.store.reviews.relate(actor, original.request_id, { relationship: "retrieved", source_record_id: generic.id, member_ids: ["member-0"] })).toThrow("qualified source return")
    const receipt = f.store.observe(actor, undefined, { phase: "companion-load-result", source: "successful-companion-tool-result", skill_id: "engineering",
      lens: "qa", content_sha256: sha, message_id: "original-native-message", call_id: "opaque-outer-call" })
    const retrieved = { relationship: "retrieved", source_record_id: receipt.id, member_ids: ["member-0"] }
    expect(f.store.reviews.relate(actor, original.request_id, retrieved).status).toBe("created")
    expect(f.store.reviews.relate(actor, original.request_id, retrieved).status).toBe("existing")
    const correction = f.store.record(actor, undefined, { kind: "qa", verdict: "inconclusive", statement: "The source return does not establish final model input." })
    f.store.reviews.relate(actor, original.request_id, { relationship: "correction", source_record_id: correction.id, member_ids: ["member-0"], supersedes: cited.id })
    const read = f.store.reviews.read(actor, original.request_id)
    expect(read.relationships).toHaveLength(4)
    expect(read.relationships.every(r => (r.review_binding as any).status === "unknown")).toBe(true)
    expect(read.relationships.find(r => r.relationship === "retrieved")).toMatchObject({ observed_source: { boundary: "tool-return", coverage: "full", receiving_session_id: actor.session_id }, source_producer: actor })
    expect(read.relationships.find(r => r.relationship === "correction")).toMatchObject({ supersedes: cited.id, declared_verdict: "inconclusive" })
    expect(read.request.mandate).toEqual(original.mandate)
    expect(read.qualification.protected_delivery).toBe("withheld")
    expect(read.relationships.find(r => r.relationship === "correction")?.source_record).toEqual(correction)
    expect(canonical(f.db.prepare("SELECT data FROM review_relationships").all())).not.toContain(correction.data.statement as string)
    for (const relationship of ["supplied", "established"]) expect(() => f.store.reviews.relate(actor, original.request_id,
      { relationship, source_record_id: receipt.id, member_ids: ["member-0"] })).toThrow("Unsupported evidence relationship")
  } finally { f.close() }
})

test("member duplicates, unsupported semantics and oversized input fail before publication", () => {
  const f = fixture()
  try {
    const original = request()
    const duplicate = { ...original, members: [original.members[0], { ...original.members[0], member_id: "other", membership_source_refs: ["different provenance"] }] }
    expect(() => f.store.reviews.freeze(actor, duplicate)).toThrow("Duplicate")
    expect(() => f.store.reviews.freeze(actor, { ...original, requester: actor })).toThrow("not supported")
    expect(() => f.store.reviews.freeze(actor, { ...original, format: "loom-review-request/v9" })).toThrow("Unsupported")
    const branch = request(); branch.members[0].artifact_refs[0].version = { kind: "git", repository: "repo", object_id: "main", path: "src/a.ts" }
    expect(() => f.store.reviews.freeze(actor, branch)).toThrow("immutable object")
    expect(() => f.store.reviews.freeze(actor, { ...original, extensions: { oversized: "x".repeat(131073) } })).toThrow("processing limit")
    expect(f.db.prepare("SELECT count(*) n FROM review_requests").get()).toEqual({ n: 0 })
    f.store.reviews.freeze(actor, original)
    const saved = f.db.prepare("SELECT data FROM review_requests WHERE request_id=?").get(original.request_id) as { data: string }
    f.db.prepare("UPDATE review_requests SET data=? WHERE request_id=?").run(saved.data.replace("loom-review-request/v1", "loom-review-request/v9"), original.request_id)
    expect(() => f.store.reviews.read(actor, original.request_id)).toThrow("Unsupported review request version")
    expect(() => f.store.reviews.prepareIssue(actor, original.request_id, { kind: "initial" })).toThrow("Unsupported review request version")
    expect(f.db.prepare("SELECT count(*) n FROM review_issue_intents").get()).toEqual({ n: 0 })
  } finally { f.close() }
})

test("source gaps remain explicit and another Session cannot link or read protected source records", () => {
  const f = fixture()
  try {
    const original = request(), foreign = f.store.record({ session_id: "other", agent: "reviewer" }, undefined,
      { kind: "qa", verdict: "fail", statement: "Private foreign assessment" })
    original.members[0].producing_attempt_refs = ["missing-attempt"]
    expect(() => f.store.reviews.freeze(actor, original)).toThrow("explicit source gap")
    original.members[0].gaps.push({ reason: "source-missing", source_ref: "missing-attempt" })
    f.store.reviews.freeze(actor, original)
    expect(() => f.store.reviews.relate(actor, original.request_id, { relationship: "finding", source_record_id: foreign.id, member_ids: ["member-0"] })).toThrow("unavailable to this Session")
    for (const id of [original.request_id, "does-not-exist"]) expect(() => f.store.reviews.read({ session_id: "other", agent: "reviewer" }, id)).toThrow("Review request is unavailable to this Session")
    const page = f.store.reviews.read(actor, original.request_id)
    expect(page.members[0].gaps).toContainEqual({ reason: "source-missing", source_ref: "missing-attempt" })
    expect(page.relationships).toEqual([])
    expect(page.qualification.native_review_binding.status).toBe("unknown")
  } finally { f.close() }
})

test("group constituents freeze the selected descendants without promoting dependency context", () => {
  const f = fixture()
  try {
    const action = f.store.create("Group review", "Keep original constituent population", actor)
    const plan = f.store.savePlan(action.id, 0, [
      { id: "phase", kind: "phase", title: "Context ancestor" },
      { id: "wave", kind: "wave", title: "Selected group", parent: "phase" },
      { id: "dependency", kind: "task", title: "Context dependency" },
      { id: "first", kind: "task", title: "First requested task", parent: "wave", depends_on: ["dependency"] },
      { id: "detail", kind: "subtask", title: "Requested subtask", parent: "first" },
      { id: "second", kind: "task", title: "Second requested task", parent: "wave" },
    ])
    const original = request("group")
    original.members[0].work_ref = workReference(action, plan, "wave")
    f.store.reviews.freeze(actor, original)
    const before = f.store.reviews.read(actor, "group")
    expect(before.frozen_work_membership[0].constituents.map(ref => ref.node_id)).toEqual(["wave", "first", "detail", "second"])
    f.store.savePlan(action.id, 1, [{ id: "new", kind: "task", title: "New unrelated population" }])
    expect(f.store.reviews.read(actor, "group").frozen_work_membership).toEqual(before.frozen_work_membership)
    const stored = f.db.prepare("SELECT membership_data FROM review_requests WHERE request_id='group'").get() as { membership_data: string }
    const corrupted = JSON.parse(stored.membership_data)
    corrupted.members[0].constituents.pop()
    f.db.prepare("UPDATE review_requests SET membership_data=? WHERE request_id='group'").run(JSON.stringify(corrupted))
    expect(() => f.store.reviews.read(actor, "group")).toThrow("membership integrity failed")
    expect(() => f.store.reviews.prepareIssue(actor, "group", { kind: "initial" })).toThrow("membership integrity failed")
  } finally { f.close() }
})

test("authored links never attribute a later analyst's assertion to the original coder", () => {
  const f = fixture()
  try {
    f.store.reviews.freeze(actor, request())
    const coder = { session_id: actor.session_id, agent: "coder" }, analyst = { session_id: actor.session_id, agent: "analyst" }
    const source = f.store.record(coder, undefined, { kind: "result", statement: "I have not inspected or cited any artifact." })
    f.store.reviews.relate(analyst, "request-A", { relationship: "claimed-inspected", source_record_id: source.id, member_ids: ["member-0"] })
    const linked = f.store.reviews.read(actor, "request-A").relationships[0]
    expect(linked).toMatchObject({ author: analyst, source_producer: coder,
      relationship_attribution: { status: "unknown", reason: "authored-association-unverified" }, source_record: source })
    f.db.prepare("DELETE FROM ledger WHERE id=?").run(source.id)
    const missing = f.store.reviews.read(actor, "request-A").relationships[0]
    expect(missing).toMatchObject({ source_availability: "source-missing", source_record: null,
      relationship_attribution: { status: "unknown", reason: "authored-association-unverified" } })
  } finally { f.close() }
})

test("artifact availability is explicit even when the original authored gap list is empty", () => {
  const f = fixture()
  try {
    const original = request("availability", 2)
    original.members[0].gaps = []
    original.members[1].gaps = []; original.members[1].artifact_refs[0].content_ref = "source:declared-only"
    f.store.reviews.freeze(actor, original)
    const read = f.store.reviews.read(actor, "availability")
    expect(read.members).toEqual(original.members)
    expect(read.artifact_availability).toMatchObject([
      { member_id: "member-0", artifact_index: 0, status: "unknown", reason: "source-missing" },
      { member_id: "member-1", artifact_index: 0, status: "unknown", reason: "not-observed" },
    ])
  } finally { f.close() }
})

test("recheck finding identities must belong to the referenced original review", () => {
  const f = fixture()
  try {
    f.store.reviews.freeze(actor, request())
    const followup = request("recheck")
    followup.rechecks = [{ request_id: "request-A", finding_ids: ["missing"] }]
    expect(() => f.store.reviews.freeze(actor, followup)).toThrow("existing finding relationship")
    const source = f.store.record(actor, undefined, { kind: "qa", verdict: "fail", statement: "Original defect" })
    const finding = f.store.reviews.relate(actor, "request-A", { relationship: "finding", source_record_id: source.id, member_ids: ["member-0"] })
    followup.rechecks[0].finding_ids = [finding.id]
    expect(f.store.reviews.freeze(actor, followup).status).toBe("created")
    expect(f.store.reviews.read(actor, "recheck").request.rechecks).toEqual(followup.rechecks)
  } finally { f.close() }
})

test("public reconstruction enforces the shared UTF-8 byte budget and offers smaller complete pages", () => {
  const f = fixture()
  try {
    f.store.reviews.freeze(actor, request())
    for (let i = 0; i < 45; i++) {
      // Existing large legacy metadata fixture, not new automatic raw capture.
      const source = f.store.observe(actor, undefined, { fixture: "☂".repeat(35000), index: i })
      f.store.reviews.relate(actor, "request-A", { relationship: "observed", source_record_id: source.id, member_ids: ["member-0"] })
    }
    expect(() => f.store.reviews.read(actor, "request-A", { limit: 50 })).toThrow("exceeds 4 MiB")
    const page = f.store.reviews.read(actor, "request-A", { limit: 20 })
    expect(page.relationships).toHaveLength(20)
    expect(page.next_relationship_after).not.toBeNull()
    expect(f.db.prepare("SELECT count(*) n FROM review_relationships").get()).toEqual({ n: 45 })
  } finally { f.close() }
})

test("corrupt persisted request identity cannot be read, prepared or claimed as another request", () => {
  const f = fixture()
  try {
    f.store.reviews.freeze(actor, request("A")); f.store.reviews.freeze(actor, request("B"))
    const prepared = f.store.reviews.prepareIssue(actor, "A", { kind: "initial" })
    const row = f.db.prepare("SELECT data FROM review_requests WHERE request_id='A'").get() as { data: string }
    const corrupt = JSON.parse(row.data); corrupt.request_id = "B"
    f.db.prepare("UPDATE review_requests SET data=? WHERE request_id='A'").run(JSON.stringify(corrupt))
    expect(() => f.store.reviews.read(actor, "A")).toThrow("identity is inconsistent")
    expect(() => f.store.reviews.prepareIssue(actor, "A", { kind: "initial" })).toThrow("identity is inconsistent")
    expect(() => f.store.reviews.claimIssue(actor, prepared.intent, "owner")).toThrow("identity is inconsistent")
    expect(f.db.prepare("SELECT state FROM review_issue_intents WHERE request_id='A'").get()).toEqual({ state: "prepared" })
    expect(f.store.reviews.read(actor, "B").request.request_id).toBe("B")
  } finally { f.close() }
})
