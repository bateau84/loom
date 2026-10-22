# Loom usage guide

Use for Loom coordination/resumption. Load engineering skills separately.

## Keep Loom optional

A conversation needs no Action. An Action needs no Plan. Use only structure
that helps recover useful work. OpenCode owns Sessions, execution, delegation,
skills, models and permissions. Loom records intent, context and history; it is
not a scheduler. Do not invent mandatory stages or legacy tools. Role checks
restrict only the companion loaders, not native execution.

## Find the right tool

| Tool | Purpose and boundary |
| --- | --- |
| `loom_agents` | Native IDs, roles and diagnostics; no permission grants. |
| `loom_action` | Goals and read-only Session inventory. Creation selects; state labels do not stop execution or certify success. |
| `loom_plan` | Read/replace optional nodes; no dispatch or skill loading. |
| `loom_context` | Select work, pin a result handoff or limit prior opinions during independent review. |
| `loom_record` | Store/query concerns, claims, results, reviews, progress, questions and history. |
| `loom_assessment` | Load ASSESSMENT.md; requires configured assessment role. |
| `loom_qa` | Load QA.md; requires configured qa role. |

Tool search supplies schemas/help. Tools return JSON with `result` and optional
`config_errors`. Await writes before using IDs or ending Code Mode. Sequence
dependent calls; use Promise.allSettled for independent calls and inspect outcomes.

## Start or resume work

Use `loom_agents {}`: match `agents[].roles` to `role_descriptions`.
Check `available`/`enabled`; delegate natively.

For existing work, recover its Action ID from the handoff or `loom_action`
list; an unselected Session is not a reason to duplicate it.
For new work worth retaining, create a goal:

```json
{"operation":"create","title":"Explain a setting","goal":"Produce a source-backed explanation with its limitations."}
```

Replace placeholders with returned IDs; `result.id` is the Action ID.
Use `loom_action` operation `sessions` for local Sessions, optionally filtered
by `action_id`. Follow `next_cursor`. Archive state is read-only;
no execution or delivery is proven.

Read the current optional Plan before changing it:

```json
{"operation":"read","action_id":"ACTION_ID"}
```

A Plan is intended work, not an activity log. Nodes have `id`, `kind` and `title`;
optional fields are `outcome`, `criteria`, `context`, `depends_on`, `parent`,
`agent`, `roles` and `skills`. Kinds are phase, wave, task and subtask.
Hierarchy is optional. Siblings do not implicitly depend on each other.
`depends_on` helps select relevant context; it does not enforce execution.

Save the complete node list using the returned Plan revision as
`expected_revision`. Preserve unchanged IDs. Revision 0 is only for an unsaved
Plan. Action updates require the Action's separate current revision. On a
conflict, reread and reconcile; do not blindly overwrite or borrow a revision.

Explicitly select the work before performing it:

```json
{"action_id":"ACTION_ID","node_id":"TASK_ID"}
```

Retain `work_ref`, the definition actually worked against. Give native delegates
the Action/task IDs, goal, constraints, record IDs and original reference.
Each child selects its own work; selection is not inherited.

### Handoffs and independent first review

At a useful stopping point, write one ordinary `kind:result` with the goal,
source revision, decisions, evidence and limits, unfinished work and next step.
Pass its exact record ID, not the whole conversation. A continuation can select
`loom_context` with `handoff_id:"RESULT_ID"` and the destination Action/task;
this pins a same-Action result, even from a dependency. Read it in full using
`loom_record` with `action_id` and `record_id` **without `node_id`**. Pins are
pointers, not proof of correctness, currency or completion.

For an independent first assessment, start a fresh Session and select
`loom_context` with `mode:"independent"` **before reading prior opinions**.
This hides Loom ledger/review/progress/question history from both context reads
and automatic injection; it cannot erase native messages or task text. After
recording original findings, switch to `mode:"continuation"` and reconcile
unresolved earlier findings before the final verdict. A follow-up review may
start with prior findings. Saved mode persists; default remains continuation.
Selection-save failure means the old view may still inject. See
[handoff limits and recovery](../../../docs/handoffs.md).

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
`evidence_ids` must be real same-Action host observation IDs; `artifact_refs`
are pointers, not proof. Missing evidence stays missing.

Observations hold identity/digests, not raw input/output. Missing or unpaired
observations prove neither success nor failure. `session_only:true` reads
Session history without selection and cannot combine with work IDs.
Do not record credentials or secrets: explicit text is not redacted.

## Preserve and route concerns

Every agent records task concerns with `kind:concern` and a factual `statement`.
Distinguish suspected from confirmed and give its sources or unknowns.
Documented, outside-task or handed-off is not resolved. General routes
blockers; critic compares patterns without pretending to dispatch agents.
Use actual configured roles. Cite immutable Action and concern record IDs;
retrieve sources with explicit `action_id` and `record_id`, no `node_id`.
Concern IDs are not observation `evidence_ids`. Append follow-ups rather
than altering history. No automatic escalation or execution gates.

## Complete, review and reopen honestly

Report completion with `loom_record complete`, the original `work_ref`, and the
actual outcome. Do not fetch a newer reference to make old work look current.
A `result` alone is not completion. Query `view:progress` for reported progress
and contract matching. Changed contracts may need fresh work or reconfirmation;
unrelated replanning does not erase history.

Completion does not complete parents or the Action and does not establish
independent acceptance. Assessment/QA verdicts are `pass`, `fail`, `inconclusive`.
Choose relevant skills independently of the producer's list. Call
`loom_assessment {"skill":"SKILL_ID"}` for ASSESSMENT.md or `loom_qa` for QA.md.
The enabled caller needs the corresponding configured role and native skill
permission; no Action, Plan or prior load receipt is required. Load practitioner
guidance natively when useful. Missing companions return `available:false`, not
SKILL.md. Loading a lens or storing PASS does not prove independent review or
Action-wide success. Record actual findings separately with `loom_record`.

`reopen` appends a reason without erasing history or undoing native side effects.
Update Action state separately; paused/cancelled labels do not stop execution.

## Questions and manual native handling

Ask with `question`, `to_agent`, explicit Boolean `blocking`; optional `context`,
`context_attachments` (references), `reference:{action_id,kind:action|phase|wave|task|subtask,id}`.
Association defaults to selection, otherwise asking Session only; no Action/Plan
required. Invalid explicit references never fall back: Action/node IDs and kind
must match.

```json
{"operation":"ask","question":"Which limit applies here?","to_agent":"research","blocking":false,"context_attachments":["SOURCE_REFERENCE"]}
```

On pinned OpenCode 2.1.1 the question is saved, but the recipient is NOT contacted.
Inspect `dispatch:{status:not-attempted,reason:policy-capability-unavailable}`.
Arrange manual handling outside ask; a blocking asker may yield after it is
arranged. Blocking is intent, not a wait, approval or gate; nonblocking work continues.

Answer with `question_id`, `answer`, optional `context_attachments`. Caller supplies
actual author/Session. Original nullable association survives node removal without
selecting asker's work. Conflicting answers remain. `attachments` is never an alias;
old statement/respondent/background/artifact_refs are not ask/answer inputs.

```json
{"operation":"answer","question_id":"QUESTION_ID","answer":"Read the source and its limitations.","context_attachments":["SOURCE_REFERENCE"]}
```

Only the FIRST committed answer to a new-format blocking question qualifies
for one immediate best-effort resume of its exact asking Session. Later,
nonblocking and legacy answers never retry input or transfer eligibility.
Missing or moved targets fail without retargeting; native agent/model/permissions
remain unchanged. Validation is not an atomic lease; the 5000ms deadline only
bounds waiting, not cancellation of already-started native I/O. Admission is
not processing or completion; timeout can leave outcome unknown. No retries,
replay or startup reconstruction; a crash can permanently lose resume. Do not repeat an
answer to try delivery.

The answer remains durable independently. An eligible response includes `resume`
status/IDs/qualification and a separate SYSTEM annotation; annotation failure
does not erase the answer. Read `view:thread` for authoritative answers.
Answered means response, not resolution, approval or permission.

Assignment/delivery operations AND views are retired. Historical records stay
readable/inert, not current consent. No startup sender or retry engine exists.

## Complete stored history

```json
{"operation":"query","view":"full_thread","action_id":"ACTION_ID","node_id":"TASK_ID","limit":20}
```

Alternatively use `session_id`, never alongside Action/node; there is no
selected-scope fallback. Reads the current authorized Loom Store, not native
Session bodies or cross-project databases. Membership uses authorship and direct
question/answer relations, not notices, assumed agent identity or delivery.

The response is `format:loom-full-thread/v1` with escaped `markdown` and
`next_cursor`. Follow `next_cursor` as `cursor` with the same scope until null.
Pages may be partial even below limit 20 (maximum 50). Record identity, sequence,
authors, links, verdicts, evidence metadata and historical work references are
retained. Oversized records repeat their identity; advance only on the final
part. No recursive source expansion or invented raw tool output. Cursors depend
on scope/location/version and do not promise a concurrent snapshot. Invalid
history fails without advancing; reducing page size cannot admit an invalid
individual record.

## Recover without guessing

When a task is removed, inspect the returned recovery information, current Plan
and retained history. Explicitly select a current task, select Action-only context
or call `loom_context` with `{"clear":true}`. Do not infer a replacement task from
a similar title. `loom_context` with `{}` reads this Session's existing selection.

Successful reads survive selection-save failures. Inspect
`selection.status:"save-failed"` and `persisted` (saved reference, null or
"unknown"), not the unsaved request. Automatic context still uses the persisted
selection; do not assume the selection changed after an error. Failed clear
also fails; unreadable context is not a missing-task recovery. Explicit Plan
and ledger reads do not change selection. Injection is optional; obey native
denials. Pass useful references and actual verification limits, not delivery or
readiness claims. See [handoff recovery](../../../docs/handoffs.md).
