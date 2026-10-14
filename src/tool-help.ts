/** Registered discovery help. No guide-file read or extra tool call is required. */
export const TOOL_EXAMPLES = {
  agents: [{}],
  action: [
    { operation: "create", title: "Explain a setting", goal: "Record a source-backed explanation and its qualifications." },
    { operation: "list", offset: 0 },
    { operation: "update", action_id: "ACTION_ID", expected_revision: 1, title: "Explain the investigated setting" },
  ],
  plan: [
    { operation: "read", action_id: "ACTION_ID" },
    { operation: "save", action_id: "ACTION_ID", expected_revision: 0, nodes: [
      { id: "research", kind: "task", title: "Investigate", roles: ["research"] },
      { id: "explain", kind: "task", title: "Explain findings", depends_on: ["research"], roles: ["implementation"] },
    ] },
  ],
  context: [{ action_id: "ACTION_ID", node_id: "explain" }, {}, { clear: true }],
  record: [
    { operation: "add", action_id: "ACTION_ID", node_id: "research", kind: "result", statement: "REPLACE_WITH_FINDING_SOURCE_AND_QUALIFICATIONS" },
    { operation: "query", action_id: "ACTION_ID", record_id: "RECORD_ID" },
    { operation: "query", session_only: true, limit: 10 },
    { operation: "add", action_id: "ACTION_ID", node_id: "explain", kind: "qa", verdict: "inconclusive", statement: "REPLACE_WITH_ACTUAL_REVIEW_FINDING" },
  ],
} as const
export type LoomToolName = keyof typeof TOOL_EXAMPLES

const entries: Record<LoomToolName, { summary: string; usage: string; returns: string; caution: string }> = {
  agents: {
    summary: "Discover native agents and Loom roles; inspect configuration, capture and load-queue diagnostics.",
    usage: "Use {} to find the actual roster before native delegation. Choose by available=true, enabled=true and relevant roles; configured=true alone does not establish availability. Agent descriptions guide coordination, not permissions. Agents and skills are defined outside Loom.",
    returns: "result.agents contains id, description when present, roles, configured, available and enabled. Also returns config_sources, errors, warnings, evidence.capture/pairing and config_loads (active, waiting and limits).",
    caution: "Does not create or dispatch agents, load skills or grant authority. Configuration errors disable Loom injection and new capture, not native work. Queue length is bounded, waiting time is not; a diagnostic request can itself wait. Use native OpenCode delegation with the Action/task IDs and retrieve work through loom_context.",
  },
  action: {
    summary: "Create, list or update an Action: a persistent goal shared across agents and Sessions.",
    usage: "operation=create requires title and goal; it selects the new Action for this Session. operation=list accepts offset (default 0), returns at most 50 Actions; follow next_offset until null. operation=update requires action_id and the current Action expected_revision, plus title, goal or state to change. Get the current Action revision from list or loom_context; it is not a Plan revision.",
    returns: "Create/update return result with id, title, goal, state, revision and created_at. List returns result.items and next_offset. Save result.id for subsequent Action/task requests and native handoff messages.",
    caution: "Ordinary conversation needs no Action; a Plan is optional. active, paused, completed and cancelled are progress labels, not process controls or proof of delivery. Update changes metadata, not current selection. A stale revision or failed write throws: reread and reconcile rather than retrying with a guessed revision. Use loom_plan for a Plan and loom_context for an existing Action.",
  },
  plan: {
    summary: "Read or save an optional complete Action plan with task dependencies and retained revisions.",
    usage: "Requires operation and action_id. read returns the latest Plan unless revision selects history. save requires expected_revision from the current Plan and the complete nodes list; use 0 only before the first saved Plan. Each node needs a stable id, kind and title. Kinds: phase, wave, task, subtask; levels may be omitted. parent groups work; depends_on names existing node IDs. outcome, context, criteria, skills, roles and agent describe the assignment. At most 300 nodes; parent ordering and dependency cycles are validated.",
    returns: "result.revision and result.nodes. Saving appends a new revision; it does not erase previous Plan revisions or ledger records. Read the latest revision before another save.",
    caution: "Save replaces the whole node list, not a patch. Keep IDs for unchanged work; omitted nodes leave current work, while their history remains. Subject to combined input/processing limits. No scheduling, dispatch or permission grants occur. Assign real agents from loom_agents, then delegate natively with action_id and node_id. Use loom_context to read assigned work; a removed selection returns explicit recovery choices.",
  },
  context: {
    summary: "Recover an Action/task's context or select work for this Session, including after a handoff or restart.",
    usage: "{} reads current selection without changing it; a fresh Session returns selected:null. action_id selects an existing Action and reads it; optional node_id selects a task or other Plan node. node_id requires action_id. {clear:true} clears selection; do not combine clear with work IDs. Delegate with the Action/task IDs: the receiving agent must select its own work. Later automatic context follows saved selection for configured agents while instruction injection is enabled.",
    returns: "result contains action, plan_revision, task, related_tasks, records and truncation/retrieval notices (a compact response can omit fields). A missing node returns recovery.code=task-not-in-current-plan with Plan/history queries and explicit reselection, Action-only or clear choices; selection/history stay unchanged.",
    caution: "Explicit IDs read and then attempt to save selection. CURRENT LIMITATION: if saving fails, this call can throw after reading; do not assume selection changed. Failed clear also throws. Context is sampled, not complete: excerpts can omit qualifications; contract_match:null is unknown, and true is not code freshness. Read a full dependency conclusion with loom_record query and explicit action_id plus record_id (no node_id); otherwise the Worker's selected-task filter can hide it. Context selection is not permission to execute.",
  },
  record: {
    summary: "Store results, claims, Assessment or QA findings; retrieve full evidence and dependency history.",
    usage: "operation=add requires kind and statement plus explicit action_id (optional node_id) or this Session's selection. Kinds: result (outcome), claim (conclusion), assessment (requirements review), qa (failure/risk probes). assessment/qa require verdict: pass, fail or inconclusive. evidence_ids optionally link existing host observations in the same Action, not other results; artifact_refs are unverified references. Missing evidence is omitted, never invented. Use actual findings instead of the example placeholders.",
    returns: "Add returns result.id and the recorded scope, author, time and data. query returns result.items and next_after; pass next_after as after with the same filters until null. limit is 1-50 (default 30). Page statements over 600 characters are excerpted. record_id requests that complete record, within existing read limits; it still obeys scope and after filters.",
    caution: "Query scope: explicit action_id without node_id searches the whole Action, not the selected task. Without action_id it inherits selected Action/task, or this Session's history when unselected. node_id requires action_id. For a dependency's full record, provide action_id and record_id, omit node_id and after. session_only:true queries this Session including unpaired observations without changing selection; query only, incompatible with work IDs. Empty filtered results do not prove absence. This tool cannot create observations or certify claims/review independence; read complete sources before consequential decisions. No raw tool output is stored automatically; explicit statements must not contain secrets. Failed writes/oversized reads throw, not succeed with invented or shortened records.",
  },
}

/** First line stays useful in the host's short inline catalog; search returns all lines. */
export const TOOL_HELP = Object.fromEntries(Object.entries(entries).map(([name, help]) => [name, [
  help.summary,
  `Usage: ${help.usage}`,
  `Returns: ${help.returns}`,
  `Caution: ${help.caution}`,
  'Examples (JSON inputs, not shell commands; replace ACTION_ID/RECORD_ID with returned IDs):',
  ...TOOL_EXAMPLES[name as LoomToolName].map(input => JSON.stringify(input)),
  'The tool returns JSON text with a result field and optional config_errors. In Code Mode, parse that text once with JSON.parse; use the exact callable path returned by search.',
].join('\n')])) as Record<LoomToolName, string>

export const LOOM_NAMESPACE_HELP = "Loom remembers Actions, plans, context and evidence. Search namespace loom for each tool's usage, examples and side effects. Execution and delegation stay native."
