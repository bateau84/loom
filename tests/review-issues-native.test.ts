import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ReviewIssues, ReviewIssueError, type IssueIntentKey, type RetryAuthority, type RetryDecision, type ReviewIssueRequest } from "../src/review-issues.js"
import type { SQL } from "../src/store.js"

const actor = { session_id: "requester", agent: "general" }
type Request = ReviewIssueRequest & { revision: number }
const request = (id = "review-A", current = false): Request => ({
  request_id: id, requester: actor, revision: 1,
  work_revision_policy: current ? "current-at-issue-claim" : "frozen-historical",
})
const initial = (id = "review-A"): Extract<IssueIntentKey, { kind: "initial" }> => ({ request_id: id, kind: "initial" })
const proof = { status: "proven-non-admission", source_ref: "host:precreation-denial:1", reason: "Native pre-creation rejection established" }

// The request callback represents the existing admission owner's prevalidated
// frozen request. Retry decisions below are durable fixture-owned authority,
// not a production authorization API or qualification of OpenCode approvals.
function fixture(withAuthority = false) {
  const root = mkdtempSync(join(tmpdir(), "loom-review-issues-")), path = join(root, "actions.sqlite")
  const handles: Database[] = []
  function open() {
    const db = new Database(path)
    handles.push(db)
    db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS review_requests(request_id TEXT PRIMARY KEY NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixture_authorizations(reference TEXT PRIMARY KEY NOT NULL,body TEXT NOT NULL,active INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS fixture_current(id TEXT PRIMARY KEY NOT NULL,revision INTEGER NOT NULL);`)
    const owners = {
      request: (caller: typeof actor, id: string): Request => {
        const row = db.prepare("SELECT body FROM review_requests WHERE request_id=?").get(id) as { body: string } | undefined
        if (!row) throw new ReviewIssueError("request-not-found", "Unknown request")
        const found = JSON.parse(row.body) as Request
        if (found.requester.session_id !== caller.session_id) throw new ReviewIssueError("not-authorized", "Request is not readable by this Session")
        return found
      },
      checkFresh: (found: ReviewIssueRequest) => {
        const current = db.prepare("SELECT revision FROM fixture_current WHERE id=?").get(found.request_id) as { revision: number }
        if (current.revision !== (found as Request).revision) throw new ReviewIssueError("stale-scope", "Original mandate required current work")
      },
    }
    const authority: RetryAuthority = {
      resolve: (_caller, reference) => {
        const row = db.prepare("SELECT body FROM fixture_authorizations WHERE reference=?").get(reference) as { body: string } | undefined
        return row ? JSON.parse(row.body) as RetryDecision : undefined
      },
      recheck: (_caller, decision) => {
        const row = db.prepare("SELECT active FROM fixture_authorizations WHERE reference=?").get(decision.canonical_ref) as { active: number } | undefined
        return row?.active === 1
      },
    }
    const build = (sql: SQL = db) => new ReviewIssues(sql, owners, withAuthority ? authority : undefined)
    const issues = build()
    return { db, issues, build }
  }
  const first = open()
  function save(value: Request) {
    first.db.prepare("INSERT INTO review_requests(request_id,body) VALUES(?,?)").run(value.request_id, JSON.stringify(value))
    first.db.prepare("INSERT INTO fixture_current(id,revision) VALUES(?,?)").run(value.request_id, value.revision)
  }
  save(request())
  function authorize(reference: string, after = initial(), allowUnresolved = false, canonicalRef = reference) {
    const decision: RetryDecision = { canonical_ref: canonicalRef, request_id: after.request_id, after_intent: after,
      allow_unresolved_prior: allowUnresolved, authority_source: "fixture:durable-admission-authority" }
    first.db.prepare("INSERT INTO fixture_authorizations(reference,body,active) VALUES(?,?,1)").run(reference, JSON.stringify(decision))
    return decision
  }
  return { ...first, path, open, save, authorize,
    close() { for (const db of handles) { try { db.close() } catch { /* Already closed for recovery. */ } }; rmSync(root, { recursive: true, force: true }) },
  }
}
function codeOf(run: () => unknown, code: string) {
  try { run() } catch (error) {
    expect(error).toBeInstanceOf(ReviewIssueError)
    expect((error as ReviewIssueError).code).toBe(code)
    return
  }
  throw new Error("Expected rejection " + code)
}

test("initial preparation is canonical and only a fresh claim returns a native permit", () => {
  const f = fixture()
  try {
    const first = f.issues.prepare(actor, "review-A", { kind: "initial" })
    const other = f.open().issues.prepare(actor, "review-A", { kind: "initial" })
    expect(first.status).toBe("created")
    expect(other.status).toBe("existing")
    expect(other.attempt.attempt_id).toBe(first.attempt.attempt_id)
    let nativeCalls = 0
    for (const claimant of ["owner-1", "owner-2", "owner-1"]) {
      if (f.issues.claim(actor, first.intent, claimant).status === "claimed-now") nativeCalls++
    }
    expect(nativeCalls).toBe(1)
    expect(f.issues.read(actor, first.intent).attempt.claimant_id).toBe("owner-1")
    expect(f.issues.read(actor, first.intent).attempt.native_binding.status).toBe("unknown")
    for (const field of ["attempt_id", "intent_id", "sequence", "nonce"])
      codeOf(() => f.issues.prepare(actor, "review-A", { kind: "initial", [field]: "new-id" }), "invalid-input")
    expect(f.issues.list(actor, "review-A").items).toHaveLength(1)
  } finally { f.close() }
})

test("lost commit acknowledgements preserve prepared and consumed identities across reopen", () => {
  const f = fixture()
  try {
    let lose = false
    const issues = f.build({
      prepare: query => f.db.prepare(query),
      exec(query) { f.db.exec(query); if (query === "COMMIT" && lose) { lose = false; throw new Error("lost-commit-ack") } },
    })
    lose = true
    expect(() => issues.prepare(actor, "review-A", { kind: "initial" })).toThrow("lost-commit-ack")
    const recovered = f.open().issues.prepare(actor, "review-A", { kind: "initial" })
    expect(recovered.status).toBe("existing")
    expect(recovered.attempt.state).toBe("prepared")
    lose = true
    expect(() => issues.claim(actor, recovered.intent, "lost-owner")).toThrow("lost-commit-ack")
    f.db.close()
    const reopened = f.open().issues
    const same = reopened.prepare(actor, "review-A", { kind: "initial" })
    expect(same.attempt.attempt_id).toBe(recovered.attempt.attempt_id)
    expect(same.attempt.state).toBe("claimed")
    for (const owner of ["lost-owner", "replacement-owner"])
      expect(reopened.claim(actor, same.intent, owner).status).toBe("existing-state")
    expect(reopened.list(actor, "review-A").items).toHaveLength(1)
  } finally { f.close() }
})

test("failed transaction publishes neither an intent nor a dispatchable attempt", () => {
  const f = fixture()
  try {
    let fail = true
    const issues = f.build({ prepare: query => f.db.prepare(query), exec(query) {
      if (query === "COMMIT" && fail) { fail = false; throw new Error("commit-not-written") }
      f.db.exec(query)
    } })
    expect(() => issues.prepare(actor, "review-A", { kind: "initial" })).toThrow("commit-not-written")
    expect(f.issues.list(actor, "review-A").items).toHaveLength(0)
    expect(issues.prepare(actor, "review-A", { kind: "initial" }).status).toBe("created")
  } finally { f.close() }
})

test("proven non-admission refines prior observations but never reopens the consumed intent", () => {
  const f = fixture()
  try {
    const prepared = f.issues.prepare(actor, "review-A", { kind: "initial" })
    f.issues.claim(actor, prepared.intent, "owner")
    f.issues.recordOutcome(prepared.intent, "owner", { status: "issued", source_ref: "host:call-start", reason: "Native call started; admission unconfirmed" })
    f.issues.recordOutcome(prepared.intent, "owner", proof)
    const read = f.open().issues.read(actor, prepared.intent)
    expect(read.attempt.state).toBe("rejected")
    expect(read.attempt.native_outcome).toBe("proven-non-admission")
    expect(read.outcomes.map(item => item.status)).toEqual(["issued", "proven-non-admission"])
    expect(f.issues.claim(actor, prepared.intent, "owner").status).toBe("existing-state")
    codeOf(() => f.issues.prepare(actor, "review-A", { kind: "retry", after_intent: prepared.intent, authorization_ref: "user-says-retry" }), "retry-authority-unavailable")
    codeOf(() => f.issues.recordOutcome(prepared.intent, "other-owner", proof), "claim-owner-mismatch")
    expect(f.issues.read(actor, prepared.intent).outcomes).toHaveLength(2)
  } finally { f.close() }
})

test("unknown execution stays uncertain and neither replay nor a fake decision redispatches", () => {
  const f = fixture(true)
  try {
    const prepared = f.issues.prepare(actor, "review-A", { kind: "initial" })
    let nativeCalls = 0
    if (f.issues.claim(actor, prepared.intent, "owner").status === "claimed-now") nativeCalls++
    f.issues.recordOutcome(prepared.intent, "owner", { status: "unknown", source_ref: "host:lost-ack", reason: "Native call timed out without decisive receipt" })
    const reader = f.open().issues
    if (reader.claim(actor, prepared.intent, "owner").status === "claimed-now") nativeCalls++
    expect(reader.read(actor, prepared.intent).attempt.native_outcome).toBe("unknown")
    codeOf(() => reader.prepare(actor, "review-A", { kind: "retry", after_intent: prepared.intent, authorization_ref: "fabricated" }), "retry-not-authorized")
    f.authorize("only-after-non-admission")
    codeOf(() => reader.prepare(actor, "review-A", { kind: "retry", after_intent: prepared.intent, authorization_ref: "only-after-non-admission" }), "unresolved-prior-issue")
    expect(nativeCalls).toBe(1)
    expect(reader.list(actor, "review-A").items).toHaveLength(1)
  } finally { f.close() }
})

test("durable canonical retry authority, aliases and replay grant one additional permit", () => {
  const f = fixture(true)
  try {
    f.issues.prepare(actor, "review-A", { kind: "initial" })
    f.issues.claim(actor, initial(), "first-owner")
    f.issues.recordOutcome(initial(), "first-owner", proof)
    const originalDecision = f.authorize("decision-1")
    f.authorize("decision-alias", initial(), false, "decision-1")
    const retry = (reference: string) => ({ kind: "retry", authorization_ref: reference, after_intent: initial() })
    const created = f.issues.prepare(actor, "review-A", retry("decision-alias"))
    const replay = f.open().issues.prepare(actor, "review-A", retry("decision-1"))
    expect(created.status).toBe("created")
    expect(replay.status).toBe("existing")
    expect(created.intent).toEqual({ request_id: "review-A", kind: "retry", authorization_ref: "decision-1" })
    expect(created.attempt.attempt_id).toBe(replay.attempt.attempt_id)
    expect(created.attempt.attempt_id).not.toBe(f.issues.read(actor, initial()).attempt.attempt_id)
    expect(f.issues.claim(actor, created.intent, "retry-owner").status).toBe("claimed-now")
    expect(f.open().issues.claim(actor, created.intent, "retry-owner").status).toBe("existing-state")
    expect(f.issues.prepare(actor, "review-A", retry("decision-alias")).attempt.state).toBe("claimed")
    expect(f.issues.read(actor, initial()).attempt.native_outcome).toBe("proven-non-admission")
    expect(f.issues.list(actor, "review-A").items).toHaveLength(2)
    const reopened = f.open().issues
    expect(reopened.read(actor, created.intent).intent_body).toEqual({ intent: { request_id: "review-A", kind: "retry", authorization_ref: "decision-1" },
      after_intent: initial(), decision: originalDecision })
    expect(reopened.read(actor, initial()).intent_body).toEqual({ intent: initial() })
  } finally { f.close() }
})

test("unknown predecessor requires a decision expressly permitting unresolved execution", () => {
  const f = fixture(true)
  try {
    f.issues.prepare(actor, "review-A", { kind: "initial" })
    f.issues.claim(actor, initial(), "first-owner")
    f.authorize("acknowledged-risk", initial(), true)
    const retry = f.issues.prepare(actor, "review-A", { kind: "retry", authorization_ref: "acknowledged-risk", after_intent: initial() })
    expect(f.issues.claim(actor, retry.intent, "second-owner").status).toBe("claimed-now")
    expect(f.issues.read(actor, initial()).attempt.native_outcome).toBe("unknown")
  } finally { f.close() }
})

test("one canonical authorization cannot be rebound to another request or predecessor", () => {
  const f = fixture(true)
  try {
    f.save(request("review-B"))
    f.issues.prepare(actor, "review-A", { kind: "initial" })
    f.issues.prepare(actor, "review-B", { kind: "initial" })
    f.authorize("decision-1", initial(), true)
    f.authorize("malformed-authority-alias", initial("review-B"), true, "decision-1")
    const first = f.issues.prepare(actor, "review-A", { kind: "retry", authorization_ref: "decision-1", after_intent: initial() })
    codeOf(() => f.issues.prepare(actor, "review-B", { kind: "retry", authorization_ref: "malformed-authority-alias", after_intent: initial("review-B") }), "conflict")
    codeOf(() => f.issues.prepare(actor, "review-A", { kind: "retry", authorization_ref: "decision-1", after_intent: first.intent }), "conflict")
    expect(f.issues.list(actor, "review-A").items).toHaveLength(2)
    expect(f.issues.list(actor, "review-B").items).toHaveLength(1)
  } finally { f.close() }
})

test("revoked or changed authority cannot authorize a prepared retry claim", () => {
  const f = fixture(true)
  try {
    f.issues.prepare(actor, "review-A", { kind: "initial" })
    f.authorize("decision-1", initial(), true)
    const prepared = f.issues.prepare(actor, "review-A", { kind: "retry", authorization_ref: "decision-1", after_intent: initial() })
    f.db.prepare("UPDATE fixture_authorizations SET active=0 WHERE reference=?").run("decision-1")
    const rejected = f.issues.claim(actor, prepared.intent, "retry-owner")
    expect(rejected.status).toBe("rejected")
    expect(rejected.attempt.rejection_reason).toBe("retry-authority-revoked")
    expect(rejected.attempt.claimant_id).toBeNull()
    expect(f.issues.prepare(actor, "review-A", { kind: "retry", authorization_ref: "decision-1", after_intent: initial() }).status).toBe("existing")
    f.db.prepare("UPDATE fixture_authorizations SET active=1 WHERE reference=?").run("decision-1")
    expect(f.issues.claim(actor, prepared.intent, "retry-owner").status).toBe("existing-state")
    const nextDecision = f.authorize("decision-2", initial(), true)
    const changed = f.issues.prepare(actor, "review-A", { kind: "retry", authorization_ref: "decision-2", after_intent: initial() })
    f.db.prepare("UPDATE fixture_authorizations SET body=? WHERE reference=?")
      .run(JSON.stringify({ ...nextDecision, authority_source: "fixture:different-authorizing-act" }), "decision-2")
    expect(f.issues.claim(actor, changed.intent, "changed-owner").attempt.rejection_reason).toBe("retry-authority-changed")
  } finally { f.close() }
})

test("frozen historical work remains issuable; mandate currentness rejects a stale claim", () => {
  const f = fixture()
  try {
    f.save(request("review-current", true))
    const historical = f.issues.prepare(actor, "review-A", { kind: "initial" })
    const current = f.issues.prepare(actor, "review-current", { kind: "initial" })
    f.db.exec("UPDATE fixture_current SET revision=2")
    expect(f.issues.claim(actor, historical.intent, "history-owner").status).toBe("claimed-now")
    const rejected = f.issues.claim(actor, current.intent, "current-owner")
    expect(rejected.status).toBe("rejected")
    expect(rejected.attempt.rejection_reason).toBe("stale-scope")
    expect(rejected.attempt.claimant_id).toBeNull()
    expect(f.issues.read(actor, current.intent).attempt.native_outcome).toBe("not-issued")
  } finally { f.close() }
})

test("request authorization is checked on preparation, claims and every read page", () => {
  const f = fixture()
  try {
    f.issues.prepare(actor, "review-A", { kind: "initial" })
    const foreign = { session_id: "another-session", agent: "reviewer" }
    for (const action of [
      () => f.issues.prepare(foreign, "review-A", { kind: "initial" }),
      () => f.issues.claim(foreign, initial(), "intruder"),
      () => f.issues.read(foreign, initial()),
      () => f.issues.list(foreign, "review-A"),
    ]) codeOf(action, "not-authorized")
    expect(f.issues.read(actor, initial()).attempt.state).toBe("prepared")
  } finally { f.close() }
})

test("freshness storage errors abort claim without a permit or a fabricated rejection", () => {
  const f = fixture()
  try {
    f.issues.prepare(actor, "review-A", { kind: "initial" })
    const broken = new ReviewIssues(f.db, {
      request: (_actor, id) => request(id, true),
      checkFresh: () => { throw Object.assign(new Error("Storage I/O unavailable"), { code: "SQLITE_IOERR" }) },
    })
    expect(() => broken.claim(actor, initial(), "owner")).toThrow("Storage I/O unavailable")
    const result = f.issues.read(actor, initial())
    expect(result.attempt.state).toBe("prepared")
    expect(result.attempt.claimant_id).toBeNull()
    expect(result.attempt.rejection_reason).toBeNull()
  } finally { f.close() }
})

test("public issue reconstruction rejects corrupted intent, authority and native semantics", () => {
  const f = fixture(true)
  try {
    f.issues.prepare(actor, "review-A", { kind: "initial" })
    f.issues.claim(actor, initial(), "owner")
    f.issues.recordOutcome(initial(), "owner", { status: "unknown", source_ref: "host:original", reason: "No native acknowledgement" })
    const original = f.db.prepare("SELECT intent_data FROM review_issue_intents WHERE decision_ref IS NULL").get() as { intent_data: string }
    f.db.prepare("UPDATE review_issue_intents SET intent_data=? WHERE decision_ref IS NULL")
      .run(JSON.stringify({ intent: { request_id: "review-A", kind: "future-intent" } }))
    codeOf(() => f.issues.read(actor, initial()), "invalid-stored-issue")
    codeOf(() => f.issues.claim(actor, initial(), "owner"), "invalid-stored-issue")
    f.db.prepare("UPDATE review_issue_intents SET intent_data=? WHERE decision_ref IS NULL").run(original.intent_data)
    f.db.exec("PRAGMA ignore_check_constraints=ON; UPDATE review_issue_intents SET native_outcome='future-success'")
    codeOf(() => f.issues.read(actor, initial()), "invalid-stored-issue")
    f.db.exec("UPDATE review_issue_intents SET native_outcome='unknown'")
    f.db.prepare("UPDATE review_issue_outcomes SET source_ref=?").run("oversized".repeat(1000))
    codeOf(() => f.issues.read(actor, initial()), "invalid-stored-issue")
    f.db.exec("UPDATE review_issue_outcomes SET source_ref='host:original',status='future-admission'")
    codeOf(() => f.issues.read(actor, initial()), "invalid-stored-issue")
    f.db.exec("UPDATE review_issue_outcomes SET status='unknown'; PRAGMA ignore_check_constraints=OFF")
    const authorized = f.authorize("decision-1", initial(), true)
    const retry = f.issues.prepare(actor, "review-A", { kind: "retry", after_intent: initial(), authorization_ref: "decision-1" })
    f.db.prepare("UPDATE review_issue_intents SET decision_data=? WHERE decision_ref=?")
      .run(JSON.stringify({ ...authorized, request_id: "other-request" }), "decision-1")
    codeOf(() => f.open().issues.read(actor, retry.intent), "invalid-stored-issue")
    codeOf(() => f.issues.claim(actor, retry.intent, "retry-owner"), "invalid-stored-issue")
    const row = f.db.prepare("SELECT state FROM review_issue_intents WHERE decision_ref=?").get("decision-1") as { state: string }
    expect(row.state).toBe("prepared")
  } finally { f.close() }
})

function child(path: string, operation: "initial" | "retry", authorization = "decision-1", requestID = "review-A") {
  const module = new URL("../src/review-issues.ts", import.meta.url).pathname
  const code = `import { Database } from 'bun:sqlite';
    import { readFileSync } from 'node:fs';
    import { ReviewIssues } from ${JSON.stringify(module)};
    const db = new Database(${JSON.stringify(path)});
    db.exec('PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON');
    const actor = {session_id:'requester',agent:'general'};
    const issues = new ReviewIssues(db, {
      request(actor,id) { const row=db.prepare('SELECT body FROM review_requests WHERE request_id=?').get(id); if(!row)throw Error('missing request'); const value=JSON.parse(row.body); if(value.requester.session_id!==actor.session_id)throw Error('denied'); return value; },
      checkFresh() {}
    }, { resolve(actor,ref) { const row=db.prepare('SELECT body FROM fixture_authorizations WHERE reference=?').get(ref); return row?JSON.parse(row.body):undefined; },
      recheck(actor,decision) { return db.prepare('SELECT active FROM fixture_authorizations WHERE reference=?').get(decision.canonical_ref)?.active===1; }
    });
    console.log('READY');
    readFileSync(0,'utf8');
    try {
      const intent=${JSON.stringify(operation === "initial" ? { kind: "initial" } : { kind: "retry", authorization_ref: authorization, after_intent: initial(requestID) })};
      const prepared=issues.prepare(actor,${JSON.stringify(requestID)},intent);
      const claimed=issues.claim(actor,prepared.intent,'process-'+process.pid);
      console.log(JSON.stringify({prepared,claimed}));
    } catch(error) { console.log(JSON.stringify({error:error.code,message:error.message})); }
    db.close();`
  const proc = spawn(process.execPath, ["--eval", code], { stdio: ["pipe", "pipe", "pipe"] })
  let output = "", diagnostic = "", readyResolve: () => void = () => {}, readyReject: (error: Error) => void = () => {}
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  const timer = setTimeout(() => { proc.kill(); readyReject(new Error("Review issue child did not become ready: " + diagnostic)) }, 10000)
  proc.stdout.on("data", chunk => { output += String(chunk); if (output.includes("READY\n")) readyResolve() })
  proc.stderr.on("data", chunk => { diagnostic += String(chunk) })
  type ChildResult = { prepared?: { status: string; attempt: { attempt_id: string } }; claimed?: { status: string }; error?: string }
  const done = new Promise<ChildResult>((resolve, reject) => {
    proc.on("error", error => { clearTimeout(timer); readyReject(error); reject(error) })
    proc.on("close", exit => {
      clearTimeout(timer)
      if (exit !== 0) { const error = new Error("Review issue child failed: " + diagnostic); readyReject(error); reject(error); return }
      try { resolve(JSON.parse(output.trim().split("\n").at(-1) ?? "") as ChildResult) } catch (error) { reject(error) }
    })
  })
  return { ready, done, release: () => proc.stdin.end("go"), kill: () => proc.kill() }
}

test("independent processes concurrently prepare and claim one canonical initial intent", async () => {
  const f = fixture(), children = [child(f.path, "initial"), child(f.path, "initial")]
  try {
    await Promise.all(children.map(item => item.ready))
    for (const item of children) item.release()
    const results = await Promise.all(children.map(item => item.done))
    expect(results.map(item => item.error)).toEqual([undefined, undefined])
    expect(results.map(item => item.prepared?.status).sort()).toEqual(["created", "existing"])
    expect(new Set(results.map(item => item.prepared?.attempt.attempt_id)).size).toBe(1)
    expect(results.map(item => item.claimed?.status).sort()).toEqual(["claimed-now", "existing-state"])
    expect(f.issues.list(actor, "review-A").items).toHaveLength(1)
  } finally { for (const item of children) item.kill(); f.close() }
}, 20000)

test("concurrent canonical retry aliases share one additional intent and permit", async () => {
  const f = fixture(true)
  f.issues.prepare(actor, "review-A", { kind: "initial" })
  f.issues.claim(actor, initial(), "initial-owner")
  f.issues.recordOutcome(initial(), "initial-owner", proof)
  f.authorize("decision-1")
  f.authorize("alias", initial(), false, "decision-1")
  const children = [child(f.path, "retry"), child(f.path, "retry", "alias")]
  try {
    await Promise.all(children.map(item => item.ready))
    for (const item of children) item.release()
    const results = await Promise.all(children.map(item => item.done))
    expect(results.map(item => item.error)).toEqual([undefined, undefined])
    expect(results.map(item => item.prepared?.status).sort()).toEqual(["created", "existing"])
    expect(new Set(results.map(item => item.prepared?.attempt.attempt_id)).size).toBe(1)
    expect(results.map(item => item.claimed?.status).sort()).toEqual(["claimed-now", "existing-state"])
    expect(f.issues.list(actor, "review-A").items).toHaveLength(2)
  } finally { for (const item of children) item.kill(); f.close() }
}, 20000)

test("conflicting concurrent uses cannot bind one decision to two requests", async () => {
  const f = fixture(true)
  f.save(request("review-B"))
  f.issues.prepare(actor, "review-A", { kind: "initial" })
  f.issues.prepare(actor, "review-B", { kind: "initial" })
  f.authorize("decision-1", initial(), true)
  f.authorize("bad-alias", initial("review-B"), true, "decision-1")
  const children = [child(f.path, "retry"), child(f.path, "retry", "bad-alias", "review-B")]
  try {
    await Promise.all(children.map(item => item.ready))
    for (const item of children) item.release()
    const results = await Promise.all(children.map(item => item.done))
    expect(results.filter(item => item.error === "conflict")).toHaveLength(1)
    expect(results.filter(item => item.prepared?.status === "created")).toHaveLength(1)
    expect(results.filter(item => item.claimed?.status === "claimed-now")).toHaveLength(1)
    const rows = f.db.prepare("SELECT COUNT(*) AS n FROM review_issue_intents WHERE decision_ref IS NOT NULL").get() as { n: number }
    expect(rows.n).toBe(1)
  } finally { for (const item of children) item.kill(); f.close() }
}, 20000)
