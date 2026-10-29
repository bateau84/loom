# Loom usage guide

## Keep Loom optional

A conversation needs no Action. An Action needs no Plan. OpenCode owns
Sessions, execution, delegation, skills, models and permissions. Loom records
intent, context and history; it is not a scheduler. Role checks restrict only
companion loaders, not native execution.

## Find the right tool

| Tool | Purpose and boundary |
| --- | --- |
| `loom_agents` | Native IDs, roles and diagnostics; no permission grants. |
| `loom_action` | Goals and Session inventory; state labels are not execution controls or proof. |
| `loom_trace` | Read-only native Session timeline or direct child Session inventory; never claims full history from post-compaction context. |
| `loom_plan` | Read/replace optional nodes; no dispatch or skill loading. |
| `loom_context` | Select work, pin a result handoff or limit prior opinions during independent review. |
| `loom_record` | Store/query concerns, claims, results, reviews, progress, questions and history. |
| `loom_assessment` | Load ASSESSMENT.md; requires configured assessment role. |
| `loom_qa` | Load QA.md; requires configured qa role. |

Tool search provides syntax. Structured outputs use JSON with `result` and optional `config_errors`.
Assessment/QA and `full_thread` return Markdown by default; pass `response_format:"json"` for scripts.
Only JSON outputs should be passed to JSON.parse. Await writes; sequence dependent calls.
Use Promise.allSettled for independent calls and inspect outcomes.

## Start or resume work

Use `loom_agents {}`: match `agents[].roles` to `role_descriptions`.
Check `available`/`enabled`; delegate natively.

Reuse handed-off Action IDs or find via `loom_action` list. To create an Action:

```json
{"operation":"create","title":"Explain a setting","goal":"Produce a source-backed explanation with its limitations."}
```

Use `result.id` as Action ID. `loom_action sessions` finds local Sessions, optionally by Action, with paging; it does not prove execution.

Read the Plan before edits:

```json
{"operation":"read","action_id":"ACTION_ID"}
```

A Plan has optional phase/wave/task/subtask nodes. Required: `id`, `kind`, `title`; optional: `outcome`, `criteria`, `context`, `depends_on`, `parent`, `agent`, `roles`, `skills`. Save the complete node list with Plan `expected_revision` (0 for a new Plan), retain IDs and reconcile conflicts. Action updates use the Action's separate current revision. New revisions record native `saved_by` Session/agent.

For delegated planning with `action_id`, select it via `loom_context`, read/save with `loom_plan`, and return Action ID, revision and node IDs. General verifies the saved Plan. Chat or `docs/plan/` alone is not Plan storage. Without an ID, propose without inventing an Action; report save failures.

Explicitly select the work before performing it:

```json
{"action_id":"ACTION_ID","node_id":"TASK_ID"}
```

Retain `work_ref`, the definition actually worked against. Give native delegates
the Action/task IDs, goal, constraints, record IDs and original reference.
Each child selects its own work; selection is not inherited.

### Handoffs and independent first review

Write a `kind:result` handoff with goal/revision, decisions, evidence, limits and next step. Pass its ID, not the chat. `loom_context` can pin a same-Action `handoff_id:"RESULT_ID"` to destination Action/task, including dependency results. Read it with `loom_record` using `action_id` and `record_id`, without `node_id`. A pointer is not proof of completion.

For independent Assessment, start a fresh Session and call `loom_context` with `mode:"independent"` before reading prior opinions. Without an Action, this returns Session-only context with history withheld and no saved selection; no Action is needed. Action-linked independent mode hides Loom ledger/review/progress/question history from reads and injection, but cannot erase native messages, task text or earlier conversation. After original findings, Action-linked reviews can use `mode:"continuation"` to reconcile earlier findings. Without an Action, use `loom_record query` with `session_only:true` to inspect Session history as needed. Action modes persist; default is continuation. A failed selection save leaves the old mode in effect. See [handoff limits and recovery](../../../docs/handoffs.md).

## Read evidence before using conclusions

Context is bounded and may contain excerpts. Read full material records before
using their conclusions, especially their conditions, uncertainty and failures.
To retrieve a dependency record, name the Action without a node filter:

```json
{"operation":"query","action_id":"ACTION_ID","record_id":"RECORD_ID"}
```

A record ID may inherit a task filter; empty results prove no absence.
Follow ledger `next_after` as `after` until null; Action lists use `next_offset`.
Read exact records for full statements. `contract_match:null` means unknown;
matching work definitions do not prove code correctness.

Use `add`: `result` describes observed work; `claim` records a supported
conclusion with its limits. Keep checks and sources, not activity logs.
`evidence_ids` must cite same-Action host observations for Action records,
or unscoped observations from the same Session for Session-only records.
`artifact_refs` are pointers, not proof. Missing evidence stays missing.

Observations hold identity/digests, not raw input/output. Missing or unpaired
observations prove neither success nor failure. `session_only:true` on a query
reads the caller's Session history, including Action-linked records. On an
`add`, it forces Session scope for all five record kinds, even with a
selected Action; without selection, Session scope is the default. Neither
use accepts work IDs.
Do not record credentials or secrets: explicit text is not redacted.

## Preserve and route concerns

Every agent records task concerns with `kind:concern` and a factual `statement`.
Distinguish suspected from confirmed and give its sources or unknowns.
Documented, outside-task or handed-off is not resolved. General routes
blockers; critic compares patterns without pretending to dispatch agents.
Use actual configured roles. Cite Action+record IDs, or Session+record IDs for unscoped concerns.
Read Action records by `action_id`+`record_id` (no `node_id`);
Session records by `full_thread`+`session_id`.
Concern IDs are not observation `evidence_ids`. Append follow-ups rather
than altering history. No automatic escalation or execution gates.

## Complete, review and reopen honestly

Report completion with `loom_record complete`, the original `work_ref`, and the
actual outcome. Do not fetch a newer reference to make old work look current.
A `result` alone is not completion. Query `view:progress` for reported progress
and contract matching. Changed contracts may need fresh work or reconfirmation;
unrelated replanning does not erase history.

Completion does not complete parents or Actions and does not establish independent acceptance. Assessment/QA verdicts are `pass`, `fail`, `inconclusive`. Choose skills independently of the producer. Call `loom_assessment {"skill":"SKILL_ID"}` for ASSESSMENT.md or `loom_qa` for QA.md. The enabled caller needs its role and native skill permission; no Action, Plan or prior skill receipt is required. Missing companions return `available:false`, never SKILL.md. A PASS or loaded lens does not prove independence or Action success. Record findings with `loom_record`: with no Action, review verdicts are stored under the calling Session, as are results, claims and concerns. Use `session_only:true` to override a selected Action; Session-only evidence IDs must refer to unscoped observations from that Session. No workflow gate is created.

`reopen` appends a reason without erasing history or undoing native side effects.
Update Action state separately; paused/cancelled labels do not stop execution.

## Questions and manual native handling

Ask with `question`, `to_agent`, Boolean `blocking`; optional `context`, `context_attachments`, `reference:{action_id,kind:action|phase|wave|task|subtask,id}`. Defaults to selected work or asking Session. Invalid references fail closed.

```json
{"operation":"ask","question":"Which limit applies here?","to_agent":"research","blocking":false,"context_attachments":["SOURCE_REFERENCE"]}
```

On pinned OpenCode 2.1.1 the recipient is NOT contacted: `dispatch:{status:not-attempted,reason:policy-capability-unavailable}`. Arrange manual/native handling separately. Blocking intent is not a wait or approval.

Answer with `question_id`, `answer`, optional `context_attachments`; actual author/Session come from the host. Association survives task removal; conflicting answers remain. No `attachments` alias or legacy answer inputs.

```json
{"operation":"answer","question_id":"QUESTION_ID","answer":"Read the source and its limitations.","context_attachments":["SOURCE_REFERENCE"]}
```

Only the FIRST committed answer to a new blocking question may attempt one best-effort resume of the exact asker Session. No retries or startup replay; later/nonblocking/legacy answers do not resume. Missing or moved targets fail closed; agent/model/permissions unchanged. Validation is not an atomic lease. The 5000ms bound limits waiting, not started input. Admission is not processing or completion; timeout may leave outcome unknown. Do not repeat an answer to try delivery.

Answers survive resume or annotation failure. Use `view:thread` for replies. Answered is not resolution, approval or permission. Assignment/delivery operations AND views are retired. Historical records remain readable/inert, never current consent. No automatic sender exists.

## Deep retrospective evidence

Use `loom_trace` `timeline` for user/tool/skill/dispatch events and `children` for direct child Sessions; page relevant results. Native context is post-compaction only. A local `export_path` requires read permission; completeness is unverified (`coverage.full_history:null`). `include_text:true` adds excerpts. Cite IDs and missing evidence; never store raw transcripts or secrets.

## Complete stored history

```json
{"operation":"query","view":"full_thread","action_id":"ACTION_ID","node_id":"TASK_ID","limit":20}
```

Alternatively use `session_id`, never alongside Action/node; there is no
selected-scope fallback. Reads the current authorized Loom Store, not native
Session bodies or cross-project databases. Membership uses authorship and direct
question/answer relations, not notices, assumed agent identity or delivery.

`full_thread` returns Markdown by default, with scope and `next_cursor` at the top. Use
`response_format:"json"` for `result.format`, `markdown`, `scope` and `next_cursor`.
Follow the same scope to null; a short page can be incomplete (limit 20, max 50).
Records include identity, authors, sequence, verdicts, evidence and old work references;
oversized records advance only on their final part. No recursive source expansion or
invented raw output. Cursors depend on scope/location/version, not a concurrent
snapshot. Invalid data fails without advancing.

## Recover without guessing

When a task is removed, inspect the returned recovery information, current Plan
and retained history. Explicitly select a current task, select Action-only context
or call `loom_context` with `{"clear":true}`. Do not infer a replacement task from
a similar title. `loom_context` with `{}` reads this Session's existing selection.

Successful context reads survive selection-save failures. Inspect `selection.status:"save-failed"` and `persisted` (saved reference, null or "unknown"); later injection follows persisted state. A failed clear throws; unreadable context is not missing-task recovery. Explicit Plan/ledger reads do not modify selection. Do not assume the selection changed after an error unless confirmed. Native permissions still apply. Pass honest evidence and limits, not approval claims. See [handoff recovery](../../../docs/handoffs.md).