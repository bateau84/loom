# Seven tools, optional structure

Loom retains goals, context and attributed history. OpenCode owns execution,
native delegation, skills, models and permissions. A conversation needs no Action;
an Action needs no Plan. Live tool search is the syntax authority; the bundled
native `loom` guide teaches use without requiring this document to be fetched.

| Tool | Purpose |
| --- | --- |
| `loom_agents` | Existing native roster, roles, configuration/capture diagnostics |
| `loom_action` | Create/list/update a goal, or read native Session inventory and archive status |
| `loom_plan` | Read/replace optional intended work and relationships |
| `loom_context` | Read selection, explicitly select work or clear selection |
| `loom_record` | Concerns, results, claims, Assessment/QA, completion/reopen, questions/answers and history |
| `loom_assessment` | Load an installed skill’s ASSESSMENT.md; requires the enabled caller’s assessment role |
| `loom_qa` | Load an installed skill’s QA.md; requires the enabled caller’s qa role |

Responses are JSON text with `result` and optional `config_errors`. In Code Mode,
parse once; await writes before using IDs or ending the script. Sequence dependent
calls. Use `Promise.allSettled` for independent calls and inspect every outcome;
this is not an atomic multi-write transaction. Use the exact callable search path.

## Assessment and QA lenses

Call either loader with `{"skill":"software-engineering"}` using an exact native
skill ID. The existing `.loom.yaml` role mapping controls its use; agent names
and Plan roles do not grant access. Native skill allow/ask/deny still applies.
The tools return full companion content, its path and hash, or an explicit
missing-companion result. They need no Action or Plan and do not record verdicts
or dispatch work. See [companion configuration and limits](review-companions.md).

## Recover or define work

Discover the actual roster with `loom_agents {}`; role names are not guaranteed IDs.
The response includes `result.role_descriptions`, a map from role IDs to descriptions
declared in `.loom.yaml` (only where a description was set). Match keys against
`result.agents[].roles` and check `available` and `enabled` before native delegation.
The map can include roles no agent currently has. Descriptions guide selection;
they do not automatically assign work or grant permissions.
For existing work use its actual Action ID rather than creating a duplicate.
For a new persistent goal:

```json
{"operation":"create","title":"Explain a setting","goal":"Produce a source-backed explanation with limitations."}
```

Action creation selects it. `list` uses `offset`/`next_offset` (50 per page).
Updates require the Action's current `expected_revision`, not a Plan revision.
State labels active/paused/completed/cancelled do not stop execution or certify success.

With OpenCode 2.1.1, use the same tool to browse **read-only native Sessions**:

`{"operation":"sessions","action_id":"ACTION_ID","limit":20}`

The optional Action ID filters for a current Session selection or authored
Action ledger activity; omit it to list local native Sessions without an Action
filter. The result contains `sessions`, `scanned`, `matched`, and
`next_cursor`. Follow the opaque `next_cursor` with `cursor` until null,
including when a filtered page is empty. An optional `archived:true/false`
filters OpenCode's native archive state. Each entry may contain `selection`,
`has_recorded_activity`, and `archived`. This page is bounded (1–50, default 20),
location-scoped and **does not** retrieve other processes, dispatch work,
archive/unarchive Sessions, prove execution, or change Loom selection.

Read the optional Plan:

```json
{"operation":"read","action_id":"ACTION_ID"}
```

To save, pass `operation:save`, `action_id`, current Plan `expected_revision`
(0 only before first save) and the **complete** `nodes` list. Preserve stable IDs.
Nodes require `id`, `kind`, `title`; kinds are phase/wave/task/subtask. Optional
fields: `outcome`, `criteria`, `context`, `depends_on`, `parent`, `agent`, `roles`,
`skills`. At most 300 nodes; cycles/invalid references fail. Siblings do not
implicitly depend on each other. Plan saves do not dispatch, load skills, enforce
order or complete work. Reread/reconcile stale revisions, never guess a replacement.

Select work through `loom_context`:

```json
{"action_id":"ACTION_ID","node_id":"TASK_ID"}
```

Retain `result.work_ref` before working. A native delegate receives IDs, goal,
constraints, useful record IDs and the original reference, then selects its own
work. It does not inherit the parent's selection. `{}` reads current selection;
`{"clear":true}` clears it. Selection is attribution, not permission to execute.

Successful context reads survive selection-save failure with separate
`selection.status:save-failed` diagnostics and `persisted` (saved reference,
null, or `unknown` with read error). Later injection follows persisted selection,
not the unsaved request. Failed clear still throws. Removed tasks return recovery
choices; do not guess a replacement from its title. Explicit Plan/history reads
do not change selection. Context is sampled, not complete.

## Read before relying on a conclusion

Use explicit Action plus exact record ID, with no node filter, for a dependency:

```json
{"operation":"query","action_id":"ACTION_ID","record_id":"RECORD_ID"}
```

A record ID alone can inherit the selected task and miss a dependency. Ledger
pages default to 30, max 50; follow `next_after` as `after`. Statements over 600
characters are previews; exact record reads return full stored records within
read limits. `session_only:true` is ledger-only and incompatible with work IDs.
Empty filtered results are not absence proof. `contract_match:null` means unknown;
a matching contract is not code freshness or independent validation.

`add` accepts Action/node or selection, `kind:result|claim|concern|assessment|qa` and
`statement`; Assessment/QA require `verdict:pass|fail|inconclusive`. Record actual
checks, sources and limits. `evidence_ids` reference existing same-Action host
observations only; `artifact_refs` are unverified pointers. No raw tool bodies
are captured, and explicit text is not redacted: never record credentials.

### Concerns and follow-up

Every agent records its own task-related concerns, not only handoffs:

```json
{"operation":"add","action_id":"ACTION_ID","node_id":"TASK_ID","kind":"concern","statement":"Suspected incompatibility; no reproduction yet. Outside this task, not resolved."}
```

An Action association is required under existing selection rules; a task and
verdict are optional. State suspected versus confirmed with supporting checks or
unknowns. Documented, outside-task and handed-off do not mean resolved. General
routes blockers through existing native coordination; critic consolidates
patterns with source Action and concern record IDs in later statement text.
Discover actual roster IDs; built-in coordination/qa guidance carries those
responsibilities respectively, without creating or renaming agents.

For example, a later assessment can state `Suspected pattern: Action ACTION_ID
record CONCERN_ID; confirmed mismatch: Action ACTION_ID record OTHER_ID. Neither
resolved by consolidation.` Retrieve each source using the exact query above
(`action_id` plus `record_id`, no `node_id`), even while another task is selected.
Concern IDs are not valid `evidence_ids`. Follow-up appends commentary; it never
replaces the original text or origin. Context may omit or excerpt concerns under
ordinary limits; paged Action/Session full history includes eligible concerns.
No concern lifecycle, structured record links, automatic escalation or gates.

## Questions without assignment machinery

```json
{"operation":"ask","question":"Does the finding cover empty input?","to_agent":"research","blocking":true,"context":"The cited source is ambiguous.","context_attachments":["SOURCE_REFERENCE"],"reference":{"action_id":"ACTION_ID","kind":"task","id":"TASK_ID"}}
```

Required: `question`, `to_agent`, explicit Boolean `blocking`. Optional: `context`,
`context_attachments`, `reference`. Without reference, selection supplies association;
without either, the question belongs only to its asking Session. No Action, Plan,
assignment or selection is created for an unscoped ask. Explicit Action reference
requires `id=action_id`; node ID and kind must match. Invalid explicit reference
never falls back. Reference kinds are action/phase/wave/task/subtask.

On the supported OpenCode 2.0.32 host, ask stores
the question and returns
`dispatch:{status:"not-attempted",reason:"policy-capability-unavailable"}`.
The recipient is **NOT contacted**. Arrange manual native handling outside ask.
If that is arranged, a blocking asker may naturally yield. Blocking is intent,
not a gate, forced wait or statement that the recipient is working.

```json
{"operation":"answer","question_id":"QUESTION_ID","answer":"Empty input is excluded; see the source limits.","context_attachments":["SOURCE_REFERENCE"]}
```

Answer requires `question_id`, `answer`; optional `context_attachments`. Actual
author/Session derive from the caller. Association is inherited from the question,
even if nullable or its node was removed; answering does not select the asker's
work. Both canonical attachment fields are string-reference arrays. `attachments`
is never an alias, alone or alongside the canonical field. Old statement,
respondent, background and artifact_refs are not ask/answer inputs.

Only the FIRST committed answer to a new-format blocking question qualifies for
one immediate postcommit best-effort exact-asking-Session resume. Later,
nonblocking and legacy answers never submit asker input. No retries, eligibility
transfer, recovery replay or startup/read reconstruction exists; crash after
commit can permanently lose liveness. Missing/moved/inaccessible targets fail
visibly without retargeting; current native agent/model/permissions stay unchanged.
Target check is not an atomic lease. The 5000ms deadline bounds waiting, not
cancellation of started native I/O. Admission is not consumption or completion.
An eligible response's `resume` and separate SYSTEM annotation qualify the outcome;
annotation failure cannot erase the answer or undo I/O. Never repeat an answer
to try delivery. Read [full outcome details](collaboration.md#one-shot-first-answer-resume).

## Query views and complete history

| View | Scope / continuation |
| --- | --- |
| `ledger` (default) | Explicit Action/node or selection, otherwise caller Session; `after`/`next_after` |
| `progress` | Action/node or selection; `offset`/`next_offset` |
| `questions` | Explicit/selected Action, optional explicit node/respondent, question_state open/answered/all; `after`/`next_after`; does not inherit task filter |
| `thread` | Required question_id, optional matching action_id; full question plus paged answers, `after`/`next_after`; no selection required |
| `full_thread` | Explicit Action/node OR Session; `cursor`/`next_cursor`; no selection fallback |

Views other than ledger default to 20, max 50. For full stored relational history:

```json
{"operation":"query","view":"full_thread","action_id":"ACTION_ID","node_id":"TASK_ID","limit":20}
```

Or use `session_id` instead of Action/node. Response: `format:loom-full-thread/v1`,
`scope`, escaped `markdown`, `next_cursor`. Follow `next_cursor` as `cursor` with
the same explicit scope until null. Do not combine scopes or pass ledger-only
after/session_only/record_id options. It reads the authorized local Loom Store,
not native Session bodies or cross-project databases. Session membership is
authored records/direct question-answer relations including later answers, not
notice destination, admission, assignments or agent-name equality.

Records are deduplicated, sequence-ordered and include full stored content, true
authors/Sessions/times, IDs, links, verdicts, attachment/evidence references,
observation metadata and historical Plan/work_ref qualifications. No recursive
evidence expansion or fabricated raw bodies. Oversized records have labelled
parts with repeated identity; only the final part advances the record. A short
page may still be incomplete. Cursors are scope/location/version-bound, not
perpetual or a frozen concurrent snapshot. Corrupt/unsupported data fails without
advancing; read limits remain. General assignment/delivery operations AND views
are retired; old records remain readable and inert, not current consent.

## Complete and reopen honestly

`complete` takes a truthful `statement` and the exact original retained `work_ref`,
not a fresh reference fetched to relabel old work. Optional `artifact_refs` are
unverified. All node kinds use it; no parent/Action completes automatically.
Original `work_goal`, revisions and qualifications stay in history. Progress is
open/reported-complete/needs-reconfirmation/validity-unknown, not independent
acceptance. `reopen` appends a reason for explicit/selected node; history is not
erased and native side effects are not undone. An answer is a response, not
resolution/approval/permission. Use external professional/review skills natively.

See [operating limits](operating-policy.md), [read consistency](read-consistency.md)
and [manual stopped-writers backup/restore](manual-backup-restore.md). No read view
promises unlimited readable history or automatic storage repair.
