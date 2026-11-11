/**
 * Qualified public-reader exercise in its own Bun process.
 *
 * A separate process prevents a restored host from accidentally borrowing
 * another test's process-global XDG_STATE_HOME or SQLite connections.
 * All work uses a disposable restore; no native Session is created.
 */
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { registeredLoom } from "./registered-loom.js"

const [project, restoreHome, inputFile] = process.argv.slice(2)
assert(project && restoreHome && inputFile, "usage: bun learning-recovery-reader.ts PROJECT STATE_HOME EXPECTED_JSON")
const { action, evidence, original, revision, objective, trendBounds, findings, expected, older, wal, legacy } = JSON.parse(readFileSync(inputFile, "utf8"))
const recovered = await registeredLoom([], { directory: project, stateHome: restoreHome, versionedHost: true })
try {
  const actions = (await recovered.invoke("action", { operation: "list" })).result.items
  assert.deepEqual(actions.find((a: any) => a.id === action.id), action)

  if (legacy) {
    assert.deepEqual((await recovered.invoke("tweak", { operation: "list" })).result.items, [],
      "A pre-learning backup must not invent learning history")
    assert.deepEqual((await recovered.invoke("insights", { operation: "findings" })).result.items, [],
      "A pre-learning backup must not invent historical findings")
    assert.deepEqual(recovered.sessionPrompts, [])
    assert.deepEqual(recovered.sessionCreates, [])
    process.stdout.write("PASS: legacy Action history recovered without fabricated learning state\\n")
  } else {
  if (objective) {
    const linked = (await recovered.invoke("objective", {
      operation: "read", objective_id: objective.id,
    })).result
    assert.equal(linked.objective.id, objective.id,
      "Restored objective identity changed")
    assert.deepEqual(linked.entries.map((entry: any) => entry.phase),
      ["request", "verification", "corrective-dispatch", "verification", "outcome"],
      "Reconstructed corrective history was lost or reordered")
    assert(linked.entries.every((entry: any) => entry.verification === "loom-ledger"),
      "Restored objective no longer points to original Action evidence")
    assert.equal(linked.entries.find((entry: any) => entry.phase === "corrective-dispatch").related_sequence,
      linked.entries.find((entry: any) => entry.phase === "verification" && entry.assessment === "fail").sequence,
      "Restored correction no longer points to the failed check")
    const comparison = (await recovered.invoke("trends", trendBounds)).result
    assert.equal(comparison.population.eligible_objectives, 1,
      "Restored trends changed objective denominator")
    assert.equal(comparison.metrics.reported_recovery, 1,
      "Restored recovery became a separate failure or success")
    assert.equal(comparison.metrics.with_documented_correction, 1,
      "Restored corrective attempt linkage is absent")
    assert.equal(comparison.items[0].objective_id, objective.id,
      "Trend lost its original objective source link")
    assert.equal(comparison.population.origin_independence.status, "unqualified",
      "Restore must not manufacture originating-request independence")
  }
  if (findings) {
    const continued = [...findings.firstPage.items]
    let cursor = findings.firstPage.next_cursor
    while (cursor) {
      const page = (await recovered.invoke("insights", {
        operation: "findings", limit: 7, finding_cursor: cursor,
      })).result
      assert.equal(page.snapshot_max_rowid, findings.firstPage.snapshot_max_rowid,
        "Restored findings continuation changed its insertion snapshot")
      assert.equal(page.independent_pattern_qualification.status, "unqualified")
      continued.push(...page.items)
      cursor = page.next_cursor
    }
    assert.deepEqual(continued, findings.initial,
      "Findings continuation lost original history or included a later append")
    const fresh: any[] = []
    cursor = undefined
    do {
      const page = (await recovered.invoke("insights", {
        operation: "findings", limit: 7,
        ...(cursor ? { finding_cursor: cursor } : {}),
      })).result
      assert.equal(page.independent_pattern_qualification.status, "unqualified")
      fresh.push(...page.items)
      cursor = page.next_cursor
    } while (cursor)
    assert.deepEqual(fresh, findings.all,
      "Historical corrective/positive findings or their exact source links changed")
  }
  const insights = (await recovered.invoke("insights", { operation: "window", limit: 200 })).result
  assert(insights.events.some((e: any) => e.record_id === evidence.id), "Source Action evidence missing from insights")
  if (wal) assert(insights.events.some((e: any) => e.record_id === wal.evidence),
    "Committed WAL-only Action evidence missing")

  const records = (await recovered.invoke("record", { operation: "query", session_only: true })).result.items
  assert.equal(records.find((r: any) => r.id === evidence.id)?.data.statement,
    "Original negative verification evidence")

  const candidates = (await recovered.invoke("tweak", { operation: "list" })).result.items
  assert(candidates.some((c: any) => c.id === original.id), "Original candidate missing")
  assert(candidates.some((c: any) => c.id === revision.id), "Revised candidate missing")

  const first = (await recovered.invoke("tweak", { operation: "read", id: original.id })).result
  for (const field of ["id", "base_sha256", "candidate_sha256", "content", "hypothesis"])
    assert.equal(first[field], original[field], "Original candidate mismatch in " + field)
  assert.equal(first.status, "retired")
  assert.deepEqual(first.evidence_refs, [evidence.id])
  assert.equal(first.trials.length, 1)
  assert.equal(first.trials[0].observed_effect, "harmful")
  assert.deepEqual(first.trials[0].evidence_refs, [evidence.id])

  const second = (await recovered.invoke("tweak", { operation: "read", id: revision.id })).result
  for (const field of ["id", "revised_from", "base_sha256", "candidate_sha256", "content", "hypothesis"])
    assert.equal(second[field], revision[field], "Revised candidate mismatch in " + field)
  assert.equal(second.status, "retired")
  assert.deepEqual(second.evidence_refs, [evidence.id])
  assert.equal(second.trials_more, true)

  const all: any[] = []
  let page = second
  while (true) {
    all.push(...page.trials)
    if (page.trials_next_before === null) break
    page = (await recovered.invoke("tweak", {
      operation: "read", id: revision.id, trial_before: page.trials_next_before,
    })).result
  }
  assert.equal(all.length, expected.length)
  assert.deepEqual(new Set(all.map(t => t.id)), new Set(expected.map((t: any) => t.id)))
  for (const trial of expected) {
    const actual = all.find(t => t.id === trial.id)
    assert(actual, "Restored trial missing: " + trial.id)
    for (const field of ["id", "observed_effect", "observed_sha256", "statement", "session_id", "agent"])
      assert.equal(actual[field], trial[field], "Trial " + trial.id + " differs: " + field)
    assert.deepEqual(actual.evidence_refs, trial.evidence_refs)
  }
  for (const negative of older)
    assert.equal(all.find(t => t.id === negative.id)?.observed_effect, "harmful",
      "Oldest negative report lost or reclassified")

  if (wal) {
    const walCandidate = (await recovered.invoke("tweak", { operation: "read", id: wal.candidate })).result
    assert.deepEqual(walCandidate.evidence_refs, [wal.evidence])
    assert.equal(walCandidate.candidate_sha256, wal.candidateHash)
  }
  assert.deepEqual(recovered.sessionPrompts, [], "Inspection must never prompt a native Session")
  assert.deepEqual(recovered.sessionCreates, [], "Inspection must never create a native Session")
  process.stdout.write("PASS: verified public Action/learning readers, IDs, hashes, cross-db refs, " +
    all.length + " reports and oldest harmful outcomes\n")
  }
} finally {
  await recovered.close()
}
