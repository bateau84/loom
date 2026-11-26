# Loom usage guide

## Keep Loom optional

A conversation needs no Action. An Action needs no Plan. OpenCode owns Sessions, execution, delegation, skills, models and permissions.
Loom retains intent/history, not a scheduler. Roles restrict companion loaders.

## Find the right tool

| Tool | Purpose and boundary |
| --- | --- |
| `loom_agents` | Native IDs, roles and diagnostics; no permission grants. |
| `loom_action` | Goals and Session inventory; state labels are not execution controls or proof. |
| `loom_trace` | Authorized Session structure, tool-part metadata and permitted fields. |
| `loom_history` | Discover/expand work; shared JSON, Markdown and HTML dashboard. |
| `loom_plan` | Read/replace optional nodes; no dispatch or skill loading. |
| `loom_context` | Select work, pin a result handoff or limit prior opinions during independent review. |
| `loom_record` | Store/query concerns, claims, results, reviews, progress, questions and history. |
| `loom_review` | Protected mandates, evidence links and Evaluator preparation; no unqualified delivery. |
| `loom_insights` | Observations, deterministic evaluations, preparation/admission; no genuine reasoning. |
| `loom_objective` | Link original goal sources, attempts and verification; no proof. |
| `loom_trends` | Compare source-started objectives with frozen membership and evidence bounds; no inferred exposure or agent grade. |
| `loom_tweak` | Store fingerprinted tweak proposals and trials; no activation. |
| `loom_assessment` | Load ASSESSMENT.md; requires configured assessment role. |
| `loom_qa` | Load QA.md; requires configured qa role. |

Tool search supplies syntax and callable paths. JSON contains `result` and optional `config_errors`. Record queries accept `response_format:json`; omit format on writes. Assessment/QA and `full_thread` default to Markdown; `loom_history` defaults to JSON and accepts Markdown/HTML. Parse only JSON; join Markdown lenses into one string. Await writes; inspect Promise.allSettled failures.

## Start or resume work

Actions support cross-agent/Session continuity; Plans meaningful dependencies, distinct tasks or resumption needs. Chat needs neither.

Use `loom_agents {}`: match `agents[].roles` to `role_descriptions`; check `available`/`enabled` and delegate natively. Reuse Action IDs or list them (next_offset). Create an Action:

```json
{"operation":"create","title":"Explain a setting","goal":"Produce a source-backed explanation with its limitations."}
```

`result.id` is Action ID. Action sessions lists native Sessions, not execution proof. Read the Plan before edits:

```json
{"operation":"read","action_id":"ACTION_ID"}
```

Save the complete node list with `expected_revision` (0 initially); preserve IDs, reconcile conflicts. Action updates use the Action's separate current revision. Plan `saved_by` identifies author. Use `outcome` for capability, `criteria` for proof, `context` for scope/limits. Phases/waves group intended work; dependencies express order, not scheduling.

Delegated planning: select, read/save Plan, return next outcome, proof and Action/revision/node IDs. Chat/docs are not Plan storage. Without Action ID, propose only. Report failed saves.

Select before work:

```json
{"action_id":"ACTION_ID","node_id":"TASK_ID"}
```

Retain original `work_ref`. Give delegates Action/task IDs, goal, constraints, record IDs and reference. Each child selects its own work; selection is not inherited.

### Handoffs and independent first review

Record `kind:result` handoffs: goal/revision, decisions, evidence/limits, learning, next step. Pass ID, not chat. Pin same-Action `handoff_id`; read exact record. A pointer does not prove completion.

For independent Assessment, start a fresh Session and select `mode:"independent"` before reading opinions. This withholds history from context, not explicit reads or native messages/task text. Without Action, no selection is saved. Record original findings before switching to continuation and reconciling prior opinions. Mode persists; default continuation. Save failure leaves old mode.

## Read evidence before using conclusions

Context is bounded. Read full records before relying on material conclusions. For known Action records:

```json
{"operation":"query","action_id":"ACTION_ID","record_id":"RECORD_ID","response_format":"json"}
```

Omit node filter. Without Action ID, selection may apply. For known Session records use `source_session_id`+`record_id` with native read permission. Empty results prove no absence. `contract_match:null` means unknown; matches do not prove correctness.

### Investigate historical work selectively

Use `loom_history` for a known Action or Session. With a known question, search before paging:

```json
{"operation":"read","action_id":"ACTION_ID","match":"timeout"}
```

Use `session_id` instead for Session scope. Combine literal `match` with category, verdict, Session, node, revision or gap selectors. Follow `expand` with operation:read; retain selectors/`through` with `next_after` or `next_branch_offset`. Use `source.query` via `loom_record` for exact originals. Historical WorkRefs differ from current Plan; without Plan use observed groups or labelled chronology. Highlights aren't exhaustive; counts cover recorded activity. Claims/reviews aren't verification. Preserve failures, contradictions and gaps. References grant no access; scope and contributor permissions apply. Native originals, protected review/objective links and frozen populations remain separate. `through` is an append bound, not a frozen population. Enumerate ledger/thread only for completeness; ledger next_after as after.

`add`: result preserves work, claim states conclusions. Retain sources, qualifications, unknowns and next steps, not activity logs. `evidence_ids` cite same-Action observations or same-Session unscoped observations for Session records. `artifact_refs` are pointers, not proof.

Observations hold identities/digests, not raw bodies. Missing/unpaired observations prove neither success nor failure. `session_only:true` query reads caller history including Action-linked records; add forces Session scope (default without selection). Neither accepts work IDs. Never record credentials or secrets: explicit text is not redacted.

## Preserve and route concerns

Every agent records task concerns (kind:concern) with suspected/confirmed status, support and unknowns. Documented/handed-off is not resolved. General routes blockers; critic compares patterns, not dispatches. Cite Action+record or Session+record IDs; read originals as above. Concern IDs are not observation evidence_ids. Append follow-ups; no automatic escalation or gates.

## Complete, review and reopen honestly

`loom_record complete` needs original `work_ref` and actual outcome; never substitute a newer reference. Result alone is not completion. Check `view:progress`; changed contracts may need reconfirmation, unrelated replanning does not erase history. Completion never completes parent/Action or proves acceptance.

Choose review skills independently. Assessment checks conformance; QA challenges failures. `loom_assessment`/`loom_qa` use exact IDs, role and native permission, not Action/Plan/receipt. Load ASSESSMENT.md/QA.md; missing returns `available:false`, never SKILL.md. Lens load or reported pass does not establish independent acceptance. Record actual pass/fail/inconclusive findings; no gate.

`reopen` appends reason, not undo. Update Action state separately; paused/cancelled labels do not stop execution.

## Questions: route material unknowns

Investigate facts within your responsibility. Use `loom_record ask` for input owned elsewhere, not a concern/handoff. If a choice changes the goal, scope, promised behavior or accepted risk, ask its owner; do not treat a recorded assumption as authorization. Scope: dispatcher; judgment: role/agent; intent/approval: user. Do not manufacture OQs.

Ask needs `question`, `blocking`, and one of typed `recipient`, verified
`session_id`, or legacy `to_agent`. Recipient: agent/role (requires id)
or dispatcher/user.
`action_id` associates work without changing selection; never combine with `reference`.
The caller remains author. Peer delivery needs native `loom.question.deliver` for
`session:<ID>` under caller policy, honoring native allows. Denial stores nothing;
answer ownership is separate. Dispatcher needs a child.

```json
{"operation":"ask","question":"Which limit applies?","recipient":{"kind":"role","id":"research"},"blocking":false}
```

Legacy recipient is NOT contacted (`policy-capability-unavailable`). Typed routing
uses native depth, permissions and continuation; admission is not execution.
For dispatcher targets, answer directly even after consultation, without binding.
For forwarded agent/role OQs, natively delegate and bind the verified child.
For user targets, ask the user and cite their actual decision.

```json
{"operation":"answer","question_id":"QUESTION_ID","answer":"Source-backed response.","context_attachments":["SOURCE_REFERENCE"]}
```

`answer_type` defaults to `text`. `multi-choice` needs typed `recipient` or verified
`session_id`, never `to_agent`, and 2-20 immutable `{id,answer}` choices.
Reply with ONE `choice_id` plus optional `reason`, never `answer`;
or `status:"cannot-select"` with a reason. Read `view:thread`.
An answer is not necessarily approval or resolution. Conflicts remain.
`view:inbox` finds your Session's questions after missed notices/restart,
without selecting work. Only FIRST committed blocking legacy/forwarded/explicit-Session
answers attempt exact-asker resume. No retries/replay. 5000ms bounds waiting, not I/O;
the check is not an atomic lease. Do not repeat an
answer to try delivery. Historical records are readable; assignment/delivery views retired.

## Deep retrospective evidence

Use `loom_trace`: timeline (caller post-compaction context or authorized export), children (direct; historical access needs permission), parts (tool metadata), source (exact fields). Raw fields and input/output matching are caller-context only; export/cross-Session reads permit structural/status/dispatch data under authority. Follow `next_cursor`; pin source/part hashes. Native history incomplete; export authenticity unverified. Code Mode may hide nested calls; masking is best effort. Cite IDs/gaps; never store raw transcripts or secrets.

## Complete stored history

For deliberately complete relational ledger history:

```json
{"operation":"query","view":"full_thread","action_id":"ACTION_ID","node_id":"TASK_ID","limit":20}
```

Alternatively `session_id`, never Action/node; no selection fallback. Local authorized Store, not native bodies. Membership follows authorship/direct question-answer links, not notices or agent names. `full_thread` defaults to Markdown with scope/`next_cursor`; JSON wraps these in `result`. Follow same scope until null (limit 20, max 50); oversized records advance only on final part. Cursor binds scope/location/version, not a snapshot. Invalid data fails without advancing.

## Recover without guessing

When a task is removed, inspect the returned recovery information, current Plan
and retained history. Explicitly select a current task, select Action-only context
or call `loom_context` with `{"clear":true}`. Do not infer a replacement task from
a similar title. `loom_context` with `{}` reads this Session's existing selection.

Context reads survive selection-save failure. Inspect `selection.status:"save-failed"` and `persisted` (reference, null or "unknown"); injection follows persisted state. Failed clear throws; unreadable context is not missing-task recovery. Explicit Plan/ledger reads do not select work. Do not assume the selection changed after an error. Native permissions apply. Pass evidence and limits, not approval claims.
