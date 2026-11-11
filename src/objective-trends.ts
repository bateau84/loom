import type { SQL } from "./store.js"

// Read-only, bounded comparisons over ObjectiveIndex's exact source-linked contract.
// The two databases remain authoritative; no inferred objectives or score tables.
type Scope = {
  since_at: string; until_at: string; as_of_at: string
  population: "all-linked" | "selected"
  objective_ids: string[]
  source_type: string | null; unit_key: string | null
  group_by: string
}
export type TrendInput = {
  operation: "compare"; since_at: string; until_at: string; as_of_at: string
  population: "all-linked" | "selected"; objective_ids?: string[]
  source_type?: string; unit_key?: string; group_by?: string
  cursor?: string; limit?: number
}
type Snapshot = { v: 1; scope: Scope; max_objective: number; max_link: number; last_row: number }
type OriginRow = {
  objective_row: number; id: string; unit_key: string; created_at: string; author_agent: string
  source_key: string; source_type: string; source_id: string; source_session_id: string | null
  source_message_id: string | null; verification: string; start_ms: number; sequence: number
}
type LinkRow = {
  sequence: number; source_key: string; source_type: string; source_id: string
  source_session_id: string | null; source_message_id: string | null; action_id: string | null
  verification: string; source_at_ms: number | null; recorded_at: string
  phase: string; confidence: string; assessment: string | null; related_sequence: number | null
  gap_reason: string | null; author_agent: string; event_kind: string | null
}
type FingerprintRow = {
  kind: string; phase: string | null; skill_id: string | null; rendered_sha256: string | null
  content_sha256: string | null; registry_content_sha256: string | null
}
type Metrics = ReturnType<typeof zeroMetrics>
type GroupPoint = { start_at: string; dimensions: { unit_key: string; source_type: string; origin_verification: string; outcome_author_agent: string | null; instruction_fingerprint: string } }

const MAX_OBJECTIVES = 500
const MAX_LINKS = 500
const MAX_GROUPS = 50
const timestamp = (value: unknown, label: string) => {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Error(label + " must be a timezone-qualified ISO timestamp")
  const ms = Date.parse(value)
  if (!Number.isSafeInteger(ms)) throw new Error("Invalid " + label)
  return new Date(ms).toISOString()
}
const positive = (v: unknown, fallback: number, max: number) => {
  const n = v ?? fallback
  if (!Number.isSafeInteger(n) || (n as number) < 1 || (n as number) > max)
    throw new Error("Invalid trends page limit")
  return n as number
}
const bounded = (v: unknown, label: string) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(v))
    throw new Error("Invalid trends " + label)
  return v
}
const validHash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
const zeroMetrics = () => ({
  eligible_objectives: 0, reported_pass: 0, reported_fail: 0,
  unknown_or_incomplete: 0, inconclusive: 0, contested: 0,
  with_documented_correction: 0, reported_recovery: 0,
  reported_pass_without_correction: 0, verification_passes: 0,
  verification_failures: 0, verification_inconclusive: 0,
  handback_done_claims: 0, coverage_gaps: 0, unresolved_uncertain_links: 0,
  rejected_links: 0, environmental_problem_links: 0,
  planned_increment_links: 0, concern_source_links: 0,
})
const addMetrics = (target: Metrics, source: Metrics) => {
  for (const key of Object.keys(target) as Array<keyof Metrics>) target[key] += source[key]
}
const reference = (l: LinkRow) => ({
  sequence: l.sequence, type: l.source_type, id: l.source_id,
  session_id: l.source_session_id, message_id: l.source_message_id,
  action_id: l.action_id, verification: l.verification,
  source_at_ms: l.source_at_ms, recorded_at: l.recorded_at,
})
const retained = (links: LinkRow[]) => ({
  total: links.length, sources: links.slice(0, 12).map(reference),
  omitted: Math.max(0, links.length - 12),
})
const unavailables = {
  work_type: "No standardized work-type field; unit_key is a caller-chosen goal key, not a work classification.",
  model: "Objective links do not certify the actual model used for the whole objective or its attempts.",
  provider: "Provider/route per actual native request is not retained by this contract.",
  host_revision: "No source-linked host revision per objective or attempt is recorded.",
  tool_revision: "No source-linked tool implementation revision is recorded.",
  rubric: "Outcome assessments do not carry a stable rubric identity.",
  actual_instruction_exposure: "Linked observed result hashes do not prove final model receipt, consumption or stable variant assignment.",
  assignment: "Learning tweak proposals/trials do not certify assignment to these objectives.",
  human_intervention: "Source author_agent IDs do not identify human intervention or independent verification.",
  incident_cause: "Matching source IDs show shared evidence, not all shared root causes.",
}

export type OriginIndependenceQualification = {
  status: "qualified" | "unqualified"
  basis: string
}

/** A frozen high-water mark is carried in every continuation, not a ledger-page offset.
 * Recomputed totals always cover the entire selected objective set. */
export class ObjectiveTrends {
  constructor(private db: SQL, private actionDB: SQL) {}

  /** OpenCode 2.2.6 has no attested direct originating-request identity.
   * Distinct ledger or user-role message IDs can be attempts at one request.
   * There is currently no trusted producer for independence certification. */
  originIndependenceQualification(): OriginIndependenceQualification {
    return {
      status: "unqualified",
      basis: "Distinct objective, ledger and user-role message IDs can still describe one originating request. The installed host has no verified originating-request independence receipt.",
    }
  }

  private scope(input: TrendInput): Scope {
    const since_at = timestamp(input.since_at, "since_at")
    const until_at = timestamp(input.until_at, "until_at")
    const as_of_at = timestamp(input.as_of_at, "as_of_at")
    if (since_at >= until_at || until_at > as_of_at) throw new Error("Trends require since_at < until_at <= as_of_at")
    if (Date.parse(until_at) - Date.parse(since_at) > 366 * 86400000)
      throw new Error("Trends window exceeds 366 days; use a narrower explicit period")
    if (!["all-linked", "selected"].includes(input.population)) throw new Error("Invalid trends population")
    const ids = input.objective_ids ?? []
    if (!Array.isArray(ids) || ids.length > 50) throw new Error("Choose at most 50 exact objective IDs")
    const objective_ids = [...new Set(ids.map(x => bounded(x, "objective ID")))].sort()
    if (input.population === "selected" && !objective_ids.length) throw new Error("Selected population requires objective_ids")
    if (input.population === "all-linked" && objective_ids.length) throw new Error("all-linked population cannot use objective_ids")
    const source_type = input.source_type === undefined ? null : input.source_type
    if (source_type !== null && !["native-message", "native-call", "ledger-record", "external-ref"].includes(source_type))
      throw new Error("Invalid trends source_type")
    const unit_key = input.unit_key === undefined ? null : bounded(input.unit_key, "unit_key")
    const group_by = input.group_by ?? "start-month"
    if (!["start-month", "unit-key", "source-type", "origin-verification", "outcome-author-agent",
      "instruction-fingerprint", "work-type", "model", "provider", "host-revision", "tool-revision",
      "rubric", "actual-instruction-exposure"].includes(group_by)) throw new Error("Invalid trends group_by")
    return { since_at, until_at, as_of_at, population: input.population, objective_ids,
      source_type, unit_key, group_by }
  }

  private decode(raw: string, scope: Scope): Snapshot {
    if (typeof raw !== "string" || raw.length > 16000 || !/^[A-Za-z0-9_-]+$/.test(raw))
      throw new Error("Invalid trends cursor")
    let pos: Snapshot
    try { pos = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Snapshot }
    catch { throw new Error("Invalid trends cursor") }
    if (!pos || pos.v !== 1 || JSON.stringify(pos.scope) !== JSON.stringify(scope) ||
        ![pos.max_objective, pos.max_link, pos.last_row].every(Number.isSafeInteger) ||
        pos.max_objective < 0 || pos.max_link < 0 || pos.last_row < 0 ||
        pos.last_row > pos.max_objective ||
        Object.keys(pos).sort().join(",") !== "last_row,max_link,max_objective,scope,v")
      throw new Error("Trends cursor does not match the comparison population or snapshot")
    return pos
  }

  private originals(scope: Scope, pos: Snapshot): OriginRow[] {
    const constraints = [
      "o.rowid<=?", "o.created_at<=?", "a.sequence<=?", "a.recorded_at<=?",
      "a.source_at_ms>=?", "a.source_at_ms<?",
    ]
    const args: unknown[] = [pos.max_objective, scope.as_of_at, pos.max_link, scope.as_of_at,
      Date.parse(scope.since_at), Date.parse(scope.until_at)]
    if (scope.source_type) { constraints.push("a.source_type=?"); args.push(scope.source_type) }
    if (scope.unit_key) { constraints.push("o.unit_key=?"); args.push(scope.unit_key) }
    if (scope.population === "selected") {
      constraints.push("o.id IN (" + scope.objective_ids.map(() => "?").join(",") + ")")
      args.push(...scope.objective_ids)
    }
    const rows = this.db.prepare(
      "SELECT o.rowid AS objective_row, o.id, o.unit_key, o.created_at, o.author_agent," +
      " a.source_key, a.source_type, a.source_id, a.source_session_id, a.source_message_id," +
      " a.verification, a.source_at_ms AS start_ms, a.sequence" +
      " FROM learning_objectives o JOIN learning_objective_links a ON a.sequence=(" +
      " SELECT MIN(r.sequence) FROM learning_objective_links r" +
      " WHERE r.objective_id=o.id AND r.phase='request' AND r.sequence<=?)" +
      " WHERE " + constraints.join(" AND ") + " ORDER BY o.rowid LIMIT ?"
    ).all(pos.max_link, ...args, MAX_OBJECTIVES + 1) as OriginRow[]
    if (rows.length > MAX_OBJECTIVES)
      throw new Error("Trends population exceeds 500 objective anchors; narrow the period or select exact IDs")
    return rows
  }

  /** A missing original event clock cannot be silently treated as registration time. */
  private unknownStarts(scope: Scope, pos: Snapshot) {
    const filters = ["o.rowid<=?", "o.created_at<=?", "a.sequence<=?", "a.recorded_at<=?",
      "a.source_at_ms IS NULL"]
    const args: unknown[] = [pos.max_objective, scope.as_of_at, pos.max_link, scope.as_of_at]
    if (scope.source_type) { filters.push("a.source_type=?"); args.push(scope.source_type) }
    if (scope.unit_key) { filters.push("o.unit_key=?"); args.push(scope.unit_key) }
    if (scope.population === "selected") {
      filters.push("o.id IN (" + scope.objective_ids.map(() => "?").join(",") + ")")
      args.push(...scope.objective_ids)
    } else {
      // Undated older registrations cannot be placed in any source-start period.
      // Report only registrations in the requested period, and label the limit.
      filters.push("o.created_at>=?", "o.created_at<?")
      args.push(scope.since_at, scope.until_at)
    }
    const row = this.db.prepare(
      "SELECT COUNT(*) AS n FROM learning_objectives o" +
      " JOIN learning_objective_links a ON a.sequence=(" +
      " SELECT MIN(r.sequence) FROM learning_objective_links r" +
      " WHERE r.objective_id=o.id AND r.phase='request' AND r.sequence<=?)" +
      " WHERE " + filters.join(" AND ")
    ).get(pos.max_link, ...args) as { n: number }
    return row.n
  }

  private links(objectiveID: string, pos: Snapshot): LinkRow[] {
    const rows = this.db.prepare(
      "SELECT sequence,source_key,source_type,source_id,source_session_id,source_message_id," +
      " action_id,verification,source_at_ms,recorded_at,phase,confidence,assessment," +
      " related_sequence,gap_reason,author_agent,event_kind FROM learning_objective_links" +
      " WHERE objective_id=? AND sequence<=? AND recorded_at<=?" +
      " AND (source_at_ms IS NULL OR source_at_ms<=?) ORDER BY sequence LIMIT ?"
    ).all(objectiveID, pos.max_link, pos.scope.as_of_at, Date.parse(pos.scope.as_of_at), MAX_LINKS + 1) as LinkRow[]
    if (rows.length > MAX_LINKS)
      throw new Error("Objective " + objectiveID + " exceeds 500 observed links; refuse incomplete comparisons")
    return rows
  }

  private fingerprints(links: LinkRow[], outcome: LinkRow | undefined) {
    // Only a source-dated observation strictly before a source-dated outcome can
    // support a pre-outcome association. Recording time is not a substitute.
    const outcomeAt = outcome?.source_at_ms ?? null
    let excludedUnknownTime = 0, excludedAfterOutcome = 0
    const matched: Array<{ stage: string; skill_id: string | null; sha256: string; source_id: string }> = []
    const seen = new Set<string>()
    const statement = this.actionDB.prepare(
      "SELECT kind, json_extract(data,'$.data.phase') AS phase," +
      " json_extract(data,'$.data.skill_id') AS skill_id," +
      " json_extract(data,'$.data.rendered_sha256') AS rendered_sha256," +
      " json_extract(data,'$.data.content_sha256') AS content_sha256," +
      " json_extract(data,'$.data.registry_content_sha256') AS registry_content_sha256" +
      " FROM ledger WHERE id=? AND length(data)<=393216"
    )
    for (const l of links) {
      if (l.source_type !== "ledger-record" || l.event_kind !== "observation") continue
      if (outcomeAt === null || l.source_at_ms === null) { excludedUnknownTime++; continue }
      if (l.source_at_ms >= outcomeAt) { excludedAfterOutcome++; continue }
      const event = statement.get(l.source_id) as FingerprintRow | undefined
      if (!event || event.kind !== "observation") continue
      const sha = event.phase === "skill-load-result" ? event.rendered_sha256
        : event.phase === "companion-load-result" || event.phase === "agent-context-snapshot"
          ? event.content_sha256 : null
      if (!validHash(sha)) continue
      const stage = event.phase!
      const key = [stage, event.skill_id ?? "", sha].join(":")
      if (seen.has(key)) continue
      seen.add(key)
      matched.push({ stage, skill_id: event.skill_id, sha256: sha, source_id: l.source_id })
    }
    return {
      group_key: matched.length === 0 ? "not-observed" : matched.length === 1
        ? [matched[0]!.stage, matched[0]!.skill_id ?? "", matched[0]!.sha256].join(":")
        : "multiple-observations",
      observations: matched.slice(0, 8), total: matched.length,
      omitted: Math.max(0, matched.length - 8),
      excluded_unknown_chronology: excludedUnknownTime,
      excluded_at_or_after_outcome: excludedAfterOutcome,
      stage: "source-dated observation before source-dated outcome; not confirmed model exposure",
    }
  }

  private point(origin: OriginRow, links: LinkRow[]) {
    const changes = new Map<number, "confirm" | "reject">()
    for (const l of links) if (l.phase === "link-correction" &&
      (l.assessment === "confirm" || l.assessment === "reject") && l.related_sequence !== null)
      changes.set(l.related_sequence, l.assessment)
    const rejected = links.filter(l => changes.get(l.sequence) === "reject")
    const unresolved = links.filter(l => l.phase !== "link-correction" &&
      l.confidence === "uncertain" && !changes.has(l.sequence))
    const active = links.filter(l => l.phase !== "link-correction" &&
      changes.get(l.sequence) !== "reject" &&
      (l.confidence === "supported" || changes.get(l.sequence) === "confirm"))
    const by = (phase: string, assessment?: string) =>
      active.filter(l => l.phase === phase && (assessment === undefined || l.assessment === assessment))
    const failures = by("verification", "fail")
    const passes = by("verification", "pass")
    const outcomes = by("outcome")
    // An undated outcome has unknown ordering; it must not inherit the date
    // on which an agent chose to link it. Unordered failures contest a pass.
    const last = outcomes.every(l => l.source_at_ms !== null)
      ? [...outcomes].sort((a, b) => a.source_at_ms! - b.source_at_ms! || a.sequence - b.sequence).at(-1)
      : undefined
    const contrary = last?.assessment === "pass" &&
      failures.some(f => f.source_at_ms === null ||
        f.source_at_ms > last.source_at_ms! ||
        (f.source_at_ms === last.source_at_ms && f.sequence > last.sequence))
    const outcome = !last ? "unknown" : contrary ? "contested" :
      last.assessment === "pass" ? "reported-pass" :
      last.assessment === "fail" ? "reported-fail" : "inconclusive"
    const corrections = by("corrective-dispatch")
    const hasRecovery = outcome === "reported-pass" && corrections.length > 0 &&
      passes.some(p => p.source_at_ms !== null && failures.some(f =>
        f.source_at_ms !== null && f.source_at_ms < p.source_at_ms!))
    const gaps = by("coverage-gap")
    const linkedConcerns = active.filter(l => l.event_kind === "concern")
    const fp = this.fingerprints(active, last)
    const metrics = zeroMetrics()
    metrics.eligible_objectives = 1
    if (outcome === "reported-pass") metrics.reported_pass++
    if (outcome === "reported-fail") metrics.reported_fail++
    if (outcome !== "reported-pass" && outcome !== "reported-fail") metrics.unknown_or_incomplete++
    if (outcome === "inconclusive") metrics.inconclusive++
    if (outcome === "contested") metrics.contested++
    if (corrections.length) metrics.with_documented_correction++
    if (hasRecovery) metrics.reported_recovery++
    if (outcome === "reported-pass" && !corrections.length) metrics.reported_pass_without_correction++
    metrics.verification_passes = passes.length
    metrics.verification_failures = failures.length
    metrics.verification_inconclusive = by("verification", "inconclusive").length
    metrics.handback_done_claims = by("handback", "reported-done").length
    metrics.coverage_gaps = gaps.length
    metrics.unresolved_uncertain_links = unresolved.length
    metrics.rejected_links = rejected.length
    metrics.environmental_problem_links = by("environment-failure").length
    metrics.planned_increment_links = by("planned-increment").length
    metrics.concern_source_links = linkedConcerns.length
    return {
      objective_row: origin.objective_row, objective_id: origin.id,
      unit_key: origin.unit_key, start_at: new Date(origin.start_ms).toISOString(),
      indexed_at: origin.created_at,
      origin: { source_type: origin.source_type, source_id: origin.source_id,
        session_id: origin.source_session_id, message_id: origin.source_message_id,
        verification: origin.verification, sequence: origin.sequence,
        originating_request_independence: "unverified" as const },
      origin_key: origin.source_key,
      outcome, chronology: {
        undated_outcomes: outcomes.filter(l => l.source_at_ms === null).length,
        undated_verifications: [...failures, ...passes].filter(l => l.source_at_ms === null).length,
        recording_time_used_as_event_time: false,
      },
      outcome_judgment: last ? { ...reference(last), assessment: last.assessment,
        author_agent: last.author_agent, interpretation: "authored-not-host-certified" } : null,
      metrics, instruction_observations: fp,
      dimensions: {
        unit_key: origin.unit_key, source_type: origin.source_type,
        origin_verification: origin.verification,
        outcome_author_agent: last?.author_agent ?? null,
        instruction_fingerprint: fp.group_key,
      },
      evidence: {
        verification_fails: retained(failures), verification_passes: retained(passes),
        corrective_dispatches: retained(corrections), handbacks: retained(by("handback")),
        outcomes: retained(outcomes), coverage_gaps: retained(gaps),
        concerns: retained(linkedConcerns), rejected: retained(rejected),
        uncertain: retained(unresolved),
      },
      failing_source_keys: [...new Set(failures.map(l => l.source_key))],
      original_sources_readable_via: "loom_objective read",
    }
  }

  private key(point: GroupPoint, groupBy: string) {
    if (groupBy === "start-month") return point.start_at.slice(0, 7)
    if (groupBy === "unit-key") return point.dimensions.unit_key
    if (groupBy === "source-type") return point.dimensions.source_type
    if (groupBy === "origin-verification") return point.dimensions.origin_verification
    if (groupBy === "outcome-author-agent") return point.dimensions.outcome_author_agent ?? "unavailable"
    if (groupBy === "instruction-fingerprint") return point.dimensions.instruction_fingerprint
    return "unavailable" // Never synthesize a missing model, provider, host, rubric or exposure.
  }

  compare(input: TrendInput) {
    if (input.operation !== "compare") throw new Error("Unknown trends operation")
    const scope = this.scope(input), take = positive(input.limit, 20, 20)
    this.db.exec("BEGIN")
    try {
      const current = {
        max_objective: (this.db.prepare("SELECT COALESCE(MAX(rowid),0) AS n FROM learning_objectives").get() as { n: number }).n,
        max_link: (this.db.prepare("SELECT COALESCE(MAX(sequence),0) AS n FROM learning_objective_links").get() as { n: number }).n,
      }
      const pos: Snapshot = input.cursor === undefined
        ? { v: 1, scope, ...current, last_row: 0 }
        : this.decode(input.cursor, scope)
      if (pos.max_objective > current.max_objective || pos.max_link > current.max_link)
        throw new Error("Comparison snapshot is no longer present; do not silently resume")
      const origins = this.originals(scope, pos)
      const points: Array<ReturnType<typeof this.point>> = []
      let excludedRejected = 0, excludedUncertain = 0
      for (const origin of origins) {
        const links = this.links(origin.id, pos)
        const anchor = links.find(l => l.sequence === origin.sequence)
        if (!anchor) { excludedUncertain++; continue }
        const corrections = links.filter(l => l.phase === "link-correction" &&
          l.related_sequence === anchor.sequence).sort((a, b) => a.sequence - b.sequence)
        const last = corrections.at(-1)?.assessment
        if (last === "reject") { excludedRejected++; continue }
        if (anchor.confidence !== "supported" && last !== "confirm") { excludedUncertain++; continue }
        points.push(this.point(origin, links))
      }
      const metrics = zeroMetrics(), groups = new Map<string, Metrics>()
      const sourceImpacts = new Map<string, Set<string>>(), originImpacts = new Map<string, Set<string>>()
      const mix = { unit_keys: {} as Record<string, number>,
        origin_verifications: {} as Record<string, number>,
        instruction_observations: { one: 0, multiple: 0, none: 0 } }
      for (const point of points) {
        addMetrics(metrics, point.metrics)
        const group = this.key(point, scope.group_by)
        if (!groups.has(group)) groups.set(group, zeroMetrics())
        addMetrics(groups.get(group)!, point.metrics)
        mix.unit_keys[point.unit_key] = (mix.unit_keys[point.unit_key] ?? 0) + 1
        const verification = point.origin.verification
        mix.origin_verifications[verification] = (mix.origin_verifications[verification] ?? 0) + 1
        if (point.instruction_observations.total === 0) mix.instruction_observations.none++
        else if (point.instruction_observations.total === 1) mix.instruction_observations.one++
        else mix.instruction_observations.multiple++
        const origin = originImpacts.get(point.origin_key) ?? new Set<string>()
        origin.add(point.objective_id); originImpacts.set(point.origin_key, origin)
        for (const key of point.failing_source_keys) {
          const incidents = sourceImpacts.get(key) ?? new Set<string>()
          incidents.add(point.objective_id); sourceImpacts.set(key, incidents)
        }
      }
      if (groups.size > MAX_GROUPS)
        throw new Error("Trends grouping exceeds 50 distinct keys; narrow the comparison population")
      const shared = [...sourceImpacts.values()].filter(s => s.size > 1)
      const overlap = [...originImpacts.values()].filter(s => s.size > 1)
      const safePoints = points.map(({ objective_row: _row, origin_key: _key,
        failing_source_keys: _failures, ...rest }) => rest)
      const eligibleRows = points.map(p => p.objective_row)
      const page = points.filter(p => p.objective_row > pos.last_row).slice(0, take)
      const lastRow = page.at(-1)?.objective_row ?? pos.last_row
      const more = eligibleRows.some(row => row > lastRow)
      const next_cursor = more ? Buffer.from(JSON.stringify({ ...pos, last_row: lastRow })).toString("base64url") : null
      const selected = page.map(p => safePoints[points.indexOf(p)])
      const unknownStart = this.unknownStarts(scope, pos)
      return {
        scope: { ...scope, start_semantics: "first source-linked request occurred_at_ms, inclusive start and exclusive end",
          cutoff_semantics: "source occurrence and interpretation recorded by as_of_at, plus frozen insertion high-water; later verification after the start window is retained when known by cutoff" },
        snapshot: { max_objective_rowid: pos.max_objective, max_link_sequence: pos.max_link,
          reproducible_across_pages: true },
        population: {
          eligible_objectives: points.length,
          excluded: { rejected_origin_links: excludedRejected, uncertain_or_missing_origin_links: excludedUncertain,
            undated_origin_registration_candidates: unknownStart },
          coverage: { outcome_claims: metrics.reported_pass + metrics.reported_fail,
            denominator: points.length,
            fraction: points.length ? (metrics.reported_pass + metrics.reported_fail) / points.length : null,
            unknown_start_scope: scope.population === "selected"
              ? "undated among selected IDs"
              : "undated objectives registered within the period; earlier undated anchors cannot be assigned to a source-time window" },
          unit: "one explicitly anchored objective ID; no independent originating-request denominator is certified",
          origin_independence: this.originIndependenceQualification(),
        },
        metrics,
        groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, counts]) => ({ key, metrics: counts })),
        mix,
        correlation: {
          distinct_failing_sources: sourceImpacts.size,
          shared_failure_sources: shared.length,
          affected_objectives: new Set(shared.flatMap(s => [...s])).size,
          shared_origin_groups: overlap.length,
          affected_objectives_sharing_origin: new Set(overlap.flatMap(s => [...s])).size,
          note: "A repeated exact source is one shared evidence record, not proof of separate incidents. Even distinct ledger or native user-role source IDs may belong to one original request. Independence is UNQUALIFIED; do not infer recurring independent episodes.",
        },
        unavailable_dimensions: unavailables,
        metric_definitions: {
          reported_pass: "objectives with latest uncontradicted authored pass outcome, not independently certified success",
          reported_fail: "objectives with latest authored fail outcome",
          unknown_or_incomplete: "no final authored outcome, inconclusive, or later contrary evidence",
          verification_failures: "number of explicitly linked fail verification judgments (not failed objectives or automatic agent errors)",
          with_documented_correction: "objectives with one or more supported explicit corrective-dispatch links, irrespective of number of attempts",
          reported_recovery: "reported pass with corrective dispatch and an earlier fail verification followed by a later pass verification",
          reported_pass_without_correction: "reported pass with no linked corrective dispatch; missing history may conceal rework",
          concern_source_links: "linked original concern records; cannot infer whether a protective decision succeeded",
        },
        items: selected, next_cursor,
        limits: { max_objectives: MAX_OBJECTIVES, max_links_per_objective: MAX_LINKS,
          max_groups: MAX_GROUPS, page_limit: 20, aggregate_is_full_population_not_page: true,
          source_history: "explicitly linked only; original Sessions and independent checks need authorized inspection",
          analysis: "association, not causation; no universal agent score or automatic instruction promotion" },
      }
    } finally {
      this.db.exec("ROLLBACK") // release the read snapshot; no write occurs
    }
  }
}
