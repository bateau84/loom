import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Store } from "../src/store.js"
import { digest } from "../src/model.js"
import { registeredLoom } from "./helpers/registered-loom.js"
import { SessionExperiments } from "../src/live-experiments.js"

const BASE = "edab7a96e7c5a9172ceb98b8518c47c48a1d7c09"
const PACKAGE = "2.0.0-alpha.1"
const command = new URL("../tools/learning-state-backup.py", import.meta.url).pathname
const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex")
const scope = (project: string) => digest({ project: "tool-help", canonical: project })
const source = (project: string) => join(project, "state", "loom", "actions-v1", scope(project))
const settings = (project: string) => [
  "--project-id", "tool-help", "--project-canonical", project,
  "--loom-revision", BASE, "--package-version", PACKAGE,
]
function python(args: string[], stopped = "yes") {
  return Bun.spawnSync(["python3", command, ...args], {
    env: { ...process.env, LOOM_WRITERS_STOPPED: stopped },
  })
}
function ok(run: ReturnType<typeof python>) {
  if (run.exitCode !== 0) throw new Error("recovery command failed: " + run.stderr.toString())
  expect(run.exitCode).toBe(0)
  expect(run.stderr.toString()).toBe("")
  return run.stdout.toString()
}
function rejected(run: ReturnType<typeof python>, phrase: string) {
  expect(run.exitCode).not.toBe(0)
  expect(run.stderr.toString()).toContain(phrase)
}
// Hash raw bytes (the backup format never normalizes text or SQLite pages).
function rawHashes(directory: string) {
  return Object.fromEntries(readdirSync(directory).sort().map(name =>
    [name, createHash("sha256").update(readFileSync(join(directory, name))).digest("hex")]))
}
function outputDirs(root: string, project: string) {
  const backup = join(root, "backup")
  const restoreHome = join(root, "isolated-state")
  const restored = join(restoreHome, "loom", "actions-v1", scope(project))
  mkdirSync(join(restoreHome, "loom", "actions-v1"), { recursive: true })
  return { backup, restoreHome, restored }
}
function backupArgs(project: string, dest: string, legacy = false) {
  return ["backup", "--source-dir", source(project), "--backup-dir", dest, ...settings(project),
    ...(legacy ? ["--legacy-no-learning"] : [])]
}
function restoreArgs(project: string, backup: string, destination: string) {
  return ["restore", "--backup-dir", backup, "--destination-dir", destination, ...settings(project)]
}

for (const mode of ["closed", "residual-WAL"] as const) {
  test("full offline backup restores public Loom readers and oldest negative reports: " + mode, async () => {
    const root = mkdtempSync(join(tmpdir(), "loom-learning-recovery-"))
    const project = join(root, "project")
    mkdirSync(project)
    try {
      const host = await registeredLoom([], { directory: project, versionedHost: true, approvalProof: "synthetic" })
      let action: any, evidence: any, original: any, revision: any, older: any[], objective: any, trendBounds: any, live: any
      const expected: any[] = []
      try {
        action = (await host.invoke("action", { operation: "create",
          title: "One objective", goal: "Investigate mixed outcomes without counting handbacks as success" })).result
        evidence = (await host.invoke("record", { operation: "add", session_only: true,
          kind: "result", statement: "Original negative verification evidence" })).result
        // Reconstruct an actual linked corrective objective using original Action
        // records. This cross-version fixture exercises the final objective and
        // trend readers after physical restore, not merely SQLite file checksums.
        objective = (await host.invoke("objective", { operation: "create",
          label: "Original correction and final outcome", source_type: "ledger-record",
          source_id: evidence.id, unit_key: "whole" })).result
        const firstLink = (await host.invoke("objective", {
          operation: "read", objective_id: objective.id,
        })).result.entries[0]
        const failed = (await host.invoke("record", { operation: "add", session_only: true,
          kind: "result", statement: "First implementation failed real verification" })).result
        await host.invoke("objective", { operation: "link", objective_id: objective.id,
          phase: "verification", assessment: "fail", source_type: "ledger-record", source_id: failed.id })
        const corrected = (await host.invoke("record", { operation: "add", session_only: true,
          kind: "result", statement: "Corrective implementation dispatched" })).result
        await host.invoke("objective", { operation: "link", objective_id: objective.id,
          phase: "corrective-dispatch", related_sequence: firstLink.sequence,
          source_type: "ledger-record", source_id: corrected.id })
        const passed = (await host.invoke("record", { operation: "add", session_only: true,
          kind: "result", statement: "Corrected implementation passed verification" })).result
        await host.invoke("objective", { operation: "link", objective_id: objective.id,
          phase: "verification", assessment: "pass", source_type: "ledger-record", source_id: passed.id })
        const delivered = (await host.invoke("record", { operation: "add", session_only: true,
          kind: "result", statement: "One final successful objective delivered" })).result
        await host.invoke("objective", { operation: "link", objective_id: objective.id,
          phase: "outcome", assessment: "pass", source_type: "ledger-record", source_id: delivered.id })
        trendBounds = { operation: "compare", population: "selected", objective_ids: [objective.id],
          since_at: new Date(Date.now()-86400000).toISOString(),
          until_at: new Date(Date.now()+30000).toISOString(),
          as_of_at: new Date(Date.now()+30000).toISOString() }
        const originalTrend = (await host.invoke("trends", trendBounds)).result
        expect(originalTrend.population.eligible_objectives).toBe(1)
        expect(originalTrend.metrics.reported_recovery).toBe(1)
        expect(originalTrend.metrics.with_documented_correction).toBe(1)
        original = (await host.invoke("tweak", { operation: "propose", target_kind: "agent",
          target_id: "evaluator", base_sha256: fingerprint("agent base"),
          candidate_content: "Version A: use all source records", hypothesis: "Reduce false successes",
          evidence_refs: [evidence.id] })).result;
        (await host.invoke("tweak", { operation: "trial", id: original.id,
          observed_effect: "harmful", observed_sha256: original.candidate_sha256,
          statement: "First negative episode", evidence_refs: [evidence.id] }))
        revision = (await host.invoke("tweak", { operation: "propose", target_kind: "agent",
          target_id: "evaluator", base_sha256: original.candidate_sha256,
          revised_from: original.id, candidate_content: "Version B: evidence plus corrections",
          hypothesis: "Retain negative counterexamples", evidence_refs: [evidence.id] })).result
        expect((await host.invoke("tweak", { operation: "retire", id: original.id })).result.status).toBe("retired")
        const effects = ["harmful", "neutral", "inconclusive", "promising", "not-exercised"]
        for (let i = 0; i < 29; i++) {
          const effect = i < 6 ? "harmful" : effects[i % effects.length]
          expected.push((await host.invoke("tweak", { operation: "trial", id: revision.id,
            observed_effect: effect, observed_sha256: revision.candidate_sha256,
            statement: "Original objective report " + i,
            evidence_refs: [evidence.id, "source://trial/" + i] })).result)
        }
        older = expected.slice(0, 6)
        expect((await host.invoke("tweak", { operation: "retire", id: revision.id })).result.status).toBe("retired")
        // Exercise the final production Session-trial tables and audit history.
        // This is a deterministic host fixture: assignment is NOT observed
        // provider delivery or real user authorization.
        const treatmentSession = "recovery-trial"
        const baseline = "Original native author system instructions."
        const candidateText = "Proposed additive Session context: record original source evidence."
        host.nativeAgents.find((a: any) => a.id === "author").system = baseline
        host.sessions.set(treatmentSession, {
          id: treatmentSession, agent: "author", projectID: "tool-help",
          location: { directory: project },
        })
        host.nativeContexts.set(treatmentSession, { data: [{
          id: "request-recovery-trial", type: "user",
          text: "Reconstruct one exact engineering objective for a bounded instruction trial",
          time: { created: Date.now() },
        }] })
        const liveObjective = (await host.invoke("objective", {
          operation: "create", source_type: "native-message",
          source_id: "request-recovery-trial", label: "Original native Session trial goal",
        }, treatmentSession)).result
        const liveCandidate = (await host.invoke("tweak", {
          operation: "propose", target_kind: "agent", target_id: "author",
          base_sha256: fingerprint(baseline), candidate_content: candidateText,
          hypothesis: "Test faithful retention of trial assignment across backup",
          evidence_refs: [evidence.id],
        })).result
        const approval = "user-approval-recovery-trial"
        const trialStart = {
          operation: "live-start", objective_id: liveObjective.id,
          candidate_id: liveCandidate.id, authorize: true,
          authorization_ref: approval,
          eligibility: "The exact original author Session and approved objective",
          evaluation_criteria: "Verify original sources and avoid counting attempts as objectives",
          preserved_guarantees: "No registry edits, no permission bypass and no paid provider",
          budget_requests: 2, expires_at: new Date(Date.now()+180000).toISOString(),
        }
        // Recovery tests use a synthetic trusted-approval fixture solely to
        // exercise the persisted assignment, never to claim native human consent.
        // Bind the exact candidate bytes, scope, objective, budget and expiry.
        const approvalDB = new Database(join(source(project), "learning.sqlite"))
        let approvalLine: string
        try {
          approvalLine = new SessionExperiments(approvalDB).approvalBinding(
            { session_id: treatmentSession, agent: "author" }, trialStart).approval_line
        } finally { approvalDB.close() }
        (host.nativeContexts.get(treatmentSession) as {data:Array<Record<string,unknown>>}).data.push({
          id: approval, type: "user", text: approvalLine,
          time: { created: Date.now() },
        })
        const assignment = (await host.invoke("tweak", trialStart, treatmentSession)).result
        expect(assignment.status).toBe("assigned")
        expect(assignment.exposure).toBe("NOT_VERIFIED")
        // Withdraw through the actual tool. Preserve all historical
        // assignments/events without carrying an orphaned native entry into
        // a recovered host that has no model-visible Session history.
        const stopped = (await host.invoke("tweak", {
          operation: "live-stop",
        }, treatmentSession)).result
        expect(stopped.status).toBe("stopped")
        const observedTrial = (await host.invoke("tweak", {
          operation: "live-read",
        }, treatmentSession)).result
        expect(observedTrial.events.some((e: any) => e.kind === "native-entry-readback")).toBe(true)
        live = { session_id: treatmentSession, experiment_id: assignment.experiment_id,
          candidate_id: liveCandidate.id, candidate_sha256: liveCandidate.candidate_sha256,
          objective_id: liveObjective.id, baseline_sha256: fingerprint(baseline),
          authorization_ref: approval, event_kinds: observedTrial.events.map((e: any) => e.kind) }
      } finally { await host.close() }

      let wal: { evidence: string; candidate: string } | undefined
      if (mode === "residual-WAL") {
        // Two committed writes remain in real WAL files after the writer dies.
        // This child is a disposable fixture, not an operator process stop.
        const snippet = [
          'import { Database } from "bun:sqlite";',
          "import { Store } from " + JSON.stringify(new URL("../src/store.ts", import.meta.url).pathname) + ";",
          "import { Learning } from " + JSON.stringify(new URL("../src/learning.ts", import.meta.url).pathname) + ";",
          'import { writeSync } from "node:fs";',
          "const a = new Database(" + JSON.stringify(join(source(project), "ledger.sqlite")) + ");",
          "const b = new Database(" + JSON.stringify(join(source(project), "learning.sqlite")) + ");",
          "const store = new Store(a); const learning = new Learning(b, store, a);",
          'a.exec("PRAGMA wal_autocheckpoint=0"); b.exec("PRAGMA wal_autocheckpoint=0");',
          'const actor = {session_id:"s", agent:"author"};',
          'const evidence = store.record(actor, undefined, {kind:"result",statement:"Uncheckpointed negative evidence"});',
          'const candidate = learning.propose(actor, {target_kind:"skill",target_id:"wal",base_sha256:"' + fingerprint("wal base") + '",candidate_content:"WAL-only content",hypothesis:"Do not lose reports",evidence_refs:[evidence.id]});',
          'writeSync(1,JSON.stringify({evidence:evidence.id,candidate:candidate.id})+"\\n");',
          'process.kill(process.pid, "SIGKILL");',
        ].join("\n")
        const child = Bun.spawnSync([process.execPath, "--eval", snippet])
        expect(child.stderr.toString()).toBe("")
        expect(child.signalCode).toBe("SIGKILL")
        wal = JSON.parse(child.stdout.toString().trim())
        for (const name of ["ledger.sqlite", "learning.sqlite"]) {
          expect(existsSync(join(source(project), name + "-wal"))).toBe(true)
          expect(readFileSync(join(source(project), name + "-wal")).length).toBeGreaterThan(32)
        }
      }
      const originalHashes = rawHashes(source(project))
      const { backup, restoreHome, restored } = outputDirs(root, project)
      ok(python(backupArgs(project, backup)))
      expect(rawHashes(source(project))).toEqual(originalHashes)
      const manifest = JSON.parse(readFileSync(join(backup, "loom-state-manifest.json"), "utf8"))
      expect(manifest).toMatchObject({
        format: "loom-stopped-state/v1", project: { id: "tool-help", canonical: project, scope: scope(project) },
        loom_revision: BASE, package_version: PACKAGE, learning: "present",
      })
      expect(Object.keys(manifest.databases).sort()).toEqual(["learning.sqlite", "ledger.sqlite"])
      for (const [name, checksum] of Object.entries(originalHashes))
        expect(manifest.files[name].sha256).toBe(checksum)
      const backupHashes = rawHashes(backup)
      ok(python(restoreArgs(project, backup, restored)))
      expect(rawHashes(restored)).toEqual(originalHashes)
      expect(rawHashes(backup)).toEqual(backupHashes)
      expect(rawHashes(source(project))).toEqual(originalHashes)

      // Verify public readers in a separate process, so test files sharing an
      // environment cannot redirect the host to the original state home.
      const expectedFile = join(root, "reader-expectations.json")
      writeFileSync(expectedFile, JSON.stringify({ action, evidence, original, revision, objective, trendBounds, live,
        expected, older, wal: wal && { ...wal, candidateHash: fingerprint("WAL-only content") } }))
      const reader = Bun.spawnSync([process.execPath,
        new URL("./helpers/learning-recovery-reader.ts", import.meta.url).pathname,
        project, restoreHome, expectedFile])
      if (reader.exitCode !== 0) throw new Error("isolated public readers failed: " + reader.stderr.toString())
      expect(reader.stdout.toString()).toContain("PASS: verified public Action/learning readers")
      expect(rawHashes(source(project))).toEqual(originalHashes)
      expect(rawHashes(backup)).toEqual(backupHashes)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
}

test("manifest rejects missing learning, mixed files, wrong identity and revision before restore creates state", async () => {
  const root = mkdtempSync(join(tmpdir(), "loom-recovery-guards-"))
  const project = join(root, "project")
  mkdirSync(project)
  try {
    const host = await registeredLoom([], { directory: project })
    try {
      await host.invoke("tweak", { operation: "propose", target_kind: "skill",
        target_id: "guard", base_sha256: fingerprint("base"),
        candidate_content: "Preserve", hypothesis: "Keep complete learning membership" })
    } finally { await host.close() }
    const { backup, restored } = outputDirs(root, project)
    rejected(python(backupArgs(project, backup), "no"), "Stop all relevant writers")
    expect(existsSync(backup)).toBe(false)
    ok(python(backupArgs(project, backup)))
    const pristine = rawHashes(backup)
    const valid = readFileSync(join(backup, "learning.sqlite"))
    const alternative = join(root, "alternative")
    mkdirSync(alternative)
    for (const name of readdirSync(backup))
      copyFileSync(join(backup, name), join(alternative, name))
    // The old manifest identifies a single set; any later state file is rejected.
    const changed = new Database(join(alternative, "learning.sqlite"))
    try { changed.exec("UPDATE learning_candidates SET status='retired'") } finally { changed.close() }
    const mixed = join(backup, "learning.sqlite")
    copyFileSync(join(alternative, "learning.sqlite"), mixed)
    const failed = python(restoreArgs(project, backup, restored))
    rejected(failed, "membership, size or SHA-256 mismatch")
    expect(existsSync(restored)).toBe(false)
    writeFileSync(mixed, valid)
    // Other backup files are unchanged; the unmodified, identified set is valid.
    expect(rawHashes(backup)).toEqual(pristine)
    rejected(python(["restore", "--backup-dir", backup, "--destination-dir", restored, ...settings(project).map(x => x === "tool-help" ? "wrong-project" : x)]), "project identity mismatch")
    rejected(python(["restore", "--backup-dir", backup, "--destination-dir", restored,
      ...settings(project).map(x => x === BASE ? "a".repeat(40) : x)]), "revision mismatch")
    rejected(python(["restore", "--backup-dir", backup, "--destination-dir", restored,
      ...settings(project).map(x => x === PACKAGE ? "wrong-version" : x)]), "package version mismatch")
    const manifestPath = join(backup, "loom-state-manifest.json")
    const manifest = readFileSync(manifestPath)
    unlinkSync(manifestPath)
    rejected(python(restoreArgs(project, backup, restored)), "Missing or non-regular backup manifest")
    writeFileSync(manifestPath, manifest)
    unlinkSync(mixed)
    rejected(python(restoreArgs(project, backup, restored)), "Orphan sidecar without learning.sqlite")
    expect(existsSync(restored)).toBe(false)
    expect(rawHashes(source(project))).toEqual(Object.fromEntries(
      Object.entries(pristine).filter(([name]) => name !== "loom-state-manifest.json")))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("explicit pre-learning backup remains ledger-only; corrupt and incompatible learning files fail closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "loom-recovery-legacy-"))
  const project = join(root, "project")
  mkdirSync(project)
  try {
    const origin = source(project)
    mkdirSync(origin, { recursive: true })
    const db = new Database(join(origin, "ledger.sqlite"))
    const store = new Store(db)
    const action = store.create("Historical Action", "Pre-learning operator evidence",
      { session_id: "s", agent: "author" })
    db.close()
    const before = rawHashes(origin)
    const { backup, restoreHome, restored } = outputDirs(root, project)
    rejected(python(backupArgs(project, backup)), "--legacy-no-learning")
    expect(existsSync(backup)).toBe(false)
    ok(python(backupArgs(project, backup, true)))
    const manifest = JSON.parse(readFileSync(join(backup, "loom-state-manifest.json"), "utf8"))
    expect(manifest.learning).toBe("absent-pre-learning")
    expect(Object.keys(manifest.databases)).toEqual(["ledger.sqlite"])
    ok(python(restoreArgs(project, backup, restored)))
    expect(rawHashes(origin)).toEqual(before)
    const expectedFile = join(root, "legacy-reader-expectations.json")
    writeFileSync(expectedFile, JSON.stringify({ action, legacy: true }))
    const reader = Bun.spawnSync([process.execPath,
      new URL("./helpers/learning-recovery-reader.ts", import.meta.url).pathname,
      project, restoreHome, expectedFile])
    if (reader.exitCode !== 0) throw new Error("legacy restored public readers failed: " + reader.stderr.toString())
    expect(reader.stdout.toString()).toContain("PASS: legacy Action history recovered")
    expect(rawHashes(origin)).toEqual(before)

    const badLearning = join(origin, "learning.sqlite")
    writeFileSync(badLearning, "not a SQLite database")
    const badBackup = join(root, "bad")
    rejected(python(backupArgs(project, badBackup)), "file is not a database")
    expect(existsSync(join(badBackup, "loom-state-manifest.json"))).toBe(false)
    unlinkSync(badLearning)
    const invalid = new Database(badLearning)
    invalid.exec("PRAGMA user_version=99")
    invalid.close()
    const incompatible = join(root, "incompatible")
    rejected(python(backupArgs(project, incompatible)), "Unsupported learning.sqlite user_version")
    expect(existsSync(join(incompatible, "loom-state-manifest.json"))).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
