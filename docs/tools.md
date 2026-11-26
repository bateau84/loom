---
type: API Reference
title: "Fourteen tools, optional structure"
description: "Documents Loom tools, input contracts, scopes and failure semantics."
tags: [loom, tools, api]
timestamp: 2026-10-24T00:00:00Z
---

# Fourteen tools, optional structure

Loom retains goals, context and attributed history. OpenCode owns execution,
native delegation, skills, models and permissions. A conversation needs no Action;
an Action needs no Plan. Live tool search is the syntax authority; the bundled
native `loom` guide teaches use without requiring this document to be fetched.
Use an Action when substantive work needs continuity across agents or Sessions;
use a Plan when dependencies, distinct tasks or resumption needs make structure
useful, not simply because work takes multiple steps.

| Tool | Purpose |
| --- | --- |
| `loom_agents` | Existing native roster, roles, configuration/capture diagnostics |
| `loom_action` | Create/list/update a goal, or read native Session inventory and archive status |
| `loom_trace` | Inspect authorized original Session messages and child identities; state coverage gaps |
| `loom_history` | Start with a compact recorded-work overview; expand historical branches and render the same authorized view as JSON, Markdown or HTML |
| `loom_insights` | Read bounded observational Action/project ledger metadata; no success-rate claims |
| `loom_objective` | Recover one source-linked objective, child-agent handbacks, runtime checks and corrective attempts |
| `loom_trends` | Compare a bounded, explicitly selected objective population over source-start and reporting windows; no causal verdict |
| `loom_tweak` | Preserve provisional fingerprinted tweak proposals and trials; never activate them |
| `loom_plan` | Read/replace optional intended work and relationships |
| `loom_context` | Read selection, explicitly select work or clear selection |
| `loom_record` | Concerns, results, claims, Assessment/QA, completion/reopen, questions/answers and history |
| `loom_review` | Privately freeze, read and relate protected review mandates; unqualified recipient-specific delivery stays withheld |
| `loom_assessment` | Load an installed skill’s ASSESSMENT.md; requires the enabled caller’s assessment role |
| `loom_qa` | Load an installed skill’s QA.md; requires the enabled caller’s qa role |

Structured responses remain JSON text with `result` and optional `config_errors`.
`loom_history` defaults to JSON and returns document text directly for explicit
`response_format:"markdown"` or `"html"`.
The Assessment/QA loaders and `loom_record` `view:full_thread` return
**Markdown by default**, because they contain readable documents or history.
Use `response_format:"json"` on those calls for the original JSON envelope,
including exact metadata and cursors. In Code Mode, JSON.parse only JSON
responses. Join multiple Markdown lens responses into one string rather than
returning an array (which Code Mode JSON-escapes), and surface each failed call.
Direct tool calls already return Markdown. Await writes before using IDs or ending the script. Sequence dependent
calls. Use `Promise.allSettled` for independent calls and inspect every outcome;
this is not an atomic multi-write transaction. Use the exact callable search path.

## Progressive engineering history

Start with one known Action or Session, without enumerating child Sessions:

```json
{"operation":"read","action_id":"ACTION_ID"}
```

```json
{"operation":"read","session_id":"SESSION_ID"}
```

To find older work outside the initial overview, use question terms and known
categories. Selectors run over the eligible authorized scope before paging:

```json
{"operation":"read","action_id":"ACTION_ID","match":"timeout","record_kinds":["concern","assessment"]}
```

`match` is a literal ASCII-case-insensitive substring (1–200 characters), not a
wildcard or semantic search. Optional `verdict`, `source_session_id`, `node_id`,
`plan_revision` and `has_gaps` selectors combine with AND. `plan_revision` matches
established WorkRefs only; fingerprints cannot establish a report's exact Plan
revision. `has_gaps:true` discovers recorded attribution or work-scope gaps.

Call `loom_history` with `operation:"read"` plus a returned branch or record's
`expand` query to inspect that group. Historical Plan revisions have actionable
ancestor containers; Sessions contain observed message groups or explicitly
analytical chronology. Related branches can share a captured subject fingerprint
without asserting the same revision or invocation.

Keep selectors and `through` when paging matching/branch records with
`after:coverage.next_after`, or immediate children with
`branch_offset:coverage.next_branch_offset`. New work appears on a fresh read;
these bounds are not frozen retrospective membership. `record_id` retrieves that
record with branch context. Exact original references contain the separately
authorized `loom_record` query. Focused reads omit unrelated global branches and
the current intended Plan; coverage distinguishes scoped totals, matches and
omissions.

The JSON, Markdown and HTML dashboard share identifiers, relationships and
coverage. The dashboard expands included content with native disclosure controls;
deeper requests are shown as copyable tool inputs. It has no network requests,
automatic refresh, default file write or separate persistence. An explicit save
uses the host's authorized file writer.

The requested scope and every contributing Session require native discovery,
inspection and disclosure permission for `engineering-history`. Every format is
bounded and passes the final assertion on its exact returned bytes. A denied
contributor withholds the entire view, including a contributor excluded by the
selection filters. A reference grants neither original-source
access nor delivery to another recipient.

Counts cover recorded Loom activity. Completion and passing assessments remain
authored claims; verified outcomes and native dispatch totals remain unknown.
Current intended Plans are distinct from exact historical WorkRef branches.
Session views do not expand linked Action or Plan content. Native messages,
protected review/objective relations, and frozen retrospective populations have
their existing independent owners. See [the shared contract and remaining
boundaries](learning-engineering-history.md).


## Source-linked whole-objective history

`loom_objective` is an optional, authored reconstruction index in separate `learning.sqlite`. A `create` request anchors one goal to an original source message/ledger record/declared URL; different goals in the same request use different `unit_key` values. Use `link` with exact native message/call IDs or a validated ledger record for request, coordination, dispatch, handback, verification, corrective dispatch, continuation, changed requirements, planned increments, environmental failure, outcome and explicit coverage gaps. Later verdict or relationship corrections append records, never erase previous claims. `read` pages chronologically; `find` may return several objectives for a shared source. Foreign native Session evidence requires its own authorized export; no private transcript bodies are copied into the index. Original source, link authorship, confidence, status (reported versus verified) and missing coverage remain separate. See [the full evidence contract](learning-experiments.md).

## Read-only longitudinal comparisons

`loom_trends` reads the optional source-linked objective index, not individual bounded `loom_insights` ledger pages. Supply explicit `since_at`, `until_at` (exclusive), `as_of_at`, population mode, and optional grouping/filter. Totals are computed across a frozen high-water-mark objective population on **every** page; `next_cursor` pages original objective IDs without reselecting members during concurrent appends. Unknown outcomes and undated starts remain visible. Counts represent authored judgments with original source IDs, not independently verified task success. Same-source failures are identified as correlated evidence, not independent incidents. Work type, model/provider, host/tool revision, observer/rubric and actual instruction exposure must not be inferred from today’s files or current defaults. See [longitudinal comparison details](learning-experiments.md).

## Evaluator admission assessment

After [durable preparation](learning-stage4-preparation.md), call `loom_insights` with `operation:"evaluation-admission"` and its exact `batch_id`, `request_id`, `manifest_sha256`, and initial `issue.attempt.attempt_id` as `attempt_id`. This read validates the complete existing source population and current canonical issue under the calling Session's native read permissions. It reports capability-specific blockers, consumed or uncertain issue state, and recovery limits. Caller-supplied authority, recipient, account, reservation and retry fields are rejected.

The result is an assessment, with no effect permit or budget reservation. A local issue ID is not a native effect receipt; null accounting does not establish zero spending or permit release of uncertain budget. Capture-off remains inspectable under existing read authority. See the [admission contract and remaining execution obligations](learning-stage4-admission.md).

The [restricted execution consumer](learning-restricted-execution.md) is an internal owner integration with no production authority adapter. It adds no public execution operation or grant-bearing tool arguments. Genuine execution requires the separately qualified native/account boundary and operator scope described in that document.

## Assessment and QA lenses

Call either loader with `{"skill":"software-engineering"}` using an exact native
skill ID. The existing `.loom.yaml` role mapping controls its use; agent names
and Plan roles do not grant access. Native skill allow/ask/deny still applies.
The loaders return full Markdown companion content, source path and hash, or an
explicit missing-companion message. Set `response_format:"json"` to obtain the
structured result instead. They need no Action or Plan and do not record verdicts
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

The optional Action ID filters for a current Session selection, authored
Action ledger activity or a saved Plan revision; omit it to list local native Sessions without an Action
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

When General delegates planning for an existing Action, include its `action_id`.
The planning agent selects it with `loom_context`, reads the existing Plan,
saves the complete revision through `loom_plan`, and leads its human handback
with the next outcome and proof strategy, followed by the Action ID,
saved revision and node IDs. General reads that revision to verify it before
delegating planned work. A chat response or `docs/plan/` document can be a
proposal or supplement, not a saved Loom Plan. Without an Action ID, a
proposal can remain in chat; do not invent an Action to store it. Failed saves
must be reported, not presented as completed planning.

A saved revision includes `saved_by: {session_id, agent}` from the native
caller; older revisions can omit it. `loom_action sessions` can discover
that Session from its Plan write, even after it clears selection. This is
traceability, not proof that the plan was reviewed or executed.

For substantial product work, professional planning guidance can organize the
Plan around milestones without changing Loom's schema. A milestone is a
checkpoint for a meaningful outcome, represented on an ordinary phase or task.
Use the existing fields, for example:

| Field | Example for a local export tool |
| --- | --- |
| `title` | Export and inspect one complete report |
| `outcome` | The operator can create a report and inspect its completed output. |
| `criteria` | Run the real export command from accepted input, read its output, and verify that failure never reports success. |
| `context` | Advances the Action goal of reliable local reporting; this increment covers one format, with later formats still planned. |

Here `criteria` is stored as a list of strings. Phases can group work toward a
milestone; waves arrange execution and do not themselves establish product
progress. A single task may carry a small outcome without either grouping.
Keep required technical prerequisites and accepted guarantees in the plan.
After a demonstration, record evidence, limits and learning in existing result
or review records, then revise affected remaining work. Explain current
capability and the next demonstration before listing IDs. Completion remains
agent-reported: completing tasks does not complete or accept their milestone,
parent or Action, and a milestone does not certify the whole product.

Select work through `loom_context`:

```json
{"action_id":"ACTION_ID","node_id":"TASK_ID"}
```

Retain `result.work_ref` before working. A native delegate receives IDs, goal,
constraints, useful record IDs and the original reference, then selects its own
work. It does not inherit the parent's selection. `{}` reads current selection;
`{"clear":true}` clears it. Selection is attribution, not permission to execute.

For a fresh independent review with no Action, `loom_context`
`{"mode":"independent"}` returns `selected:null`, `history_withheld:true`
and no inherited Loom history. It creates no Action and saves no selection:
there is no Action history to inject. It cannot erase earlier native messages
or prevent explicit history queries. When an Action exists, select it with
`mode:"independent"` to persist a withheld-history view for that work.

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
read limits. `session_only:true` on a ledger query reads the caller's Session,
including records that may also be Action-scoped. On `add`, it instead forces
Session scope for any record kind. Neither use accepts Action/node IDs.
Empty filtered results are not absence proof. `contract_match:null` means unknown;
a matching contract is not code freshness or independent validation.

`add` accepts Action/node or selection, `kind:result|claim|concern|assessment|qa` and
`statement`; Assessment/QA require `verdict:pass|fail|inconclusive`. All five
kinds can also be recorded without an Action, under the actual calling Session:

`{"operation":"add","kind":"qa","verdict":"pass","statement":"Checked the changed behavior and stated its limits."}`

When an Action is selected but the record must remain separate, add
`"session_only":true`. It does not change the saved selection. Session-only
records have no Action contract fingerprint and cannot be pinned as Action
handoff results. Session-only review verdicts are not Action-wide verdicts.
Action records may link same-Action host observations in `evidence_ids`;
Session-only records may link only unscoped host observations from the **same**
Session. `artifact_refs` are unverified pointers. Read your Session-scoped
records with `loom_record {"operation":"query","session_only":true}` or the
explicit Session `full_thread` view. Record actual checks, sources and limits.
No raw tool bodies are captured, and explicit text is not redacted: never
record credentials.

### Concerns and follow-up

Every agent records its own task-related concerns, not only handoffs:

```json
{"operation":"add","action_id":"ACTION_ID","node_id":"TASK_ID","kind":"concern","statement":"Suspected incompatibility; no reproduction yet. Outside this task, not resolved."}
```

Without an Action, concerns are stored under the calling Session. An Action
or task association is optional; concerns need no verdict. State suspected versus confirmed with supporting checks or
unknowns. Documented, outside-task and handed-off do not mean resolved. General
routes blockers through existing native coordination; critic consolidates
patterns with source Action and record IDs, or Session and record IDs for
Session-scoped concerns. Read the latter via `full_thread` with `session_id`.
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

Investigate uncertain facts within your responsibility; uncertainty alone is
not an OQ. Before committing to a choice outside your authority that changes
the goal, scope, promised behavior or accepted risk, ask the owner rather than
silently deciding or treating a recorded assumption as authorization. Route
scope to the dispatcher, specialist judgment to a role/agent, and intent or
approval to the user. Continue independent work where safe. An answer is not
necessarily approval or resolution.

The following example is explicitly legacy/manual and does not contact its
recipient. For routed questions use `recipient` as described immediately below.

```json
{"operation":"ask","question":"Does the finding cover empty input?","to_agent":"research","blocking":true,"context":"The cited source is ambiguous.","context_attachments":["SOURCE_REFERENCE"],"reference":{"action_id":"ACTION_ID","kind":"task","id":"TASK_ID"}}
```

Required: `question`, explicit Boolean `blocking`, and exactly one of
`recipient`, explicit destination `session_id`, or `to_agent` (legacy/manual).
An explicit `session_id` names an existing native Session and is verified as a
local peer in the current project/workspace before the question is stored.
The recipient is one of
`{kind:"agent",id:"AGENT_ID"}`, `{kind:"role",id:"ROLE_ID"}`,
`{kind:"dispatcher"}`, `{kind:"user"}`. Optional `context`,
`context_attachments`, `reference`. Without reference, selection supplies
association; without either, it belongs only to the asking Session. Optional
`action_id` overrides the selected Action association (but not the calling
author), and cannot be combined with `reference`. Explicit Action/node
references are validated, never silently changed.

On OpenCode 2.2.0, a question directed to a single eligible agent/role from a
primary Session invokes OpenCode's native subagent tool with built-in
permission and depth checks; a prompt hook binds the verified child before
native admission. Blocking direct OQs run as native foreground subagents
and return one tool result, without another Loom answer notice.
Nonblocking direct OQs use native background completion to wake later.
A question from a child is relayed to its dispatching Session. When addressed
to the dispatcher, it must answer directly, even if it consults a specialist;
it must not bind that specialist. A forwarded agent/role question requires
native delegation followed by `loom_record` with
`operation:"bind-respondent"`, `question_id`, and the verified child
`respondent_session_id`. Only that child Session can answer, not a sibling.
A user-targeted question from a child reaches the parent for user interaction;
the parent asks the user and cites the actual decision. A primary agent must
ask the user itself through the native interface. Unavailable or ambiguous role
assignments are not auto-dispatched.
When guarded model routing is enabled but the native host is unqualified,
Loom records questions requiring native contact without dispatch
(`dispatch.reason:"model-routing-host-unqualified"`). This avoids
creating children that cannot run a verified model. A primary Session
can still ask the user directly. There is no automatic replay after
a model-routing upgrade.
Explicit `session_id` questions use the same typed answer checks and native
synthetic notice facility as parent-addressed questions, but target the
verified peer Session, including unrelated root Sessions. Native delivery
is best effort: `dispatch.status:admission-observed` does not prove consumption.
The recipient can use `loom_record operation=query view=inbox` to discover
pending questions later without selecting an Action; this is scoped to the
actual calling Session and spans both Action and Session-only questions.
`question_state` (open/answered/all), `after`, `limit` and `next_after`
support bounded traversal. The inbox does not accept a foreign Session ID.

Legacy `to_agent` is still stored with no native contact. For automatic native routing instead, replace `to_agent`
with `recipient:{"kind":"role","id":"research"}` after discovering an eligible
role through `loom_agents`.

`dispatch.status:"admission-observed"` means native delegation was acknowledged,
not OQ resolution. `native_status` distinguishes running/completed work;
it does not verify correctness. Known pre-creation depth/permission denials
return `not-attempted` with a bounded `diagnostic`. Uncertain effects
remain `outcome-unknown`; no automatic retry. Blocking selects foreground
direct delegation, not an approval gate.

```json
{"operation":"answer","question_id":"QUESTION_ID","answer":"Empty input is excluded; see the source limits.","context_attachments":["SOURCE_REFERENCE"]}
```

Text answers require `question_id`, `answer`; optional `context_attachments`.
For a structured `answer_type:"multi-choice"` ask, supply immutable
`choices:[{id,answer},...]` and a typed `recipient`, never legacy `to_agent`. Reply with `question_id` and `choice_id`, plus an
optional `reason`; or `status:"cannot-select"` and a required `reason` instead.
Do not also submit `answer`. Omitted answer type remains text. See the
[structured contract](structured-questions.md) for validation, bounds, examples
and unchanged authority/continuation semantics. Actual
author/Session derive from the caller. Typed direct questions enforce the bound native child Session and agent;
forwarded specialist questions require the dispatcher's exact binding
and the native child relationship. Legacy questions preserve their previous behavior. An agent
relaying a user decision must include the real user source; identity checks alone
do not verify it. Association is inherited from the question,
even if nullable or its node was removed; answering does not select the asker's
work. Both canonical attachment fields are string-reference arrays. `attachments`
is never an alias, alone or alongside the canonical field. Old statement,
respondent, background and artifact_refs are not ask/answer inputs.

Only the FIRST committed blocking legacy v1, forwarded typed v2 or explicitly
Session-addressed v2 answer qualifies for one best-effort Loom resume of the original asker. Direct typed
OQs do not send a Loom answer notice: foreground native execution owns blocking
continuation, background native completion owns nonblocking wake-up.
Later/nonblocking answers do not submit Loom resume input. No retries, eligibility
transfer, recovery replay or startup/read reconstruction exists; crash after
commit can permanently lose liveness. Missing/moved/inaccessible targets fail
visibly without retargeting; current native agent/model/permissions stay unchanged.
Target check is not an atomic lease. The 5000ms deadline bounds waiting, not
cancellation of started native I/O. Admission is not consumption or completion.
An eligible response's `resume` and separate SYSTEM annotation qualify the outcome;
annotation failure cannot erase the answer or undo I/O. Never repeat an answer
to try delivery. Read [full outcome details](collaboration.md) (section **One-shot first-answer resume**).

## Query views and complete history

| View | Scope / continuation |
| --- | --- |
| `ledger` (default) | Explicit Action/node or selection, otherwise caller Session; `after`/`next_after` |
| `progress` | Action/node or selection; `offset`/`next_offset` |
| `questions` | Explicit/selected Action, optional explicit node/respondent, question_state open/answered/all; `after`/`next_after`; does not inherit task filter |
| `thread` | Required question_id; optional matching action_id; full question plus paged answers; `after`/`next_after`; no selection required |
| `full_thread` | Explicit Action/node OR Session; `cursor`/`next_cursor`; no selection fallback |

Views other than ledger default to 20, max 50. For full stored relational history:

```json
{"operation":"query","view":"full_thread","action_id":"ACTION_ID","node_id":"TASK_ID","limit":20}
```

Or use `session_id` instead of Action/node. The default response is Markdown
with the exact scope and `next_cursor` at the top. Set
`response_format:"json"` to get `result.format:loom-full-thread/v1`,
`scope`, escaped `markdown` and `next_cursor` as structured fields.
Follow `next_cursor` as `cursor` with
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
