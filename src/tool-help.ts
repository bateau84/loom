/** Registered discovery help. No guide-file read or extra tool call is required. */
export const TOOL_EXAMPLES = {
  agents: [{}],
  history: [
    { operation: "read", action_id: "ACTION_ID" },
    { operation: "read", objective_id: "OBJECTIVE_ID" },
    { operation: "read", action_id: "ACTION_ID", match: "timeout", record_kinds: ["concern", "assessment"] },
    { operation: "read", action_id: "ACTION_ID", record_id: "RECORD_ID", related: true },
    { operation: "read", action_id: "ACTION_ID", response_format: "html" },
    { operation: "preview-population", selection: { objective_id: "OBJECTIVE_ID", question: "What corrected this failure and what remains unverified?" }, limit: 20 },
    { operation: "population", population_id: "POPULATION_ID", manifest_sha256: "MANIFEST_SHA256", limit: 20 },
    { operation: "population-source", population_id: "POPULATION_ID", manifest_sha256: "MANIFEST_SHA256", member_key: "MEMBER_KEY" },
  ],
  review: [
    { operation: "freeze", request: { format: "loom-review-request/v1", request_id: "REVIEW_REQUEST_ID",
      mandate: { question: "Assess correctness of the exact cited artifact.", dimensions: ["correctness"],
        criteria: [{ text: "Preserve the accepted behavior", source_ref: null }], mode: "independent", inclusions: [], exclusions: [] },
      intended_recipient: { agent: "reviewer", session_id: null }, work_revision_policy: "frozen-historical",
      members: [{ member_id: "artifact", work_ref: null, producing_attempt_refs: [],
        artifact_refs: [{ locator: "ARTIFACT_PATH", version: { kind: "sha256", value: "0000000000000000000000000000000000000000000000000000000000000000" }, content_ref: null }],
        prior_review_request_id: null, membership_source_refs: [], gaps: [{ reason: "source-missing", source_ref: null }] }], rechecks: [] } },
    { operation: "read", request_id: "REVIEW_REQUEST_ID", limit: 20 },
    { operation: "issue", request_id: "REVIEW_REQUEST_ID", limit: 20 },
    { operation: "work", request_id: "REVIEW_REQUEST_ID", member_id: "MEMBER_ID" },
    { operation: "relate", request_id: "REVIEW_REQUEST_ID", relationship: "finding", source_record_id: "RECORD_ID", member_ids: ["MEMBER_ID"] },
  ],
  trace: [
    { operation: "timeline", limit: 25 },
    { operation: "timeline", session_id: "SESSION_ID", export_path: "private-retro/session.json", include_text: true, limit: 25 },
    { operation: "children", session_id: "SESSION_ID", limit: 20 },
    { operation: "children", access: "historical", session_id: "SESSION_ID", limit: 50 },
    { operation: "parts", session_id: "SESSION_ID", export_path: "private-retro/session.json", tool: "subagent", limit: 50 },
    { operation: "source", message_id: "MESSAGE_ID", part_id: "PART_ID", fields: ["output"], part_sha256: "0000000000000000000000000000000000000000000000000000000000000000" },
  ],
  insights: [
    { operation: "action", action_id: "ACTION_ID", limit: 50 },
    { operation: "window", limit: 50, since_at: "2026-11-01T00:00:00.000Z" },
    { operation: "findings", limit: 20 },
    { operation: "evaluation-status" },
    { operation: "evaluations", limit: 5 },
    { operation: "evaluation", batch_id: "BATCH_ID" },
    { operation: "evaluation-members", batch_id: "BATCH_ID", limit: 10 },
    { operation: "evaluation-sources", batch_id: "BATCH_ID", limit: 50 },
    { operation: "evaluation-observations", batch_id: "BATCH_ID", member_key: "MEMBER_KEY", report_id: "REPORT_ID", after: 0, limit: 20 },
    { operation: "evaluation-preparation", batch_id: "BATCH_ID" },
    { operation: "evaluation-preparation-members", batch_id: "BATCH_ID", request_id: "REQUEST_ID", manifest_sha256: "MANIFEST_SHA256", after: 0, limit: 20 },
    { operation: "evaluation-preparation-source", batch_id: "BATCH_ID", request_id: "REQUEST_ID", manifest_sha256: "MANIFEST_SHA256", member_key: "MEMBER_KEY", source_index: 0 },
    { operation: "evaluation-admission", batch_id: "BATCH_ID", request_id: "REQUEST_ID", manifest_sha256: "MANIFEST_SHA256", attempt_id: "ATTEMPT_ID" },
    { operation: "evaluation-interpretations", limit: 10 },
    { operation: "evaluation-interpretation", batch_id: "BATCH_ID", section: "overview", response_format: "markdown" },
    { operation: "evaluation-interpretation", batch_id: "BATCH_ID", section: "sources", limit: 20 },
  ],
  objective: [
    { operation: "create", source_type: "ledger-record", source_id: "RECORD_ID", label: "One requested behavior", unit_key: "GOAL_KEY" },
    { operation: "link", objective_id: "OBJECTIVE_ID", phase: "coordination", source_type: "ledger-record", source_id: "RECORD_ID", note: "Source-backed retrospective association; native dispatch not established" },
    { operation: "link", objective_id: "OBJECTIVE_ID", phase: "verification", source_type: "ledger-record", source_id: "RECORD_ID", assessment: "fail", note: "Runtime test rejected the claimed implementation" },
    { operation: "read", objective_id: "OBJECTIVE_ID", limit: 20 },
    { operation: "find", source_type: "ledger-record", source_id: "RECORD_ID" },
    { operation: "list", offset: 0 },
  ],
  trends: [
    { operation: "compare", population: "all-linked", since_at: "2026-10-01T00:00:00Z",
      until_at: "2026-11-01T00:00:00Z", as_of_at: "2026-11-10T00:00:00Z",
      group_by: "start-month", limit: 20 },
  ],
  tweak: [
    { operation: "propose", target_kind: "skill", target_id: "software-engineering", base_sha256: "0000000000000000000000000000000000000000000000000000000000000000", candidate_content: "FULL_CANDIDATE_SKILL_TEXT", hypothesis: "A recurring observed problem and one bounded improvement", evidence_refs: ["SOURCE_RECORD_ID"] },
    { operation: "list", offset: 0 },
    { operation: "read", id: "CANDIDATE_ID" },
    { operation: "read", id: "CANDIDATE_ID", trial_before: 100 },
    { operation: "trial", id: "CANDIDATE_ID", observed_effect: "inconclusive", statement: "Observed case and exact evidence limit" },
    { operation: "retire", id: "CANDIDATE_ID" },
  ],
  action: [
    { operation: "create", title: "Explain a setting", goal: "Record a source-backed explanation and its qualifications." },
    { operation: "list", offset: 0 },
    { operation: "update", action_id: "ACTION_ID", expected_revision: 1, title: "Explain the investigated setting" },
    { operation: "sessions", action_id: "ACTION_ID", limit: 20 },
  ],
  plan: [
    { operation: "read", action_id: "ACTION_ID" },
    {"operation":"save","action_id":"ACTION_ID","expected_revision":0,"nodes":[{"id":"research","kind":"task","title":"Investigate configuration behavior","agent":"research","roles":["research"],"outcome":"Source-backed findings about configuration loading.","criteria":["Explain layer precedence","Identify failure behavior","Include sources and material qualifications"]},{"id":"explain","kind":"task","title":"Write the configuration guide","agent":"documenter","roles":["documentation"],"depends_on":["research"],"outcome":"A concise guide with a usable example.","context":"Use the research findings; retain their qualifications.","criteria":["Examples match actual behavior","Limitations are stated clearly"]},{"id":"review","kind":"task","title":"Check the guide against the implementation","agent":"reviewer","roles":["assessment"],"depends_on":["explain"],"outcome":"Evidence-backed review findings."}]},
  ],
  context: [{ action_id: "ACTION_ID", node_id: "explain" }, {}, { clear: true },
    { action_id: "ACTION_ID", node_id: "review", mode: "independent" }, { mode: "continuation" },
    { action_id: "ACTION_ID", node_id: "explain", handoff_id: "RECORD_ID" }, { handoff_id: null },
    { mode: "independent" }],
  record: [
    { operation: "add", action_id: "ACTION_ID", node_id: "research", kind: "result", statement: "FINDING_SOURCES_AND_LIMITS" },
    { operation: "query", action_id: "ACTION_ID", record_id: "RECORD_ID", response_format: "json" },
    { operation: "query", session_only: true, limit: 10 },
    { operation: "add", action_id: "ACTION_ID", node_id: "explain", kind: "qa", verdict: "inconclusive", statement: "REPLACE_WITH_ACTUAL_REVIEW_FINDING" },
    { operation: "ask", question: "Does this finding also apply to empty files?", recipient: { kind: "role", id: "research" }, blocking: false, context: "Check the cited result's limits.", context_attachments: ["RECORD_ID"], reference: { action_id: "ACTION_ID", kind: "task", id: "explain" } },
    { operation: "answer", question_id: "QUESTION_ID", answer: "REPLACE_WITH_RESPONSE_SOURCES_AND_QUALIFICATIONS", context_attachments: ["SOURCE_REFERENCE"] },
    { operation: "query", view: "thread", question_id: "QUESTION_ID" },
    { operation: "query", view: "inbox", question_state: "open", limit: 20 },
    { operation: "complete", work_ref: { action_id: "ACTION_ID", node_id: "explain", action_revision: 1, plan_revision: 1, hash: "REPLACE_ENTIRE_WORK_REF_FROM_WORKED_CONTEXT" }, statement: "REPLACE_WITH_PERFORMED_WORK" },
    { operation: "reopen", action_id: "ACTION_ID", node_id: "explain", statement: "Revisit the newly required cases." },
    { operation: "query", view: "progress", action_id: "ACTION_ID" },
    { operation: "query", view: "questions", action_id: "ACTION_ID", respondent: "research", question_state: "open" },
    { operation: "query", view: "full_thread", action_id: "ACTION_ID", node_id: "explain", limit: 20 },
    { operation: "query", view: "full_thread", session_id: "SESSION_ID", cursor: "NEXT_CURSOR", limit: 20 },
    { operation: "ask", question: "Which limitation matters here?", recipient: { kind: "dispatcher" }, blocking: true },
    { operation: "add", action_id: "ACTION_ID", node_id: "research", kind: "concern", statement: "Suspected incompatibility; include support and unknowns." },
    { operation: "ask", question: "Which approach fits?", recipient: { kind: "role", id: "research" }, blocking: true, answer_type: "multi-choice", choices: [{ id: "A", answer: "Keep current" }, { id: "B", answer: "Use proposed" }] },
    { operation: "answer", question_id: "QUESTION_ID", choice_id: "B", reason: "REPLACE_WITH_EVIDENCE" },
    { operation: "answer", question_id: "QUESTION_ID", status: "cannot-select", reason: "REPLACE_WITH_REASON" },
    { operation: "query", action_id: "ACTION_ID", source_session_id: "SESSION_ID", projection: "metadata", limit: 50 },
    { operation: "query", action_id: "ACTION_ID", record_id: "RECORD_ID", projection: "fields", fields: ["statement", "artifact_refs"] },
  ],
} as const
export type LoomToolName = keyof typeof TOOL_EXAMPLES

const entries: Record<LoomToolName, { summary: string; usage: string; returns: string; caution: string }> = {
  history: {
    summary: "Discover history, trajectories, populations and frozen originals.",
    usage: "Always supply operation. read: one action_id/session_id/objective_id; limit 1-50. Search before paging: literal match (1-200 chars), AND record_kinds, verdict, source_session_id, node_id, plan_revision, has_gaps. Known ID: loom_record query for full text; history record_id+related:true for connections, no discovery filters. Copy trajectory, expand, group.details and navigation unchanged (selectors, through, owner_boundary, owner_version, cursors). Changed versions need fresh read.\npreview-population: selection:{objective_id,question,exclusions?:[{record_id,reason}]}, limit 1-50. Get objective ID via loom_objective find/list/create, not an Action ID. Omit boundaries initially. History boundary versions are not preview versions; reuse preview selection/next. Approve exact membership/gaps before sending preview.freeze unchanged to loom_review.\npopulation: population_id+manifest_sha256 from freeze; after/limit or navigation.next. population-source: same pins+member_key, preferably copy a frozen member's inspect. All history operations accept response_format=json(default)|markdown|html. Optional source_offset/source_limit (2-32768 UTF-16 units); follow navigation.next, concatenate content_json fragments and verify original SHA-256 before parsing.",
    returns: "JSON result: history records, coverage, relationships, source.query for loom_record; populations: member_count/items, manifest, manifest_sha256, navigation, freeze/inspect. Preview population_id=null; freeze creates it. Source reads: available/missing/changed/unsupported; metadata is not original content.",
    caution: "Investigation needs no Plan/objective except objective-scoped reads/populations. Missing objective: inspect sources or author associations if authorized; never invent IDs. Source/contributor permissions apply throughout. Private review populations are requester-only. Connections prove no causation, dispatch, inspection or acceptance. Frozen metadata grants no execution/source-release authority. Live pins are not frozen membership. Unresolved/reference-only originals need fresh preview/freeze. Caller-native context and authenticated exact GitHub originals only for native/external reads; 54 owner reads per selection. Response <=262144 UTF-8 bytes; narrow scope/limit.",
  },
  review: {
    summary: "Freeze approved populations or protected review mandates; no execution grant.",
    usage: "freeze-population: copy approved preview.freeze (selection+preview_sha256); replay retains identity. Inspect all membership/gaps via navigation.next before approval. No approval Boolean or execution operation exists.\nfreeze: request:loom-review-request/v1 with mandate, intended_recipient, exact members and rechecks. Omit mandate.currentness for frozen-historical; current-at-issue-claim requires freshness. work_revision_policy must match. read: request_id, limit 1-50, after/relationship_after/issue_after. work: request_id+member_id for historical Action/Plan. issue: request_id, optional authorization_ref, after=next_outcome_sequence; reads intent/outcomes. relate: request_id, relationship, own source_record_id, member_ids; rechecks identify prior findings/corrections. prepare: request_id for canonical initial intent.\nprepare-evaluation: exactly one complete Stage3 batch_id OR population_id+manifest_sha256; complete loom-evaluator-method/v1 method and budget_policy (null or id/revision/sha256). Requires capture=automatic and read permission on both stores. Read resulting batch_id via insights evaluation-preparation; preparation is not execution.",
    returns: "freeze-population: population_id, manifest_sha256, immutable selected identities/versions/gaps, navigation and per-member inspect requests for loom_history. Other operations return mandate, subjects, qualified relationships and receipts. Authored links are unverified. Structured review ask privately freezes/prepares; protected delivery withheld.",
    caution: "Native read permission and requesting Session ownership required; preparation needs learning-store access. Method/policy references are not content or authority. No new capture, issue claim, dispatch, protected transfer or genuine reasoning. Same-ID changes conflict; consumed intents stay consumed. No new approval workflow: use actual authorization for the specific selection.",
  },
  agents: {
    summary: "Discover native agents and Loom roles; inspect configuration, capture and load-queue diagnostics.",
    usage: "Use {} to find the actual roster before native delegation. Choose by available=true, enabled=true and relevant roles; configured=true alone does not establish availability. Match agents[].roles with role_descriptions by role ID. Agent and role descriptions are coordination hints, not permissions or automatic matching. Agents and skills are defined outside Loom.",
    returns: "result.agents contains id, description when present, roles, configured, available and enabled. result.learning reports whether optional learning storage is available; unavailable learning does not disable ordinary Loom tools. result.role_descriptions maps configured role IDs to their descriptions when provided; roles without a description have no entry, and unassigned roles may appear. Also returns config_sources, errors, warnings, evidence.capture/pairing and config_loads (active, waiting and limits).",
    caution: "Does not create or dispatch agents, load skills or grant authority. Configuration errors disable Loom injection and new capture, not native work. Queue length is bounded, waiting time is not; a diagnostic request can itself wait. Use native OpenCode delegation with the Action/task IDs and retrieve work through loom_context.",
  },
  trace: {
    summary: "Discover historical Session structure and exact native tool parts; read authorized evidence projections.",
    usage: "timeline: caller post-compaction context, or session_id + authorized project-local export_path; include_text:true adds bounded masked excerpts. children: direct family children; access:historical requests separately authorized structural inventory for a named local parent. Follow descendants explicitly. parts: tool-part metadata, optional tool/message_id filters, match (literal, 1-256 chars), match_fields (default tool/status/dispatch). source: exact message_id + part_id + fields from input/output/dispatch/status/error. Both use caller context or an export. Raw fields and input/output matching are ONLY available in caller context; export/cross-Session views permit structural/status/dispatch data. part_sha256 pins an exact part; source_sha256 pins the whole source. For evolving context prefer part_sha256. Page using cursor/next_cursor, limit 1-50.",
    returns: "timeline: source, coverage, page metrics, events, next_cursor; opaque wrappers retain delegation uncertainty. children: sessions and next_cursor; historical mode withholds scan counts and rejects foreign rows. parts: Session/message/part IDs, hashes, sizes, field availability and next_cursor. source: selected fields, identity/pins, coverage, resolved/partial/missing/changed and gaps; no inventory metadata. Marker gaps: redaction-marker-unverified. Output belongs to state.content on the part, not a separate result. Dispatch does not establish Loom assignment or objective participation.",
    caution: "Read-only, same project/workspace/canonical location. Native context is incomplete; supplied exports remain authenticity/completeness unverified and may omit unsettled/redacted content. Export must be a regular project-local JSON file <=16 MiB, separately native-read-authorized; replacement/path escapes fail. No new private reasoning, message-body or attachment view. include_text masking is best effort, not guaranteed secret removal. New views require native read resources loom:evidence:discover/inspect/disclose for actual caller/view; wildcard grants apply. Final native assertion is NOT an atomic revocation fence: raw export/cross-Session reads AND body matching fail unsupported-source-release. New parts cursors pin source+filters; changed sources require restart. Timeline paging retains its older non-snapshot behavior. Responses <=262144 bytes; oversized originals fail, never substitute an excerpt. See docs/architecture/design/ard-007-learning-historical-evidence.md: resource grammar and qualification limits.",
  },
  insights: {
    summary: "Read deterministic evaluations and durable Evaluator interpretations with evidence links; no dispatch.",
    usage: "action/window: before, limit 1-200; findings: finding_cursor. Stage3 uses native source notifications, idle and startup catch-up (capture=automatic). Batch reads need batch_id. Members/sources/observations use numeric after; preparation source also needs request_id+manifest_sha256+member_key+source_index. Admission adds attempt_id. S5 evaluation-interpretations: JSON list, before/next_before. evaluation-interpretation: section overview/trajectory/claims/review_coverage/gaps/sources/prior_interpretations; limit 1-100(default25), response_format json/markdown/html. Copy navigation.sections/next with report pins and opaque after. source.inspect uses loom_history; prior.inspect uses loom_insights.",
    returns: "Stage3 reports/source refs/coverage; body_paginated uses evaluation-observations. Preparation: method/request/manifest, issue, interpretation:null. Admission: blockers, no permit; null reservation means unknown accounting. S5: findings, practices, failures, counterevidence, uncertainty, recommendations/no-change and provenance. Sources distinguish selected/retrieved/cited/unavailable. Exhaust next to null; coverage.complete describes one page. Large items use exact fragments.",
    caution: "Each page rechecks native read permission and calling Session ownership. S5 rechecks all sources, including uncited/inherited inputs; loss or denial withholds metadata/content/cursors. Frozen gaps stay gaps. No public import, dispatch or canonical mutation. Scripted publication is not genuine Evaluator reasoning; production authority stays absent. Stage3 limit 262144 canonical characters. S5 pages<=180000 UTF8 bytes in every format; final response<=262144 bytes. No omitted cursor prefix.",
  },

  objective: {
    summary: "Find exact-source objective associations or author a qualified goal history; find is not a text search.",
    usage: "find: source_type+source_id of an original; ledger-record uses its ID, native-message also source_session_id, native-call also source_message_id. It matches exact source identity, NOT label, question or substring. For words use loom_history read+match; list browses objectives. list/find: offset or returned navigation.next. read: objective_id, limit 1-50, cursor or navigation.next. Use items[].id or create result.id.\ncreate (write): label+source_type/source_id anchor, optional unit_key distinguishes goals; same anchor/key is idempotent. Author only when authorized; missing associations are gaps. link (write): objective_id, phase, source_type/source_id, optional note/confidence. Native writes default to caller; other Sessions need authorized export_path. Native calls require source_message_id. ledger-record resolves the original; external-ref declares an HTTPS URL.\nPhases: request, coordination, dispatch, handback, verification, corrective-dispatch, continuation, planned-increment, requirement-change, environment-failure, outcome, coverage-gap, link-correction. handback assessment=reported-done|reported-failed|inconclusive; verification/outcome=pass|fail|inconclusive. corrective-dispatch/continuation/link-correction need earlier related_sequence; link-correction assessment=confirm|reject. coverage-gap needs gap_reason; unavailable source is allowed only there. relation=supports|contradicts|addresses|assesses|supersedes|contests joins distinct ledger sources using earlier related_sequence, never link-correction.",
    returns: "create: result.id and existing. link: sequence, source, phase, author, interpretation and verification. read: bounded chronological entries, current_relationship, coverage and continuation. list/find: 20-item items/next_offset pages; several objectives may share a source. Empty find means no indexed association, not absent engineering history.",
    caution: "Authored reconstruction, not transcript capture, automatic objective merging or acceptance. Shared Session/Action/title/revision does not establish one goal. Preserve source gaps, compaction and denials; never invent native provenance. Reported DONE is not verified. Later corrections do not erase prior claims. No execution, source grants or instruction mutation; capture opt-out stays intact. Never store secrets in labels/notes.",
  },
  trends: {
    summary: "Compare bounded, source-started whole objectives across time without treating ledger pages as samples.",
    usage: "operation=compare requires since_at (inclusive), until_at (exclusive), as_of_at (at or after until_at), and population=all-linked or selected (selected requires objective_ids, maximum 50). Use ISO timestamps with timezone. Optional source_type, unit_key and group_by=start-month|unit-key|source-type|origin-verification|outcome-author-agent|instruction-fingerprint|model|provider|host-revision|tool-revision|work-type|rubric|actual-instruction-exposure. Page with limit=1-20 and next_cursor, repeating identical population/window/group filters. Queries exceeding 366 days, 500 candidate objectives or 50 groups fail closed. An objective with more than 500 links is excluded and disclosed without hiding other eligible objectives.",
    returns: "Full frozen-population metrics/groups on every page, plus up to 20 objective IDs, original source references, authored outcome, corrective redispatch, recovery and contrary verification; eligible/unknown/excluded counts, collection coverage, shared evidence/origin warning and unavailable dimension reasons. Page cursors freeze objective and link insertion bounds; later appends require a fresh comparison.",
    caution: "Only explicitly linked objectives with known original request source time are eligible; original histories may be missing. Outcome/verification labels are authored judgments, NOT host-certified correctness. Shared source does not prove independent incidents. Linked fingerprint receipts do not establish final model exposure. No invented work type/model/provider/rubric, universal score, causal effect, automatic experiment, scheduling or promotion. Read original authorized sources via loom_objective and loom_trace before proposing a change.",
  },
  tweak: {
    summary: "Store and revisit provisional fingerprinted instruction tweaks and agent-reported trials; never activate them.",
    usage: "operation=propose requires target_kind(skill/assessment/qa/agent), target_id, base_sha256, complete candidate_content and hypothesis; optional evidence_refs/revised_from. list takes offset; read and retire take id; read also accepts trial_before from trials_next_before for bounded history; trial takes id, observed_effect and statement, optional observed_sha256/evidence_refs. A revised candidate gets a new ID/fingerprint.",
    returns: "Propose returns immutable candidate content and SHA-256. Read returns candidate plus up to 20 attributed trial reports and an optional trials_next_before continuation. List omits full candidate text. Trial reports the calling native Session/agent, not a certified model exposure or effectiveness outcome.",
    caution: "Candidate text is untrusted hypothesis data, never installed guidance. This tool does not mutate native skill/agent registries, dispatch agents, assign variants, prove delivery or promote global instructions. Do not store secrets or private transcripts. A matching reported hash is not an attestation. Use qualified isolated or explicit manual trials, then normal review for promotion.",
  },
  action: {
    summary: "Create, list or update Actions, or list native Sessions associated with local work.",
    usage: "operation=create requires title and goal; it selects the new Action for this Session. operation=list accepts offset (default 0), returns at most 50 Actions; follow next_offset until null. operation=update requires action_id and the current Action expected_revision, plus title, goal or state to change. Get the current Action revision from list or loom_context; it is not a Plan revision. operation=sessions is a read-only native inventory; optional action_id filters by recorded participation (including Plan saves) or current selection, archived filters native archives, limit=1-50 (default 20), cursor follows next_cursor. An empty filtered page does not mean no Sessions exist.",
    returns: "Create/update return result with id, title, goal, state, revision and created_at. List returns result.items and next_offset. sessions returns sessions, scanned, matched and next_cursor; each local Session may have selection, has_recorded_activity (ledger or Plan author when filtered), and archived status. Save result.id for subsequent Action/task requests and native handoff messages.",
    caution: "Ordinary conversation needs no Action; a Plan is optional. active, paused, completed and cancelled are progress labels, not process controls or proof of delivery. Update changes metadata, not current selection. A stale revision or failed write throws: reread and reconcile rather than retrying with a guessed revision. Use loom_plan for a Plan and loom_context for an existing Action. Native Session discovery is limited to this plugin location; no cross-process aggregation, authority, receipt, execution status, or automatic archival is implied.",
  },
  plan: {
    summary: "Read or save intended work and its relationships under an Action; a Plan is not a scheduler.",
    usage: "Use a Plan when meaningful dependencies, distinct coherent tasks or resumption make structure useful; not merely because work takes multiple steps. Assigned Action plans need saved revision/nodes; chat/docs do not persist. Requires operation and action_id. read gets latest or chosen revision. save requires expected_revision and the complete nodes list (0 initially). Action and Plan revisions are separate.\nNodes are a flat list linked by parent and depends_on. Required: id = stable identifier; kind = phase, wave, task or subtask; title = short readable name.\nOptional fields:\n- outcome: what the work should produce.\n- criteria: list of observable completion conditions.\n- context: constraints, background, qualifications and references.\n- depends_on: list of needed node IDs in this Plan.\n- parent: grouping node ID. Levels may be skipped; siblings do not automatically depend on each other.\n- agent: suggested native agent ID; roles: relevant Loom role names; skills: relevant skill names. These do not dispatch agents or load skills.",
    returns: "result.revision, result.nodes and optional result.saved_by (native session_id and agent on new revisions). Save replaces the whole current list, not a patch; earlier revisions remain.",
    caution: "Keep IDs for unchanged work. After a revision conflict, reread and reconcile; never guess. At most 300 nodes; parent/dependency references, hierarchy and cycles are validated; combined input/processing limits apply. Saving does not dispatch, enforce execution order or mark tasks complete. Discover real agents with loom_agents; example agent IDs are suggestions. Delegate natively with Action/task IDs and use loom_context to select work. Keep intent here, not activity logs or whole fetched documents; status, completed and permissions are invalid node fields. Put findings, results, sources and review verdicts in loom_record on the task. Dependencies make records available to downstream context, but sampling is not complete. Use loom_record for reported progress. The Plan says what should happen; the ledger remembers what was found or done.",
  },
  context: {
    summary: "Select work, pin a result handoff, or read independent context without earlier Loom opinions.",
    usage: "{} reads saved selection; fresh Sessions return selected:null. action_id selects an Action; optional node_id needs action_id. mode=continuation (legacy default) or independent is saved with selection, including automatic context. Omitted mode keeps it; create Action or clear resets it. With no selected Action, mode=independent returns a Session-only withheld-history view without saving a selection. Unreadable saved selection: explicit navigation keeps legacy continuation unless mode is explicit; select independent for a fresh first review. handoff_id pins a same-Action result; null clears it, new work drops it. Independent clears inherited pins and rejects explicit pins. clear:true cannot combine with IDs or options. ",
    returns: "Context mode, Action/task contracts, related tasks and truncation notices. Both views retain work_ref before work; continuation adds sampled records, progress and questions. Read handoffs with loom_record query, action_id and record_id, no node_id. Independent sets history_withheld:true and reads no ledger/results/reviews/progress/questions; task text is not sanitized. Missing task: recovery.code=task-not-in-current-plan, selection/history unchanged. Output, configuration errors and selection diagnostics share context.max_chars. config_errors_excerpted marks configuration diagnostic prefixes; selection.diagnostics_excerpted marks error/read_error prefixes. Status, persisted identity and failing sources survive excerpts.",
    caution: "Start independent review in a fresh Session before exposure. Read current sources/evidence and record your own observations. For Action work, switch to continuation and reconcile earlier findings; without an Action, query Session history explicitly when needed (session_only:true). This controls context reads/injection, not permissions, explicit history queries, native messages or model independence. It cannot erase an existing conversation. Handoffs are ordinary kind=result records: goal/revision, decisions, evidence/limits, remaining work and next step. No report file, dispatch or approval gate is required. Pins do not certify completion; contract_match:null is unknown, and true is not code freshness. Read full records for omitted qualifications. A failed save returns selection.status=save-failed; persisted identifies the old selection, null, or persisted=\"unknown\" with read_error. The old view still controls later injection: do not assume isolation. No retry. Failed clear still throws; input/read failures are not task removal. Questions/answers can appear in continuation; this read does not dispatch or resume. The first blocking answer has a separate best-effort exact-asker resume path. Completion uses the original work_ref, not a newly fetched substitute.",
  },
  record: {
    summary: "Read exact records, store findings and progress, or ask/answer Open Questions (OQs).",
    usage: "Known ID: query with action_id+record_id, omit node_id. For just selected content use projection:fields with fields. Unknown work: loom_history read+match. Exhaust full_thread only when complete stored history is needed.\nadd: kind and statement in Action/node or Session scope. session_only:true forces Session scope. Kinds=result, claim, concern, assessment, qa; review verdicts required. evidence_ids link observations; artifact_refs are unverified pointers.\ncomplete: statement and original work_ref retained BEFORE work; never substitute newer scope. reopen: reason with Action/node.\nask: Use an Open Question for material input owned elsewhere. Investigate uncertain facts within your responsibility. For changed goal/scope/accepted risk, ask its owner; do not treat a recorded assumption as authorization. Route scope to dispatcher, judgment to role/agent, approval to user. question, Boolean blocking, exactly one of to_agent (legacy/manual), recipient {kind:agent|role|dispatcher|user,id?:string}, or session_id (verified existing native peer). Agent/role needs id; dispatcher/user no id. Dispatcher needs a child; primary user needs native interaction. Optional action_id associates another Action, not a different author; cannot combine with reference. Optional context, context_attachments, reference{action_id,kind:action|phase|wave|task|subtask,id}. Selection supplies missing association; invalid references fail. No Action/Plan needed. multi-choice requires recipient or verified session_id (never to_agent), 2-20 immutable choices[{id,answer}], and ONE selection. IDs: 1-64 case-sensitive letters/digits/_.:-, start alphanumeric; nonblank labels: 1-4000 Unicode code points. No auto-Evaluator routing.\nbind-respondent: dispatcher-only question_id/respondent_session_id for forwarded specialists after native delegation; exact parent/child, one-time. Dispatcher answers its own questions even when consulting; do not bind consultants.\nanswer: question_id plus text answer OR choice_id with optional reason OR status=cannot-select with nonblank reason. Never mix forms. Choice labels come from stored question. Optional context_attachments; retains removed-node association. Conflicts remain; cannot-select may wake, not grant decision authority; no selection needed to answer. Response is not necessarily approval or resolution; attachments/old aliases are invalid.\nquery full_thread: explicit action_id plus optional node_id OR session_id; optional cursor/limit. No selection fallback or ledger filters.",
    returns: "Writes return result.id, author/scope/time/data. Legacy to_agent dispatch is not-attempted (policy-capability-unavailable): no native contact. Typed routes delegate to a single native subagent or notify the verified parent/peer Session; only the intended Session can reply. Notice is not consumption. query view=inbox: caller-bound questions across scopes (state, after/next_after). Ambiguous roles/primary user targets need manual handling. admission-observed is input only, not execution/answer. SYSTEM outcomes are no-retry. Typed replies check bound identity/parent; identity is not user approval and blocking is no gate.\nOnly the FIRST committed blocking legacy/forwarded/explicit-Session answer can resume the asker once. Direct typed answers use native completion, not a duplicate notice. Eligible resumes have qualified outcomes; annotation failure preserves answer. Pre-creation denial is not-attempted, uncertain effects outcome-unknown.\nLedger query: items/next_after, limit=1-50 (default 30); pass next_after as after. Statements over 600 chars are excerpted; record_id reads the full record. projection=metadata: identities/sizes/counts, no data/refs. projection=fields: exact record_id and fields (statement/evidence_ids/artifact_refs/verdict/verification); absent fields appear in missing_fields. source_session_id intersects action_id or selects that Session without focus. record_kinds filters kinds. Range: after < sequence <= through; retain filters. Projections require evidence read permission; return source_store_id. Other views default to 20, max 50. progress uses Action/node or selection, offset/next_offset; states=open/reported-complete/needs-reconfirmation/validity-unknown. questions uses explicit or selected Action, optional explicit node_id/respondent, question_state=open/answered/all, after/next_after; it does NOT inherit the selected-task filter. thread needs question_id; full question, answers, next_after; optional action_id must match.\nfull_thread: readable Markdown by default (response_format=json yields scope/markdown/next_cursor). Follow next_cursor with SAME explicit scope until null. Records retain attribution/qualifications; oversized parts repeat identity, only final parts advance. Short pages may be incomplete. Cursors bind scope/location/version, not perpetual or a snapshot; corruption never advances.",
    caution: "Ledger scope: action_id without node_id searches the whole Action; otherwise selection/Session. Dependency lookup uses action_id+record_id, no node_id/after. session_only is valid for ledger query or any add, incompatible with work IDs. Pins need Action results. Empty pages prove no absence.\nLater/nonblocking answers do not wake. No retries. Live session_id delivery requires native loom.question.deliver permission for session:<target>; stock native wildcard allows are honored, while denial stores nothing. Missed peer notices remain discoverable via inbox. No recipient-read grant. Missing targets are not retargeted. 5000ms bounds waiting, not I/O. Target check is not an atomic lease.\nfull_thread reads only local authorized Store, not native Session contents. Membership requires authorship or direct replies, never notice/agent-name matches. No recursive evidence expansion. Retired delivery history remains inert.\nReported completion is not acceptance; no parent/Action cascade. Answered is not resolution, approval or permission. Typed answers check identity; relayed user decisions need sources. Preserve work_ref/Plan history and qualifications. Do not record secrets.",
  },
}

/** First line stays useful in the host's short inline catalog; search returns all lines. */
export const TOOL_HELP = Object.fromEntries(Object.entries(entries).map(([name, help]) => [name, [
  help.summary,
  `Usage: ${help.usage}`,
  `Returns: ${help.returns}`,
  `Caution: ${help.caution}`,
  ...(name === "record" ? ["Concerns: Every agent records kind=concern with suspected/confirmed evidence. Handoff is not resolved. General routes blockers; critic cites Action+record_id or Session+record_id. Concern IDs are not observation evidence_ids. Append follow-ups."] : []),
  ...(name === "record" ? ["Structured reviews: ask with typed agent/role and review:loom-review-request/v1; retain exact question, recipient, mandate and members. No context/reference fields alongside review. Loom freezes intent privately, prepares an issue, and withholds protected native delivery. Read via loom_review in the requesting Session with native permission."] : []),
  'Examples (JSON inputs; UPPERCASE values and zero hashes are placeholders, not stored IDs; replace from actual responses):',
  ...TOOL_EXAMPLES[name as LoomToolName].flatMap(input => [
    ...("operation" in input && input.operation === "ask"
      ? [input.recipient.kind === "dispatcher" ? "Ask example context: child Session only." : "Ask example context: primary Session."] : []),
    JSON.stringify(input),
  ]),
  name === "history"
    ? 'Use the callable search path. Parse JSON once; Markdown/HTML are document text.'
    : name === "record"
    ? 'Queries accept response_format:json; only full_thread supports Markdown (default). Omit format on writes. JSON wraps result/config_errors. Use search path; parse only JSON.'
    : 'JSON text wraps result and optional config_errors. In Code Mode JSON.parse once; use the callable path returned by search.',
  'Await writes before using IDs or ending Code Mode. For independent calls use Promise.allSettled and inspect every outcome; sequence dependent calls.',
].join('\n')])) as Record<LoomToolName, string>

export const LOOM_NAMESPACE_HELP = "Loom remembers optional Actions, Plans and evidence. Known record ID: record query; unfamiliar work: history read+match; exact-source objectives: objective find; approved population: history preview-population then review freeze-population. Search one relevant tool for syntax. operation is required except agents/context/lenses. Execution and permissions stay native."
