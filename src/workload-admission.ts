import { digest, uid } from "./model.js"
import type { SQL, Store } from "./store.js"
import type { Config } from "./config.js"
import { planWorkloadRoutes, type WorkloadAssignment, type WorkloadDecision } from "./workload-routing.js"
import type { RouteInventory } from "./model-routing.js"

/**
 * A durable *candidate* for an existing saved Loom Action/plan selection.
 * This intentionally does not attest native execution, origin, permission,
 * safe Session state, account/billing entitlement, or provider transport.
 */
export type WorkloadWorkSource = {
  ownerSessionID: string
  actionID: string
  nodeID: string
  actionRevision: number
  planRevision: number
}
export type WorkloadCandidateRecord = {
  id: string
  schema: "loom.workload-candidate/v1"
  status: "candidate-only"
  assignmentId: string
  objectiveId: string
  agentId: string
  source: WorkloadWorkSource
  sourceDigest: string
  decision: WorkloadDecision
}
const MAX_RECORD_BYTES = 8192
const SCHEMA_TABLE = "loom_workload_schema"
const RECORD_TABLE = "loom_workload_records"
function fail(code: string): never { throw new Error("LOOM_WORKLOAD_" + code) }
function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail("STALE")
  return Number(value)
}
 function safeRecord(row: unknown): WorkloadCandidateRecord {
  if (!row || typeof row !== "object") fail("INTEGRITY")
  const value = row as { bytes?: unknown; content_json?: unknown; record_id?: unknown; assignment_id?: unknown; owner_session?: unknown; work_key?: unknown }
  if (!Number.isSafeInteger(value.bytes) || Number(value.bytes) > MAX_RECORD_BYTES
    || Number(value.bytes) <= 0 || typeof value.content_json !== "string") fail("INTEGRITY")
  let parsed: unknown
  try { parsed = JSON.parse(value.content_json) } catch { fail("INTEGRITY") }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("INTEGRITY")
  const record = parsed as WorkloadCandidateRecord
  if (record.schema !== "loom.workload-candidate/v1" || record.status !== "candidate-only"
    || typeof record.id !== "string" || typeof record.assignmentId !== "string"
    || typeof record.source?.ownerSessionID !== "string"
    || typeof record.decision?.id !== "string" || record.decision.assignmentId !== record.assignmentId
    || record.decision.objectiveId !== record.objectiveId || record.decision.agentId !== record.agentId
    || value.assignment_id !== record.assignmentId || value.owner_session !== record.source.ownerSessionID
    || typeof record.sourceDigest !== "string"
    || value.work_key !== digest([record.source.ownerSessionID, record.source.actionID,
      record.source.nodeID, record.source.actionRevision, record.source.planRevision, record.agentId]))
    fail("INTEGRITY")
  const { id, ...payload } = record
  const { id: decisionID, ...decisionPayload } = record.decision
  if (id !== value.record_id || id !== digest(payload) || decisionID !== digest(decisionPayload))
    fail("INTEGRITY")
  return record
}
export class WorkloadDecisionJournal {
  constructor(private readonly db: SQL, private readonly store: Store) {
    db.exec("PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON")
    this.transaction(() => {
      const existing = db.prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name IN (?,?) ORDER BY name",
      ).all(SCHEMA_TABLE, RECORD_TABLE) as Array<{name: string}>
      if (!existing.length) {
        db.exec(`
          CREATE TABLE loom_workload_schema(
            singleton INTEGER PRIMARY KEY CHECK(singleton=1),
            version INTEGER NOT NULL CHECK(version=1)
          );
          CREATE TABLE loom_workload_records(
            assignment_id TEXT PRIMARY KEY,
            owner_session TEXT NOT NULL,
            work_key TEXT NOT NULL UNIQUE,
            record_id TEXT NOT NULL,
            content_json TEXT NOT NULL
          );
          INSERT INTO loom_workload_schema VALUES(1,1);
        `)
        return
      }
      if (existing.length !== 2) fail("SCHEMA")
      const ver = db.prepare("SELECT version FROM loom_workload_schema WHERE singleton=1")
        .get() as {version: number} | undefined
      const cols = db.prepare("PRAGMA table_info(loom_workload_records)")
        .all() as Array<{ name: string }>
      if (ver?.version !== 1 || cols.map(c => c.name).join(",") !==
        "assignment_id,owner_session,work_key,record_id,content_json") fail("SCHEMA")
    })
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = fn()
      this.db.exec("COMMIT")
      return result
    } catch (error) {
      try { this.db.exec("ROLLBACK") } catch { /* A lost COMMIT receipt may already be durable. */ }
      throw error
    }
  }
  /** Local Action selection is an identity fence, never execution authority. */
  private source(input: WorkloadWorkSource, agentId: string): {source: WorkloadWorkSource;sourceDigest: string;workKey: string} {
    const source: WorkloadWorkSource = {
      ownerSessionID: uid(input.ownerSessionID, "ownerSessionID"),
      actionID: uid(input.actionID, "actionID"),
      nodeID: uid(input.nodeID, "nodeID"),
      actionRevision: version(input.actionRevision),
      planRevision: version(input.planRevision),
    }
    const selected = this.store.selected(source.ownerSessionID)
    if (selected?.action_id !== source.actionID || selected?.node_id !== source.nodeID) fail("SCOPE")
    const action = this.store.action(source.actionID)
    const plan = this.store.plan(source.actionID)
    if (action.revision !== source.actionRevision || plan.revision !== source.planRevision
      || action.state !== "active") fail("STALE")
    const node = plan.nodes.find(n => n.id === source.nodeID)
    if (!node) fail("STALE")
    return {
      source,
      sourceDigest: digest({ action, node, planRevision: plan.revision }),
      workKey: digest([source.ownerSessionID, source.actionID, source.nodeID,
        source.actionRevision, source.planRevision, uid(agentId, "agentId")]),
    }
  }
  /** Records candidate evidence once. Does not authorize dispatch or accept an in-flight/phase switch. */
  record(
    ref: WorkloadWorkSource, config: Config, agentId: string,
    inventory: readonly RouteInventory[], assignment: WorkloadAssignment,
  ): WorkloadCandidateRecord {
    if (assignment.boundary !== "new-assignment") fail("BOUNDARY")
    const planned = planWorkloadRoutes(config, agentId, inventory, assignment)
    if (planned.status !== "ready") fail("UNAVAILABLE")
    return this.transaction(() => {
      const {source,sourceDigest,workKey} = this.source(ref, agentId)
      const existing = this.db.prepare(
        "SELECT assignment_id,owner_session,work_key,record_id,content_json,length(CAST(content_json AS BLOB)) AS bytes FROM loom_workload_records WHERE assignment_id=? OR work_key=? LIMIT 2",
      ).all(assignment.assignmentId, workKey) as unknown[]
      const payload = {
        schema: "loom.workload-candidate/v1" as const,
        status: "candidate-only" as const,
        assignmentId: assignment.assignmentId,
        objectiveId: assignment.objectiveId,
        agentId: uid(agentId, "agentId"),
        source,sourceDigest,decision:planned.decision,
      }
      const record: WorkloadCandidateRecord = { id: digest(payload), ...payload }
      const json = JSON.stringify(record)
      if (Buffer.byteLength(json,"utf8") > MAX_RECORD_BYTES) fail("LIMIT")
      if (existing.length) {
        const prior = safeRecord(existing[0])
        if (existing.length !== 1 || prior.id !== record.id) fail("CONFLICT")
        return prior
      }
      this.db.prepare(
        "INSERT INTO loom_workload_records(assignment_id,owner_session,work_key,record_id,content_json) VALUES(?,?,?,?,?)",
      ).run(assignment.assignmentId,source.ownerSessionID,workKey,record.id,json)
      return record
    })
  }
  /** Source-scoped, read-only historical candidate. Recheck live eligibility before any future send. */
  get(assignmentId: string, ownerSessionID: string): WorkloadCandidateRecord | null {
    const id = uid(assignmentId,"assignmentId"), owner = uid(ownerSessionID,"ownerSessionID")
    const row = this.db.prepare(
      "SELECT assignment_id,owner_session,work_key,record_id,content_json,length(CAST(content_json AS BLOB)) AS bytes FROM loom_workload_records WHERE assignment_id=? AND owner_session=?",
    ).get(id,owner)
    return row ? safeRecord(row) : null
  }
}
