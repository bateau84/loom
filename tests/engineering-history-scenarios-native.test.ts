import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { canonical, type LedgerRecord } from "../src/model.js"
import { engineeringHistoryScenario, type RegisteredHistoryFixture } from "./helpers/engineering-history-scenarios.js"

type Step = { tool: string; input: Record<string, unknown>; bytes: number; elapsed_ms: number; record_ids: string[] }
type Measurement = { calls: number; bytes: number; elapsed_ms: number; steps: Step[] }
const metric = (): Measurement => ({ calls: 0, bytes: 0, elapsed_ms: 0, steps: [] })
const phrase = (record: LedgerRecord, search: string) => typeof record.data.statement === "string"
  && record.data.statement.toLowerCase().includes(search)
const exact = (record: LedgerRecord) => {
  const { id, action_id, node_id, kind, session_id, agent, created_at, fingerprint, data } = record
  return { id, action_id, node_id, kind, session_id, agent, created_at, fingerprint, data }
}
const ordered = (records: LedgerRecord[]) => records.map(record => canonical(exact(record))).sort()

function measured(f: RegisteredHistoryFixture, measurement: Measurement) {
  return async (name: string, input: Record<string, unknown>) => {
    const start = performance.now()
    const response = await f.tools.get(name).execute(input, { sessionID: "unfamiliar-reader", agent: "author",
      messageID: "qualification-read", id: "qualification-call", signal: new AbortController().signal })
    const elapsed_ms = performance.now() - start, bytes = Buffer.byteLength(response.content)
    const result = JSON.parse(response.content).result
    const records = result.items ?? result.records ?? []
    measurement.calls++; measurement.bytes += bytes; measurement.elapsed_ms += elapsed_ms
    measurement.steps.push({ tool: name, input, bytes, elapsed_ms,
      record_ids: records.map((record: any) => record.id ?? record.source.record_id) })
    return result
  }
}

async function sourceRecords(run: ReturnType<typeof measured>, action_id: string, source_session_id: string) {
  const records: LedgerRecord[] = []
  let after: number | undefined
  do {
    const page = await run("record", { operation: "query", action_id, source_session_id, limit: 50,
      ...(after === undefined ? {} : { after }) })
    records.push(...page.items); after = page.next_after ?? undefined
  } while (after !== undefined)
  return records
}

/** Follow only source-produced citations and captured-start links. Reused Session
 * neighbors are not silently incorporated into the selected engineering story. */
function trajectorySources(records: LedgerRecord[], search: string) {
  const byID = new Map(records.map(record => [record.id, record]))
  const selected = records.filter(record => phrase(record, search))
  const ids = new Set(selected.map(record => record.id))
  for (const record of selected) {
    if (!Array.isArray(record.data.evidence_ids)) continue
    for (const id of record.data.evidence_ids) {
      if (typeof id !== "string") throw new Error("Unsupported source citation")
      const observation = byID.get(id)
      if (!observation) throw new Error("Selected source citation was not retrieved")
      ids.add(id)
      if (typeof observation.data.start_id === "string") {
        if (!byID.has(observation.data.start_id)) throw new Error("Captured start source was not retrieved")
        ids.add(observation.data.start_id)
      }
    }
  }
  return records.filter(record => ids.has(record.id))
}

for (const planned of [false, true]) test(`${planned ? "planned" : "unplanned"} adversarial history is selectively discoverable with a fair record baseline`, async () => {
  const scenario = await engineeringHistoryScenario({ planned })
  const { f, action, search } = scenario
  try {
    // Both retrieval procedures receive only the Action identity and the same
    // natural-language topic. Source, node and record IDs come from tool output.
    const legacy = metric(), oldRead = measured(f, legacy)
    let concern: LedgerRecord | undefined, after: number | undefined
    do {
      const page = await oldRead("record", { operation: "query", action_id: action.id, record_kinds: ["concern"], limit: 50,
        ...(after === undefined ? {} : { after }) })
      concern = page.items.find((record: LedgerRecord) => phrase(record, search))
      after = page.next_after ?? undefined
    } while (!concern && after !== undefined)
    if (!concern) throw new Error("Record baseline did not discover the relevant concern")
    // The existing source_session_id filter retrieves this reused Session in two
    // bounded calls. Metadata omits statement text; selected-field projection
    // requires known record IDs. Neither would improve this full-original need.
    const oldSources = await sourceRecords(oldRead, action.id, concern.session_id)
    const oldSelected = trajectorySources(oldSources, search)

    const progressive = metric(), newRead = measured(f, progressive)
    const overview = await newRead("history", { operation: "read", action_id: action.id })
    expect(overview.totals.records).toBe(1766)
    expect(overview.totals.sessions).toBe(241)
    expect(overview.coverage.branches_omitted).toBeGreaterThan(0)
    const targetIDs = Object.values(scenario.records).map(record => record.id)
    expect(overview.highlights.map((record: any) => record.source.record_id).some((id: string) => targetIDs.includes(id))).toBe(false)

    const discovered = await newRead("history", { operation: "read", action_id: action.id, match: search })
    expect(discovered.mode).toBe("discovery")
    expect(discovered.coverage.matching_records).toBe(7)
    expect(discovered.coverage.next_after).toBeNull()
    expect(discovered.records.map((record: any) => record.source.record_id).sort()).toEqual([...targetIDs].sort())
    const sourceSessions = [...new Set<string>(discovered.records.map((record: any) => record.source.session_id))]
    expect(sourceSessions).toHaveLength(1)
    const newSources = await sourceRecords(newRead, action.id, sourceSessions[0])
    const newSelected = trajectorySources(newSources, search)
    expect(ordered(newSelected)).toEqual(ordered(oldSelected))
    const expectedOriginals = [...Object.values(scenario.records),
      ...[scenario.observations.original, scenario.observations.rerun, scenario.observations.corrected,
        scenario.observations.partial, scenario.observations.contradictory].flatMap(pair => [pair.start, pair.finish])]
    expect(ordered(newSelected)).toEqual(ordered(expectedOriginals))
    expect(newSelected).toHaveLength(17)
    expect(newSources.some(record => record.id === scenario.observations.ambiguousFinish.id || record.id === scenario.observations.gapFinish.id)).toBe(false)
    expect(legacy.calls).toBe(4)
    expect(progressive.calls).toBe(4)

    // Repeated reads make their local cost visible. These are observations from
    // a warmed process, not latency thresholds, cache requirements or a speedup.
    const repeatedDiscovery = metric(), repeatDiscovery = measured(f, repeatedDiscovery)
    const repeatedBranch = metric(), repeatBranch = measured(f, repeatedBranch)
    const first = discovered.records[0]
    const branchQuery = { operation: "read", action_id: action.id, branch_ref: first.branch_ref,
      through: discovered.boundary.observed_through }
    const selectedBranches = []
    for (let i = 0; i < 3; i++) {
      const repeat = await repeatDiscovery("history", { operation: "read", action_id: action.id, match: search })
      expect(repeat.records.map((record: any) => record.source.record_id)).toEqual(discovered.records.map((record: any) => record.source.record_id))
      const branch = await repeatBranch("history", branchQuery)
      expect(branch.selected_branch.ref).toBe(first.branch_ref)
      selectedBranches.push(branch)
    }
    const selected = selectedBranches[0]
    const selectedRoot = selected.ancestors[0] ?? selected.selected_branch
    expect(overview.branches.some((branch: any) => branch.ref === selectedRoot.ref)).toBe(false)
    expect(selected.totals.native_dispatches).toBeNull()
    expect(selected.totals.verified_outcomes).toBeNull()
    if (!planned) expect(selected.ancestors.some((branch: any) => branch.kind === "session")).toBe(true)
    else {
      // This ordinary authored finding has a subject fingerprint shared across
      // two Plan revisions. Related historical work is qualified, not silently
      // chosen as the finding's exact parent or execution membership.
      expect(selected.selected_branch.kind).toBe("unversioned-node")
      const related = selected.related_branches.filter((branch: any) => branch.work_ref?.node_id === "legacy-probe")
      expect(related.map((branch: any) => branch.work_ref.plan_revision).sort()).toEqual([1, 2])
      expect(related.every((branch: any) => branch.gaps.some((gap: any) => gap.code === "same-work-fingerprint"))).toBe(true)
      const historical = (await f.invoke("history", { operation: "read", ...related[0].expand }, "unfamiliar-reader")).result
      expect(historical.ancestors.some((branch: any) => branch.kind === "historical-plan")).toBe(true)
      expect(historical.ancestors.some((branch: any) => branch.historical_node?.kind === "wave")).toBe(true)
    }
    const encoded = JSON.stringify(discovered)
    expect(encoded).not.toContain("PRIVATE_RAW_NATIVE_INPUT")
    expect(encoded).not.toContain("PRIVATE_RAW_NATIVE_RESULT")
    expect(encoded).not.toContain("PRIVATE_AGENT_INSTRUCTIONS")

    // A reader who already has the question can issue match directly. Preserve
    // the overview-first journey and also report that cheaper exact subset of
    // measured callbacks, without pretending it was a separate timed run.
    const directSteps = progressive.steps.slice(1)
    const direct: Measurement = { calls: directSteps.length, bytes: directSteps.reduce((sum, step) => sum + step.bytes, 0),
      elapsed_ms: directSteps.reduce((sum, step) => sum + step.elapsed_ms, 0), steps: directSteps }
    const result = { format: "loom-engineering-history-qualification/v1", scenario: planned ? "planned" : "unplanned",
      scope: { action_id: action.id, records: overview.totals.records, sessions: overview.totals.sessions,
        ledger_coverage_only: true, additional_session_only_unpaired_finishes: 2 },
      question: scenario.question, initial_target_outside_default_highlights: true, initial_target_outside_default_branches: true,
      optimized_record_baseline: legacy, progressive_history: progressive, direct_selective_history: direct,
      route_qualification: "progressive_history includes an optional initial overview. direct_selective_history is the exact measured match-plus-source subset, not an independently timed run. Both receive the same question terms as the record baseline.",
      repeat_selective_reads: repeatedDiscovery, repeat_branch_reads: repeatedBranch,
      selected_original_record_ids: newSelected.map(record => record.id), selected_author_statement_ids: targetIDs,
      exact_originals_equal: true, matching_record_count: discovered.coverage.matching_records,
      full_action_client_enumeration: { optimized_record_baseline: false, progressive_history: false, direct_selective_history: false },
      interpretation: "Deterministic source-selection qualification through actual registered callbacks. It does not measure unfamiliar-agent comprehension or establish a general efficiency win.",
      excludes: ["fixture setup", "oracle assertions", "live native host/network", "model reasoning", "tokens", "production performance"],
      repeat_qualification: "Three local repeated reads in one process. No cache or performance threshold is asserted.",
    }
    if (process.env.LOOM_HISTORY_MEASURE_DIR) {
      await mkdir(process.env.LOOM_HISTORY_MEASURE_DIR, { recursive: true })
      await writeFile(join(process.env.LOOM_HISTORY_MEASURE_DIR, `${planned ? "planned" : "unplanned"}.json`), JSON.stringify(result, null, 2) + "\n")
    }
    if (process.env.LOOM_HISTORY_MEASURE === "1") console.log("ENGINEERING_HISTORY_ADVERSARIAL_MEASUREMENT " + JSON.stringify({
      ...result, optimized_record_baseline: { ...legacy, steps: undefined }, progressive_history: { ...progressive, steps: undefined },
      direct_selective_history: { ...direct, steps: undefined },
      repeat_selective_reads: repeatedDiscovery.steps.map(step => ({ bytes: step.bytes, elapsed_ms: step.elapsed_ms })),
      repeat_branch_reads: repeatedBranch.steps.map(step => ({ bytes: step.bytes, elapsed_ms: step.elapsed_ms })),
    }))
  } finally { await scenario.close() }
})

for (const planned of [false, true]) test(`${planned ? "planned" : "unplanned"} real observation provenance survives projection without assigning Session gaps to an Action`, async () => {
  const scenario = await engineeringHistoryScenario({ planned, unrelatedSessions: 30 })
  const { f, action, observations, sessions } = scenario
  try {
    const projected = async (record: LedgerRecord, sessionOnly = false) => {
      const view = (await f.invoke("history", { operation: "read", ...(sessionOnly ? { session_id: sessions.target } : { action_id: action.id }),
        record_id: record.id }, "unfamiliar-reader")).result
      expect(view.records).toHaveLength(1)
      return view.records[0]
    }
    const start = await projected(observations.original.start), finish = await projected(observations.original.finish)
    expect(start.observation).toMatchObject({ phase: "started", capture_gap: false,
      attribution: null, attribution_excerpted: false, finish_pairing: "not-applicable",
      message_id: observations.original.start.data.message_id, call_id: observations.original.start.data.call_id,
      correlation_key: observations.original.start.data.correlation_key, observer_epoch: observations.original.start.data.observer_epoch,
      input_digest: observations.original.start.data.input_digest })
    expect(finish.observation).toMatchObject({ phase: "finished", status: "error", capture_gap: null,
      attribution: "captured-at-start", attribution_excerpted: false, finish_pairing: "paired",
      start_id: observations.original.start.id, result_digest: observations.original.finish.data.result_digest })
    const recordedScope = observations.original.finish.data.work_scope
    if (!recordedScope || typeof recordedScope !== "object") throw new Error("Observed finish did not retain its source work scope")
    expect(finish.observation.work_scope).toMatchObject(recordedScope)
    expect(finish.fingerprint).toBe(observations.original.finish.fingerprint)
    expect(finish.verification).toBe("recorded observation; engineering outcome not established")

    const firstContext = await projected(observations.originalContext), currentContext = await projected(observations.currentContext)
    for (const [view, original] of [[firstContext, observations.originalContext], [currentContext, observations.currentContext]] as const) {
      expect(view.observation).toMatchObject({ phase: "agent-context-snapshot", agent_id: original.data.agent_id,
        content_sha256: original.data.content_sha256, context_system_sha256: original.data.context_system_sha256,
        source: "native-agent-registry-system", qualification: original.data.observation,
        work_scope: { status: "unavailable", reason: "absent" } })
      expect(view.work_ref).toBeNull()
    }
    expect(firstContext.observation.content_sha256).not.toBe(currentContext.observation.content_sha256)
    const firstSkill = await projected(observations.originalSkill), revisedSkill = await projected(observations.revisedSkill)
    for (const [view, original] of [[firstSkill, observations.originalSkill], [revisedSkill, observations.revisedSkill]] as const) {
      expect(view.observation).toMatchObject({ phase: "skill-load-result", skill_id: original.data.skill_id,
        call_id: original.data.call_id, rendered_sha256: original.data.rendered_sha256,
        registry_content_sha256: original.data.registry_content_sha256, registered_content_present: true,
        qualification: original.data.observation, work_scope: { status: "unavailable", reason: "absent" } })
      expect(view.fingerprint).toBe(original.fingerprint)
      expect(view.work_ref).toBeNull()
    }
    expect(firstSkill.observation.rendered_sha256).not.toBe(revisedSkill.observation.rendered_sha256)

    const originalFinding = await projected(scenario.records.originalFailure), rerun = await projected(scenario.records.unchangedRerun)
    expect(originalFinding.fingerprint).toBe(rerun.fingerprint)
    expect(originalFinding.work_ref).toBeNull()
    expect(rerun.work_ref).toBeNull()
    if (planned) {
      expect(scenario.plans.original!.revision).toBe(1)
      expect(scenario.plans.unrelated!.revision).toBe(2)
      expect(scenario.plans.current!.revision).toBe(3)
      expect(scenario.plans.current!.nodes.some(node => node.id === "legacy-probe")).toBe(false)
      expect(start.work_ref.plan_revision).toBe(1)
      const repeated = await projected(observations.rerun.start)
      expect(repeated.work_ref.plan_revision).toBe(2)
    }

    const ambiguous = await projected(observations.ambiguousFinish, true)
    expect(ambiguous.observation).toMatchObject({ attribution: "ambiguous-host-call; not assigned to current work",
      finish_pairing: "unestablished", start_id: null,
      work_scope: { status: "ambiguous", candidates_complete: false, candidates_omitted: 0, observation_ids_omitted: 0 } })
    expect(ambiguous.observation.work_scope.observation_ids.sort()).toEqual([
      observations.ambiguousStart.id, observations.otherAmbiguousStart.id,
    ].sort())
    expect(ambiguous.observation.work_scope.candidates).toHaveLength(planned ? 2 : 0)
    expect(ambiguous.work_ref).toBeNull()
    const gapStart = await projected(observations.gapStart), gapFinish = await projected(observations.gapFinish, true)
    expect(gapStart.observation.capture_gap).toBe(true)
    expect(gapFinish.observation).toMatchObject({ capture_gap: null, attribution: "capture-gap; not assigned to current work",
      finish_pairing: "unestablished", start_id: null, work_scope: { status: "unknown", reason: "not-observed" } })
    expect(observations.ambiguousFinish.action_id).toBeUndefined()
    expect(observations.gapFinish.action_id).toBeUndefined()
    for (const record of [observations.ambiguousFinish, observations.gapFinish]) await expect(f.invoke("history", {
      operation: "read", action_id: action.id, record_id: record.id,
    }, "unfamiliar-reader")).rejects.toThrow("unavailable")

    const actionView = (await f.invoke("history", { operation: "read", action_id: action.id }, "unfamiliar-reader")).result
    const sessionView = (await f.invoke("history", { operation: "read", session_id: sessions.target }, "unfamiliar-reader")).result
    expect(actionView.totals).toMatchObject({ capture_gap_records: 1, unestablished_finishes: 0, ambiguous_scope_records: 0 })
    expect(sessionView.totals).toMatchObject({ capture_gap_records: 1, unestablished_finishes: 2, ambiguous_scope_records: 1 })
    expect(sessionView.highlights.some((record: any) => [observations.ambiguousFinish.id, observations.gapFinish.id, observations.gapStart.id]
      .includes(record.source.record_id))).toBe(true)
    const gaps = []
    let after: number | undefined, through: number | undefined
    do {
      const page = (await f.invoke("history", { operation: "read", session_id: sessions.target, has_gaps: true,
        record_kinds: ["observation"], limit: 50, ...(after === undefined ? {} : { after, through }) }, "unfamiliar-reader")).result
      gaps.push(...page.records)
      through = page.boundary.observed_through; after = page.coverage.next_after ?? undefined
    } while (after !== undefined)
    expect(gaps.map((record: any) => record.source.record_id)).toEqual(expect.arrayContaining([
      observations.ambiguousFinish.id, observations.gapFinish.id, observations.gapStart.id,
    ]))
    for (const view of [actionView, sessionView]) {
      const text = JSON.stringify(view)
      expect(text).not.toContain("PRIVATE_RAW_NATIVE_INPUT")
      expect(text).not.toContain("PRIVATE_RAW_NATIVE_RESULT")
      expect(text).not.toContain("PRIVATE_AGENT_INSTRUCTIONS")
      expect(view.totals.native_dispatches).toBeNull()
      expect(view.totals.verified_outcomes).toBeNull()
    }
  } finally { await scenario.close() }
})
