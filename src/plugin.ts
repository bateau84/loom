import { Plugin } from "@opencode/plugin"
import { Database } from "bun:sqlite"
import { sqliteConnection } from "./sqlite-connection.js"
import { createHash, randomUUID } from "node:crypto"
import { decodeConfigYaml } from "./config-parser.js"
import { mkdir, open, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { configPaths, loadConfig } from "./config.js"
import { resolveModelPolicy } from "./model-routing.js"
import { registerModelRouting } from "./model-routing-adapter.js"
import { configLoadStatus } from "./config-admission.js"
import { injectInstructions, registry, roleDescriptions, type NativeAgent } from "./agents.js"
import { Observer } from "./context.js"
import { resolveContextSelection, workContext } from "./work-context.js"
import { digest, uid, PROCESSING_LIMITS, type Actor, type Focus } from "./model.js"
import { renderFullHistory } from "./history-renderer.js"
import { engineeringHistoryScope, type EngineeringHistoryQuery, type EngineeringHistoryView } from "./engineering-history.js"
import type { EngineeringHistoryOwners } from "./engineering-trajectories.js"
import { renderEngineeringHistoryHTML, renderEngineeringHistoryMarkdown } from "./engineering-history-dashboard.js"
import { fullThreadMarkdown } from "./response-format.js"
import { Store, RECORD_FIELDS, RECORD_KINDS, type SQL, type RecordQuery } from "./store.js"
import { Learning } from "./learning.js"
import { EVALUATION_READS, registerAutomaticLearning, type AutomaticLearningRuntime } from "./learning-runtime.js"
import { OBJECTIVE_RELATIONS, type ObjectiveSource, type ObjectivePhase, type ObjectiveRelation, type ObjectiveHistorySelection } from "./objectives.js"
import type { ReviewHistorySelection } from "./review-requests.js"
import { QUESTION_CHOICE_LIMITS, QUESTION_DISPATCH, questionRecipient } from "./collaboration.js"
import { questionRoute, sendQuestion, type NativeModel, type QuestionRoute } from "./question-routing.js"
import { resumeAnswer } from "./answer-resume.js"
import { TOOL_HELP, LOOM_NAMESPACE_HELP } from "./tool-help.js"
import { findTraceSource, readSessionExport, traceTimeline } from "./session-trace.js"
import { nativeEvidenceDigest, nativeEvidenceParts, nativeEvidenceSource, type NativeEvidenceField, type NativeEvidenceMatchField } from "./native-evidence.js"

function payload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object")
  return value as Record<string, unknown>
}
function unwrapped(value: unknown): unknown {
  if (value && typeof value === "object" && "data" in value) return (value as { data: unknown }).data
  return value
}
/** Bound diagnostic JSON before reserving it, leaving room for useful context and
 * selection/readback outcomes. All failing sources remain visible as prefixes. */
function contextConfigDiagnostics(errors: string[], maxChars: number): { config_errors?: string[]; config_errors_excerpted?: true } {
  if (!errors.length) return {}
  const allowance = Math.floor(maxChars / 8)
  if (JSON.stringify({ config_errors: errors }).length <= allowance) return { config_errors: errors }
  const diagnostics = { config_errors: errors.map(() => ""), config_errors_excerpted: true as const }
  let low = 0, high = allowance
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    diagnostics.config_errors = errors.map(error => error.slice(0, middle))
    if (JSON.stringify(diagnostics).length <= allowance) low = middle
    else high = middle - 1
  }
  diagnostics.config_errors = errors.map(error => error.slice(0, low))
  return diagnostics
}
function nativeModel(value: unknown): NativeModel | undefined {
  if (value === undefined || value === null) return undefined
  const ref = payload(value)
  if (typeof ref.providerID !== "string" || !ref.providerID ||
      typeof ref.id !== "string" || !ref.id ||
      (ref.variant !== undefined && (typeof ref.variant !== "string" || !ref.variant)))
    throw new Error("OpenCode returned an invalid native model reference")
  return { providerID: ref.providerID, id: ref.id,
    ...(typeof ref.variant === "string" ? { variant: ref.variant } : {}) }
}
function agents(value: unknown): NativeAgent[] {
  const items = unwrapped(value)
  if (!Array.isArray(items)) throw new Error("OpenCode returned an unsupported agent registry shape")
  return items.map(v => { const a = payload(v); if (typeof a.id !== "string") throw new Error("OpenCode agent ID is missing"); return { id: a.id, ...(typeof a.description === "string" ? { description: a.description } : {}) } })
}
const str = { type: "string" } as const
const list = { type: "array", items: str, maxItems: 100 } as const
const num = { type: "integer", minimum: 0 } as const
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false })
const choice = (...values: string[]) => ({ type: "string", enum: values })
const workRefInput = obj({ action_id: str, node_id: str, action_revision: { type: "integer", minimum: 1 }, plan_revision: { type: "integer", minimum: 1 }, hash: str },
  ["action_id", "node_id", "action_revision", "plan_revision", "hash"])
const nullableString = { type: ["string", "null"] }
const artifactRefInput = obj({ locator: str, version: { oneOf: [
  obj({ kind: { const: "git" }, repository: str, object_id: str, path: nullableString }, ["kind", "repository", "object_id", "path"]),
  obj({ kind: { const: "sha256" }, value: str }, ["kind", "value"]),
] }, content_ref: nullableString }, ["locator", "version", "content_ref"])
const reviewRequestInput = obj({
  format: { const: "loom-review-request/v1" }, request_id: str,
  mandate: obj({ question: str, dimensions: list,
    criteria: { type: "array", maxItems: 100, items: obj({ text: str, source_ref: nullableString }, ["text", "source_ref"]) },
    mode: str, inclusions: list, exclusions: list, currentness: { const: "current-at-issue-claim" },
  }, ["question", "dimensions", "criteria", "mode", "inclusions", "exclusions"]),
  intended_recipient: obj({ agent: str, session_id: nullableString }, ["agent", "session_id"]),
  work_revision_policy: choice("frozen-historical", "current-at-issue-claim"),
  members: { type: "array", maxItems: 100, items: obj({ member_id: str,
    work_ref: { anyOf: [workRefInput, { type: "null" }] }, producing_attempt_refs: list,
    artifact_refs: { type: "array", maxItems: 50, items: artifactRefInput },
    prior_review_request_id: nullableString, membership_source_refs: list,
    gaps: { type: "array", maxItems: 100, items: obj({ reason: choice("not-observed", "unsupported-host-boundary",
      "missing-native-field", "opaque-inner-call", "capture-disabled", "capture-failed", "observer-discontinuity",
      "history-unavailable", "compacted", "redacted", "not-authorized", "source-missing", "source-changed",
      "unsupported-version", "processing-limit"), source_ref: nullableString }, ["reason", "source_ref"]) },
  }, ["member_id", "work_ref", "producing_attempt_refs", "artifact_refs", "prior_review_request_id", "membership_source_refs", "gaps"]) },
  rechecks: { type: "array", maxItems: 100, items: obj({ request_id: str, finding_ids: list }, ["request_id", "finding_ids"]) },
  extensions: { type: "object", additionalProperties: true },
}, ["format", "request_id", "mandate", "intended_recipient", "members", "rechecks"])
const contextAttachments = { type: "array", items: { type: "string", maxLength: 2000 }, maxItems: 50 }
const recipientInput = obj({ kind: choice("agent", "role", "dispatcher", "user"), id: str }, ["kind"])
const choiceIDInput = { type: "string", minLength: 1, maxLength: QUESTION_CHOICE_LIMITS.id, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$" }
const choicesInput = { type: "array", minItems: 2, maxItems: QUESTION_CHOICE_LIMITS.count,
  items: obj({ id: choiceIDInput, answer: { type: "string", minLength: 1, maxLength: QUESTION_CHOICE_LIMITS.answer, pattern: "\\S" } }, ["id", "answer"]) }
const askInput = { question: str, to_agent: str, recipient: recipientInput, session_id: str, action_id: str, blocking: { type: "boolean" }, context: str, context_attachments: contextAttachments,
  answer_type: choice("text", "multi-choice"), choices: choicesInput,
  reference: obj({ action_id: str, kind: choice("action", "phase", "wave", "task", "subtask"), id: str }, ["action_id", "kind", "id"]), review: reviewRequestInput }
const answerInput = { question_id: str, answer: str, choice_id: choiceIDInput,
  status: choice("cannot-select"), reason: { type: "string", minLength: 1, maxLength: QUESTION_CHOICE_LIMITS.reason, pattern: "\\S" }, context_attachments: contextAttachments }
const bindInput = { question_id: str, respondent_session_id: str }
// The host removes unknown fields from closed objects before execution. Preserve
// them here so Loom's strict operation/method validators reject forged authority.
const preserveInput = (properties: Record<string, unknown>, required: string[] = []) => ({ ...obj(properties, required), additionalProperties: true })
const evaluatorContentRefInput = preserveInput({ locator: { type: "string", maxLength: 2000 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["locator", "sha256"])
const evaluatorPolicyInput = preserveInput({ id: str, revision: str, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["id", "revision", "sha256"])
const evaluatorMethodInput = preserveInput({
  format: { const: "loom-evaluator-method/v1" },
  evaluator: preserveInput({ agent: { const: "evaluator" }, definition: evaluatorContentRefInput }, ["agent", "definition"]),
  audit_skill: preserveInput({ skill: { const: "agent-run-audit" }, definition: evaluatorContentRefInput }, ["skill", "definition"]),
  rubric: evaluatorContentRefInput, instruction_bundle: evaluatorContentRefInput,
  result_format: { const: "loom-evaluator-interpretation/v1" },
  model: preserveInput({ provider_id: str, model_id: str, settings: evaluatorContentRefInput }, ["provider_id", "model_id", "settings"]),
  adapter: preserveInput({ id: str, version: str, profile: evaluatorPolicyInput }, ["id", "version", "profile"]),
  source_policy: evaluatorPolicyInput, route_policy: evaluatorPolicyInput,
}, ["format", "evaluator", "audit_skill", "rubric", "instruction_bundle", "result_format", "model", "adapter", "source_policy", "route_policy"])
const evaluatorPrepareInput = { operation: { const: "prepare-evaluation" }, batch_id: str, method: evaluatorMethodInput,
  budget_policy: { anyOf: [evaluatorPolicyInput, { type: "null" }] } }
const specs = [
  { name: "agents", description: TOOL_HELP.agents, input: obj({}) },
  { name: "history", description: TOOL_HELP.history, input: preserveInput({
    operation: { const: "read" }, action_id: str, session_id: str, objective_id: str, related: { type: "boolean" },
    branch_ref: { type: "string", minLength: 1, maxLength: 4096 }, record_id: str,
    match: { type: "string", minLength: 1, maxLength: 200 },
    record_kinds: { type: "array", minItems: 1, maxItems: RECORD_KINDS.length, uniqueItems: true, items: choice(...RECORD_KINDS) },
    verdict: choice("pass", "fail", "inconclusive"), source_session_id: str, node_id: str,
    plan_revision: { type: "integer", minimum: 1 }, has_gaps: { type: "boolean" },
    after: num, through: num, branch_offset: { type: "integer", minimum: 0, maximum: 100000 }, limit: { type: "integer", minimum: 1, maximum: 50 },
    owner_boundary: preserveInput({ objective_links: { anyOf: [num, { type: "null" }] }, review_requests: num, review_relationships: num },
      ["objective_links", "review_requests", "review_relationships"]), owner_version: { type: "string", pattern: "^[a-f0-9]{64}$" },
    connection_cursor: { type: "string", minLength: 1, maxLength: 2048 },
    response_format: choice("json", "markdown", "html"),
  }, ["operation"]) },
  { name: "review", description: TOOL_HELP.review, input: {
    ...preserveInput({ operation: choice("freeze", "read", "issue", "prepare", "prepare-evaluation", "relate", "work"), request: reviewRequestInput, request_id: str, authorization_ref: str,
      batch_id: str, method: evaluatorMethodInput, budget_policy: evaluatorPrepareInput.budget_policy,
      after: num, relationship_after: num, issue_after: num, limit: { type: "integer", minimum: 1, maximum: 50 }, member_id: str,
      relationship: choice("observed", "retrieved", "cited", "claimed-inspected", "finding", "correction"),
      source_record_id: str, member_ids: list, supersedes: str }, ["operation"]),
    oneOf: [
      preserveInput(evaluatorPrepareInput, ["operation", "batch_id", "method", "budget_policy"]),
      obj({ operation: { const: "freeze" }, request: reviewRequestInput }, ["operation", "request"]),
      obj({ operation: { const: "read" }, request_id: str, after: num, relationship_after: num, issue_after: num, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["operation", "request_id"]),
      obj({ operation: { const: "prepare" }, request_id: str }, ["operation", "request_id"]),
      obj({ operation: { const: "issue" }, request_id: str, authorization_ref: str, after: num, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["operation", "request_id"]),
      obj({ operation: { const: "relate" }, request_id: str,
        relationship: choice("observed", "retrieved", "cited", "claimed-inspected", "finding", "correction"),
        source_record_id: str, member_ids: list, supersedes: str }, ["operation", "request_id", "relationship", "source_record_id", "member_ids"]),
      obj({ operation: { const: "work" }, request_id: str, member_id: str }, ["operation", "request_id", "member_id"]),
    ],
  } },
  { name: "trace", description: TOOL_HELP.trace, input: obj({ operation: choice("timeline", "children", "parts", "source"),
      session_id: str, export_path: { type: "string", minLength: 1, maxLength: 4096 },
      include_text: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 50 },
      access: choice("historical"), message_id: str, part_id: str, tool: { type: "string", minLength: 1, maxLength: 120 },
      fields: { type: "array", minItems: 1, maxItems: 5, uniqueItems: true, items: choice("input", "output", "dispatch", "status", "error") },
      match: { type: "string", minLength: 1, maxLength: 256 },
      match_fields: { type: "array", minItems: 1, maxItems: 5, uniqueItems: true, items: choice("tool", "status", "dispatch", "input", "output") },
      source_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" }, part_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      cursor: { type: "string", minLength: 1, maxLength: 4096 } }, ["operation"]) },
  { name: "insights", description: TOOL_HELP.insights, input: preserveInput({ operation: choice("action", "window", "findings", ...EVALUATION_READS), batch_id: str, member_key: str, report_id: str,
    request_id: str, manifest_sha256: str, attempt_id: str, source_index: num, after: num, finding_cursor: { type: "string", maxLength: 512 }, action_id: str, before: { type: "integer", minimum: 1 }, limit: { type: "integer", minimum: 1, maximum: 200 }, since_at: str, until_at: str }, ["operation"]) },
  { name: "objective", description: TOOL_HELP.objective, input: obj({
      operation: choice("create", "link", "read", "list", "find"),
      objective_id: str, label: { type: "string", maxLength: 200 }, unit_key: str,
      phase: choice("request", "coordination", "dispatch", "handback", "verification", "corrective-dispatch",
        "continuation", "planned-increment", "requirement-change", "environment-failure", "outcome", "coverage-gap", "link-correction"),
      source_type: choice("native-message", "native-call", "ledger-record", "external-ref", "unavailable"),
      source_id: str, source_session_id: str, source_message_id: str,
      export_path: { type: "string", minLength: 1, maxLength: 4096 },
      confidence: choice("supported", "uncertain"),
      assessment: choice("reported-done", "reported-failed", "pass", "fail", "inconclusive", "confirm", "reject"),
      related_sequence: { type: "integer", minimum: 1 },
      relation: choice(...OBJECTIVE_RELATIONS),
      gap_reason: choice("missing-child", "compacted", "denied-access", "opaque-tool", "missing-source", "unknown"),
      note: { type: "string", maxLength: 800 },
      cursor: { type: "string", minLength: 1, maxLength: 512 },
      limit: { type: "integer", minimum: 1, maximum: 50 }, offset: num,
    }, ["operation"]) },
  { name: "trends", description: TOOL_HELP.trends, input: obj({
      operation: choice("compare"),
      since_at: str, until_at: str, as_of_at: str,
      population: choice("all-linked", "selected"),
      objective_ids: { type: "array", items: str, maxItems: 50 },
      source_type: choice("native-message", "native-call", "ledger-record", "external-ref"),
      unit_key: str,
      group_by: choice("start-month", "unit-key", "source-type", "origin-verification",
        "outcome-author-agent", "instruction-fingerprint", "work-type", "model", "provider",
        "host-revision", "tool-revision", "rubric", "actual-instruction-exposure"),
      cursor: { type: "string", minLength: 1, maxLength: 16000 },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    }, ["operation", "since_at", "until_at", "as_of_at", "population"]) },
  { name: "tweak", description: TOOL_HELP.tweak, input: obj({ operation: choice("propose", "list", "read", "retire", "trial"), id: str, target_kind: choice("skill", "assessment", "qa", "agent"), target_id: str, base_sha256: str, candidate_content: str, hypothesis: str, evidence_refs: { type: "array", items: str, maxItems: 20 }, revised_from: str, trial_before: { type: "integer", minimum: 1 }, observed_sha256: str, observed_effect: choice("promising", "harmful", "neutral", "inconclusive", "not-exercised"), statement: str, offset: { type: "integer", minimum: 0 } }, ["operation"]) },
  { name: "action", description: TOOL_HELP.action, input: obj({ operation: choice("list", "create", "update", "sessions"), action_id: str, title: str, goal: str, state: choice("active", "paused", "completed", "cancelled"), expected_revision: num, offset: num, archived: { type: "boolean" }, cursor: { type: "string", minLength: 1, maxLength: 4096 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["operation"]) },
  { name: "plan", description: TOOL_HELP.plan, input: obj({ operation: choice("read", "save"), action_id: str, revision: num, expected_revision: num, nodes: { type: "array", maxItems: 300, items: obj({ id: str, kind: choice("phase", "wave", "task", "subtask"), title: str, parent: str, depends_on: list, outcome: str, context: str, criteria: list, roles: list, skills: list, agent: str }, ["id", "kind", "title"]) } }, ["operation", "action_id"]) },
  { name: "context", description: TOOL_HELP.context, input: obj({ action_id: str, node_id: str, clear: { type: "boolean" }, mode: choice("continuation", "independent"), handoff_id: { type: ["string", "null"] } }) },
  { name: "record", description: TOOL_HELP.record, input: { ...obj({ operation: choice("add", "query", "complete", "reopen", "ask", "answer", "bind-respondent"), view: choice("ledger", "progress", "questions", "inbox", "thread", "full_thread"), response_format: { ...choice("markdown", "json"), description: "Query only. JSON for every query; Markdown only for full_thread (its default)." }, cursor: str, work_ref: workRefInput, ...askInput, ...answerInput, ...bindInput, respondent: str, question_state: choice("open", "answered", "all"), offset: num, action_id: str, node_id: str, kind: choice("claim", "result", "concern", "assessment", "qa"), statement: str, evidence_ids: list, artifact_refs: list, verdict: choice("pass", "fail", "inconclusive"), record_id: str, session_only: { type: "boolean" }, after: num,
      projection: choice("metadata", "fields"), source_session_id: str, through: num,
      fields: { type: "array", minItems: 1, maxItems: RECORD_FIELDS.length, uniqueItems: true, items: choice(...RECORD_FIELDS) },
      record_kinds: { type: "array", minItems: 1, maxItems: RECORD_KINDS.length, uniqueItems: true, items: choice(...RECORD_KINDS) },
      limit: { type: "integer", minimum: 1, maximum: 50 } }, ["operation"]),
    allOf: [
      { if: { properties: { operation: { const: "ask" } } }, then: {
          ...obj({ operation: { const: "ask" }, ...askInput }, ["operation", "question", "blocking"]),
          oneOf: [
            { required: ["to_agent"], not: { anyOf: [{ required: ["recipient"] }, { required: ["session_id"] }] } },
            { required: ["recipient"], not: { anyOf: [{ required: ["to_agent"] }, { required: ["session_id"] }] } },
            { required: ["session_id"], not: { anyOf: [{ required: ["to_agent"] }, { required: ["recipient"] }] } },
          ],
          allOf: [
            { not: { required: ["action_id", "reference"] } },
            { if: { properties: { answer_type: { const: "multi-choice" } }, required: ["answer_type"] },
              then: { required: ["choices"], anyOf: [{ required: ["recipient"] }, { required: ["session_id"] }] },
              else: { not: { required: ["choices"] } } },
          ],
        } },
      { if: { properties: { operation: { const: "answer" } } }, then: {
          ...obj({ operation: { const: "answer" }, ...answerInput }, ["operation", "question_id"]),
          oneOf: [
            { required: ["answer"], not: { anyOf: [{ required: ["choice_id"] }, { required: ["status"] }, { required: ["reason"] }] } },
            { required: ["choice_id"], not: { anyOf: [{ required: ["answer"] }, { required: ["status"] }] } },
            { required: ["status", "reason"], not: { anyOf: [{ required: ["answer"] }, { required: ["choice_id"] }] } },
          ],
        } },
        { if: { properties: { operation: { const: "bind-respondent" } } }, then:
          obj({ operation: { const: "bind-respondent" }, ...bindInput },
            ["operation", "question_id", "respondent_session_id"]) },
      { if: { properties: { view: { const: "full_thread" } }, required: ["view"] }, then: {
        ...obj({ operation: { const: "query" }, view: { const: "full_thread" }, action_id: str, node_id: str, session_id: str, cursor: str, response_format: choice("markdown", "json"),
          limit: { type: "integer", minimum: 1, maximum: 50 } }, ["operation", "view"]),
        oneOf: [{ required: ["action_id"], not: { required: ["session_id"] } }, { required: ["session_id"], not: { anyOf: [{ required: ["action_id"] }, { required: ["node_id"] }] } }],
      } },
      { if: { properties: { response_format: choice("markdown", "json") }, required: ["response_format"] },
        then: { properties: { operation: { const: "query" } } } },
      { if: { properties: { response_format: { const: "markdown" } }, required: ["response_format"] },
        then: { properties: { view: { const: "full_thread" } }, required: ["view"] } },
    ] } },
] as const

export default Plugin.define({
  id: "loom",
  async setup(ctx) {
    // A real OpenCode host may keep running after plugin setup fails.
    // Register an early pre-transport deny hook BEFORE quota/ledger I/O on
    // any versioned native host. No host/SDK profile is currently qualified
    // for managed routing; unknown future versions must not fail open.
    // Versionless partial test hosts retain their historical setup behavior.
    const guardedHost = typeof ctx.app?.version === "string" && ctx.app.version.length > 0
    let startupDispatch: "deny" | "delegated" | "disabled" = "deny"
    let startupDenial = "LOOM_MODEL_ROUTING_STARTUP_BLOCKED: routing has not completed initialization"
    const startupGuard = guardedHost ? await ctx.session.hook("model.request", () => {
      if (startupDispatch === "deny") throw new Error(startupDenial)
    }) : undefined
    let startupGuardDisposed = false
    const disposeStartupGuard = async () => {
      if (startupGuardDisposed) return
      startupGuardDisposed = true
      await startupGuard?.dispose()
    }
    try {
    const directory = await realpath(ctx.location.directory)
    const configuredPaths = configPaths(directory)
    const lifetime = new AbortController()
    const getConfig = (signal?: AbortSignal) => loadConfig(configuredPaths, decodeConfigYaml, undefined,
      signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal)
    const xdg = process.env.XDG_STATE_HOME
    const stateHome = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "state")
    const projectScope = digest({ project: ctx.location.project.id, canonical: ctx.location.project.canonical })
    const state = join(stateHome, "loom", "actions-v1", projectScope)
    let filename = join(state, "ledger.sqlite")
    let stage = "state-directory"
    let db: Database | undefined, learningDB: Database | undefined
    let actionSQL: SQL
    let store: Store, observer: Observer, learning: Learning | undefined
    try {
      await mkdir(state, { recursive: true, mode: 0o700 })
      stage = "database-file"
      const handle = await open(filename, "a", 0o600); await handle.close()
      stage = "database-path"
      filename = await realpath(filename)
      stage = "database-open"
      db = new Database(filename)
      actionSQL = sqliteConnection(db)
      stage = "store-initialization"
      store = new Store(actionSQL, projectScope)
      stage = "observer-initialization"
      observer = new Observer(store)
    } catch (error) {
      // Cleanup must not replace the initialization cause. No recovery or retry here.
      try { db?.close(true) } catch { /* Preserve the primary failure. */ }
      throw new Error(`Loom startup failed (stage=${stage}, database=${JSON.stringify(filename)}): ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    // Learning history is optional; corruption must never remove the healthy
    // Action tools, observation capture or the independently guarded routing path.
    let learningStage = "learning-database-file", learningFailure: string | undefined
    let learningFilename = join(state, "learning.sqlite")
    let learningRuntime: AutomaticLearningRuntime | undefined
    try {
      const learningPath = join(state, "learning.sqlite")
      const learningHandle = await open(learningPath, "a", 0o600)
      await learningHandle.close()
      learningStage = "learning-database-open"
      learningFilename = await realpath(learningPath)
      learningDB = new Database(learningFilename)
      learningStage = "learning-initialization"
      learning = new Learning(sqliteConnection(learningDB), store, actionSQL)
    } catch (error) {
      learningFailure = learningStage
      try { console.warn(`Loom optional learning unavailable (${learningStage}): ${error instanceof Error ? error.message : String(error)}`) }
      catch { /* Diagnostic sink failure cannot disable core startup or its native deny guard. */ }
      try { learningDB?.close(true) } catch { /* Keep the original learning failure. */ }
      learningDB = undefined
      learning = undefined
    }
    const learningStatus = () => learning
      ? { available: true, storage: "separate-project-sqlite", automatic_mutation: false, findings: "historical-read-only", automatic_findings: false, automatic_model_calls: false, automatic_descriptions: learningRuntime?.status() ?? { registered: false } }
      : { available: false, stage: learningFailure ?? "unavailable", automatic_mutation: false,
          note: "Existing Action/record/trace tools and native execution remain available; learning evidence is preserved for operator repair" }
    const requiredLearning = () => {
      if (!learning) throw new Error(`LOOM_LEARNING_UNAVAILABLE: learning subsystem failed at ${learningFailure ?? "unknown"}; existing Action history is still available`)
      return learning
    }
    const database = db, learningDatabase = learningDB
    const lastAgentContent = new Map<string, string>()
    // Scoped to one live plugin instance; never recover a dispatch token from untrusted history.
    const awaitingNativePrompt = new Map<string, { question: string; parent: string; agent: string; bound?: string }>()
    const disposers: Array<{ dispose(): Promise<void> }> = []
    let lastWarning = ""
    const warn = (error: unknown) => {
      try {
        const message = `Loom: ${error instanceof Error ? error.message : String(error)}`
        if (message !== lastWarning) { lastWarning = message; console.warn(message) }
      } catch { /* A failed diagnostic sink never controls native safety or source recording. */ }
    }
    // A plugin instance's location is not necessarily the location of all server events.
    const sessionIsLocal = async (session: Record<string, unknown>) => {
      const location = payload(session.location)
      if (session.projectID !== ctx.location.project.id || typeof location.directory !== "string" || location.workspaceID !== ctx.location.workspaceID) return false
      try { return await realpath(location.directory) === directory } catch { return false }
    }
    const owns = async (sessionID: Parameters<typeof ctx.session.get>[0]["sessionID"]) =>
      sessionIsLocal(payload(unwrapped(await ctx.session.get({ sessionID: sessionID }))))
    const checkedSession = async (sessionID: string) => {
      const session = payload(unwrapped(await ctx.session.get({ sessionID: sessionID })))
      if (session.id !== sessionID || !await sessionIsLocal(session))
        throw new Error("Session is not in this Loom project/workspace/location")
      return session
    }
    // Same-project Sessions are not automatically one user's work. Child discovery
    // is restricted to the caller's bounded native parent/child tree.
    const familyRoot = async (sessionID: string): Promise<string> => {
      const visited = new Set<string>()
      let current = sessionID
      for (let depth = 0; depth < 32; depth++) {
        if (visited.has(current)) throw new Error("Session ancestry cycle")
        visited.add(current)
        const session = await checkedSession(current)
        if (typeof session.parentID !== "string") return current
        current = session.parentID
      }
      throw new Error("Session ancestry exceeds 32 ancestors")
    }
    const focusFor = (input: Record<string, unknown>, session: string): Focus | undefined => {
      if (input.action_id !== undefined) return { action_id: String(input.action_id), ...(input.node_id !== undefined ? { node_id: String(input.node_id) } : {}) }
      if (input.node_id !== undefined) throw new Error("node_id requires action_id")
      const saved = store.selected(session)
      return saved ? { action_id: saved.action_id, ...(saved.node_id === undefined ? {} : { node_id: saved.node_id }) } : undefined
    }
    let routingStatus: "disabled" | "not-connected" | "initial-only" | "blocked-config" = "not-connected"
    try {
      const routing = await registerModelRouting(ctx, () => getConfig(), disposers, lifetime.signal)
      routingStatus = routing.status
      // Native subagent owns depth and permission checks. Its prompt hook supplies
      // the exact child identity BEFORE OpenCode can admit that child's input.
      disposers.push(await ctx.session.hook("prompt", async event => {
        const token = /(?:^|\n)Loom OQ dispatch token: ([0-9a-f-]{36})(?:\n|$)/.exec(event.prompt.text)?.[1]
        const pending = token ? awaitingNativePrompt.get(token) : undefined
        if (!pending) return
        if (pending.bound) throw new Error("OQ recipient has already been bound")
        const child = payload(unwrapped(await ctx.session.get({ sessionID: event.sessionID })))
        if (child.id !== event.sessionID || child.parentID !== pending.parent ||
            child.agent !== pending.agent || !await sessionIsLocal(child))
          throw new Error("Native OQ prompt recipient is not the intended local child")
        store.collaboration.bindRespondent(pending.question, event.sessionID, pending.agent)
        pending.bound = event.sessionID
      }))
      disposers.push(await ctx.tool.transform(editor => {
        editor.namespace({ name: "loom", description: LOOM_NAMESPACE_HELP })
        for (const spec of specs) editor.add({
          name: spec.name, description: spec.description, input: spec.input as Parameters<typeof editor.add>[0]["input"],
          options: { namespace: "loom", codemode: true },
          execute: async (raw, toolContext) => {
            if (!await owns(toolContext.sessionID)) throw new Error("This Loom instance does not own the Session location")
            const input = payload(raw), actor: Actor = { session_id: toolContext.sessionID, agent: toolContext.agent }
            const snapshot = await getConfig(toolContext.signal)
            lifetime.signal.throwIfAborted()
            toolContext.signal.throwIfAborted()
            const diagnostics = spec.name === "context" ? contextConfigDiagnostics(snapshot.errors, snapshot.config.context.max_chars)
              : snapshot.errors.length ? { config_errors: snapshot.errors } : {}
            // New evidence views use independently grantable native read resources.
            // One final assertion covers the entire union, including export files.
            // This observes native policy; it is not a qualified atomic transfer fence.
            const evidenceResources = new Set<string>()
            const evidenceSessions = new Set<string>([actor.session_id])
            // uid permits ':' in native identities. Encode components so an ID
            // cannot impersonate resource separators or another exact tuple.
            const evidenceID = (value: unknown, label: string) => encodeURIComponent(uid(value, label))
            let evidenceSourceCheck: (() => Promise<void>) | undefined
            const assertEvidence = async (resources: string[], viewSha256?: string) => {
              await ctx.permission.assert({ action: "read", resources,
                sessionID: toolContext.sessionID, agent: toolContext.agent,
                source: { type: "tool", messageID: toolContext.messageID, id: toolContext.id },
                metadata: { purpose: "historical-engineering-evidence", recipient_session_id: actor.session_id,
                  ...(viewSha256 ? { view_sha256: viewSha256 } : {}) } })
              lifetime.signal.throwIfAborted(); toolContext.signal.throwIfAborted()
            }
            const beginEvidence = async (scope: string, views: string[], inspect: string[] = []) => {
              const discovery = `loom:evidence:discover:${scope}`
              // Do not look up the target, return a cursor, or count its records first.
              await assertEvidence([discovery])
              evidenceResources.add(discovery)
              for (const view of views) evidenceResources.add(`loom:evidence:disclose:${scope}:view:${view}:recipient:${evidenceID(actor.session_id, "recipient Session")}`)
              for (const view of inspect) evidenceResources.add(`loom:evidence:inspect:${scope}:view:${view}`)
              await assertEvidence([...evidenceResources])
            }
            const evidenceSession = async (id: string) => {
              try { return await checkedSession(id) }
              catch { throw new Error("Evidence source unavailable in the authorized scope") }
            }
            const authorizeReview = async () => {
              // The native source-file read owner is the existing authority for
              // this private projection. Project membership or an intended
              // recipient name alone cannot grant access to request metadata.
              await ctx.permission.assert({ action: "read", resources: [filename],
                sessionID: toolContext.sessionID, agent: toolContext.agent,
                source: { type: "tool", messageID: toolContext.messageID, id: toolContext.id } })
              lifetime.signal.throwIfAborted()
              toolContext.signal.throwIfAborted()
              await checkedSession(actor.session_id)
            }
            const authorizePreparedReview = async (raw: unknown) => {
              const submitted = payload(raw)
              let existing: ReturnType<Store["reviews"]["getRequest"]> | undefined
              if (typeof submitted.request_id === "string") {
                try { existing = store.reviews.getRequest(actor, submitted.request_id) }
                catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "not-authorized") throw error }
              }
              if (existing?.extensions?.classification !== "evaluator-preparation"
                && (submitted.extensions === undefined || payload(submitted.extensions).classification !== "evaluator-preparation")) return
              await ctx.permission.assert({ action: "read", resources: [learningFilename], sessionID: toolContext.sessionID, agent: toolContext.agent,
                source: { type: "tool", messageID: toolContext.messageID, id: toolContext.id } })
              lifetime.signal.throwIfAborted(); toolContext.signal.throwIfAborted()
              await checkedSession(actor.session_id)
              if (!existing) throw new Error("Evaluator preparation unavailable")
              requiredLearning().evaluator.assertReview(actor.session_id, existing)
            }
            let result: unknown
            switch (spec.name) {
              case "history": {
                const allowed = ["operation", "action_id", "session_id", "objective_id", "branch_ref", "record_id", "related", "match", "record_kinds", "verdict",
                  "source_session_id", "node_id", "plan_revision", "has_gaps", "after", "through", "branch_offset", "limit", "owner_boundary", "owner_version", "connection_cursor", "response_format"]
                if (input.operation !== "read" || Object.keys(input).some(key => !allowed.includes(key)))
                  throw new Error("Unsupported engineering history operation or field")
                if (input.response_format !== undefined && !["json", "markdown", "html"].includes(String(input.response_format)))
                  throw new Error("History response_format must be json, markdown or html")
                if ([input.action_id, input.session_id, input.objective_id].filter(value => value !== undefined).length !== 1)
                  throw new Error("Engineering history requires exactly one explicit action_id, session_id or objective_id")
                const { operation: _operation, response_format: _format, ...rawQuery } = input
                const query = rawQuery as EngineeringHistoryQuery
                engineeringHistoryScope(query)
                const scope = input.action_id !== undefined
                  ? "action:" + evidenceID(input.action_id, "action_id")
                  : input.session_id !== undefined ? "session:" + evidenceID(input.session_id, "session_id")
                    : "objective:" + evidenceID(input.objective_id, "objective_id")
                await beginEvidence(scope, ["engineering-history"], ["engineering-history"])
                // These are the existing private source-file owners, not grants
                // inferred from a history reference. Prepared reviews are excluded.
                evidenceResources.add(filename)
                if (learning) evidenceResources.add(learningFilename)
                await assertEvidence([...evidenceResources])
                if (query.objective_id !== undefined && !learning) requiredLearning()
                if (input.session_id !== undefined) {
                  const sourceSession = uid(input.session_id, "session_id")
                  await evidenceSession(sourceSession); evidenceSessions.add(sourceSession)
                }
                const historyScope = store.captureScope()
                const objectiveSelection = (requested: EngineeringHistoryQuery): ObjectiveHistorySelection => ({
                  ...(requested.action_id === undefined ? {} : { action_id: requested.action_id }),
                  ...(requested.session_id === undefined ? {} : { session_id: requested.session_id }),
                  ...(requested.objective_id === undefined ? {} : { objective_id: requested.objective_id }),
                  ...(requested.through === undefined ? {} : { ledger_through: requested.through }),
                  ...(requested.owner_boundary?.objective_links === undefined || requested.owner_boundary.objective_links === null ? {} : { link_through: requested.owner_boundary.objective_links }),
                })
                const reviewSelection = (requested: EngineeringHistoryQuery, recordIDs?: string[]): ReviewHistorySelection => ({
                  ...(requested.action_id === undefined ? {} : { action_id: requested.action_id }),
                  ...(requested.session_id === undefined ? {} : { session_id: requested.session_id }),
                  ...(requested.objective_id === undefined ? {} : { record_ids: recordIDs ?? [] }),
                  ...(requested.through === undefined ? {} : { through: requested.through }),
                  ...(requested.owner_boundary === undefined ? {} : { request_through: requested.owner_boundary.review_requests,
                    relationship_through: requested.owner_boundary.review_relationships }),
                })
                const historyContributors = (requested: EngineeringHistoryQuery) => {
                  try {
                    const objectives = learning?.objectives.historySources(objectiveSelection(requested))
                    const recordIDs = requested.objective_id !== undefined && objectives
                      ? store.engineeringHistory.objectiveEvidenceSources(objectives.ledger_record_ids, objectives.ledger_through) : objectives?.ledger_record_ids
                    const reviews = store.reviews.historySources(actor, reviewSelection(requested, recordIDs))
                    const contributors = new Set([...store.engineeringHistory.authorizationSessions(requested, recordIDs),
                      ...(objectives?.contributors ?? []), ...reviews.contributors])
                    if (contributors.size > 2000) throw new Error("History contributor bound exceeded")
                    return { contributors: [...contributors].sort(), objectives, reviews, recordIDs }
                  }
                  // Contributor discovery is an internal permission preflight. Its
                  // failures must not expose a protected cardinality threshold,
                  // Plan author or source-store detail before source grants exist.
                  catch { throw new Error("Engineering history scope unavailable") }
                }
                const sources = historyContributors(query)
                if (query.owner_boundary && (query.owner_boundary.objective_links === null) !== (sources.objectives === undefined))
                  throw new Error("History objective owner availability changed; restart the read")
                // Pin each append owner independently. The resulting live boundary
                // is explicitly not EvaluationStore membership or an execution grant.
                query.through ??= sources.objectives?.ledger_through ?? sources.reviews.through
                query.owner_boundary ??= { objective_links: sources.objectives?.link_through ?? null,
                  review_requests: sources.reviews.request_through, review_relationships: sources.reviews.relationship_through }
                const sourceSessions = sources.contributors
                // Action discovery permits locating contributors, not disclosing their
                // content or even derived counts. Each contributing Session must grant
                // the same derived view before the projector inspects its records.
                for (const sourceSession of sourceSessions) {
                  const sourceScope = "session:" + evidenceID(sourceSession, "source Session")
                  evidenceResources.add(`loom:evidence:discover:${sourceScope}`)
                  evidenceResources.add(`loom:evidence:inspect:${sourceScope}:view:engineering-history`)
                  evidenceResources.add(`loom:evidence:disclose:${sourceScope}:view:engineering-history:recipient:${evidenceID(actor.session_id, "recipient Session")}`)
                }
                await assertEvidence([...evidenceResources])
                // Permission hooks can await while records are appended. Never inspect
                // a newly participating Session under an earlier contributor grant.
                const authorizedSessions = new Set(sourceSessions)
                if (store.captureScope() !== historyScope || historyContributors(query).contributors
                  .some(session => !authorizedSessions.has(session)))
                  throw new Error("Engineering history source membership changed; restart the read")
                const ownerSnapshots = (): EngineeringHistoryOwners => {
                  const objectives = learning?.objectives.historySnapshot(objectiveSelection(query))
                  const recordIDs = query.objective_id !== undefined && objectives
                    ? store.engineeringHistory.objectiveEvidenceSources(objectives.ledger_record_ids, objectives.ledger_through) : objectives?.ledger_record_ids
                  const reviews = store.reviews.historySnapshot(actor, reviewSelection(query, recordIDs))
                  const version = digest({ store: store.reviews.storeID, scope, boundary: query.owner_boundary,
                    objectives: objectives?.content_digest ?? null, reviews: reviews.content_digest,
                    ...(query.objective_id === undefined ? {} : { original_evidence: recordIDs }) })
                  return { objectives, reviews, record_ids: recordIDs, boundary: query.owner_boundary!, version }
                }
                const owners = ownerSnapshots()
                const view = store.engineeringHistory.read(query, owners)
                evidenceSourceCheck = async () => {
                  if (store.captureScope() !== historyScope || historyContributors({ ...query,
                    through: view.boundary.observed_through }).contributors.some(session => !authorizedSessions.has(session)))
                    throw new Error("Engineering history source membership changed; restart the read")
                  if (ownerSnapshots().version !== owners.version) throw new Error("Engineering history relationship sources changed; restart the read")
                }
                result = view
                break
              }
              case "review": {
                const allowed = input.operation === "prepare-evaluation" ? ["operation", "batch_id", "method", "budget_policy"]
                  : input.operation === "freeze" ? ["operation", "request"]
                  : input.operation === "read" ? ["operation", "request_id", "after", "relationship_after", "issue_after", "limit"]
                    : input.operation === "issue" ? ["operation", "request_id", "authorization_ref", "after", "limit"]
                    : input.operation === "prepare" ? ["operation", "request_id"]
                      : input.operation === "work" ? ["operation", "request_id", "member_id"]
                        : input.operation === "relate" ? ["operation", "request_id", "relationship", "source_record_id", "member_ids", "supersedes"] : undefined
                if (!allowed) throw new Error("Unknown review operation")
                if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Unsupported review operation field")
                await authorizeReview()
                if (input.operation === "prepare-evaluation") {
                  await ctx.permission.assert({ action: "read", resources: [learningFilename], sessionID: toolContext.sessionID, agent: toolContext.agent,
                    source: { type: "tool", messageID: toolContext.messageID, id: toolContext.id } })
                  lifetime.signal.throwIfAborted(); toolContext.signal.throwIfAborted()
                  await checkedSession(actor.session_id)
                  const current = await getConfig(toolContext.signal)
                  lifetime.signal.throwIfAborted(); toolContext.signal.throwIfAborted()
                  if (current.errors.length || current.config.ledger.capture !== "automatic") throw new Error("Evaluator preparation requires enabled source processing")
                  if (typeof input.batch_id !== "string" || !Object.hasOwn(input, "budget_policy")) throw new Error("Evaluator preparation requires batch_id and budget_policy")
                  result = requiredLearning().evaluator.prepare(actor, input.batch_id, input.method, input.budget_policy)
                }
                else if (input.operation === "freeze") {
                  await authorizePreparedReview(input.request)
                  result = store.reviews.freeze(actor, input.request)
                }
                else {
                  if (typeof input.request_id !== "string") throw new Error("Review request_id is required")
                  await authorizePreparedReview(input)
                  if (input.operation === "read") result = store.reviews.read(actor, input.request_id, {
                    after: input.after as number | undefined, relationship_after: input.relationship_after as number | undefined, issue_after: input.issue_after as number | undefined, limit: input.limit as number | undefined })
                  else if (input.operation === "prepare") result = store.reviews.prepareIssue(actor, input.request_id, { kind: "initial" })
                  else if (input.operation === "issue") result = store.reviews.readIssue(actor, input.request_id, {
                    authorization_ref: input.authorization_ref as string | undefined, after: input.after as number | undefined, limit: input.limit as number | undefined })
                  else if (input.operation === "work") {
                    if (typeof input.member_id !== "string") throw new Error("Review member_id is required")
                    result = store.reviews.work(actor, input.request_id, input.member_id)
                  } else {
                    const { operation: _operation, request_id: _requestID, ...relationship } = input
                    result = store.reviews.relate(actor, input.request_id, relationship)
                  }
                }
                break
              }
              case "agents": {
                const entries = registry(snapshot.config, agents(await ctx.agent.list()))
                const modelPolicies = snapshot.config.modelRouting.enabled
                  ? Object.fromEntries(entries.filter(a => a.configured && a.enabled).map(a => [a.id, resolveModelPolicy(snapshot.config, a.id)]))
                  : undefined
                result = {
                  agents: entries, role_descriptions: roleDescriptions(snapshot.config), config_loads: configLoadStatus(),
                  evidence: { capture: snapshot.config.ledger.capture, ...observer.status() },
                  learning: learningStatus(),
                  config_sources: snapshot.sources, errors: snapshot.errors,
                  warnings: entries.filter(a => a.configured && !a.available).map(a => `Configured agent is unavailable: ${a.id}`),
                  ...(modelPolicies || routing.status === "blocked-config" ? {
                    ...(modelPolicies ? { model_policy_preview: modelPolicies } : {}),
                    model_routing_runtime: routing.status,
                    model_routing_selected: routing.selected,
                    model_routing_unavailable_agents: routing.unavailable,
                    model_routing_note: routing.status === "blocked-config"
                      ? "Configuration is unreadable: native model requests are blocked before transport until config repair and plugin restart. Valid disabled routing is unaffected."
                      : routing.status === "initial-only"
                      ? "Native 2.1.4 agent selection only. Only verified included routes (or explicitly opted-in verified metered routes) are dispatched. No live provider failover; unavailable routes fail closed."
                      : "Policy preview only: Loom does not yet route native provider requests in this host. No model-routing adapter is installed.",
                  } : {}),
                }; break
              }
              case "trace": {
                if ("offset" in input) throw new Error("Trace offset is not supported; follow next_cursor instead")
                const targetID = input.session_id === undefined ? actor.session_id : uid(input.session_id, "source Session")
                const nativeEvidence = input.operation === "parts" || input.operation === "source"
                const historicalChildren = input.operation === "children" && input.access === "historical"
                if (input.access !== undefined && !historicalChildren)
                  throw new Error("access=historical is only supported by children")
                if (nativeEvidence) {
                  const allowed = input.operation === "parts"
                    ? ["operation", "session_id", "export_path", "limit", "cursor", "match", "match_fields", "tool", "message_id", "source_sha256"]
                    : ["operation", "session_id", "export_path", "message_id", "part_id", "fields", "source_sha256", "part_sha256"]
                  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Unsupported native evidence option")
                  const fields = input.operation === "source" ? input.fields as NativeEvidenceField[] : []
                  if (input.operation === "source" && (!Array.isArray(fields) || fields.length < 1 || fields.length > 5
                    || fields.some(field => !["input", "output", "dispatch", "status", "error"].includes(field))
                    || new Set(fields).size !== fields.length)) throw new Error("source requires unique supported fields")
                  const matchFields = input.match_fields as NativeEvidenceMatchField[] | undefined
                  if (matchFields !== undefined && (!Array.isArray(matchFields) || matchFields.length < 1 || matchFields.length > 5
                    || matchFields.some(field => !["tool", "status", "dispatch", "input", "output"].includes(field))
                    || new Set(matchFields).size !== matchFields.length)) throw new Error("Invalid native evidence match_fields")
                  const views = input.operation === "source" ? fields.map(field => "native-" + field) : ["native-parts"]
                  const inspected = input.operation === "source" ? views
                    : input.match === undefined ? [] : (matchFields ?? ["tool", "status", "dispatch"]).map(field => "native-" + field)
                  const exactScope = input.operation === "source"
                    ? ":message:" + evidenceID(input.message_id, "message_id") + ":part:" + evidenceID(input.part_id, "part_id") : ""
                  await beginEvidence("session:" + evidenceID(targetID, "source Session") + exactScope, views, inspected)
                  const rawFields = fields.some(field => ["input", "output", "error"].includes(field))
                    || (input.match !== undefined && matchFields?.some(field => field === "input" || field === "output"))
                  // A native policy assertion can wait on stale approval. Do not
                  // turn it into protected cross-Session raw transfer authority.
                  if (rawFields && (targetID !== actor.session_id || input.export_path !== undefined))
                    throw new Error("unsupported-source-release: raw exported or cross-Session native evidence requires a qualified source-owner release boundary")
                  await evidenceSession(targetID)
                  evidenceSessions.add(targetID)
                  if (targetID !== actor.session_id && input.export_path === undefined)
                    throw new Error("Historical native evidence requires an authorized project-local export; the plugin SDK has no full-history reader")
                  let messages: unknown, sourceSha256: string, locationVerified = true
                  if (input.export_path === undefined) {
                    messages = unwrapped(await ctx.session.context({ sessionID: targetID }))
                    sourceSha256 = nativeEvidenceDigest(messages)
                  } else {
                    const exported = await readSessionExport(directory, String(input.export_path), targetID, ctx.location.project.id, async path => {
                      evidenceResources.add(path)
                      await assertEvidence([...evidenceResources])
                      await evidenceSession(targetID)
                    }, toolContext.signal)
                    messages = exported.messages; sourceSha256 = exported.sourceSha256
                    locationVerified = exported.locationVerified; evidenceSourceCheck = exported.revalidate
                  }
                  const common = { sessionID: targetID, source: input.export_path === undefined ? "native-context" as const : "provided-export" as const,
                    sourceSha256, locationVerified }
                  if (input.operation === "parts") {
                    if (input.source_sha256 !== undefined && input.source_sha256 !== sourceSha256)
                      throw new Error("Native evidence source changed; restart discovery")
                    result = nativeEvidenceParts(messages, { ...common, cursor: input.cursor as string | undefined,
                      limit: input.limit as number | undefined, match: input.match as string | undefined,
                      matchFields, tool: input.tool as string | undefined, messageID: input.message_id as string | undefined })
                  } else result = nativeEvidenceSource(messages, { ...common,
                    messageID: uid(input.message_id, "message_id"), partID: uid(input.part_id, "part_id"), fields,
                    expectedSha256: input.source_sha256 as string | undefined, expectedPartSha256: input.part_sha256 as string | undefined })
                  result = { ...payload(result), namespace: { project_id: ctx.location.project.id,
                    workspace_id: ctx.location.workspaceID ?? null, native_store_identity: "unavailable" } }
                  break
                }
                if (["fields", "match", "match_fields", "message_id", "part_id", "tool", "source_sha256", "part_sha256"].some(key => key in input))
                  throw new Error("Native evidence options require parts or source")
                if (historicalChildren) {
                  if (Object.keys(input).some(key => !["operation", "access", "session_id", "limit", "cursor"].includes(key)))
                    throw new Error("Unsupported historical child inventory option")
                  if (input.export_path !== undefined || input.include_text !== undefined)
                    throw new Error("children does not accept export_path or include_text")
                  const limit = input.limit ?? 20
                  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 50) throw new Error("children limit must be 1-50")
                  await beginEvidence("session:" + evidenceID(targetID, "source Session"), ["children"])
                  await evidenceSession(targetID); evidenceSessions.add(targetID)
                  const scope = digest({ operation: "historical-children/v1", parent: targetID,
                    recipient: actor.session_id, project: ctx.location.project.id, workspace: ctx.location.workspaceID ?? null, directory })
                  let nativeCursor: string | undefined
                  if (input.cursor !== undefined) {
                    let cursor: Record<string, unknown>
                    try {
                      if (typeof input.cursor !== "string" || input.cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) throw new Error()
                      cursor = payload(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")))
                      if (cursor.version !== 1 || cursor.scope !== scope || typeof cursor.native !== "string" || cursor.native.length > 2048) throw new Error()
                    } catch { throw new Error("Historical child cursor does not match this authorized scope") }
                    nativeCursor = cursor.native as string
                  }
                  const native = payload(await ctx.session.list({ project: ctx.location.project.id, directory,
                    parentID: targetID, limit: Number(limit), ...(nativeCursor ? { cursor: nativeCursor } : {}) }))
                  if (!Array.isArray(native.data) || native.data.length > Number(limit)) throw new Error("Historical child inventory unavailable")
                  const sessions: Array<Record<string, unknown>> = []
                  for (const raw of native.data) {
                    const child = payload(raw)
                    // Never expose scan counts or a cursor derived from excluded rows.
                    if (typeof child.id !== "string" || child.parentID !== targetID || !await sessionIsLocal(child))
                      throw new Error("Historical child inventory unavailable in the authorized scope")
                    const time = payload(child.time ?? {})
                    sessions.push({ id: uid(child.id, "child Session"), parent_id: targetID,
                      ...(typeof time.created === "number" ? { created_at: time.created } : {}),
                      ...(typeof time.updated === "number" ? { updated_at: time.updated } : {}),
                      archived: time.archived !== undefined && time.archived !== null,
                      relationship: "native-parentage", objective_participation: "not-established" })
                  }
                  const next = payload(native.cursor).next
                  if (next !== null && next !== undefined && (typeof next !== "string" || !next || next.length > 2048))
                    throw new Error("Historical child inventory cursor unavailable")
                  result = { parent_session_id: targetID, sessions,
                    namespace: { project_id: ctx.location.project.id, workspace_id: ctx.location.workspaceID ?? null,
                      native_store_identity: "unavailable" },
                    next_cursor: typeof next === "string" ? Buffer.from(JSON.stringify({ version: 1, scope, native: next })).toString("base64url") : null,
                    coverage: { direct_children: true, recursive: false, snapshot: false },
                    note: "Authorized direct-child structure only. Follow next_cursor until null and query selected descendants explicitly. Parentage does not establish objective participation or authorize native content." }
                  break
                }
                await checkedSession(targetID)
                if (input.operation === "timeline") {
                  // The 2.2.0 plugin SDK provides no target-Session read authority API.
                  // Do not silently expose another native Session's private context.
                  if (targetID !== actor.session_id && input.export_path === undefined)
                    throw new Error("Another Session's native context is not authorized; supply a project-local export with explicit native read permission")
                  const traceSource = input.export_path === undefined
                    ? { messages: unwrapped(await ctx.session.context({ sessionID: targetID })), locationVerified: true }
                    : await readSessionExport(directory, String(input.export_path), targetID, ctx.location.project.id, async canonicalPath => {
                        await ctx.permission.assert({
                          action: "read", resources: [canonicalPath], sessionID: actor.session_id,
                          agent: toolContext.agent,
                          source: { type: "tool", messageID: toolContext.messageID, id: toolContext.id },
                        })
                        if (!await owns(targetID)) throw new Error("Source Session moved during export permission approval")
                        toolContext.signal.throwIfAborted()
                      }, toolContext.signal)
                  toolContext.signal.throwIfAborted()
                  if (!await owns(targetID)) throw new Error("Source Session moved during trace read")
                  result = traceTimeline(traceSource.messages, {
                    sessionID: targetID,
                    source: input.export_path === undefined ? "native-context" : "provided-export",
                    locationVerified: traceSource.locationVerified,
                    cursor: input.cursor as string | undefined, limit: input.limit as number | undefined,
                    includeText: input.include_text as boolean | undefined,
                  })
                } else if (input.operation === "children") {
                  if (input.export_path !== undefined || input.include_text !== undefined)
                    throw new Error("children does not accept export_path or include_text")
                  if (await familyRoot(actor.session_id) !== await familyRoot(targetID))
                    throw new Error("Cannot enumerate unrelated Session family")
                  const native = payload(await ctx.session.list({
                    project: ctx.location.project.id, directory, parentID: targetID,
                    limit: input.limit as number | undefined ?? 20,
                    ...(input.cursor !== undefined ? { cursor: String(input.cursor) } : {}),
                  }))
                  if (!Array.isArray(native.data)) throw new Error("Native Session list did not return a data array")
                  const cursors = payload(native.cursor)
                  const sessions: Array<Record<string, unknown>> = []
                  for (const raw of native.data) {
                    const child = payload(raw)
                    if (typeof child.id !== "string" || child.parentID !== targetID || !await sessionIsLocal(child)) continue
                    sessions.push({ id: child.id, parent_id: targetID,
                      ...(typeof child.title === "string" ? { title: child.title } : {}) })
                  }
                  if (!await owns(targetID)) throw new Error("Source Session moved during child inventory")
                  result = { parent_session_id: targetID, sessions,
                    scanned: native.data.length, matched: sessions.length,
                    next_cursor: typeof cursors.next === "string" ? cursors.next : null,
                    note: "Only direct children in this local project/workspace. Follow next_cursor and inspect relevant descendants individually. Empty results and successful delegation claims are not proof that no other work occurred." }
                } else throw new Error("Unknown trace operation")
                break
              }
              case "insights":
                if ((EVALUATION_READS as readonly unknown[]).includes(input.operation)) {
                  await ctx.permission.assert({ action: "read", resources: [filename, learningFilename],
                    sessionID: toolContext.sessionID, agent: toolContext.agent,
                    source: { type: "tool", messageID: toolContext.messageID, id: toolContext.id } })
                  lifetime.signal.throwIfAborted(); toolContext.signal.throwIfAborted()
                  await checkedSession(actor.session_id)
                  if (!learningRuntime) throw new Error("LOOM_LEARNING_UNAVAILABLE: automatic report runtime is unavailable")
                  // An admission assessment describes current source-processing
                  // policy, including changes while native authorization awaited.
                  // Historical read access remains separate from that policy.
                  const current = input.operation === "evaluation-admission" ? await getConfig(toolContext.signal) : snapshot
                  if (input.operation === "evaluation-admission") await checkedSession(actor.session_id)
                  lifetime.signal.throwIfAborted(); toolContext.signal.throwIfAborted()
                  result = learningRuntime.read(input, actor.session_id, !current.errors.length && current.config.ledger.capture === "automatic")
                } else if (input.batch_id !== undefined || input.member_key !== undefined || input.report_id !== undefined || input.after !== undefined
                  || input.request_id !== undefined || input.manifest_sha256 !== undefined || input.attempt_id !== undefined || input.source_index !== undefined) {
                  throw new Error("Evaluation fields require an evaluation read operation")
                } else if (input.operation === "action") {
                  const actionID = input.action_id === undefined ? store.selected(actor.session_id)?.action_id : String(input.action_id)
                  if (!actionID) throw new Error("Insights action view requires explicit or selected action_id")
                  result = requiredLearning().events({ action_id: actionID, before: input.before as number | undefined, limit: input.limit as number | undefined,
                    since_at: input.since_at as string | undefined, until_at: input.until_at as string | undefined })
                } else if (input.operation === "window") {
                  if (input.action_id !== undefined) throw new Error("Window insights cannot use action_id")
                  result = requiredLearning().events({ before: input.before as number | undefined, limit: input.limit as number | undefined,
                    since_at: input.since_at as string | undefined, until_at: input.until_at as string | undefined })
                } else if (input.operation === "findings") {
                  if (input.action_id !== undefined || input.before !== undefined ||
                      input.since_at !== undefined || input.until_at !== undefined)
                    throw new Error("Findings are project-scoped; filters and ledger cursors are unsupported")
                  result = requiredLearning().findings.list(input.limit as number | undefined,
                    input.finding_cursor as string | undefined)
                } else throw new Error("Unknown insights operation")
                break
              case "objective": {
                const index = requiredLearning().objectives
                if (input.operation === "list") result = index.list(input.offset as number | undefined)
                else if (input.operation === "read") result = index.read(input.objective_id as string,
                  input.cursor as string | undefined, input.limit as number | undefined)
                else if (input.operation === "find") {
                  if (input.source_type === undefined || input.source_id === undefined)
                    throw new Error("Objective find requires an exact source type and source ID")
                  result = index.find({
                    type: input.source_type as ObjectiveSource["type"], id: input.source_id as string,
                    session_id: input.source_session_id as string | undefined,
                    message_id: input.source_message_id as string | undefined,
                  }, input.offset as number | undefined)
                } else if (input.operation === "create" || input.operation === "link") {
                  if (input.source_type === undefined || input.source_id === undefined)
                    throw new Error("Objective links require an original source type and ID")
                  const sourceType = input.source_type as ObjectiveSource["type"]
                  let source: ObjectiveSource
                  if (sourceType === "ledger-record") {
                    if (input.export_path !== undefined || input.source_session_id !== undefined || input.source_message_id !== undefined)
                      throw new Error("Ledger record references use only their original record ID")
                    source = index.ledgerSource(input.source_id as string)
                  } else if (sourceType === "native-message" || sourceType === "native-call") {
                    const target = input.source_session_id === undefined ? actor.session_id : input.source_session_id as string
                    const native = await checkedSession(target)
                    if (target !== actor.session_id && input.export_path === undefined)
                      throw new Error("Other native Session evidence requires an authorized original export")
                    if (sourceType === "native-call" && input.source_message_id === undefined)
                      throw new Error("Native calls require their original message ID")
                    if (sourceType === "native-message" && input.source_message_id !== undefined)
                      throw new Error("Native messages use their own message ID")
                    const inspected = input.export_path === undefined
                      ? { messages: unwrapped(await ctx.session.context({ sessionID: target })),
                          locationVerified: true }
                      : await readSessionExport(directory, input.export_path as string, target,
                          ctx.location.project.id, async canonicalPath => {
                            await ctx.permission.assert({
                              action: "read", resources: [canonicalPath], sessionID: actor.session_id, agent: actor.agent,
                              source: { type: "tool", messageID: toolContext.messageID, id: toolContext.id },
                            })
                            if (!await owns(target)) throw new Error("Native source moved during export permission approval")
                            toolContext.signal.throwIfAborted()
                          }, toolContext.signal)
                    const projected = findTraceSource(inspected.messages, {
                      sessionID: target,
                      messageID: sourceType === "native-message" ? input.source_id as string : input.source_message_id as string,
                      ...(sourceType === "native-call" ? { callID: input.source_id as string } : {}),
                    })
                    toolContext.signal.throwIfAborted()
                    if (!await owns(target)) throw new Error("Native source moved during objective read")
                    let parent: string | undefined
                    if (typeof native.parentID === "string") {
                      try { await checkedSession(native.parentID); parent = native.parentID }
                      catch { /* No verified native parent; never guess one. */ }
                    }
                    const occurred = typeof projected.created_at === "number" ? projected.created_at
                      : typeof projected.created_at === "string" ? Date.parse(projected.created_at) : NaN
                    source = {
                      type: sourceType, id: input.source_id as string, session_id: target,
                      ...(sourceType === "native-call" ? { message_id: input.source_message_id as string } : {}),
                      ...(parent ? { parent_session_id: parent } : {}),
                      event_kind: projected.kind,
                      ...(Number.isSafeInteger(occurred) && occurred >= 0 ? { occurred_at_ms: occurred } : {}),
                      verification: input.export_path === undefined ? "native-context" : "provided-export-unverified",
                    }
                  } else if (sourceType === "external-ref" || sourceType === "unavailable") {
                    if (input.export_path !== undefined || input.source_session_id !== undefined || input.source_message_id !== undefined)
                      throw new Error("External and unavailable sources have no native Session fields")
                    source = { type: sourceType, id: input.source_id as string,
                      verification: sourceType === "external-ref" ? "declared-external" : "reported-gap" }
                  } else throw new Error("Invalid objective source type")
                  if (input.operation === "create") result = index.create(actor, source,
                    input.label as string, input.unit_key as string | undefined)
                  else result = index.link(actor, {
                    objective_id: input.objective_id as string, phase: input.phase as ObjectivePhase,
                    source, confidence: input.confidence as "supported" | "uncertain" | undefined,
                    assessment: input.assessment as "reported-done" | "reported-failed" | "pass" | "fail" | "inconclusive" | "confirm" | "reject" | undefined,
                    related_sequence: input.related_sequence as number | undefined,
                    relation: input.relation as ObjectiveRelation | undefined,
                    gap_reason: input.gap_reason as "missing-child" | "compacted" | "denied-access" | "opaque-tool" | "missing-source" | "unknown" | undefined,
                    note: input.note as string | undefined,
                  })
                } else throw new Error("Unknown objective operation")
                break
              }
              case "trends":
                result = requiredLearning().trends.compare({
                  operation: input.operation as "compare",
                  since_at: input.since_at as string,
                  until_at: input.until_at as string,
                  as_of_at: input.as_of_at as string,
                  population: input.population as "all-linked" | "selected",
                  objective_ids: input.objective_ids as string[] | undefined,
                  source_type: input.source_type as string | undefined,
                  unit_key: input.unit_key as string | undefined,
                  group_by: input.group_by as string | undefined,
                  cursor: input.cursor as string | undefined,
                  limit: input.limit as number | undefined,
                })
                break
              case "tweak":
                if (input.operation === "propose") result = requiredLearning().propose(actor, {
                  target_kind: input.target_kind as string, target_id: input.target_id as string,
                  base_sha256: input.base_sha256 as string, candidate_content: input.candidate_content as string,
                  hypothesis: input.hypothesis as string, evidence_refs: input.evidence_refs as string[] | undefined,
                  revised_from: input.revised_from as string | undefined })
                else if (input.operation === "list") result = requiredLearning().list(input.offset as number | undefined)
                else if (input.operation === "read") result = requiredLearning().read(String(input.id), input.trial_before as number | undefined)
                else if (input.operation === "retire") result = requiredLearning().retire(String(input.id))
                else if (input.operation === "trial") result = requiredLearning().trial(actor, { id: String(input.id),
                  observed_sha256: input.observed_sha256 as string | undefined,
                  observed_effect: input.observed_effect as string, statement: input.statement as string,
                  evidence_refs: input.evidence_refs as string[] | undefined })
                else throw new Error("Unknown tweak operation")
                break
              case "action":
                if (input.operation === "list") result = store.list(input.offset as number | undefined)
                else if (input.operation === "create") result = store.create(input.title as string, input.goal as string, actor)
                else if (input.operation === "update") result = store.update(String(input.action_id), Number(input.expected_revision), { title: input.title as string | undefined, goal: input.goal as string | undefined, state: input.state as Parameters<Store["update"]>[2]["state"] })
                else if (input.operation === "sessions") {
                  // The native inventory is a read-only, bounded page. It is not
                  // authorization to dispatch, attach, interrupt or archive Sessions.
                  const actionID = input.action_id === undefined ? undefined : String(input.action_id)
                  if (actionID !== undefined) store.action(actionID)
                  const native = payload(await ctx.session.list({
                    project: ctx.location.project.id,
                    directory,
                    limit: input.limit as number | undefined ?? 20,
                    ...(input.cursor !== undefined ? { cursor: String(input.cursor) } : {}),
                    ...(input.archived !== undefined ? { archived: input.archived as boolean } : {}),
                  }))
                  if (!Array.isArray(native.data)) throw new Error("Native Session list did not return a data array")
                  const cursors = payload(native.cursor)
                  const sessions: Array<Record<string, unknown>> = []
                  for (const raw of native.data) {
                    const session = payload(raw)
                    if (typeof session.id !== "string" || !await sessionIsLocal(session)) continue
                    const selected = store.selected(session.id)
                    const hasRecordedActivity = actionID === undefined ? false : store.hasActionActivity(actionID, session.id)
                    if (actionID !== undefined && selected?.action_id !== actionID && !hasRecordedActivity) continue
                    const time = session.time && typeof session.time === "object" && !Array.isArray(session.time)
                      ? session.time as Record<string, unknown> : {}
                    sessions.push({
                      id: session.id,
                      ...(typeof session.title === "string" ? { title: session.title } : {}),
                      ...(typeof session.parentID === "string" ? { parent_id: session.parentID } : {}),
                      archived: time.archived !== undefined && time.archived !== null,
                      ...(selected ? { selection: selected } : {}),
                      ...(actionID !== undefined ? { has_recorded_activity: hasRecordedActivity } : {}),
                    })
                  }
                  result = {
                    sessions, scanned: native.data.length, matched: sessions.length,
                    next_cursor: typeof cursors.next === "string" ? cursors.next : null,
                    note: "Read-only native Session inventory page. A selection, Plan revision or ledger record does not prove execution, task completion, or recipient contact. Follow next_cursor; filtered/empty pages do not prove absence.",
                  }
                }
                else throw new Error("Unknown Action operation")
                break
              case "plan":
                if (input.operation === "read") result = store.plan(String(input.action_id), input.revision as number | undefined)
                else if (input.operation === "save") result = store.savePlan(String(input.action_id), Number(input.expected_revision), input.nodes, actor)
                else throw new Error("Unknown plan operation")
                break
              case "context": {
                if (input.clear) { if (input.action_id !== undefined || input.node_id !== undefined || input.mode !== undefined || input.handoff_id !== undefined) throw new Error("clear cannot be combined with work IDs or context options"); store.select(actor.session_id); result = { selected: null }; break }
                // Clearing is navigation, not a read of the possibly damaged selection.
                const focus = resolveContextSelection(input, () => store.selected(actor.session_id))
                if (!focus) {
                  result = input.mode === "independent"
                    ? { selected: null, context_mode: "independent", history_withheld: true, records: [], progress: [], questions: [],
                      selection_unchanged: true,
                      note: "No Action selected: no Loom work history was read and no work selection was saved. This Session-only independent view does not erase native messages, prior conversation, or explicitly queried history." }
                    : { selected: null, note: "No Action selected. Ordinary conversation needs no Action." }
                  break
                }
                const envelopeChars = JSON.stringify({ result: null, ...diagnostics }).length - 4
                result = workContext(store, focus, snapshot.config.context.max_chars, actor.agent, {
                  ...(input.action_id !== undefined || input.mode !== undefined || input.handoff_id !== undefined ? { selectForSession: actor.session_id } : {}), envelopeChars,
                })
                break
              }
              case "record": {
                const evidenceQuery = ["projection", "fields", "source_session_id", "record_kinds", "through"].some(key => key in input)
                if (evidenceQuery && (input.operation !== "query" || (input.view !== undefined && input.view !== "ledger")))
                  throw new Error("Evidence projections and filters require a ledger query")
                if (input.source_session_id !== undefined && input.node_id !== undefined && input.action_id === undefined)
                  throw new Error("node_id requires action_id")
                if (input.review !== undefined && input.operation !== "ask") throw new Error("review is only supported for a typed ask")
                if (input.response_format !== undefined) {
                  if (input.response_format !== "markdown" && input.response_format !== "json") throw new Error("response_format must be markdown or json")
                  if (input.operation !== "query") throw new Error("response_format is only supported for queries")
                  if (input.response_format === "markdown" && input.view !== "full_thread") throw new Error("response_format markdown is only supported for full_thread queries; use json")
                }
                // Reject retired protocol fields even when a caller bypasses schema validation.
                if (["assign", "authorize-continuation", "withdraw-continuation", "retry-delivery"].includes(String(input.operation))
                  || ["assignments", "deliveries"].includes(String(input.view))) throw new Error("Assignment/delivery operation or view is retired; history remains in the ledger")
                for (const field of ["assignment_id", "worker_session_id", "delivery_id", "continuation", "attempt_after", "attempt_limit"])
                  if (field in input) throw new Error(`${field} is not supported; assignment/delivery protocol is retired`)
                if (input.view === "full_thread") {
                  if (input.operation !== "query") throw new Error("full_thread requires query")
                  const { operation: _operation, view: _view, response_format: _responseFormat, ...query } = input
                  result = renderFullHistory(store.history.read(query))
                  break
                }
                if ((input.session_id !== undefined && input.operation !== "ask") || "cursor" in input)
                  throw new Error("session_id is an ask destination or full_thread query option; cursor is full_thread only")
                if (input.session_only && (input.action_id !== undefined || input.node_id !== undefined ||
                    (input.operation !== "query" && input.operation !== "add")))
                  throw new Error("session_only is a query option or Session-scoped add option and cannot be combined with work IDs")
                // Explicit work/thread identity must not depend on saved selection.
                const identityScoped = ["complete", "answer", "bind-respondent"].includes(String(input.operation))
                  || (input.operation === "query" && ["thread", "inbox"].includes(String(input.view)))
                const focus = identityScoped || input.session_only || (input.source_session_id !== undefined && input.action_id === undefined)
                  || (input.operation === "ask" && (input.reference !== undefined || input.review !== undefined)) ? undefined : focusFor(input, actor.session_id)
                if (evidenceQuery) {
                  const sourceSession = input.source_session_id === undefined ? undefined : uid(input.source_session_id, "source_session_id")
                  if (input.session_only && sourceSession !== undefined && sourceSession !== actor.session_id)
                    throw new Error("session_only cannot select another source Session")
                  const scope = sourceSession !== undefined ? "session:" + evidenceID(sourceSession, "source Session")
                    : focus ? "action:" + evidenceID(focus.action_id, "action_id") : "session:" + evidenceID(actor.session_id, "source Session")
                  const view = input.projection === "metadata" ? "record-metadata"
                    : input.projection === "fields" ? "record-fields" : "record-full"
                  const fields = input.fields as string[] | undefined
                  if (fields !== undefined && (!Array.isArray(fields) || fields.length < 1 || fields.length > RECORD_FIELDS.length
                    || fields.some(field => !(RECORD_FIELDS as readonly string[]).includes(field)) || new Set(fields).size !== fields.length))
                    throw new Error("Invalid evidence record fields")
                  const recordScope = input.record_id === undefined ? scope : scope + ":record:" + evidenceID(input.record_id, "record_id")
                  await beginEvidence(recordScope, view === "record-fields" ? (fields ?? []).map(field => "record-" + field) : [view],
                    view === "record-metadata" ? [] : view === "record-fields" ? (fields ?? []).map(field => "record-" + field) : [view])
                  if (sourceSession !== undefined) { await evidenceSession(sourceSession); evidenceSessions.add(sourceSession) }
                }
                if (input.operation === "bind-respondent") {
                  const question = store.collaboration.thread(String(input.question_id)).question
                  if (question.data.format !== "loom-question/v2" ||
                      typeof question.data.expected_agent !== "string" ||
                      typeof question.data.expected_parent_session !== "string")
                    throw new Error("This question is not routed for forwarded-specialist binding; answer it directly if addressed to the dispatcher, or delegate a specialist without binding if you are consulting one")
                  if (question.data.expected_parent_session !== actor.session_id)
                    throw new Error("Only the question's dispatching Session can bind this forwarded specialist")
                  const receiverID = String(input.respondent_session_id) as Parameters<typeof ctx.session.get>[0]["sessionID"]
                  const receiver = payload(unwrapped(await ctx.session.get({ sessionID: receiverID })))
                  if (receiver.id !== receiverID || receiver.parentID !== actor.session_id ||
                      receiver.agent !== question.data.expected_agent || !await sessionIsLocal(receiver))
                    throw new Error("Respondent must be the intended native specialist child of this dispatching Session")
                  result = store.collaboration.bindRespondent(question.id, receiverID,
                    receiver.agent as string, actor.session_id)
                  break
                }
                if (input.operation === "answer") {
                  const { operation: _operation, ...answer } = input
                  const original = store.collaboration.thread(String(input.question_id)).question
                  let verifiedParent: string | undefined
                  if (original.data.format === "loom-question/v2" &&
                      typeof original.data.expected_parent_session === "string") {
                    const candidate = payload(unwrapped(await ctx.session.get({ sessionID: actor.session_id })))
                    if (candidate.id !== actor.session_id ||
                        candidate.parentID !== original.data.expected_parent_session ||
                        candidate.agent !== actor.agent || !await sessionIsLocal(candidate) ||
                        !await owns(candidate.parentID as Parameters<typeof ctx.session.get>[0]["sessionID"]))
                      throw new Error("Answering Session is not a verified child of the dispatching Session")
                    verifiedParent = candidate.parentID as string
                  }
                  const committed = store.collaboration.answer(actor, answer, verifiedParent)
                  result = await resumeAnswer(store, committed, async sessionID => {
                    const target = payload(unwrapped(await ctx.session.get({ sessionID })))
                    return target.id === sessionID && await sessionIsLocal(target)
                  }, notice => ctx.session.synthetic(notice), AbortSignal.any([toolContext.signal, lifetime.signal]), lifetime.signal)
                  break
                }
                if (input.operation === "ask") {
                  if (input.recipient === undefined && input.session_id === undefined) {
                    if (input.review !== undefined) throw new Error("A review request requires a typed agent or role recipient")
                    result = { ...store.collaboration.execute(actor, input, focus) as object, dispatch: QUESTION_DISPATCH,
                      guidance: input.blocking === true
                        ? "Recipient not contacted. Manual/native handling is required. If manual handling has been arranged, you may naturally yield for a response; blocking intent does not force a wait."
                        : "Recipient not contacted. Manual/native handling is required; continue your work and retrieve answers later." }
                    break
                  }
                  const recipient = input.recipient === undefined ? undefined : questionRecipient(input.recipient)
                  const asker = payload(unwrapped(await ctx.session.get({ sessionID: actor.session_id })))
                  if (asker.id !== actor.session_id || !await sessionIsLocal(asker))
                    throw new Error("Cannot route a question from an unverified local Session")
                  if (input.session_id !== undefined) {
                    if (recipient || input.to_agent !== undefined)
                      throw new Error("Explicit session_id cannot be combined with recipient or to_agent")
                    if (input.session_id === actor.session_id)
                      throw new Error("Explicit destination must be another native Session")
                    await checkedSession(String(input.session_id))
                  }
                  // Native agent registry is only needed for agent/role resolution.
                  const all = recipient ? unwrapped(await ctx.agent.list()) : []
                  if (!Array.isArray(all)) throw new Error("OpenCode returned an unsupported agent registry shape")
                  const roster = all.map(raw => {
                    const a = payload(raw)
                    if (typeof a.id !== "string" || typeof a.mode !== "string")
                      throw new Error("OpenCode agent registry lacks an ID or mode")
                    return { id: a.id, mode: a.mode, hidden: a.hidden === true, model: nativeModel(a.model) }
                  })
                  const asking = { id: actor.session_id,
                    ...(typeof asker.parentID === "string" ? { parentID: asker.parentID } : {}),
                    model: nativeModel(asker.model) }
                  // The model-request guard is authoritative. A typed
                  // OQ must not spawn a native child (or wake a parent) when
                  // this host cannot dispatch a verified managed model.
                  const routingUnqualified = (startupGuard !== undefined && startupDispatch === "deny") ||
                    routingStatus === "blocked-config" ||
                    (snapshot.config.modelRouting.enabled && routingStatus !== "initial-only")
                  const plannedRoute: QuestionRoute = snapshot.errors.length
                    ? { mode: "manual", reason: "loom-config-unavailable" }
                    : input.session_id !== undefined
                      ? { mode: "notify", reason: "explicit-session",
                          session: String(input.session_id), expected_session: String(input.session_id) }
                      : questionRoute(recipient!, snapshot.config, roster, asking)
                  let route: QuestionRoute = routingUnqualified && plannedRoute.mode !== "manual"
                    ? { mode: "manual", reason: "model-routing-host-unqualified" }
                    : plannedRoute
                  if (route.mode === "notify" && route.session && !await owns(route.session))
                    route = { mode: "manual", reason: "target-not-local" }
                  if (input.review !== undefined) {
                    // Explicit structured reviews enter the same production
                    // initiator as other questions, but their private mandate
                    // must not leak into the ordinary project-readable ledger.
                    const allowed = ["operation", "question", "recipient", "blocking", "review"]
                    if (Object.keys(input).some(key => !allowed.includes(key)))
                      throw new Error("A structured review ask accepts only question, recipient, blocking and review; preserve context and scope in the immutable review mandate/members")
                    if (typeof input.blocking !== "boolean") throw new Error("Review ask blocking must be Boolean")
                    if (!recipient || (recipient.kind !== "agent" && recipient.kind !== "role"))
                      throw new Error("A review request requires a typed agent or role recipient")
                    const review = payload(input.review), mandate = payload(review.mandate), intended = payload(review.intended_recipient)
                    if (mandate.question !== input.question) throw new Error("Review mandate must preserve the exact original question")
                    const recipientAgent = recipient.kind === "agent" ? recipient.id : plannedRoute.expected_agent
                    if (!recipientAgent || intended.agent !== recipientAgent)
                      throw new Error("Review intended recipient must match the original resolved agent; use an explicit agent when a role is ambiguous")
                    await authorizeReview()
                    await authorizePreparedReview(review)
                    const frozen = store.reviews.freeze(actor, review)
                    result = { review: frozen,
                      ...(frozen.status !== "conflict" ? { issue: store.reviews.prepareIssue(actor, frozen.request_id, { kind: "initial" }) } : {}),
                      dispatch: { status: "not-attempted", attempted: false,
                        reason: frozen.status === "conflict" ? "review-request-conflict" : "recipient-specific-protected-transfer-unqualified" },
                      guidance: frozen.status === "conflict"
                        ? "This request ID already preserves a different original review. The submitted change was not stored and no issue was prepared or dispatched. Read the existing request and reconcile the original mandate."
                        : "The original review mandate and membership are persisted privately. Read them with loom_review read. Protected delivery is withheld because this host cannot enforce recipient-specific incoming transfer; no native review execution or paid dispatch is claimed. An existing initial issue is never a new issue permit.",
                    }
                    break
                  }
                  const { operation: _askOperation, ...askFields } = input
                  // An explicit destination remains the authorized respondent even when
                  // a guarded host withholds native delivery. Never reassign author identity.
                  const verifiedSession = input.session_id === undefined ? undefined : String(input.session_id)
                  if (verifiedSession) {
                    await checkedSession(verifiedSession)
                    if (route.mode === "notify") {
                      // Locality identifies the destination; only native policy may
                      // authorize this caller to inject input and wake that Session.
                      // Do not offer saved grants: OpenCode persists those project-wide.
                      await ctx.permission.assert({ action: "loom.question.deliver",
                        resources: [`session:${verifiedSession}`],
                        sessionID: toolContext.sessionID, agent: toolContext.agent,
                        source: { type: "tool", messageID: toolContext.messageID, id: toolContext.id },
                        metadata: { destination_session_id: verifiedSession } })
                      lifetime.signal.throwIfAborted()
                      toolContext.signal.throwIfAborted()
                      // Native approval can wait for human input. Recheck both
                      // locations and the dispatch guard before committing any work.
                      const current = await getConfig(toolContext.signal)
                      await checkedSession(actor.session_id)
                      await checkedSession(verifiedSession)
                      lifetime.signal.throwIfAborted()
                      toolContext.signal.throwIfAborted()
                      if (current.errors.length) route = { mode: "manual", reason: "loom-config-unavailable" }
                      else if ((startupGuard !== undefined && startupDispatch === "deny") ||
                          routingStatus === "blocked-config" ||
                          (current.config.modelRouting.enabled && routingStatus !== "initial-only"))
                        route = { mode: "manual", reason: "model-routing-host-unqualified" }
                    }
                  }
                  const stored = store.collaboration.ask(actor, focus, askFields, {
                    ...(route.expected_agent ? { expected_agent: route.expected_agent } : {}),
                    ...((verifiedSession ?? route.expected_session) ? { expected_session: verifiedSession ?? route.expected_session } : {}),
                    ...(route.expected_parent_session ? { expected_parent_session: route.expected_parent_session } : {}),
                  })
                  const dispatch = await sendQuestion(store, stored, route, {
                    delegate: async (agent, parentID, questionID, prompt, background) => {
                      const native = (await ctx.tool.list()).find(info => info.name === "subagent")
                      if (!native) throw new Error("OpenCode native subagent tool unavailable; no direct child creation")
                      const token = randomUUID()
                      const pending: { question: string; parent: string; agent: string; bound?: string } =
                        { question: questionID, parent: parentID, agent }
                      awaitingNativePrompt.set(token, pending)
                      try {
                        // Invoking the native tool preserves the effective depth limit,
                        // native permission checks, and model selection semantics.
                        const result = await native.execute({
                          agent, description: `Resolve Loom OQ ${questionID}`,
                          prompt: `Loom OQ dispatch token: ${token}\n${prompt}`, background,
                        }, toolContext)
                        const output = payload(result.output)
                        if (typeof output.sessionID !== "string" || pending.bound !== output.sessionID ||
                            !["running", "completed"].includes(String(output.status)))
                          throw new Error("Native subagent completion did not match the verified pre-admission binding")
                        return { sessionID: output.sessionID, status: output.status as "running" | "completed" }
                      } finally {
                        awaitingNativePrompt.delete(token)
                      }
                    },
                    synthetic: (sessionID, text, metadata) => ctx.session.synthetic({
                      sessionID: sessionID as Parameters<typeof ctx.session.synthetic>[0]["sessionID"],
                      text, metadata, description: "Loom Open Question", resume: true, delivery: "steer",
                    }),
                  }, AbortSignal.any([toolContext.signal, lifetime.signal]))
                  result = { ...stored, dispatch,
                    guidance: dispatch.status === "admission-observed"
                      ? "Native input admitted; recipient execution/answer is not guaranteed. Read the question thread for a real answer; blocking is advisory."
                      : recipient?.kind === "user" && route.mode === "manual"
                        ? "Ask the user using native interaction; record the actual user decision with its source. No user was contacted by Loom."
                        : "Automatic delivery was not confirmed. Inspect the dispatch result and use native handling; do not assume the question was answered." }
                  break
                }
                if (["complete", "reopen"].includes(String(input.operation)) || (input.operation === "query" && input.view !== undefined && input.view !== "ledger")) {
                  // Presentation was validated above; collaboration owns only the query fields.
                  const { response_format: _responseFormat, ...query } = input
                  result = store.collaboration.execute(actor, input.operation === "query" ? query : input, focus)
                  break
                }
                if (input.operation === "query") result = store.records({ action_id: input.session_only ? undefined : focus?.action_id,
                  session_id: actor.session_id, node_id: input.session_only ? undefined : focus?.node_id,
                  record_id: input.record_id as string | undefined, after: input.after as number | undefined, limit: input.limit as number | undefined,
                  ...(evidenceQuery ? { projection: input.projection as RecordQuery["projection"], fields: input.fields as RecordQuery["fields"],
                    source_session_id: input.source_session_id as string | undefined, record_kinds: input.record_kinds as RecordQuery["record_kinds"],
                    through: input.through as number | undefined } : {}) })
                else if (input.operation === "add") {
                  result = store.record(actor, focus, { kind: input.kind as Parameters<Store["record"]>[2]["kind"], statement: input.statement as string, evidence_ids: input.evidence_ids as string[] | undefined, artifact_refs: input.artifact_refs as string[] | undefined, verdict: input.verdict as string | undefined })
                } else throw new Error("Unknown record operation")
                if (evidenceQuery) result = { ...payload(result), source_store_id: store.reviews.storeID }
                break
              }
            }
            if ((spec.name === "record" && input.operation !== "query") ||
                (spec.name === "objective" && ["create", "link"].includes(String(input.operation))) ||
                (spec.name === "review" && ["freeze", "relate", "prepare"].includes(String(input.operation)))) learningRuntime?.notify(actor.session_id)
            if (spec.name === "record" && input.operation === "query" && (!input.view || input.view === "ledger") && !input.record_id && input.projection === undefined) {
              const page = result as ReturnType<Store["records"]>
              result = { ...page, items: page.items.map(r => "data" in r ? ({ ...r, data: typeof r.data.statement === "string" && r.data.statement.length > 600
                ? { ...r.data, statement: r.data.statement.slice(0,600), truncated: true, read_full: "Pass this record_id to loom_record query" } : r.data }) : r) }
            }
            // All presentations are derived from one view and enter the same final
            // authorization path. Hash the actual returned bytes, including HTML.
            const content = spec.name === "history" && input.response_format === "html"
              ? renderEngineeringHistoryHTML(result as EngineeringHistoryView)
              : spec.name === "history" && input.response_format === "markdown"
                ? renderEngineeringHistoryMarkdown(result as EngineeringHistoryView)
                : JSON.stringify({ result, ...diagnostics })
            if (spec.name === "trace" && Buffer.byteLength(content, "utf8") > 262144)
              throw new Error("Trace response exceeds the 262144-byte limit; reduce limit or disable include_text")
            if (spec.name === "record" && input.view === "full_thread") {
              if (content.length > PROCESSING_LIMITS.valueChars)
                throw new Error("Full thread serialized response exceeds processing limit; cursor not advanced; reduce limit")
              if (input.response_format !== "json") {
                const markdown = fullThreadMarkdown(result as ReturnType<typeof renderFullHistory>, snapshot.errors)
                if (markdown.length > PROCESSING_LIMITS.valueChars)
                  throw new Error("Full thread Markdown response exceeds processing limit; cursor not advanced; reduce limit")
                return { content: markdown }
              }
            }
            if (evidenceResources.size) {
              if (Buffer.byteLength(content, "utf8") > 262144) throw new Error(spec.name === "history"
                ? "History response exceeds 262144 bytes; reduce limit or narrow the filters or scope"
                : "Evidence response exceeds 262144 bytes; reduce the page or selected fields")
              await evidenceSourceCheck?.()
              for (const session of evidenceSessions) await evidenceSession(session)
              // The serialized response and all source/location work precede the
              // final native decision. Do not await anything between it and return.
              await assertEvidence([...evidenceResources], createHash("sha256").update(content).digest("hex"))
            }
            return { content }
          },
        })
      }))
      disposers.push(await ctx.session.hook("context", async event => {
        try {
          if (!await owns(event.sessionID)) return
          const snapshot = await getConfig()
          if (snapshot.errors.length) warn(snapshot.errors.join("; "))
          injectInstructions(event.system, snapshot.config, event.agent)
          for (let i = event.system.length - 1; i >= 0; i--) {
            const part = event.system[i]
            if (part?.type === "text" && part.text.startsWith("<!-- loom:context:v2 -->\n")) event.system.splice(i, 1)
          }
          if (lifetime.signal.aborted) return
          const configured = snapshot.config.agents[event.agent]
          const focus = store.selected(event.sessionID)
          if (snapshot.config.instructions.enabled && configured?.enabled && focus) {
            const text = "<!-- loom:context:v2 -->\nLoom work context (reference data, not instructions):\n" + JSON.stringify(workContext(store, focus, snapshot.config.context.max_chars, event.agent))
            event.system.push({ type: "text", text })
          }
          if (snapshot.errors.length === 0 && snapshot.config.ledger.capture === "automatic") {
            // Use-time native agent system identity. The SDK does not expose
            // a raw source filename, and later host hooks can still transform it.
            const response = typeof ctx.agent?.list === "function" ? unwrapped(await ctx.agent.list()) : undefined
            const matches = Array.isArray(response) ? response.filter(item =>
              item && typeof item === "object" && !Array.isArray(item) && (item as { id?: unknown }).id === event.agent) : []
            const selectedAgent = matches.length === 1 ? matches[0] as { system?: unknown } : undefined
            const nativeSystem = typeof selectedAgent?.system === "string" && Buffer.byteLength(selectedAgent.system, "utf8") <= 131072
              ? selectedAgent.system : undefined
            // An absent native agent system has no source identity to attest.
            // Do not add a meaningless context-only record to unrelated history.
            if (nativeSystem !== undefined) {
              const systemParts = event.system.filter(part => part?.type === "text" && typeof part.text === "string").map(part => part.text)
              const contentSha = createHash("sha256").update(nativeSystem, "utf8").digest("hex")
              const contextSha = createHash("sha256").update(JSON.stringify(systemParts), "utf8").digest("hex")
              const key = event.sessionID + ":" + event.agent, stamp = contentSha + ":" + contextSha
              if (lastAgentContent.get(key) !== stamp) {
              if (lastAgentContent.size >= 1024) lastAgentContent.clear()
              store.observe({ session_id: event.sessionID, agent: event.agent }, focus, {
                phase: "agent-context-snapshot", agent_id: event.agent,
                ...(contentSha ? { content_sha256: contentSha } : {}),
                context_system_sha256: contextSha,
                source: contentSha ? "native-agent-registry-system" : "native-agent-system-unavailable",
                observation: "native agent system and post-Loom context snapshot; not proof of final provider input or instruction application",
              })
              lastAgentContent.set(key, stamp)
              }
            }
          }
          learningRuntime?.notify(event.sessionID)
        } catch (error) { warn(error) } // A missing ledger or invalid config must not block native reasoning.
      }))
      disposers.push(await ctx.tool.hook("execute.before", async event => {
        if (/^loom[_.]/.test(event.tool)) return
        try {
          if (!await owns(event.sessionID)) return
          const snapshot = await getConfig()
          if (lifetime.signal.aborted) { observer.captureGap(); return }
          if (snapshot.config.ledger.capture === "automatic") observer.before(event)
          else observer.skip(event)
        } catch (error) { observer.captureGap(); warn(error) }
      }))
      disposers.push(await ctx.tool.hook("execute.after", async event => {
        if (/^loom[_.]/.test(event.tool)) return
        try {
          if (!await owns(event.sessionID)) return
          const captureEnabled = (await getConfig()).config.ledger.capture === "automatic"
          if (lifetime.signal.aborted) return
          if (captureEnabled || observer.has(event)) {
            // SDK Tool.Error is a class, and may contain arbitrary causes/metadata.
            // Hash a complete, versioned diagnostic projection, not the class graph.
            // Keep the bounded plain-data serializer strict; never truncate messages.
            const observed = event.status === "error"
              ? { ...event, error: { format: "loom-tool-error/v1", message: event.error.message } }
              : event
            const record = observer.after(observed, captureEnabled)
            if (record) learningRuntime?.notify(event.sessionID)
            if (record && record.data.attribution !== "captured-at-start") warn(`Evidence is unpaired (${record.data.attribution}). Inspect loom_record with operation=query, session_only=true.`)
            // Native skill loader result: provenance hint, not proof of model use.
            // Never store the skill body, original tool output or a claim of final delivery.
            if (record && record.data.attribution === "captured-at-start" && event.tool === "skill" && event.status === "completed") {
              const input = event.input && typeof event.input === "object" && !Array.isArray(event.input) ? event.input as Record<string, unknown> : {}
              const output = event.result as { content?: unknown }
              if (typeof input.id === "string" && input.id.length > 0 && input.id.length <= 200 &&
                  typeof output.content === "string" && Buffer.byteLength(output.content, "utf8") <= 131072) {
                const registry = unwrapped(await ctx.skill.list())
                const registered = Array.isArray(registry) ? registry.filter(s =>
                  !!s && typeof s === "object" && (s as { id?: unknown }).id === input.id) : []
                const current = registered.length === 1 ? registered[0] as { content?: unknown } : undefined
                const registeredText = typeof current?.content === "string" ? current.content : undefined
                store.observe({ session_id: event.sessionID, agent: event.agent },
                  record.action_id ? { action_id: record.action_id, ...(record.node_id ? { node_id: record.node_id } : {}) } : undefined,
                  { phase: "skill-load-result", skill_id: input.id, call_id: event.id,
                    rendered_sha256: createHash("sha256").update(output.content, "utf8").digest("hex"),
                    ...(registeredText ? { registry_content_sha256: createHash("sha256").update(registeredText, "utf8").digest("hex"),
                      registered_content_present: output.content.includes(registeredText.trim()) } : {}),
                    observation: "completed native skill tool result; registry sampled afterward; not proof of final model exposure or application" },
                  record.fingerprint)
              }
            }
          }
        } catch (error) { warn(error) }
      }))
    } catch (error) {
      lifetime.abort()
      await Promise.allSettled(disposers.map(d => d.dispose()))
      try { learningDatabase?.close(true) } finally { database.close(true) }
      throw error
    }
    try {
      learningRuntime = await registerAutomaticLearning(ctx, { learning, ledgerPath: filename, learningPath: learningFilename,
        signal: lifetime.signal, getConfig, checkedSession, warn })
      disposers.push(learningRuntime)
    } catch { warn("Optional automatic learning registration unavailable; core guards and source recording remain active") }
    // The early guard remains restrictive until the entire plugin initialized.
    // A valid, explicitly disabled policy removes it; a guarded runtime
    // delegates to the fully registered model.request hook. Unknown hosts
    // and partial runtimes remain denied instead of falling through.
    if (routingStatus === "disabled") {
      startupDispatch = "disabled"
      await disposeStartupGuard()
    } else if (routingStatus === "initial-only" || routingStatus === "blocked-config") {
      startupDispatch = "delegated"
    } else {
      // A capable real host with no working adapter must not silently fall
      // through to its global model. Incomplete legacy mocks have no early
      // guard and retain their existing setup behavior.
      startupDenial = "LOOM_MODEL_ROUTING_HOST_UNQUALIFIED: no proven native request guard"
    }
    learningRuntime?.start()
    const captureCompanion = async (receipt: import("./review-companions.js").CompanionReceipt) => {
      try {
        if (lifetime.signal.aborted || !await owns(receipt.sessionID)) return
        const snapshot = await getConfig()
        if (snapshot.errors.length || snapshot.config.ledger.capture !== "automatic") return
        store.observe({ session_id: receipt.sessionID, agent: receipt.agent }, store.selected(receipt.sessionID), {
          phase: "companion-load-result", skill_id: receipt.skillID, lens: receipt.lens,
          message_id: receipt.messageID, call_id: receipt.callID, content_sha256: receipt.contentSha256,
          source: "successful-companion-tool-result",
          observation: "successful permission-checked companion tool result; not proof of final model receipt or application",
        })
        learningRuntime?.notify(receipt.sessionID)
      } catch (error) { warn(error) }
    }
    return Object.assign(async () => {
      startupDispatch = "deny"
      lifetime.abort()
      await Promise.allSettled(disposers.map(d => d.dispose()))
      // Bun's default close defers cleanup to statement finalizers. This owner
      // must finish closing both databases before stopped-state backup can begin.
      try { learningDatabase?.close(true) } finally { database.close(true) }
      await disposeStartupGuard()
    }, { captureCompanion })
    } catch (error) {
      startupDispatch = "deny"
      startupDenial = "LOOM_MODEL_ROUTING_STARTUP_FAILED: plugin initialization failed; native dispatch blocked"
      // If the host does not expose the qualified early guard, we cannot
      // truthfully retain protection. Preserve the original startup failure.
      if (!startupGuard) throw error
      // Preserve pre-existing startup failure reporting and native fallback
      // when routing was demonstrably disabled by a successfully loaded config.
      // Unreadable config is NEVER interpreted as deliberate disabling.
      let safelyDisabled = false
      try {
        const root = await realpath(ctx.location.directory)
        const snapshot = await loadConfig(configPaths(root), decodeConfigYaml)
        safelyDisabled = snapshot.errors.length === 0 && !snapshot.config.modelRouting.enabled
      } catch { /* Unknown routing intent stays denied. */ }
      if (safelyDisabled) {
        startupDispatch = "disabled"
        await disposeStartupGuard()
        throw error
      }
      try { console.error("Loom startup failed; keeping native model dispatch denied:", error instanceof Error ? error.message : String(error)) }
      catch { /* Keep the installed deny hook even when logging fails. */ }
      // Resolving setup retains the installed deny hook. Throwing would let
      // OpenCode unload that hook and continue with an unguarded global model.
      return async () => { startupDispatch = "deny"; await disposeStartupGuard() }
    }
  },
})
