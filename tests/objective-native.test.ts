import { test, expect } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { registeredLoom } from "./helpers/registered-loom.js"
import { digest } from "../src/model.js"

const pause = () => Bun.sleep(3)
const nativeUser = (id: string) => ({ id, type: "user", text: "Private original request; do not store the full body", time: { created: Date.now() } })
const nativeDispatch = (msg: string, call: string, name = "task") => ({
  id: msg, type: "assistant", agent: "author", time: { created: Date.now() },
  content: [{ type: "tool", id: call, name, state: { status: "completed", input: { subagent_type: "coder", prompt: "Private dispatch" } } }],
})
const actionRecord = async (host: Awaited<ReturnType<typeof registeredLoom>>, actionID: string, verdict: "pass" | "fail", statement: string, session = "parent") =>
  (await host.invoke("record", { operation: "add", kind: "qa", action_id: actionID, verdict, statement }, session)).result

async function childExport(host: Awaited<ReturnType<typeof registeredLoom>>, child: string, parent: string, message: string) {
  host.sessions.set(child, {
    id: child, parentID: parent, projectID: "tool-help", location: { directory: host.directory },
  })
  await writeFile(join(host.directory, child + ".json"), JSON.stringify({
    info: { id: child, projectID: "tool-help", location: { directory: host.directory } },
    messages: [{
      id: message, type: "assistant", agent: "coder", time: { created: Date.now() },
      content: [{ type: "text", text: "DONE; child-side claim is not verification" }],
    }],
  }))
}

test("three Coder DONE reports followed by two runtime failures remain one sourced objective with one verified outcome", async () => {
  // A fixture from a simulated native OpenCode host; production registration, source projection,
  // authorization callback, Store and both SQLite databases are real. Not a live model run.
  const host = await registeredLoom()
  try {
    const messages: any[] = [nativeUser("request-feature")]
    host.nativeContexts.set("parent", { data: messages })
    const action = (await host.invoke("action", { operation: "create", title: "Runtime scenario",
      goal: "One feature plus end-to-end runtime verification" }, "parent")).result
    const objective = (await host.invoke("objective", {
      operation: "create", source_type: "native-message", source_id: "request-feature",
      label: "Make the runtime scenario pass",
    }, "parent")).result
    expect(objective.existing).toBe(false)
    expect(objective.author_session).toBe("parent")
    const phases: string[] = ["request"]
    let failedVerificationSequence = 0
    const verificationIDs: string[] = []
    for (let n = 1; n <= 3; n++) {
      await pause()
      const msg = "dispatch-" + n, call = "call-" + n
      messages.push(nativeDispatch(msg, call))
      const dispatched = (await host.invoke("objective", {
        operation: "link", objective_id: objective.id, phase: n === 1 ? "dispatch" : "corrective-dispatch",
        source_type: "native-call", source_id: call, source_message_id: msg, source_session_id: "parent",
        ...(n > 1 ? { related_sequence: failedVerificationSequence } : {}),
        note: n === 1 ? "First requested implementation" : "Corrective redispatch after failed runtime check",
      }, "parent")).result
      expect(dispatched.event_kind).toBe("agent_dispatch")
      phases.push(n === 1 ? "dispatch" : "corrective-dispatch")

      await pause()
      const child = "coder-" + n
      await childExport(host, child, "parent", "handback-" + n)
      const handback = (await host.invoke("objective", {
        operation: "link", objective_id: objective.id, phase: "handback",
        source_type: "native-message", source_id: "handback-" + n,
        source_session_id: child, export_path: child + ".json",
        assessment: "reported-done", note: "Child reported DONE, not an acceptance result",
      }, "parent")).result
      expect(handback.verification).toBe("provided-export-unverified")
      expect(handback.parent_session_id).toBe("parent")
      expect(handback.author_session).toBe("parent")
      phases.push("handback")

      await pause()
      const original = await actionRecord(host, action.id, n < 3 ? "fail" : "pass",
        n < 3 ? "Requested runtime scenario failed on implementation " + n
          : "Requested runtime scenario passed on implementation 3")
      verificationIDs.push(original.id)
      const verified = (await host.invoke("objective", {
        operation: "link", objective_id: objective.id, phase: "verification",
        source_type: "ledger-record", source_id: original.id, assessment: n < 3 ? "fail" : "pass",
        note: "Authored verification interpretation of the original QA record",
      }, "parent")).result
      expect(verified.source_id).toBe(original.id)
      expect(verified.source_session_id).toBe("parent")
      expect(verified.action_id).toBe(action.id)
      failedVerificationSequence = verified.sequence
      phases.push("verification")
    }

    const original = (await host.invoke("record", { operation: "query", action_id: action.id, limit: 20 }, "parent")).result.items
    expect(original.filter((r: any) => r.kind === "qa").map((r: any) => r.data.verdict)).toEqual(["fail", "fail", "pass"])
    const page = (await host.invoke("objective", { operation: "read", objective_id: objective.id }, "parent")).result
    expect(page.entries).toHaveLength(10)
    expect(page.entries.map((r: any) => r.phase)).toEqual(phases)
    expect(page.entries.filter((r: any) => r.phase === "handback").map((r: any) => r.assessment))
      .toEqual(["reported-done", "reported-done", "reported-done"])
    expect(page.entries.filter((r: any) => r.phase === "verification").map((r: any) => r.assessment))
      .toEqual(["fail", "fail", "pass"])
    expect(page.entries.filter((r: any) => r.phase === "verification").map((r: any) => r.source_id))
      .toEqual(verificationIDs)
    expect(page.entries.filter((r: any) => r.phase === "corrective-dispatch").map((r: any) => r.related_sequence))
      .toEqual([4, 7])
    expect(page.coverage.completeness).toBe("unknown")
    expect(page.coverage.raw_transcripts_stored).toBe(false)
    expect(JSON.stringify(page)).not.toContain("Private dispatch")
    const list = (await host.invoke("objective", { operation: "list" }, "parent")).result
    expect(list.items).toHaveLength(1)
    const find = (await host.invoke("objective", { operation: "find",
      source_type: "ledger-record", source_id: verificationIDs[0] }, "parent")).result
    expect(find.items.map((x: any) => x.id)).toEqual([objective.id])

    const root = join(host.directory, "state", "loom", "actions-v1",
      digest({ project: "tool-help", canonical: host.directory }))
    const learning = new Database(join(root, "learning.sqlite"))
    const actionDB = new Database(join(root, "ledger.sqlite"))
    try {
      expect((learning.query("SELECT count(*) AS n FROM learning_objectives").get() as any).n).toBe(1)
      expect((learning.query("SELECT count(*) AS n FROM learning_objective_links").get() as any).n).toBe(10)
      expect(actionDB.query("SELECT name FROM sqlite_schema WHERE name LIKE 'learning_objective%'").all()).toEqual([])
    } finally { learning.close(); actionDB.close() }
    expect(host.permissionRequests.filter((p: any) => p.action === "read")).toHaveLength(3)
  } finally { await host.close() }
})

test("one Session/Action can have multiple goals; one source can support several, and continuation crosses Actions", async () => {
  const host = await registeredLoom()
  try {
    const sameMessage = nativeUser("two-goals")
    host.nativeContexts.set("parent", { data: [sameMessage] })
    const a = (await host.invoke("action", { operation: "create", title: "Two goals", goal: "Several outcomes" }, "parent")).result
    const first = (await host.invoke("objective", { operation: "create", source_type: "native-message",
      source_id: "two-goals", unit_key: "goal-a", label: "Feature goal" }, "parent")).result
    const second = (await host.invoke("objective", { operation: "create", source_type: "native-message",
      source_id: "two-goals", unit_key: "goal-b", label: "Documentation goal" }, "parent")).result
    expect(first.id).not.toBe(second.id)
    const shared = await actionRecord(host, a.id, "pass", "Shared check for multiple goals")
    const common = { operation: "link", phase: "verification", source_type: "ledger-record", source_id: shared.id, assessment: "pass" }
    await host.invoke("objective", { ...common, objective_id: first.id }, "parent")
    await host.invoke("objective", { ...common, objective_id: second.id }, "parent")
    const matches = (await host.invoke("objective", { operation: "find",
      source_type: "native-message", source_id: "two-goals", source_session_id: "parent" }, "parent")).result
    expect(new Set(matches.items.map((x: any) => x.id))).toEqual(new Set([first.id, second.id]))

    // Same parent/Action evidence is only a candidate when attribution is uncertain.
    const uncertain = (await host.invoke("objective", { operation: "link", objective_id: second.id,
      phase: "coordination", source_type: "ledger-record", source_id: shared.id,
      confidence: "uncertain", note: "The review mentions both goals; intent unclear" }, "parent")).result
    await pause()
    const corrected = (await host.invoke("objective", { operation: "link", objective_id: second.id,
      phase: "link-correction", source_type: "ledger-record", source_id: shared.id,
      assessment: "reject", related_sequence: uncertain.sequence,
      note: "Original author clarified the coordination note belonged to the other goal" }, "parent")).result
    expect(corrected.related_sequence).toBe(uncertain.sequence)
    expect(corrected.recorded_at).toBeTruthy()
    const later = (await host.invoke("objective", { operation: "read", objective_id: second.id }, "parent")).result
    expect(later.entries.find((x: any) => x.sequence === uncertain.sequence).current_relationship).toBe("rejected")
    expect(later.entries.find((x: any) => x.sequence === uncertain.sequence).confidence).toBe("uncertain")
    expect(later.entries.some((x: any) => x.phase === "link-correction")).toBe(true)
    expect((await host.invoke("objective", { operation: "read", objective_id: first.id }, "parent")).result.entries)
      .toHaveLength(2)

    host.nativeContexts.set("followup", { data: [nativeUser("continued-request")] })
    const b = (await host.invoke("action", { operation: "create",
      title: "Follow-up", goal: "Finish previous feature objective" }, "followup")).result
    const continued = (await host.invoke("objective", { operation: "link", objective_id: first.id,
      phase: "continuation", source_type: "native-message", source_id: "continued-request",
      source_session_id: "followup", related_sequence: 1, note: "Explicitly authorized continuation from the original user goal" }, "followup")).result
    expect(continued.author_session).toBe("followup")
    const bProof = await actionRecord(host, b.id, "pass", "Later Action verification", "followup")
    await host.invoke("objective", { ...common, objective_id: first.id, source_id: bProof.id }, "followup")
    const linked = (await host.invoke("objective", { operation: "read", objective_id: first.id }, "parent")).result
    expect(new Set(linked.entries.map((x: any) => x.action_id).filter(Boolean))).toEqual(new Set([a.id, b.id]))
    expect(linked.entries.some((x: any) => x.phase === "continuation")).toBe(true)
    expect((await host.invoke("objective", { operation: "list" }, "parent")).result.items).toHaveLength(2)
  } finally { await host.close() }
})

test("persistent source identity, immutable later objections and stable paginated reads survive restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loom-objective-restart-"))
  try {
    const first = await registeredLoom([], { directory })
    let objectiveID = "", originalCount = 0
    try {
      first.nativeContexts.set("parent", { data: [nativeUser("persisted-request")] })
      const created = (await first.invoke("objective", { operation: "create", source_type: "native-message",
        source_id: "persisted-request", label: "The original goal" }, "parent")).result
      objectiveID = created.id
      for (let i = 0; i < 25; i++) {
        await first.invoke("objective", { operation: "link", objective_id: objectiveID,
          phase: "coordination", source_type: "external-ref", source_id: `https://github.com/bateau84/loom/issues/${i + 1}`,
          note: "Source-pinned fixture reference; not an observed production issue" }, "parent")
      }
      originalCount = (await first.invoke("objective", { operation: "read", objective_id: objectiveID }, "parent")).result.snapshot_max_sequence
      expect(originalCount).toBe(26)
    } finally { await first.close() }

    const resumed = await registeredLoom([], { directory })
    try {
      resumed.nativeContexts.set("parent", { data: [nativeUser("persisted-request")] })
      const same = (await resumed.invoke("objective", { operation: "create", source_type: "native-message",
        source_id: "persisted-request", label: "The original goal" }, "parent")).result
      expect(same.id).toBe(objectiveID)
      expect(same.existing).toBe(true)
      const before = (await resumed.invoke("objective", { operation: "read", objective_id: objectiveID, limit: 10 }, "parent")).result
      expect(before.entries).toHaveLength(10)
      expect(before.next_cursor).toBeTruthy()
      await resumed.invoke("objective", { operation: "link", objective_id: objectiveID,
        phase: "requirement-change", source_type: "external-ref",
        source_id: "https://github.com/bateau84/loom/pull/217", note: "New interpreted change" }, "parent")
      const pages: any[] = [...before.entries]
      let cursor = before.next_cursor
      while (cursor) {
        const page = (await resumed.invoke("objective", {
          operation: "read", objective_id: objectiveID, limit: 10, cursor }, "parent")).result
        pages.push(...page.entries)
        cursor = page.next_cursor
      }
      expect(pages).toHaveLength(26)
      expect(new Set(pages.map(x => x.sequence)).size).toBe(26)
      expect(pages.every(x => x.sequence <= originalCount)).toBe(true)
      const final = (await resumed.invoke("objective", { operation: "read", objective_id: objectiveID, limit: 50 }, "parent")).result
      expect(final.entries).toHaveLength(27)
      await expect(resumed.invoke("objective", { operation: "read", objective_id: "wrong", cursor: before.next_cursor }, "parent"))
        .rejects.toThrow()
      const duplicate = (await resumed.invoke("objective", { operation: "link", objective_id: objectiveID,
        phase: "requirement-change", source_type: "external-ref",
        source_id: "https://github.com/bateau84/loom/pull/217", note: "New interpreted change" }, "parent")).result
      expect(duplicate.existing).toBe(true)
      expect((await resumed.invoke("objective", { operation: "read", objective_id: objectiveID, limit: 50 }, "parent")).result.entries)
        .toHaveLength(27)
    } finally { await resumed.close() }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("absent/opaque/unauthorized original sources remain gaps; automatic capture-off does not create links", async () => {
  const host = await registeredLoom()
  try {
    const messages = [
      nativeUser("request-gap"), nativeDispatch("opaque-message", "opaque-call", "functions.exec"),
    ]
    host.nativeContexts.set("parent", { data: messages })
    expect((await host.invoke("objective", { operation: "list" }, "parent")).result.items).toEqual([])
    const created = (await host.invoke("objective", { operation: "create", source_type: "native-message",
      source_id: "request-gap", label: "Inspect only explicitly authorized evidence" }, "parent")).result
    await expect(host.invoke("objective", { operation: "link", objective_id: created.id,
      phase: "dispatch", source_type: "native-call", source_id: "opaque-call",
      source_message_id: "opaque-message" }, "parent")).rejects.toThrow("direct dispatch")
    await expect(host.invoke("objective", { operation: "link", objective_id: created.id,
      phase: "handback", source_type: "native-message", source_id: "nonexistent",
      assessment: "reported-done" }, "parent")).rejects.toThrow("missing or ambiguous")
    await expect(host.invoke("objective", { operation: "link", objective_id: created.id,
      phase: "handback", source_type: "native-message", source_id: "request-gap",
      source_session_id: "inaccessible-child", assessment: "reported-done" }, "parent")).rejects.toThrow("authorized original export")
    await childExport(host, "private-child", "parent", "private-message")
    host.permission.error = Error("Native file read denied")
    await expect(host.invoke("objective", { operation: "link", objective_id: created.id,
      phase: "handback", source_type: "native-message", source_id: "private-message",
      source_session_id: "private-child", export_path: "private-child.json",
      assessment: "reported-done" }, "parent")).rejects.toThrow("Native file read denied")
    host.permission.error = undefined

    const gap = (await host.invoke("objective", { operation: "link", objective_id: created.id,
      phase: "coverage-gap", source_type: "unavailable", source_id: "opaque-call",
      gap_reason: "opaque-tool", confidence: "uncertain", note: "Code Mode hides inner calls" }, "parent")).result
    expect(gap.gap_reason).toBe("opaque-tool")
    await host.invoke("objective", { operation: "link", objective_id: created.id,
      phase: "coverage-gap", source_type: "unavailable", source_id: "private-child",
      gap_reason: "denied-access", note: "Parent did not have native read permission" }, "parent")
    await host.invoke("objective", { operation: "link", objective_id: created.id,
      phase: "coverage-gap", source_type: "unavailable", source_id: "before-compaction",
      gap_reason: "compacted", note: "Earlier native context cannot be recovered" }, "parent")
    await expect(host.invoke("objective", { operation: "link", objective_id: created.id,
      phase: "continuation", source_type: "native-message", source_id: "request-gap",
      note: "Missing original link ID" }, "parent")).rejects.toThrow("earlier linked source sequence")
    await expect(host.invoke("objective", { operation: "link", objective_id: created.id,
      phase: "coordination", source_type: "unavailable", source_id: "pretend-source" }, "parent"))
      .rejects.toThrow("unavailable source")
    const read = (await host.invoke("objective", { operation: "read", objective_id: created.id }, "parent")).result
    expect(read.entries).toHaveLength(4)
    expect(read.entries.filter((x: any) => x.phase === "coverage-gap")).toHaveLength(3)
    expect(JSON.stringify(read)).not.toContain("Private original request")
    expect(JSON.stringify(read)).not.toContain("Private dispatch")
  } finally { await host.close() }
})
