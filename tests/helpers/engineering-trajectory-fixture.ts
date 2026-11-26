import { Database } from "bun:sqlite"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { WorkRef } from "../../src/collaboration.js"
import { Observer } from "../../src/context.js"
import type { ReviewRequest } from "../../src/review-requests.js"
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

/** A second population over the same registered owners. In sparse mode there
 * are no objective/review answers to consume: the investigator must discover
 * the scattered originals and author any retrospective associations explicitly.
 * Connected mode adds overlapping, attributed objectives and review branches;
 * its expected component includes documented shared-evidence spillover.
 * Neither mode creates a Plan, WorkRef, native review or private original.
 */
export async function unplannedEngineeringTrajectoryFixture(options: {
  mode: "sparse" | "connected"; records?: number; directory?: string;
}) {
  const totalRecords = options.records ?? 24000
  if (!Number.isSafeInteger(totalRecords) || totalRecords < 500 || totalRecords > 30000)
    throw new Error("Unplanned trajectory fixture requires 500-30000 ledger records")
  const ownsDirectory = options.directory === undefined
  const directory = options.directory ?? await mkdtemp(join(process.env.LOOM_HISTORY_FIXTURE_ROOT ?? tmpdir(), "loom-unplanned-trajectory-"))
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
    const action = await invoke("action", { operation: "create", title: "Unplanned release investigations",
      goal: "Preserve original evidence across reused Sessions and separate a scoped test correction from release acceptance." }) as Action
    const add = async (session: string, kind: "claim" | "result" | "concern" | "assessment", statement: string,
      extra: { evidence?: LedgerRecord[]; verdict?: "pass" | "fail" | "inconclusive"; artifacts?: string[] } = {}) =>
      await invoke("record", { operation: "add", action_id: action.id, kind, statement,
        evidence_ids: extra.evidence?.map(record => record.id) ?? [], artifact_refs: extra.artifacts ?? [],
        ...(extra.verdict ? { verdict: extra.verdict } : {}) }, session) as LedgerRecord
    const originals: LedgerRecord[] = []
    const observed = async (session: string, id: string, status: "completed" | "error") => {
      store.select(session, { action_id: action.id })
      const before = (db!.query("SELECT COALESCE(MAX(seq),0) AS sequence FROM ledger").get() as { sequence: number }).sequence
      const event = { sessionID: session, agent: "author", messageID: `message-${id}`, id, tool: "shell",
        input: { command: "SYNTHETIC_PRIVATE_COMMAND" } }
      await host.hooks.get("execute.before")(event)
      await host.hooks.get("execute.after")({ ...event, status,
        ...(status === "completed" ? { result: { content: "SYNTHETIC_PRIVATE_OUTPUT" } }
          : { error: { message: "Controlled assertion failed" } }) })
      const rows = store.records({ action_id: action.id, after: before, limit: 10 }).items
      const start = rows.find(record => record.data.phase === "started" && record.data.call_id === id)
      const finish = rows.find(record => record.data.phase === "finished" && record.data.call_id === id)
      if (!start || !finish) throw new Error("Registered observer lost an unplanned source attempt")
      originals.push(start, finish)
      return { start, finish }
    }
    // The surrounding population consists of explicit evidence groups around
    // shared observed sources, not isolated distractor rows. All sixteen Sessions
    // are reused; the four trajectory producers also perform independent work.
    const producers = [...Object.values(sessions), ...Array.from({ length: 12 }, (_, i) => `reused-engineer-${i}`)]
    const chains: LedgerRecord[][] = []
    const populationObserver = new Observer(store)
    let surrounding = 0
    const populate = (count: number) => {
      let writing = false
      try {
        for (let n = 0; n < count; n++, surrounding++) {
          const index = Math.floor(surrounding / 40), chain = chains[index] ?? (chains[index] = [])
          if (chain.length < 2) {
            if (writing) { db!.exec("COMMIT"); writing = false }
            const session = producers[index % producers.length]!
            const event = { sessionID: session, agent: "author", messageID: `exporter-${index}`, id: `exporter-check-${index}`,
              tool: "shell", input: { fixture: index } }
            if (!chain.length) {
              store.select(session, { action_id: action.id })
              chain.push(populationObserver.before(event))
            } else {
              const finish = populationObserver.after({ ...event, status: "completed", result: "SYNTHETIC_EXPORTER_OUTPUT" })
              if (!finish) throw new Error("Population observer did not retain its original finish")
              chain.push(finish)
            }
            continue
          }
          if (!writing) { db!.exec("BEGIN IMMEDIATE"); writing = true }
          chain.push(store.append({ action_id: action.id, session_id: producers[surrounding % producers.length]!, agent: "author",
            kind: chain.length % 7 === 0 ? "concern" : "result", data: {
              statement: `Exporter branch ${index}, check ${chain.length}: recorded follow-up to its cited source; runtime cause and full acceptance remain open.`,
              evidence_ids: [chain[1]!.id], artifact_refs: [], verification: "agent-reported; not independently validated by Loom" } }))
        }
        if (writing) db!.exec("COMMIT")
      } catch (error) { if (writing) db!.exec("ROLLBACK"); throw error }
    }
    // Twenty trajectory originals and one unrelated same-revision control.
    const chunk = Math.floor((totalRecords - 21) / 9)
    const request = await add(sessions.reader, "claim", "Investigate the issue 182 CI anomaly and distinguish a test repair from complete release acceptance.")
    populate(chunk)
    const original = await observed(sessions.ci, "initial-ci", "error")
    const finding = await add(sessions.ci, "concern", "Restore freshness: initial CI attempt 1 at a1 expected refresh=true after adding a row, but observed false. Its scheduling order was not recorded.",
      { artifacts: ["https://example.test/controlled/ci/a1/attempt/1"] })
    populate(chunk)
    const initialInterpretation = await add(sessions.reader, "assessment", "Initial reading of issue 182: this may be a stale-index defect. Whether the watcher had already indexed the new row is unknown.", { verdict: "inconclusive" })
    populate(chunk)
    const retry = await observed(sessions.ci, "unchanged-retry", "completed")
    const rerun = await add(sessions.ci, "result", "Attempt 2 for issue 182 passed on unchanged a1 before the patch. It cannot verify the later test correction.",
      { artifacts: ["https://example.test/controlled/ci/a1/attempt/2"] })
    populate(chunk)
    const edit = await observed(sessions.worker, "test-only-edit", "completed")
    const correction = await add(sessions.worker, "result", "Issue 187 changes only the test at b2: coordinate watcher and probe to cover both valid orderings. Production index behavior is unchanged.",
      { artifacts: ["https://example.test/controlled/tree/b2"] })
    const correctionReport = await add(sessions.reader, "result", "The b2 test patch from issue 187 addresses the earlier issue 182 assertion by controlling ordering. It does not reveal the historical failing interleaving.")
    populate(chunk)
    const beforeIndex = await observed(sessions.reader, "old-index-order", "completed")
    const afterIndex = await observed(sessions.reader, "new-index-order", "completed")
    const recheck = await add(sessions.reader, "assessment", "Scoped b2 verification passes: the old indexed row requires refresh and the updated row correctly returns false. The race check passed for this corrected tree. This does not prove original a1 ordering or full issue 182 acceptance.",
      { verdict: "pass", evidence: [beforeIndex.finish, afterIndex.finish], artifacts: ["https://example.test/controlled/ci/b2/scoped"] })
    populate(chunk)
    const laterInterpretation = await add(sessions.reader, "assessment", "Later interpretation of issue 182: the controlled b2 cases support a plausible test-ordering race. This replaces the stale-index reading as the working explanation, but the original cause remains unproven.", { verdict: "inconclusive" })
    populate(chunk)
    const merge = await add(sessions.release, "result", "The issue 187 corrected b2 tree was merged as c3. Delivery of this test correction does not establish complete release acceptance.",
      { artifacts: ["https://example.test/controlled/tree/c3"] })
    populate(chunk)
    const releaseAcceptance = await add(sessions.release, "concern", "Overall issue 182 acceptance still needs the installed release matrix, migration, cancellation and repair checks. Issue 187 assessed only the specified b2 correction.")
    const unrelated = await add(sessions.reader, "result", "A separate formatter check passed at b2 in this Session. It has no established relationship to issue 182 or issue 187.")
    const records = { request, finding, initialInterpretation, rerun, correction, correctionReport, recheck, laterInterpretation, merge, releaseAcceptance }
    originals.push(...Object.values(records))
    populate(totalRecords - 21 - surrounding)
    const objectives: Array<{ id: string }> = []
    const reviewIDs: string[] = [], relationshipIDs: string[] = []
    const objectiveSources = new Map<string, Set<string>>()
    if (options.mode === "connected") {
      const link = async (objective_id: string, record: LedgerRecord, extra: Record<string, unknown> = {}) => {
        const result = await invoke("objective", { operation: "link", objective_id, phase: "coordination", source_type: "ledger-record", source_id: record.id, ...extra })
        objectiveSources.get(objective_id)!.add(record.id)
        return result
      }
      for (let i = 0; i < 3; i++) {
        const source = i === 0 ? request : chains[(i - 1) * 2]![39]!
        const objective = await invoke("objective", { operation: "create", source_type: "ledger-record", source_id: source.id,
          label: i === 0 ? "Restored-index anomaly and scoped test repair" : `Exporter acceptance branch ${i}; shared evidence is not shared success` })
        objectives.push(objective); objectiveSources.set(objective.id, new Set([source.id]))
        if (i > 0) await link(objective.id, finding, { note: "Explicit attributed shared source; no causation or common acceptance inferred." })
        for (const chain of chains.slice(i * 2, i * 2 + 2)) await link(objective.id, chain[39]!, { note: "Independent correction branch retained with its original cited evidence." })
      }
      const main = objectives[0]!
      const findingLink = await link(main.id, finding)
      const diagnosis = await link(main.id, initialInterpretation, { confidence: "uncertain", related_sequence: findingLink.sequence, note: "Historical diagnosis remains a candidate." })
      const corrected = await link(main.id, correction, { relation: "addresses", related_sequence: findingLink.sequence })
      await link(main.id, rerun, { relation: "contests", related_sequence: diagnosis.sequence })
      await link(main.id, recheck, { relation: "assesses", related_sequence: corrected.sequence })
      await link(main.id, laterInterpretation, { relation: "supersedes", related_sequence: diagnosis.sequence, confidence: "uncertain", note: "Later working interpretation; historical order remains unknown." })
      for (const record of originals) await link(main.id, record)
      for (let i = 0; i < 24; i++) {
        const requestID = `overlap-review-${String(i).padStart(2, "0")}`
        const request: Omit<ReviewRequest, "requester" | "work_revision_policy"> = { format: "loom-review-request/v1", request_id: requestID,
          mandate: { question: `Assess independent correction branch ${i} against its exact requested artifact.`, dimensions: ["scope"],
            criteria: [{ text: "Shared evidence does not establish common causation or whole-release success.", source_ref: null }], mode: "independent",
            inclusions: [`correction branch ${i}`], exclusions: ["complete issue 182 release acceptance", "native review execution"] },
          intended_recipient: { agent: "investigator", session_id: null },
          members: [{ member_id: "subject", work_ref: null, producing_attempt_refs: [], artifact_refs: [{ locator: `https://example.test/controlled/branch/${i}`,
            version: { kind: "sha256", value: digest({ branch: i }) }, content_ref: null }], prior_review_request_id: i % 3 === 2 ? reviewIDs[i - 1]! : null,
            membership_source_refs: [initialInterpretation.id], gaps: [{ reason: "source-missing", source_ref: null }] }], rechecks: [] }
        await invoke("review", { operation: "freeze", request }); reviewIDs.push(requestID)
        const findingRelation = await invoke("review", { operation: "relate", request_id: requestID, relationship: "finding", source_record_id: initialInterpretation.id, member_ids: ["subject"] })
        relationshipIDs.push(findingRelation.id)
        const correctionRelation = await invoke("review", { operation: "relate", request_id: requestID, relationship: "correction", source_record_id: correctionReport.id, member_ids: ["subject"], supersedes: findingRelation.id })
        relationshipIDs.push(correctionRelation.id)
        if (i === 0) for (const source of chains.slice(0, 6).flat().filter(record => record.session_id === sessions.reader && record.kind !== "observation"))
          for (const relationship of ["cited", "claimed-inspected"]) {
            const relation = await invoke("review", { operation: "relate", request_id: requestID, relationship, source_record_id: source.id, member_ids: ["subject"] })
            relationshipIDs.push(relation.id)
          }
      }
    }
    const originalSnapshot = Object.fromEntries((db.query("SELECT id,data FROM ledger ORDER BY seq").all() as Array<{ id: string; data: string }>).map(row => [row.id, row.data]))
    const connectedRecords = options.mode === "connected" ? [...originals, ...chains.slice(0, 6).flat()] : originals
    return { f: host, directory, db, store, action, sessions, records, observations: { original, rerun: retry, edit, beforeIndex, afterIndex },
      unrelated, objectives, reviewIDs, relationshipIDs, objectiveSources, originals, connectedRecords, chains,
      originalSnapshot, totalRecords, mode: options.mode, question: TRAJECTORY_QUESTION, search: TRAJECTORY_SEARCH,
      setupQualification: options.mode === "sparse"
        ? "Synthetic unplanned originals with zero objective/review associations. Original observer references and citations are retained. Discovery, attributed retrospective authoring and subsequent navigation must be measured separately. No private operator reproduction or native review execution."
        : "Synthetic large unplanned citation population with explicitly overlapping objectives and review branches. Its connected component includes known shared-evidence spillover. Registered source owners are real; native host and sources are controlled fixtures.", close }
  } catch (error) { await close(); throw error }
}
