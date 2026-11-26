import { Database } from "bun:sqlite"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Observer, type CaptureEvent } from "../../src/context.js"
import { digest, type Action, type LedgerRecord, type Plan, type PlanNode } from "../../src/model.js"
import { Store } from "../../src/store.js"
import { registeredLoom } from "./registered-loom.js"

export type RegisteredHistoryFixture = Awaited<ReturnType<typeof registeredLoom>>
export const FRESHNESS_QUESTION = "For the freshness regression, distinguish the first failure, unchanged-code rerun, actual correction, scoped passes, and later contradictory checks. What remains unproven?"
export const FRESHNESS_SEARCH = "freshness regression"

/** Shared controlled source history for the registered-tool, document and browser
 * qualifications. Native hooks are simulated by registeredLoom; the actual
 * plugin, source store, Observer, permissions and read callbacks execute.
 *
 * IDs and records returned below are test oracles, never discovery inputs. No
 * fixture setup, inspection or assertion contributes to retrieval measurements.
 * Every temporary directory belongs to this fixture or its explicit caller.
 */
export async function engineeringHistoryScenario(options: {
  planned: boolean; unrelatedSessions?: number; directory?: string;
}) {
  const unrelatedSessions = options.unrelatedSessions ?? 240
  if (!Number.isSafeInteger(unrelatedSessions) || unrelatedSessions < 24 || unrelatedSessions > 250)
    throw new Error("Scenario needs 24-250 competing Sessions")
  const ownsDirectory = options.directory === undefined
  const directory = options.directory ?? await mkdtemp(join(process.env.LOOM_HISTORY_FIXTURE_ROOT ?? tmpdir(), "loom-history-scenario-"))
  await mkdir(directory, { recursive: true })
  const skill = { id: "scenario-evidence-review", description: "Inspect source scope and contradictory checks", content: "Preserve first failures and scope each later verification." }
  let f: RegisteredHistoryFixture | undefined, db: Database | undefined
  const close = async () => {
    try { db?.close(true); db = undefined; await f?.close() }
    finally { if (ownsDirectory) await rm(directory, { recursive: true, force: true }) }
  }
  try {
    f = await registeredLoom([skill], { directory, beforeSetup: async location => {
      await writeFile(join(location, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: automatic}\n")
    } })
    const fixture = f
    db = new Database(join(directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: directory }), "ledger.sqlite"))
    const store = new Store(db)
    const sessions = { target: "reused-engineering-session", planner: "release-planner" }
    const action = (await fixture.invoke("action", { operation: "create", title: "Release reliability investigation",
      goal: "Investigate independent failures, retain historical uncertainty, and distinguish scoped checks from complete verification." }, sessions.planner)).result as Action
    const focus = (node?: string) => ({ action_id: action.id, ...(options.planned && node ? { node_id: node } : {}) })
    const parallelNodes: PlanNode[] = Array.from({ length: unrelatedSessions }, (_, i) => ({
      id: "parallel-" + i, kind: "task", title: `Investigate exporter reliability concern ${i}`, parent: "parallel-checks",
    }))
    const baseNodes: PlanNode[] = [
      { id: "release", kind: "phase", title: "Release readiness" },
      { id: "regression-work", kind: "wave", title: "Investigate reliability regressions", parent: "release" },
      { id: "legacy-probe", kind: "task", title: "Investigate the freshness regression", parent: "regression-work",
        criteria: ["Retain the original failure separately from unchanged-code reruns."] },
      { id: "warm-cache-control", kind: "task", title: "Check warm-cache control cases", parent: "regression-work" },
      { id: "parallel-checks", kind: "wave", title: "Independent release checks", parent: "release" },
      ...parallelNodes,
    ]
    const savePlan = async (expected_revision: number, nodes: PlanNode[]) => (await fixture.invoke("plan", {
      operation: "save", action_id: action.id, expected_revision, nodes,
    }, sessions.planner)).result as Plan
    const originalPlan = options.planned ? await savePlan(0, baseNodes) : null
    const add = async (session: string, node: string | undefined, kind: "claim" | "result" | "concern" | "qa" | "assessment", statement: string,
      evidence: LedgerRecord[] = [], verdict?: "pass" | "fail" | "inconclusive", artifacts: string[] = []) => (await fixture.invoke("record", {
      operation: "add", ...focus(node), kind, statement, evidence_ids: evidence.map(record => record.id),
      artifact_refs: artifacts, ...(verdict ? { verdict } : {}),
    }, session)).result as LedgerRecord
    const noise = async (i: number) => {
      const source = "parallel-session-" + i, node = "parallel-" + i
      await add(source, node, "concern", `Exporter concern ${i}: timeout remains unexplained; this is independent of cache invalidation.`)
      await add(source, node, "result", `Exporter check ${i}: an unchanged rerun passed, without establishing the cause.`)
      await add(source, node, "qa", `Exporter check ${i}: reconnect acceptance still fails.`, [], "fail")
      await add(source, node, "qa", `Exporter check ${i}: retry acceptance still fails independently.`, [], "fail")
      await add(source, node, "qa", `Exporter check ${i}: its original cause remains uncertain.`, [], "inconclusive")
      await add(source, node, "qa", `Exporter check ${i}: a narrower timeout check passed.`, [], "pass")
      await add(source, node, "claim", `Exporter work ${i}: completion reported by its author, pending independent review.`)
      if (i >= unrelatedSessions - 2) {
        store.select(source, focus(node))
        const event = { sessionID: source, agent: "author", messageID: "exporter-check", id: "exporter-call", tool: "shell", input: { fixture: i } }
        await fixture.hooks.get("execute.before")(event)
        await fixture.hooks.get("execute.after")({ ...event, status: "error", error: { message: "Independent exporter assertion failed" } })
      }
    }
    const preceding = Math.floor(unrelatedSessions / 3)
    for (let i = 0; i < preceding; i++) await noise(i)

    const sourceRecords = () => store.records({ session_id: sessions.target, limit: 50 })
    const allSourceRecords = () => {
      const records: LedgerRecord[] = []
      let after: number | undefined
      do {
        const page = store.records({ session_id: sessions.target, limit: 50, ...(after === undefined ? {} : { after }) })
        records.push(...page.items); after = page.next_after ?? undefined
      } while (after !== undefined)
      return records
    }
    const call = async (message: string, id: string, node: string, status: "completed" | "error", tool = "shell", input: unknown = { command: "controlled fixture command" }) => {
      store.select(sessions.target, focus(node))
      const event = { sessionID: sessions.target, agent: "author", messageID: message, id, tool, input }
      await fixture.hooks.get("execute.before")(event)
      await fixture.hooks.get("execute.after")({ ...event, status,
        ...(status === "completed" ? { result: { content: tool === "skill" ? skill.content : "PRIVATE_RAW_NATIVE_RESULT" } }
          : { error: { message: "Controlled fixture assertion failed" } }) })
      const matches = allSourceRecords().filter(record => record.kind === "observation" && record.data.call_id === id)
      const start = matches.find(record => record.data.phase === "started")!
      const finish = matches.find(record => record.data.phase === "finished")!
      if (!start || !finish) throw new Error("Native capture fixture did not produce both observations")
      return { start, finish, practice: matches.find(record => record.data.phase === "skill-load-result") }
    }
    const agent = fixture.nativeAgents.find(candidate => candidate.id === "author")!
    store.select(sessions.target, focus("legacy-probe"))
    agent.system = "PRIVATE_AGENT_INSTRUCTIONS: report original evidence and limits."
    await fixture.context(sessions.target, "author")
    const originalContext = sourceRecords().items.find(record => record.data.phase === "agent-context-snapshot")!
    const originalSkill = await call("message-original", "skill-original", "legacy-probe", "completed", "skill", { id: skill.id })
    const original = await call("message-original", "original-test", "legacy-probe", "error", "shell", { command: "PRIVATE_RAW_NATIVE_INPUT" })
    const artifact = "https://example.test/controlled-history/freshness-regression"
    const originalFailure = await add(sessions.target, "legacy-probe", "concern",
      "Freshness regression: the original /coarse check returned stale data on revision a1. Watcher timing is a hypothesis, not an established cause.",
      [original.finish], undefined, [artifact + "/a1-failure"])

    // An unrelated Plan edit preserves the task subject hash. Authored records
    // therefore cannot be assigned a unique exact revision from that hash alone.
    const unrelatedPlan = options.planned ? await savePlan(1, baseNodes.map(node => node.id === "parallel-0"
      ? { ...node, title: "Investigate revised exporter acceptance criteria", criteria: ["Check reconnect behavior."] } : node)) : null
    const rerun = await call("message-rerun", "unchanged-rerun", "legacy-probe", "completed")
    const unchangedRerun = await add(sessions.target, "legacy-probe", "result",
      "Freshness regression: an unchanged-code rerun of revision a1 passed. This was before the correction and does not verify it.",
      [rerun.finish], undefined, [artifact + "/a1-rerun"])

    // The same Session does other work between the original failure and its
    // correction. These are recorded message groups, not inferred dispatches.
    const controlCalls = []
    for (let i = 0; i < 18; i++) {
      const control = await call("message-control-" + i, "control-" + i, "warm-cache-control", "completed")
      controlCalls.push(control)
      await add(sessions.target, "warm-cache-control", "result", `Warm-cache control ${i}: an independent cache-hit assertion passed.`, [control.finish])
    }
    const correctedNodes = baseNodes.filter(node => node.id !== "legacy-probe").map(node => node.id === "parallel-0"
      ? { ...node, title: "Investigate revised exporter acceptance criteria", criteria: ["Check reconnect behavior."] } : node)
    correctedNodes.push({ id: "corrected-probe", kind: "task", title: "Correct and recheck the freshness regression", parent: "regression-work",
      criteria: ["Name the corrected revision and test scope.", "Retain contradictory and incomplete checks."] })
    const currentPlan = options.planned ? await savePlan(2, correctedNodes) : null
    store.select(sessions.target, focus("corrected-probe"))
    agent.system = "PRIVATE_AGENT_INSTRUCTIONS: revised evidence review, do not erase partial failures."
    await fixture.context(sessions.target, "author")
    const contexts = allSourceRecords().filter(record => record.data.phase === "agent-context-snapshot")
    const currentContext = contexts.at(-1)!
    skill.content = "Preserve contradictory rechecks and distinguish instruction loading from application."
    fixture.reloadSkills()
    const revisedSkill = await call("message-correction", "skill-revised", "corrected-probe", "completed", "skill", { id: skill.id })
    const corrected = await call("message-correction", "fixture-correction", "corrected-probe", "completed")
    const correction = await add(sessions.target, "corrected-probe", "result",
      "Freshness regression: revision b2 changed the readiness fixture. Production cache code did not change; the historical scheduling explanation remains unproven.",
      [corrected.finish], undefined, [artifact + "/b2-diff"])
    const partial = await call("message-scoped-check", "scoped-check", "corrected-probe", "completed")
    const partialPass = await add(sessions.target, "corrected-probe", "qa",
      "Freshness regression: named /coarse and /fine subtests passed on revision b2. This checks those subtests only and does not clear the entire suite.",
      [partial.finish], "pass", [artifact + "/b2-subtests"])
    const generalClaim = await add(sessions.target, "corrected-probe", "claim",
      "Freshness regression: all checks are fixed and release readiness is complete.", [], undefined, [artifact + "/author-summary"])
    const contradictory = await call("message-independent-check", "suite-check", "corrected-probe", "error")
    const contradictoryCheck = await add(sessions.target, "corrected-probe", "qa",
      "Freshness regression: an independent suite run on b2 still failed /coarse under stress. This contradicts the broad completion claim, not the recorded scoped pass.",
      [contradictory.finish], "fail", [artifact + "/b2-suite-failure"])
    const scopeAssessment = await add(sessions.target, "corrected-probe", "assessment",
      "Freshness regression: the evidence supports a scoped recheck only. Broad verification and the original cause remain unproven; later capture gaps limit interpretation.",
      [original.finish, rerun.finish, partial.finish, contradictory.finish], "inconclusive", [artifact + "/qualified-assessment"])

    // Later competing concerns, failures and native errors occupy the default
    // representative lanes and branch slots before continuity is degraded.
    for (let i = preceding; i < unrelatedSessions; i++) await noise(i)

    // A host call identity can name multiple starts. The actual Observer refuses
    // to choose an invocation; the finish is deliberately Session-only.
    const observer = new Observer(store)
    const ambiguousEvent: CaptureEvent = { sessionID: sessions.target, agent: "author", messageID: "message-shared-host-id", id: "shared-host-id", tool: "shell", input: { fixture: "ambiguous" } }
    store.select(sessions.target, focus("corrected-probe"))
    const ambiguousStart = observer.before(ambiguousEvent)
    store.select(sessions.target, focus("warm-cache-control"))
    const otherAmbiguousStart = observer.before(ambiguousEvent)
    const ambiguousFinish = observer.after({ ...ambiguousEvent, status: "completed", result: "ambiguous result" })!
    observer.captureGap()
    const gapEvent = { ...ambiguousEvent, messageID: "message-after-gap", id: "after-gap", input: { fixture: "gap" } }
    const gapStart = observer.before(gapEvent)
    const gapFinish = observer.after({ ...gapEvent, status: "error", error: { message: "after capture gap" } })!

    // No new native observations occur after the known host/database capture gap.
    fixture.permissionRequests.length = 0
    return {
      f: fixture, action, planned: options.planned, question: FRESHNESS_QUESTION, search: FRESHNESS_SEARCH,
      sessions, plans: { original: originalPlan, unrelated: unrelatedPlan, current: currentPlan },
      records: { originalFailure, unchangedRerun, correction, partialPass, generalClaim, contradictoryCheck, scopeAssessment },
      observations: { original, rerun, corrected, partial, contradictory, originalContext, currentContext,
        originalSkill: originalSkill.practice!, revisedSkill: revisedSkill.practice!, controlCalls,
        ambiguousStart, otherAmbiguousStart, ambiguousFinish, gapStart, gapFinish },
      unrelatedSessions, close,
    }
  } catch (error) { await close(); throw error }
}

export type EngineeringHistoryScenario = Awaited<ReturnType<typeof engineeringHistoryScenario>>
