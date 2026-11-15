import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { WorkRef } from "../src/collaboration.js"
import { Store } from "../src/store.js"
import { registeredLoom } from "./helpers/registered-loom.js"

// These exercise registered production callbacks and real Store persistence.
// The registration host is simulated; this is not installed-host qualification.
function request(id: string, count = 1) {
  return {
    format: "loom-review-request/v1", request_id: id,
    mandate: {
      question: "Private original mandate: assess historical artifact A, including its limitations.",
      dimensions: ["correctness"], criteria: [{ text: "Preserve the original error behavior", source_ref: null }],
      mode: "independent", inclusions: ["historical artifact A"], exclusions: ["latest implementation"],
    },
    intended_recipient: { agent: "investigator", session_id: null },
    members: Array.from({ length: count }, (_, index) => ({
      member_id: `member-${index}`, work_ref: null as WorkRef | null, producing_attempt_refs: [],
      artifact_refs: [{ locator: `/private/artifact-${index}`, version: { kind: "sha256", value: index.toString(16).padStart(64, "0") }, content_ref: null }],
      prior_review_request_id: null, membership_source_refs: [], gaps: [{ reason: "source-missing", source_ref: null }],
    })),
    rechecks: [],
  }
}

test("normal typed review ask freezes once, prepares once and withholds protected delivery", async () => {
  const f = await registeredLoom()
  try {
    const review = request("automatic-review")
    const ask = { operation: "ask", question: review.mandate.question,
      recipient: { kind: "agent", id: "investigator" }, blocking: true, review }
    const contenders = await Promise.all([f.invoke("record", ask), f.invoke("record", ask)])
    expect(contenders.map(value => value.result.review.status).sort()).toEqual(["created", "existing"])
    const first = contenders[0].result
    expect(first.review.request_id).toBe(review.request_id)
    expect(first.dispatch).toEqual({ status: "not-attempted", attempted: false,
      reason: "recipient-specific-protected-transfer-unqualified" })
    const initial = (await f.invoke("review", { operation: "read", request_id: review.request_id })).result
    expect(initial.request.mandate).toEqual(review.mandate)
    expect(initial.request.requester).toEqual({ session_id: "s", agent: "author" })
    expect(initial.request.work_revision_policy).toBe("frozen-historical")
    expect(initial.members).toEqual(review.members)
    expect(initial.issues).toHaveLength(1)
    expect(initial.issues[0].attempt.state).toBe("prepared")
    const replay = (await f.invoke("record", ask)).result
    expect(replay.review.status).toBe("existing")
    const after = (await f.invoke("review", { operation: "read", request_id: review.request_id })).result
    expect(after.issues).toEqual(initial.issues)
    expect(f.sessionCreates).toEqual([])
    expect(f.sessionPrompts).toEqual([])
    expect(f.nativeInputs).toEqual([])
    expect((await f.invoke("record", { operation: "query", session_only: true })).result.items).toEqual([])
    const unrelated = await f.invoke("record", { operation: "query", view: "full_thread", session_id: "s" }, "other")
    expect(JSON.stringify(unrelated)).not.toContain(review.mandate.question)
    expect(JSON.stringify(unrelated)).not.toContain("/private/artifact-")
    await expect(f.invoke("review", { operation: "read", request_id: review.request_id }, "other", "investigator")).rejects.toThrow()
    expect((await f.invoke("context", {}, "other", "investigator")).result.selected).toBeNull()
    expect(f.permissionRequests.filter(p => p.action === "read").every(p =>
      p.resources.length === 1 && p.resources[0].endsWith("/ledger.sqlite"))).toBe(true)
  } finally { await f.close() }
})

test("same artifact reviews preserve distinct original mandates and reject rewriting by request ID", async () => {
  const f = await registeredLoom()
  try {
    const correctness = request("correctness"), security = request("security")
    security.mandate = { question: "Check the same artifact for security issues only.", dimensions: ["security"],
      criteria: [{ text: "Reject unauthorized access", source_ref: null }], mode: "adversarial", inclusions: [], exclusions: ["style"] }
    for (const original of [correctness, security]) {
      expect((await f.invoke("review", { operation: "freeze", request: original })).result.status).toBe("created")
      const read = (await f.invoke("review", { operation: "read", request_id: original.request_id })).result
      expect(read.request.mandate).toEqual(original.mandate)
      expect(read.members).toEqual(original.members)
    }
    const conflict = (await f.invoke("review", { operation: "freeze", request: { ...security, request_id: correctness.request_id } })).result
    expect(conflict.status).toBe("conflict")
    const preserved = (await f.invoke("review", { operation: "read", request_id: correctness.request_id })).result
    expect(preserved.request.mandate).toEqual(correctness.mandate)
    for (const forbidden of ["claim", "retry", "authorize"]) {
      await expect(f.invoke("review", { operation: forbidden, request_id: correctness.request_id })).rejects.toThrow("Unknown review operation")
    }
    await expect(f.invoke("review", { operation: "prepare", request_id: correctness.request_id, claimant_id: "new-owner" })).rejects.toThrow("Unsupported review operation field")
  } finally { await f.close() }
})

test("public review membership reconstructs all 100 historical artifacts across pages", async () => {
  const f = await registeredLoom()
  try {
    const original = request("whole-objective", 100)
    await f.invoke("review", { operation: "freeze", request: original })
    const members: unknown[] = []
    let after: number | null = 0
    const visited = new Set<number>()
    while (after !== null) {
      expect(visited.has(after)).toBe(false)
      visited.add(after)
      const page: { members: unknown[]; member_count: number; request: { mandate: unknown }; next_after: number | null } =
        (await f.invoke("review", { operation: "read", request_id: original.request_id, after, limit: 17 })).result
      expect(page.member_count).toBe(100)
      expect(page.request.mandate).toEqual(original.mandate)
      members.push(...page.members)
      after = page.next_after
    }
    expect(visited.size).toBeGreaterThan(1)
    expect(members).toEqual(original.members)
    expect(f.permissionRequests.filter(p => p.action === "read")).toHaveLength(visited.size + 1)
    expect(f.sessionCreates).toEqual([])
  } finally { await f.close() }
})

test("native read denial and revocation apply to freeze, every read page and preparation", async () => {
  const f = await registeredLoom()
  try {
    const original = request("revocable", 2)
    f.permission.error = new Error("Native read permission denied")
    await expect(f.invoke("review", { operation: "freeze", request: original })).rejects.toThrow("Native read permission denied")
    const deniedAsk = request("denied-automatic-review")
    await expect(f.invoke("record", { operation: "ask", question: deniedAsk.mandate.question,
      recipient: { kind: "agent", id: "investigator" }, blocking: false, review: deniedAsk })).rejects.toThrow("Native read permission denied")
    f.permission.error = undefined
    expect((await f.invoke("review", { operation: "freeze", request: original })).result.status).toBe("created")
    expect((await f.invoke("review", { operation: "freeze", request: deniedAsk })).result.status).toBe("created")
    const first = (await f.invoke("review", { operation: "read", request_id: original.request_id, limit: 1 })).result
    expect(first.members).toHaveLength(1)
    f.permission.error = new Error("Native read authorization withdrawn")
    for (const input of [
      { operation: "read", request_id: original.request_id, after: first.next_after, limit: 1 },
      { operation: "prepare", request_id: original.request_id },
      { operation: "work", request_id: original.request_id, member_id: "member-0" },
    ]) await expect(f.invoke("review", input)).rejects.toThrow("Native read authorization withdrawn")
    f.permission.error = undefined
    expect((await f.invoke("review", { operation: "read", request_id: original.request_id })).result.issues).toEqual([])
    f.permission.beforeReturn = async () => {
      f.sessions.set("s", { id: "s", projectID: "another-project", location: { directory: f.directory } })
    }
    await expect(f.invoke("review", { operation: "freeze", request: request("moved-during-approval") })).rejects.toThrow("Session is not in this Loom")
    f.sessions.delete("s")
    f.permission.beforeReturn = undefined
    expect((await f.invoke("review", { operation: "freeze", request: request("moved-during-approval") })).result.status).toBe("created")
  } finally { await f.close() }
})

test("structured review persistence rejects mismatched or silently omitted original intent", async () => {
  const f = await registeredLoom()
  try {
    const review = request("mismatched")
    const ask = { operation: "ask", question: review.mandate.question,
      recipient: { kind: "agent", id: "investigator" }, blocking: false, review }
    await expect(f.invoke("record", { ...ask, question: "A later reinterpretation" })).rejects.toThrow("exact original question")
    await expect(f.invoke("record", { ...ask, review: { ...review, intended_recipient: { agent: "other", session_id: null } } })).rejects.toThrow("intended recipient")
    await expect(f.invoke("record", { ...ask, context: "Important original context" })).rejects.toThrow("immutable review mandate/members")
    await expect(f.invoke("record", { operation: "ask", question: review.mandate.question, to_agent: "investigator", blocking: false, review })).rejects.toThrow("typed agent or role")
    expect((await f.invoke("record", { operation: "query", session_only: true })).result.items).toEqual([])
    expect(f.sessionCreates).toEqual([])
    expect((await f.invoke("review", { operation: "freeze", request: review })).result.status).toBe("created")
  } finally { await f.close() }
})

test("historical WorkRef and original question remain available through public readers after Plan B", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Historical review", goal: "Preserve A" })).result
    await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0,
      nodes: [{ id: "task", kind: "task", title: "Artifact A", outcome: "Original accepted outcome" }] })
    const context = (await f.invoke("context", { action_id: action.id, node_id: "task" })).result
    const original = request("review-of-a")
    original.members[0].work_ref = context.work_ref
    await f.invoke("review", { operation: "freeze", request: original })
    await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 1,
      nodes: [{ id: "task", kind: "task", title: "Artifact B", outcome: "Changed later outcome" }] })
    const read = (await f.invoke("review", { operation: "read", request_id: original.request_id })).result
    expect(read.request.work_revision_policy).toBe("frozen-historical")
    expect(read.request.mandate).toEqual(original.mandate)
    expect(read.members[0].work_ref).toEqual(context.work_ref)
    const historical = (await f.invoke("review", { operation: "work", request_id: original.request_id, member_id: "member-0" })).result
    expect(JSON.stringify(historical)).toContain("Original accepted outcome")
    expect(JSON.stringify(historical)).not.toContain("Changed later outcome")
    // The currentness condition is part of the original authored mandate.
    const current = { ...request("current-only"), mandate: { ...request("current-only").mandate, currentness: "current-at-issue-claim" },
      work_revision_policy: "current-at-issue-claim" }
    await f.invoke("review", { operation: "freeze", request: current })
    expect((await f.invoke("review", { operation: "read", request_id: current.request_id })).result.request.mandate.currentness).toBe("current-at-issue-claim")
    const invalid = { ...request("unexplained-freshness"), work_revision_policy: "current-at-issue-claim" }
    await expect(f.invoke("review", { operation: "freeze", request: invalid })).rejects.toThrow()
  } finally { await f.close() }
})

test("public evidence relationships preserve authored findings without claiming exact execution", async () => {
  const f = await registeredLoom()
  try {
    const original = request("qualified-finding")
    await f.invoke("review", { operation: "freeze", request: original })
    const source = (await f.invoke("record", { operation: "add", session_only: true,
      kind: "assessment", verdict: "inconclusive", statement: "Artifact unavailable; no complete review claimed." })).result
    await f.invoke("review", { operation: "relate", request_id: original.request_id,
      relationship: "finding", source_record_id: source.id, member_ids: ["member-0"] })
    const read = (await f.invoke("review", { operation: "read", request_id: original.request_id })).result
    expect(read.relationships).toHaveLength(1)
    expect(read.relationships[0]).toMatchObject({ relationship: "finding", source_record_id: source.id, member_ids: ["member-0"],
      source_producer: { session_id: "s", agent: "author" }, review_binding: { status: "unknown", reason: "unsupported-host-boundary" },
      relationship_attribution: { status: "unknown", reason: "authored-association-unverified" },
      declared_verdict: "inconclusive", verdict_scope: "authored; not proof of whole-request coverage" })
    await expect(f.invoke("review", { operation: "relate", request_id: original.request_id,
      relationship: "supplied", source_record_id: source.id, member_ids: ["member-0"] })).rejects.toThrow()
    await expect(f.invoke("review", { operation: "relate", request_id: original.request_id,
      relationship: "retrieved", source_record_id: source.id, member_ids: ["member-0"] })).rejects.toThrow()
    expect(f.sessionCreates).toEqual([])
  } finally { await f.close() }
})

test("production reopen preserves private request identity, canonical intent and read authorization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loom-review-reopen-"))
  const stateHome = join(directory, "state")
  let f: Awaited<ReturnType<typeof registeredLoom>> | undefined
  try {
    f = await registeredLoom([], { directory, stateHome })
    const original = request("reopened")
    await f.invoke("review", { operation: "freeze", request: original })
    await f.invoke("review", { operation: "prepare", request_id: original.request_id })
    const before = (await f.invoke("review", { operation: "read", request_id: original.request_id })).result
    await f.close(); f = undefined
    f = await registeredLoom([], { directory, stateHome })
    const after = (await f.invoke("review", { operation: "read", request_id: original.request_id })).result
    expect(after.request).toEqual(before.request)
    expect(after.members).toEqual(before.members)
    expect(after.issues).toEqual(before.issues)
    expect((await f.invoke("review", { operation: "freeze", request: original })).result.status).toBe("existing")
    await f.invoke("review", { operation: "prepare", request_id: original.request_id })
    expect((await f.invoke("review", { operation: "read", request_id: original.request_id })).result.issues).toEqual(before.issues)
    f.permission.error = new Error("Native permission revoked after restart")
    await expect(f.invoke("review", { operation: "read", request_id: original.request_id })).rejects.toThrow("revoked after restart")
    f.permission.error = undefined
    await expect(f.invoke("review", { operation: "read", request_id: original.request_id }, "recipient", "investigator")).rejects.toThrow()
    expect(f.sessionCreates).toEqual([])
  } finally {
    await f?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test("public issue reader reconstructs original intent and paged outcome evidence without a permit", async () => {
  const f = await registeredLoom()
  try {
    const original = request("outcome-evidence")
    await f.invoke("review", { operation: "freeze", request: original })
    const prepared = (await f.invoke("review", { operation: "prepare", request_id: original.request_id })).result
    const filename = f.permissionRequests.find(p => p.action === "read").resources[0]
    const db = new Database(filename)
    try {
      const store = new Store(db), actor = { session_id: "s", agent: "author" }
      expect(store.reviews.claimIssue(actor, prepared.intent, "native-owner").status).toBe("claimed-now")
      // Trusted owner fixture: these are local contract tests, not native receipts.
      store.reviews.issues.recordOutcome(prepared.intent, "native-owner", {
        status: "issued", source_ref: "fixture:original-call", reason: "Observed original call boundary" })
      store.reviews.issues.recordOutcome(prepared.intent, "native-owner", {
        status: "proven-non-admission", source_ref: "fixture:trusted-denial", reason: "Trusted fixture reports no native admission" })
    } finally { db.close() }
    const first = (await f.invoke("review", { operation: "issue", request_id: original.request_id, limit: 1 })).result
    expect(first.intent_body).toEqual({ intent: prepared.intent })
    expect(first.attempt.state).toBe("rejected")
    expect(first.outcomes).toHaveLength(1)
    expect(first.outcomes[0].source_ref).toBe("fixture:original-call")
    const second = (await f.invoke("review", { operation: "issue", request_id: original.request_id, after: first.next_outcome_sequence, limit: 1 })).result
    expect(second.outcomes[0]).toMatchObject({ status: "proven-non-admission", source_ref: "fixture:trusted-denial" })
    expect(second.next_outcome_sequence).toBeNull()
    expect((await f.invoke("review", { operation: "prepare", request_id: original.request_id })).result.attempt.attempt_id).toBe(prepared.attempt.attempt_id)
    await expect(f.invoke("review", { operation: "issue", request_id: original.request_id }, "foreign")).rejects.toThrow()
    f.permission.error = new Error("Native outcome read revoked")
    await expect(f.invoke("review", { operation: "issue", request_id: original.request_id })).rejects.toThrow("revoked")
    expect(f.sessionCreates).toEqual([])
  } finally { await f.close() }
})
