import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { Store } from "../src/store.js"
import { Learning } from "../src/learning.js"
import { Observer } from "../src/context.js"
import { digest } from "../src/model.js"
import { join } from "node:path"
import { mkdir, writeFile } from "node:fs/promises"
import { registeredLoom } from "./helpers/registered-loom.js"

const actor = { session_id: "coder-parent", agent: "coder" }
const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex")
function fixture() {
  const db = new Database(":memory:")
  const store = new Store(db)
  const learning = new Learning(db, store, db)
  const action = store.create("User feature", "One real objective", actor)
  return { db, store, learning, action }
}

test("insights count records rather than declaring successful objectives from three handbacks", () => {
  const { db, store, learning, action } = fixture()
  try {
    for (const session of ["coder-1", "coder-2", "coder-3"]) {
      store.record({ session_id: session, agent: "coder" }, { action_id: action.id }, {
        kind: "result", statement: "Local implementation finished; later runtime verification belongs to parent" })
    }
    const p = learning.events({ action_id: action.id })
    expect(p.totals.reported_results).toBe(3)
    expect(p.distinct_recorded_sessions).toBe(3)
    expect(p.distinct_action_ids).toBe(1)
    expect(p.coverage.action_is_verified_objective).toBe(false)
    expect(p.coverage.native_session_history).toBe("not-inspected")
    expect(JSON.stringify(p)).not.toContain("success_rate")
  } finally { db.close() }
})

test("insights cursor pages ledger data and do not silently count omitted records", () => {
  const { db, store, learning, action } = fixture()
  try {
    for (let i=0; i<5; i++) store.record(actor, { action_id: action.id }, { kind: "concern", statement: "Verified episode " + i })
    const a = learning.events({ action_id: action.id, limit: 2 })
    expect(a.totals.concerns).toBe(2)
    expect(a.next_before).not.toBeNull()
    const b = learning.events({ action_id: action.id, before: a.next_before!, limit: 2 })
    expect(b.totals.concerns).toBe(2)
    expect(b.events.map(e => e.record_id).some(x => a.events.map(e => e.record_id).includes(x))).toBe(false)
    expect(b.coverage.complete_ledger_window).toBe(false)
  } finally { db.close() }
})

test("tweak candidate is immutable, fingerprinted and never automatically activated", () => {
  const { db, learning } = fixture()
  try {
    const content = "# Skill\\nUse direct evidence."
    const a = learning.propose(actor, { target_kind: "skill", target_id: "software-engineering",
      base_sha256: fingerprint("old"), candidate_content: content,
      hypothesis: "Avoid a recurring unverified DONE result", evidence_refs: ["source:1"] })
    expect(a.candidate_sha256).toBe(fingerprint(content))
    const t = learning.trial(actor, { id: a.id, observed_sha256: a.candidate_sha256,
      observed_effect: "inconclusive", statement: "Could not prove native host delivery" })
    expect(t.activated).toBe(false)
    expect(t.verification).toContain("not certified")
    const loaded = learning.read(a.id)
    expect(loaded.content).toBe(content)
    expect(loaded.trials).toHaveLength(1)
    expect(loaded.trials[0].session_id).toBe(actor.session_id)
    expect(learning.retire(a.id).status).toBe("retired")
    expect(() => learning.trial(actor, { id: a.id, observed_effect: "promising", statement: "Bad claim" })).toThrow()
    expect(() => learning.propose(actor, { target_kind: "skill", target_id: "x", base_sha256: "bad",
      candidate_content: content, hypothesis: "Hypothesis" })).toThrow()
  } finally { db.close() }
})

test("registered tools expose read-only insights and opt-in candidate memory", async () => {
  const host = await registeredLoom()
  try {
    const created = (await host.invoke("action", { operation: "create", title: "Pilot", goal: "One objective" })).result
    const insights = (await host.invoke("insights", { operation: "action", action_id: created.id, limit: 10 })).result
    expect(insights.coverage.action_is_verified_objective).toBe(false)
    const proposal = (await host.invoke("tweak", {
      operation: "propose", target_kind: "skill", target_id: "software-engineering", base_sha256: fingerprint("baseline"),
      candidate_content: "# Experiment", hypothesis: "Test on eligible real work",
    })).result
    expect(proposal.authority).toContain("never installed")
    const list = (await host.invoke("tweak", { operation: "list" })).result
    expect(list.items.some((x: any) => x.id === proposal.id)).toBe(true)
  } finally { await host.close() }
})

test("learning state stays outside Action ledger schema and survives a separate reader", async () => {
  const host = await registeredLoom()
  try {
    const scope = digest({ project: "tool-help", canonical: host.directory })
    const root = join(host.directory, "state", "loom", "actions-v1", scope)
    const actionDB = new Database(join(root, "ledger.sqlite"))
    const learningDB = new Database(join(root, "learning.sqlite"))
    try {
      expect(actionDB.query("SELECT name FROM sqlite_schema WHERE name LIKE 'learning_%'").all()).toEqual([])
      const proposal = (await host.invoke("tweak", {
        operation: "propose", target_kind: "skill", target_id: "example",
        base_sha256: fingerprint("base"), candidate_content: "# Candidate",
        hypothesis: "Observed repeated trouble in comparable work",
      })).result
      const saved = learningDB.query("SELECT candidate_sha256 FROM learning_candidates WHERE id=?").get(proposal.id) as { candidate_sha256: string }
      expect(saved.candidate_sha256).toBe(proposal.candidate_sha256)
      expect(actionDB.query("SELECT name FROM sqlite_schema WHERE name='learning_candidates'").all()).toEqual([])
    } finally { learningDB.close(); actionDB.close() }
  } finally { await host.close() }
})

test("learning ledger pagination returns all older harmful trials exactly once even after new appends", async () => {
  const f = await registeredLoom()
  try {
    const proposed = (await f.invoke("tweak", { operation: "propose", target_kind: "skill",
      target_id: "sample", base_sha256: fingerprint("baseline"),
      candidate_content: "# Fixed candidate", hypothesis: "Compare objective trajectories" })).result
    const ids: string[] = []
    for (let i = 0; i < 25; i++) {
      const result = (await f.invoke("tweak", { operation: "trial", id: proposed.id,
        observed_effect: i < 5 ? "harmful" : "promising",
        statement: "Original observed objective " + i,
        evidence_refs: ["https://github.com/bateau84/loom/blob/0123456/README.md"] })).result
      ids.push(result.id)
    }
    const first = (await f.invoke("tweak", { operation: "read", id: proposed.id })).result
    expect(first.trials).toHaveLength(20)
    expect(first.trials_more).toBe(true)
    expect(typeof first.trials_next_before).toBe("number")
    const late = (await f.invoke("tweak", { operation: "trial", id: proposed.id,
      observed_effect: "inconclusive", statement: "Concurrent new observation" })).result
    const second = (await f.invoke("tweak", { operation: "read", id: proposed.id,
      trial_before: first.trials_next_before })).result
    expect(second.trials).toHaveLength(5)
    expect(second.trials_more).toBe(false)
    expect(second.trials_next_before).toBeNull()
    expect(second.trials.every((t: any) => t.observed_effect === "harmful")).toBe(true)
    expect(new Set([...first.trials, ...second.trials].map((t: any) => t.id))).toEqual(new Set(ids))
    expect([...first.trials, ...second.trials].some((t: any) => t.id === late.id)).toBe(false)
    const reopen = new Database(join(f.directory, "state", "loom", "actions-v1",
      digest({ project: "tool-help", canonical: f.directory }), "learning.sqlite"))
    try {
      expect((reopen.query("SELECT COUNT(*) AS count FROM learning_trials").get() as any).count).toBe(26)
    } finally { reopen.close() }
  } finally { await f.close() }
})

test("complete candidate text larger than the old 16 KiB limit round-trips under a byte bound", () => {
  const { db, learning } = fixture()
  try {
    const content = "# Skill\n" + "Measured behavior.\n".repeat(1000)
    expect(content.length).toBeGreaterThan(17011)
    const candidate = learning.propose(actor, { target_kind: "skill", target_id: "behavioral-spec",
      base_sha256: fingerprint("original"), candidate_content: content,
      hypothesis: "Verify a real long skill without truncation" })
    expect(learning.read(candidate.id).content).toBe(content)
    expect(candidate.candidate_sha256).toBe(fingerprint(content))
    expect(() => learning.propose(actor, { target_kind: "skill", target_id: "too-big",
      base_sha256: fingerprint("original"), candidate_content: "x".repeat(131073),
      hypothesis: "Over the boundary" })).toThrow("128 KiB")
  } finally { db.close() }
})

test("final ledger page describes older-page availability without contradicting its cursor", () => {
  const { db, store, learning, action } = fixture()
  try {
    for (let i = 0; i < 3; i++)
      store.record(actor, { action_id: action.id }, { kind: "concern", statement: "Observation " + i })
    const first = learning.events({ action_id: action.id, limit: 2 })
    const last = learning.events({ action_id: action.id, before: first.next_before!, limit: 2 })
    expect(last.next_before).toBeNull()
    expect(last.coverage.has_older_records).toBe(false)
  } finally { db.close() }
})

for (const mode of ["corrupt", "partial"] as const) test("unavailable " + mode + " learning state preserves normal Action tools and evidence", async () => {
  let actionID = ""
  const f = await registeredLoom([], { beforeSetup: async directory => {
    const root = join(directory, "state", "loom", "actions-v1",
      digest({ project: "tool-help", canonical: directory }))
    await mkdir(root, { recursive: true })
    const actionDB = new Database(join(root, "ledger.sqlite"))
    try {
      const store = new Store(actionDB)
      actionID = store.create("Saved Action", "Keep this evidence available", actor).id
      store.record(actor, { action_id: actionID }, { kind: "result", statement: "Earlier known evidence" })
    } finally { actionDB.close() }
    const learningPath = join(root, "learning.sqlite")
    if (mode === "corrupt") await writeFile(learningPath, "not-a-sqlite-database")
    else {
      const invalid = new Database(learningPath)
      try { invalid.exec("CREATE TABLE learning_candidates (id TEXT PRIMARY KEY)") }
      finally { invalid.close() }
    }
    await writeFile(join(directory, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: automatic}\n")
  } })
  try {
    const status = (await f.invoke("agents", {})).result
    expect(status.learning.available).toBe(false)
    expect(status.learning.stage).toContain("learning-")
    const list = (await f.invoke("action", { operation: "list" })).result.items
    expect(list.some((a: any) => a.id === actionID)).toBe(true)
    const original = (await f.invoke("record", { operation: "query", action_id: actionID }, actor.session_id, actor.agent)).result.items
    expect(original.some((r: any) => r.data.statement === "Earlier known evidence")).toBe(true)
    const written = (await f.invoke("record", { operation: "add", action_id: actionID, kind: "result",
      statement: "New evidence after optional learning failure" }, actor.session_id, actor.agent)).result
    expect(written.id).toBeTruthy()
    await expect(f.invoke("insights", { operation: "window" })).rejects.toThrow("LOOM_LEARNING_UNAVAILABLE")
    await expect(f.invoke("tweak", { operation: "list" })).rejects.toThrow("LOOM_LEARNING_UNAVAILABLE")
    const call = { sessionID: actor.session_id, agent: actor.agent, messageID: "m", id: "read-1", tool: "read", input: { path: "safe" } }
    await f.hooks.get("execute.before")(call)
    await f.hooks.get("execute.after")({ ...call, status: "completed", result: { content: "observed" } })
    const after = (await f.invoke("record", { operation: "query", action_id: actionID }, actor.session_id, actor.agent)).result.items
    expect(after.some((x: any) => x.kind === "observation" && x.data.phase === "finished")).toBe(true)
  } finally { await f.close() }
})

test("native agent registry identity is retained before the definition changes", async () => {
  const f = await registeredLoom()
  try {
    await writeFile(join(f.directory, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: automatic}\n")
    const agent = f.nativeAgents.find((a: any) => a.id === "author")
    agent.system = "Original agent instructions A"
    await f.context("s", "author")
    agent.system = "Revised agent instructions B"
    await f.context("s", "author")
    const read = (await f.invoke("record", { operation: "query", session_only: true }, "s", "author")).result.items
    const stamps = read.filter((x: any) => x.data.phase === "agent-context-snapshot")
    expect(stamps.map((x: any) => x.data.content_sha256)).toEqual([
      fingerprint("Original agent instructions A"), fingerprint("Revised agent instructions B"),
    ])
    expect(stamps.every((x: any) => x.data.source === "native-agent-registry-system")).toBe(true)
    expect(stamps[0].data).not.toHaveProperty("system")
  } finally { await f.close() }
})
