# Loom usage guide

## Keep Loom optional

A conversation needs no Action. An Action needs no Plan. OpenCode owns Sessions, execution, delegation, skills, models and permissions. Loom retains intent/history, not a scheduler. Roles restrict companion loaders.

## Choose the shortest route

| Need | Tool and operation |
| --- | --- |
| Known record ID | `loom_record query`; explicit scope + record_id. |
| Unfamiliar history | `loom_history read`; one scope, literal match before paging. |
| Connected attempts/fixes | History record's `trajectory`; originals via `source.query`. |
| Objective identity | `loom_objective find` by exact source; `list` to browse. |
| Retrospective membership | History `preview-population`, review `freeze-population`. |
| Native evidence | `loom_trace` timeline/children/parts/source. |
| Goals / Session inventory | `loom_action`; labels do not control execution. |
| Intended work / selection | `loom_plan` / `loom_context`; no dispatch. |
| Findings, OQs, progress | `loom_record`; completion is not acceptance. |
| Protected review mandate | `loom_review`; no execution grant. |
| Evaluations / blockers | `loom_insights`; deterministic, no genuine reasoning. |
| Compare / propose | `loom_trends` / `loom_tweak`; no causal proof or activation. |
| Roster / review lenses | `loom_agents` / `loom_assessment` / `loom_qa`. |

Search one relevant tool for syntax; no mandatory loading sequence. Except agents/context/lenses, supply `operation`. UPPERCASE IDs and zero hashes are placeholders. Get actual IDs from responses or verified user references; keep returned requests intact.

### Code Mode

Use the callable search path. JSON text wraps `result`/`config_errors`; parse once. Record queries accept `response_format:json`, never on writes. Assessment/QA and `full_thread` default to Markdown; history accepts Markdown/HTML. Parse only JSON; join Markdown lenses as text.

Use `Date.now()` for coarse elapsed milliseconds; `performance.now()` is unavailable in the qualified runtime. Do not assume browser/Node APIs. `text.length` is UTF-16 code units, not bytes/tokens. Measure UTF-8 bytes in a host harness; do not claim token savings from bytes. Return needed fields, not whole repeated responses.

Await writes before using IDs. Use `Promise.allSettled` for independent calls and inspect every outcome; sequence dependent calls.

## Start or resume work

Actions support continuity; Plans support meaningful dependencies or resumption needs. Native delegation uses `loom_agents {}`: match `agents[].roles` to `role_descriptions`, check `available`/`enabled`. Reuse or list Actions before creating:

```json
{"operation":"create","title":"Explain a setting","goal":"Produce a source-backed explanation with its limitations."}
```

`result.id` is the Action ID. Read before Plan edits:

```json
{"operation":"read","action_id":"ACTION_ID"}
```

Save the complete node list with `expected_revision` (0 initially); preserve IDs and reconcile conflicts. Action updates use the Action's separate current revision. Plans express intent, not scheduling. Chat/docs do not save a Plan; report failed saves.

Select before work:

```json
{"action_id":"ACTION_ID","node_id":"TASK_ID"}
```

Retain original `work_ref`. Give delegates Action/task IDs, goal, constraints and evidence IDs. Each child selects its own work.

Record result handoffs: goal/revision, decisions, evidence/limits, next step. Pin same-Action `handoff_id` if useful; read exact records.

For independent first review, start a fresh Session and select `mode:"independent"` before opinions. It withholds context history, not explicit reads/messages/task text. Record your findings before continuation/reconciliation. Without Action, no saved selection. Lens loading does not establish independent acceptance.

## Read evidence before using conclusions

For known Action records use the shortest exact read, without a node filter:

```json
{"operation":"query","action_id":"ACTION_ID","record_id":"RECORD_ID","response_format":"json"}
```

For known Session records use `source_session_id`+`record_id` with native read permission. Use `projection:"fields"`+`fields` for selected content, `projection:"metadata"` for inventory. Only exact reads give full statements. Empty results prove no absence. `contract_match:null` is unknown; a match is not correctness.

### Discover, connect, then inspect

For an unfamiliar question, start with one known Action or Session:

```json
{"operation":"read","action_id":"ACTION_ID","match":"timeout"}
```

For Session scope use `session_id`. Selectors combine with AND. Follow `trajectory` for connections without the text filter. Submit `expand`, group `details` and `navigation` requests unchanged: they include `operation`, selectors, `through`, owner boundaries/versions and cursors. Changed versions require a fresh read. Use `source.query` via `loom_record` for exact originals.

Historical WorkRefs differ from current Plan; unplanned history uses observed groups or labelled chronology. Highlights are not exhaustive; claims/reviews are not verification. Preserve failures, contradictions and gaps. References grant no access; source/contributor permissions apply. `through` is an append bound, not a frozen population.

### Identify or author the retrospective objective

An Action can contain many objectives or none. `loom_objective find` is exact-source lookup, not label/text search. Use `{"operation":"find","source_type":"ledger-record","source_id":"RECORD_ID"}`. Choose the relevant `result.items[].id`; inspect `read` if ambiguous. Several goals may share a source. Native sources also need Session/message identity. `list` browses labels; follow `navigation.next` as needed.

Empty `find` does not prevent source investigation. Preview does require an authored objective. If authorized, `create` with actual source_type/source_id, truthful label and distinct unit_key for separate goals sharing an anchor. Its `result.id` is the objective ID. Link relevant originals with `link`; preserve the meaning of phase/assessment, uncertainty and authorship. Relationships are attributed interpretation, not invented dispatch, causation or historical review membership. Do not create an objective merely to make a read succeed.

### Preview, approve, freeze, inspect

1. Call history with `{"operation":"preview-population","selection":{"objective_id":"OBJECTIVE_ID","question":"What corrected this failure and what remains unverified?"},"limit":20}`. Omit boundary parameters initially. History and preview use different boundary versions. Do not copy history pins into selection or guess partial boundaries; reuse only the preview's returned requests. Objective/question belong inside selection.
2. Review membership/exclusions/gaps; follow `navigation.next` unchanged to completion. Ordinary discovery need not exhaust every branch. Preview is read-only, with no population ID.
3. Obtain approval for that exact selection, or apply existing authorization. Changed scope needs a new preview. Approval is not a Boolean/tool operation.
4. Send the approved preview's `freeze` request unchanged to `loom_review`. Save returned `population_id` and `manifest_sha256`. Freeze persists membership/versions, not evidence bodies or an execution permit.
5. Follow frozen navigation; send member `inspect` unchanged for exact source. Check available/missing/changed/unsupported and gaps. Source-owner limits still apply; hashes/pointers are not contents.

Historical investigation, evidence preparation and authorized execution are distinct. These steps grant no execution/source access or genuine-reasoning proof.

## Write and review honestly

Use result for work, claim for conclusions, concern for suspected/confirmed problems with support and unknowns. Every agent records relevant concerns. A handed-off concern is not resolved. General routes blockers; critic compares evidence. Concern IDs are not observation `evidence_ids`; append follow-ups.

`evidence_ids` cite same-Action or same-Session unscoped observations; artifact_refs are pointers, not proof. Observations retain digests, not raw bodies. `session_only:true` queries caller history including Actions; add forces Session scope. Neither accepts work IDs. Never record credentials/secrets: text is not redacted.

`complete` needs original `work_ref` and actual outcome; result alone is not completion. Check `view:progress` for contract changes. No parent/Action cascade or acceptance. `reopen` appends reason; Action labels do not stop execution.

Assessment checks conformance; QA challenges failures. Lenses need exact skill IDs, role and native permission; load ASSESSMENT.md/QA.md, never SKILL.md as fallback. Missing means `available:false`. Record actual pass/fail/inconclusive findings.

## Questions: route material unknowns

Investigate facts within your responsibility. Ask for input owned elsewhere when a choice changes the goal, scope, promised behavior or accepted risk; do not treat a recorded assumption as authorization. Route scope to dispatcher, judgment to role/agent, approval to user.

Ask needs question, blocking, exactly one typed recipient, verified session_id or legacy to_agent. Agent/role needs id; dispatcher/user does not. action_id and reference conflict; caller stays author. Native peer delivery requires permission; denial stores nothing.

```json
{"operation":"ask","question":"Which limit applies?","recipient":{"kind":"role","id":"research"},"blocking":false}
```

Legacy recipient is NOT contacted (`policy-capability-unavailable`). For dispatcher targets, answer directly even after consultation. For agent/role OQs, natively delegate and bind the verified child. For user targets, ask the user and cite their actual decision.

```json
{"operation":"answer","question_id":"QUESTION_ID","answer":"Source-backed response.","context_attachments":["SOURCE_REFERENCE"]}
```

Multi-choice uses one choice_id or cannot-select with reason; no text answer. Read thread/inbox for stored questions and replies. An answer is not necessarily approval or resolution. Only FIRST committed blocking legacy/forwarded/explicit-Session answers attempt exact-asker resume. No retries/replay. 5000ms bounds waiting, not I/O; not an atomic lease. Do not repeat an
answer to try delivery. Historical records remain readable.

## Native and complete stored history

`loom_trace`: timeline is caller context/authorized export; children is direct inventory; parts is metadata; source reads exact fields. Raw fields and input/output matching are caller-context only; export/cross-Session reads permit structural/status/dispatch data. Follow `next_cursor`; pin source/part hashes. Native history may be incomplete; exports are unverified. Inner Code Mode calls may be hidden; masking is best effort. Never store transcripts/secrets.

Exhaust ledger/thread only for a complete-history requirement, not ordinary source discovery:

```json
{"operation":"query","view":"full_thread","action_id":"ACTION_ID","node_id":"TASK_ID","limit":20}
```

Or session_id, never Action/node; no selection fallback. Local Store, not native bodies. Membership is authorship/direct replies, not notices/names. Markdown default; JSON result wraps scope/markdown/next_cursor. Follow same scope until null; oversized records advance on final part. Cursors bind scope/location/version, not snapshot; invalid data never advances. Ledger uses `next_after` as `after` with filters.

## Recover without guessing

For removed tasks, read recovery/Plan/history. Select current task, Action-only or `{"clear":true}`; never infer replacement by title. `loom_context {}` reads saved selection.

After save failure, inspect `selection.status:"save-failed"` and `persisted` (reference/null/"unknown"); injection follows persisted state. Failed clear throws. Unreadable context is not task removal. Plan/ledger reads do not select. Do not assume the selection changed after an error.
