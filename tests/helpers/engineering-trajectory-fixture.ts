import { Database } from "bun:sqlite"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { WorkRef } from "../../src/collaboration.js"
import { canonical, digest, type Action, type LedgerRecord, type PlanNode } from "../../src/model.js"
import { Store } from "../../src/store.js"
import { registeredLoom } from "./registered-loom.js"

export const TRAJECTORY_QUESTION = "Investigate the restore freshness concern. Distinguish the first CI failure, unchanged-code rerun, possible historical cause, test correction, scoped verification, merge and remaining overall release acceptance. What relationships are established, authored or unknown?"
export const TRAJECTORY_SEARCH = "restore freshness"

/** Controlled equivalent of the operator's #182/#187 information needs. All
 * native events are simulated; the registered plugin, Store, ObjectiveIndex and
 * ReviewRequests owners are real. No private operator source is copied here.
 *
 * The four source Sessions have deliberately different vocabulary. Review
 * requests belong to the investigator's authorized Session; this fixture does
 * not claim that history grants permit another Session's private review scope.
 * Setup IDs and returned oracles must never become investigator inputs.
 */
export async function engineeringTrajectoryFixture(options: { records?: number; directory?: string } = {}) {
  const totalRecords = options.records ?? 24000
  if (!Number.isSafeInteger(totalRecords) || totalRecords < 100 || totalRecords > 30000)
    throw new Error("Trajectory fixture requires 100-30000 ledger records")
  const ownsDirectory = options.directory === undefined
  const directory = options.directory ?? await mkdtemp(join(process.env.LOOM_HISTORY_FIXTURE_ROOT ?? tmpdir(), "loom-trajectory-"))
  await mkdir(directory, { recursive: true })
  let f: Awaited<ReturnType<typeof registeredLoom>> | undefined, db: Database | undefined
  const close = async () => {
    try { db?.close(true); db = undefined; await f?.close() }
    finally { if (ownsDirectory) await rm(directory, { recursive: true, force: true }) }
  }
  try {
    f = await registeredLoom([], { directory, beforeSetup: async location => {
      await writeFile(join(location, ".loom.yaml"), "agents: {}\ninstructions: {enabled: false}\nledger: {capture: automatic}\n")
    } })
    const host = f
    db = new Database(join(directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: directory }), "ledger.sqlite"))
    const store = new Store(db)
    const sessions = { reader: "review-owner", ci: "build-worker", worker: "test-author", release: "release-owner" }
    const invoke = async (tool: string, input: unknown, session = sessions.reader) => (await host.invoke(tool, input, session)).result
    const action = await invoke("action", { operation: "create", title: "Release reliability investigation",
      goal: "Retain exact engineering evidence and distinguish a bounded test fix from acceptance of the full release." }) as Action
    const originalNodes: PlanNode[] = [
      { id: "release", kind: "phase", title: "Release acceptance" },
      { id: "probe", kind: "task", title: "Investigate restored-index checks", parent: "release",
        criteria: ["Keep failed attempts separate from reruns."] },
      { id: "broader", kind: "task", title: "Qualify whole release", parent: "release",
        criteria: ["Run the full installed release matrix.", "Verify migration, cancellation and repair."] },
    ]
    await invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0, nodes: originalNodes })
    const originalWork = (await invoke("context", { action_id: action.id, node_id: "probe" })).work_ref as WorkRef
    const add = async (session: string, node: string, kind: "claim" | "result" | "concern" | "assessment" | "qa",
      statement: string, options: { evidence?: LedgerRecord[]; verdict?: "pass" | "fail" | "inconclusive"; artifacts?: string[] } = {}) =>
      await invoke("record", { operation: "add", action_id: action.id, node_id: node, kind, statement,
        evidence_ids: options.evidence?.map(record => record.id) ?? [], artifact_refs: options.artifacts ?? [],
        ...(options.verdict ? { verdict: options.verdict } : {}) }, session) as LedgerRecord
    const request = await add(sessions.reader, "probe", "claim",
      "Investigate the CI anomaly in issue 182 and preserve the distinction between a repair to its test and complete release acceptance.")
    const objective = await invoke("objective", { operation: "create", source_type: "ledger-record", source_id: request.id,
      label: "Explain the restored-index CI anomaly and qualify its scoped test correction" })

    const noise = (begin: number, count: number) => {
      db!.exec("BEGIN IMMEDIATE")
      try {
        for (let i = begin; i < begin + count; i++) store.append({ action_id: action.id,
          session_id: `parallel-subsystem-${i % 160}`, agent: "author", kind: i % 5 === 0 ? "concern" : i % 5 === 1 ? "qa" : "result",
          data: { statement: `Independent exporter scenario ${i}: connection recovery remains under its own investigation.`,
            evidence_ids: [], artifact_refs: [], ...(i % 5 === 1 ? { verdict: i % 2 ? "fail" : "pass" } : {}),
            verification: "agent-reported; not independently validated by Loom" } })
        db!.exec("COMMIT")
      } catch (error) { db!.exec("ROLLBACK"); throw error }
    }
    const leadingNoise = Math.floor(totalRecords / 3)
    noise(0, leadingNoise)
    const observed = async (session: string, node: string, id: string, status: "completed" | "error") => {
      await invoke("context", { action_id: action.id, node_id: node }, session)
      const event = { sessionID: session, agent: "author", messageID: `message-${id}`, id, tool: "shell",
        input: { command: "SYNTHETIC_PRIVATE_COMMAND" } }
      await host.hooks.get("execute.before")(event)
      await host.hooks.get("execute.after")({ ...event, status,
        ...(status === "completed" ? { result: { content: "SYNTHETIC_PRIVATE_OUTPUT" } }
          : { error: { message: "Controlled assertion failed" } }) })
      const records = store.records({ action_id: action.id, source_session_id: session, record_kinds: ["observation"], limit: 50 }).items
      const start = records.find(record => record.data.phase === "started" && record.data.call_id === id)
      const finish = records.find(record => record.data.phase === "finished" && record.data.call_id === id)
      if (!start || !finish) throw new Error("Registered observer did not preserve the controlled attempt")
      return { start, finish }
    }
    const original = await observed(sessions.ci, "probe", "initial-ci", "error")
    const finding = await add(sessions.ci, "probe", "concern",
      "Restore freshness: initial CI attempt 1 at revision a1 expected refresh=true after adding a row, but observed false. Its original scheduling order was not recorded.",
      { artifacts: ["https://example.test/controlled/ci/a1/attempt/1"] })
    const initialInterpretation = await add(sessions.reader, "probe", "assessment",
      "Initial reading: this may be a stale-index defect. The report does not establish whether the filesystem watcher had already indexed the added row.",
      { verdict: "inconclusive", artifacts: ["loom-review://original-probe-review"] })
    const originalReview = { format: "loom-review-request/v1", request_id: "original-probe-review",
      mandate: { question: "Assess the reported assertion failure at a1 without inferring its missing scheduling order.",
        dimensions: ["correctness", "evidence"], criteria: [{ text: "Keep the historical cause unproven when original evidence is insufficient.", source_ref: null }],
        mode: "independent", inclusions: ["initial CI attempt and test contract"], exclusions: ["full release acceptance"] },
      intended_recipient: { agent: "investigator", session_id: null },
      members: [{ member_id: "initial-probe", work_ref: originalWork, producing_attempt_refs: [],
        artifact_refs: [{ locator: "https://example.test/controlled/tree/a1", version: { kind: "git", repository: "example/controlled", object_id: "a".repeat(40), path: "restore_test.go" }, content_ref: null }],
        prior_review_request_id: null, membership_source_refs: [finding.id], gaps: [{ reason: "source-missing", source_ref: null }] }],
      rechecks: [] }
    await invoke("review", { operation: "freeze", request: originalReview })
    const findingRelation = await invoke("review", { operation: "relate", request_id: originalReview.request_id,
      relationship: "finding", source_record_id: initialInterpretation.id, member_ids: ["initial-probe"] })
    const rerunObservation = await observed(sessions.ci, "probe", "unchanged-retry", "completed")
    const rerun = await add(sessions.ci, "probe", "result",
      "Attempt 2 passed on unchanged revision a1. This rerun happened before the test patch and cannot verify that later correction.",
      { artifacts: ["https://example.test/controlled/ci/a1/attempt/2"] })

    const correctedNodes: PlanNode[] = [...originalNodes.filter(node => node.id !== "probe"),
      { id: "ordered-test", kind: "task", parent: "release", title: "Test both index orderings",
        criteria: ["Old indexed row requires refresh.", "Already indexed new row correctly avoids refresh."] }]
    await invoke("plan", { operation: "save", action_id: action.id, expected_revision: 1, nodes: correctedNodes })
    const correctedWork = (await invoke("context", { action_id: action.id, node_id: "ordered-test" })).work_ref as WorkRef
    const editObservation = await observed(sessions.worker, "ordered-test", "test-only-edit", "completed")
    const correction = await add(sessions.worker, "ordered-test", "result",
      "Issue 187 changes only the test at revision b2: coordinate the watcher and probe explicitly so both valid orderings are checked. Production index behavior is unchanged.",
      { artifacts: ["https://example.test/controlled/tree/b2"] })
    const correctionReport = await add(sessions.reader, "ordered-test", "result",
      "The supplied test patch names b2 and addresses the earlier assertion by controlling ordering. This is an attributed correction report; it does not reveal the historical failing interleaving.",
      { artifacts: ["https://example.test/controlled/tree/b2", "loom-review://original-probe-review"] })
    const correctionRelation = await invoke("review", { operation: "relate", request_id: originalReview.request_id,
      relationship: "correction", source_record_id: correctionReport.id, member_ids: ["initial-probe"], supersedes: findingRelation.id })
    const beforeIndex = await observed(sessions.reader, "ordered-test", "old-index-order", "completed")
    const afterIndex = await observed(sessions.reader, "ordered-test", "new-index-order", "completed")
    const scopedReview = { format: "loom-review-request/v1", request_id: "ordered-test-recheck",
      mandate: { question: "Recheck the exact b2 test correction and its two controlled orderings.",
        dimensions: ["test correctness"], criteria: [{ text: "The probe requires refresh with the old indexed row and returns false after the new row is indexed.", source_ref: correction.id }],
        mode: "independent-recheck", inclusions: ["b2 test patch", "two controlled ordering subtests", "scoped race check"],
        exclusions: ["proof of original a1 scheduling order", "complete issue 182 release acceptance", "all deployment environments"] },
      intended_recipient: { agent: "investigator", session_id: null },
      members: [{ member_id: "b2-test", work_ref: correctedWork, producing_attempt_refs: [beforeIndex.start.id, afterIndex.start.id],
        artifact_refs: [{ locator: "https://example.test/controlled/tree/b2", version: { kind: "git", repository: "example/controlled", object_id: "b".repeat(40), path: "restore_test.go" }, content_ref: null }],
        prior_review_request_id: originalReview.request_id, membership_source_refs: [correctionReport.id], gaps: [{ reason: "source-missing", source_ref: null }] }],
      rechecks: [{ request_id: originalReview.request_id, finding_ids: [correctionRelation.id] }] }
    await invoke("review", { operation: "freeze", request: scopedReview })
    const recheck = await add(sessions.reader, "ordered-test", "assessment",
      "Scoped b2 verification passes: old indexed state requires refresh; already updated state correctly returns false. The race check passed for this corrected tree. This does not establish the original a1 ordering or full issue 182 release acceptance.",
      { verdict: "pass", evidence: [beforeIndex.finish, afterIndex.finish], artifacts: ["loom-review://ordered-test-recheck", "https://example.test/controlled/ci/b2/scoped"] })
    await invoke("review", { operation: "relate", request_id: scopedReview.request_id,
      relationship: "observed", source_record_id: beforeIndex.finish.id, member_ids: ["b2-test"] })
    await invoke("review", { operation: "relate", request_id: scopedReview.request_id,
      relationship: "observed", source_record_id: afterIndex.finish.id, member_ids: ["b2-test"] })
    await invoke("review", { operation: "relate", request_id: scopedReview.request_id,
      relationship: "finding", source_record_id: recheck.id, member_ids: ["b2-test"] })
    const laterInterpretation = await add(sessions.reader, "ordered-test", "assessment",
      "Later assessment: a test-ordering race is plausible and supported by the two controlled cases. It supersedes the earlier stale-index interpretation as the working explanation; the original CI cause remains unproven.",
      { verdict: "inconclusive", artifacts: ["loom-review://ordered-test-recheck"] })
    const merge = await add(sessions.release, "ordered-test", "result",
      "The corrected b2 tree was merged as c3. Merge records delivery of the test-only correction; it is not evidence that every release acceptance requirement passed.",
      { artifacts: ["https://example.test/controlled/tree/c3"] })
    const releaseAcceptance = await add(sessions.release, "broader", "concern",
      "Overall issue 182 acceptance still needs the installed release matrix, migration, cancellation and repair checks. The issue 187 assessment covered only its specified b2 correction.")
    const unrelated = await add(sessions.reader, "ordered-test", "result",
      "Separate formatter check also ran at b2 in this Session and passed. No registered relationship connects it to the investigated assertion.")

    // Retrospective associations are append-only interpretations over preserved
    // originals. The link writer is attributed; neither time nor common version
    // chooses membership. Semantic relation fields use the existing owner.
    const link = async (source: LedgerRecord, phase: string, extra: Record<string, unknown> = {}) =>
      await invoke("objective", { operation: "link", objective_id: objective.id, phase,
        source_type: "ledger-record", source_id: source.id, ...extra })
    const findingLink = await link(finding, "environment-failure", { note: "Retrospective association to the CI anomaly; historical source unchanged." })
    const evidenceLink = await link(original.finish, "coordination", { relation: "supports", related_sequence: findingLink.sequence,
      note: "Captured failed attempt supports the reported assertion failure, not a particular root cause." })
    const diagnosisLink = await link(initialInterpretation, "coordination", { related_sequence: findingLink.sequence,
      confidence: "uncertain", note: "Candidate historical diagnosis; no original ordering trace exists." })
    const rerunLink = await link(rerun, "verification", { assessment: "pass", relation: "contests", related_sequence: diagnosisLink.sequence,
      note: "Unchanged-code success contests a deterministic stale-index reading; it does not establish the failing order." })
    await link(rerunObservation.finish, "coordination", { relation: "supports", related_sequence: rerunLink.sequence })
    const correctionLink = await link(correction, "coordination", { relation: "addresses", related_sequence: findingLink.sequence,
      note: "Different-revision test correction addresses the finding without asserting the historical cause." })
    await link(editObservation.finish, "coordination", { relation: "supports", related_sequence: correctionLink.sequence })
    await link(correctionReport, "coordination", { relation: "supports", related_sequence: correctionLink.sequence,
      note: "Attributed review-owner report, distinct from the source producer's original correction." })
    const recheckLink = await link(recheck, "verification", { assessment: "pass", relation: "assesses", related_sequence: correctionLink.sequence,
      note: "Recheck scope is the exact b2 correction; no complete-release inference." })
    const laterLink = await link(laterInterpretation, "coordination", { relation: "supersedes", related_sequence: diagnosisLink.sequence,
      note: "Later authored working interpretation; original diagnosis and its uncertainty remain inspectable." })
    await link(laterInterpretation, "link-correction", { assessment: "reject", related_sequence: diagnosisLink.sequence,
      note: "Reject the former objective association as current membership; do not change the truth or content of its original source claim." })
    await link(merge, "outcome", { assessment: "pass", related_sequence: correctionLink.sequence,
      note: "Reported merge of the corrected tree, not host-certified correctness or overall acceptance." })
    await link(releaseAcceptance, "coverage-gap", { gap_reason: "missing-source", related_sequence: recheckLink.sequence,
      note: "Broader release acceptance evidence is still missing." })

    // Materialize an independent review owned by another Session as a negative
    // disclosure control. A history grant does not disclose its existence/data.
    const foreignReview = { ...originalReview, request_id: "foreign-private-review",
      mandate: { ...originalReview.mandate, question: "FOREIGN_PRIVATE_REVIEW_MANDATE" } }
    await invoke("review", { operation: "freeze", request: foreignReview }, "foreign-review-owner")
    const beforeNoiseCount = (db.query("SELECT count(*) n FROM ledger WHERE action_id=?").get(action.id) as { n: number }).n
    noise(leadingNoise, totalRecords - beforeNoiseCount)
    const records = { request, finding, initialInterpretation, rerun, correction, correctionReport, recheck, laterInterpretation, merge, releaseAcceptance }
    const observations = { original, rerun: rerunObservation, edit: editObservation, beforeIndex, afterIndex }
    const originalSnapshot = Object.fromEntries([...Object.values(records), unrelated,
      ...Object.values(observations).flatMap(pair => [pair.start, pair.finish])].map(record => [record.id, canonical(record)]))
    return { f: host, directory, db, store, action, objective, sessions, records, observations, unrelated,
      reviews: { original: originalReview, scoped: scopedReview, foreign: foreignReview },
      relationships: { finding: findingRelation, correction: correctionRelation },
      links: { finding: findingLink, evidence: evidenceLink, diagnosis: diagnosisLink, rerun: rerunLink,
        correction: correctionLink, recheck: recheckLink, later: laterLink },
      work: { original: originalWork, corrected: correctedWork },
      originalSnapshot, totalRecords, question: TRAJECTORY_QUESTION, search: TRAJECTORY_SEARCH,
      setupQualification: "Synthetic equivalent; actual registered owners, simulated native host. Review access uses its existing requester Session. No private operator originals or native review-execution attestation.",
      close }
  } catch (error) { await close(); throw error }
}
