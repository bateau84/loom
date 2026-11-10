import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Store } from "../src/store.js"
import { digest } from "../src/model.js"
import { registeredLoom } from "./helpers/registered-loom.js"

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
      const host = await registeredLoom([], { directory: project, versionedHost: true })
      let action: any, evidence: any, original: any, revision: any, older: any[]
      const expected: any[] = []
      try {
        action = (await host.invoke("action", { operation: "create",
          title: "One objective", goal: "Investigate mixed outcomes without counting handbacks as success" })).result
        evidence = (await host.invoke("record", { operation: "add", session_only: true,
          kind: "result", statement: "Original negative verification evidence" })).result
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

      // Re-open the verified isolated directory through actual registered public
      // tools, not a private SQL reader or simple plugin restart at the source.
      const recovered = await registeredLoom([], { directory: project, stateHome: restoreHome, versionedHost: true })
      try {
        const actions = (await recovered.invoke("action", { operation: "list" })).result.items
        expect(actions.find((a: any) => a.id === action.id)).toMatchObject(action)
        const insights = (await recovered.invoke("insights", { operation: "window", limit: 200 })).result
        expect(insights.events.map((e: any) => e.record_id)).toContain(evidence.id)
        if (wal) expect(insights.events.map((e: any) => e.record_id)).toContain(wal.evidence)
        const records = (await recovered.invoke("record", { operation: "query", session_only: true })).result.items
        expect(records.find((r: any) => r.id === evidence.id)?.data.statement).toBe("Original negative verification evidence")
        const candidateList = (await recovered.invoke("tweak", { operation: "list" })).result.items
        expect(candidateList.map((c: any) => c.id)).toContain(original.id)
        expect(candidateList.map((c: any) => c.id)).toContain(revision.id)
        const first = (await recovered.invoke("tweak", { operation: "read", id: original.id })).result
        expect(first).toMatchObject({ id: original.id, base_sha256: original.base_sha256,
          candidate_sha256: original.candidate_sha256, content: original.content, status: "retired",
          evidence_refs: [evidence.id] })
        expect(first.trials[0]).toMatchObject({ observed_effect: "harmful", evidence_refs: [evidence.id] })
        const second = (await recovered.invoke("tweak", { operation: "read", id: revision.id })).result
        expect(second).toMatchObject({ id: revision.id, revised_from: original.id,
          base_sha256: revision.base_sha256, candidate_sha256: revision.candidate_sha256,
          content: revision.content, status: "retired", evidence_refs: [evidence.id] })
        expect(second.trials_more).toBe(true)
        let page = second
        const all: any[] = []
        while (true) {
          all.push(...page.trials)
          if (page.trials_next_before === null) break
          page = (await recovered.invoke("tweak", {
            operation: "read", id: revision.id, trial_before: page.trials_next_before,
          })).result
        }
        expect(all).toHaveLength(29)
        expect(new Set(all.map(t => t.id))).toEqual(new Set(expected.map(t => t.id)))
        for (const trial of expected) {
          const actual = all.find(t => t.id === trial.id)
          expect(actual).toMatchObject({ id: trial.id, observed_effect: trial.observed_effect,
            observed_sha256: revision.candidate_sha256, statement: trial.statement,
            evidence_refs: trial.evidence_refs, session_id: trial.session_id, agent: trial.agent })
        }
        for (const negative of older) expect(all.find(t => t.id === negative.id)?.observed_effect).toBe("harmful")
        if (wal) {
          const walRead = (await recovered.invoke("tweak", { operation: "read", id: wal.candidate })).result
          expect(walRead.evidence_refs).toEqual([wal.evidence])
          expect(walRead.candidate_sha256).toBe(fingerprint("WAL-only content"))
        }
        expect(recovered.sessionPrompts).toHaveLength(0)
        expect(recovered.sessionCreates).toHaveLength(0)
      } finally { await recovered.close() }
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
    rejected(python(restoreArgs(project, backup, restored)), "Missing")
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
    const recovered = await registeredLoom([], { directory: project, stateHome: restoreHome })
    try {
      const actions = (await recovered.invoke("action", { operation: "list" })).result.items
      expect(actions.find((a: any) => a.id === action.id)).toMatchObject(action)
      expect((await recovered.invoke("tweak", { operation: "list" })).result.items).toEqual([])
      expect(recovered.sessionPrompts).toHaveLength(0)
    } finally { await recovered.close() }
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
