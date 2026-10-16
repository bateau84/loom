# Using Loom: five tools, one handoff

This guide describes the API inspected at `504584b`. It is usage documentation,
**not a report of a successful installed-host two-agent trial**. Examples are tool
inputs, not shell commands. Replace `ACTION_ID` and `RECORD_ID` with IDs actually
returned by Loom; do not invent evidence IDs. Native OpenCode still executes work,
delegates agents, loads skills and enforces permissions.

A conversation needs no Action. An Action needs no Plan. Use Loom when another
agent or a later Session will benefit from remembering the work.

## Choose the tool

| Tool | Use it for | Important effect or limit |
| --- | --- | --- |
| `loom_agents` | Available agent IDs, roles, descriptions and config/capture diagnostics | Does not create agents, assign work or grant permission |
| `loom_action` | List, create or update a goal | Create selects the Action for this Session; state labels do not stop work or certify success |
| `loom_plan` | Read or replace a complete optional plan | Save needs the current plan revision; retain unchanged node IDs; it does not dispatch work |
| `loom_context` | Read selected work, or select explicit Action/task IDs and read them | Explicit IDs normally save Session selection; `{}` reads existing selection; a new Session starts unselected |
| `loom_record` | Add a useful result/claim/Assessment/QA record, or read ledger history | It cannot create host observations, prove independence or certify a claim |

A successful tool result has JSON content with a `result` field; configuration
problems can also appear in `config_errors`. No-error content is not proof of task
success. An explicit operation may throw a storage/input error instead of returning
a result. Check the returned operation outcome before using IDs or claiming a write.

## Research -> Worker example

### 1. Discover the real roster and create work

Call `loom_agents` with `{}`. Choose existing native agents with relevant roles;
"Research" and "Worker" below describe responsibilities, not mandatory agent IDs.
Role mapping and descriptions live in `.loom.yaml`, not this example.

Call `loom_action`:

```json
{"operation":"create","title":"Explain a repository setting","goal":"Investigate one setting and produce a source-backed explanation with its limitations."}
```

Keep `result.id` as `ACTION_ID`. The new Action has no Plan and is selected only
for the calling Session. For this two-part example, call `loom_plan`:

```json
{
  "operation":"save",
  "action_id":"ACTION_ID",
  "expected_revision":0,
  "nodes":[
    {"id":"research","kind":"task","title":"Investigate the setting","outcome":"Record the finding, source and material qualifications.","roles":["research"]},
    {"id":"explain","kind":"task","title":"Write the explanation","depends_on":["research"],"outcome":"Use the research and retain its qualifications.","roles":["implementation"]}
  ]
}
```

`0` applies only when there is no saved Plan. On existing work, first read
`loom_plan` with `{"operation":"read","action_id":"ACTION_ID"}` and use its
returned revision. Save supplies the whole node list, not an incremental patch.
Phases, waves and subtasks are optional; dependencies organize context, not execution.

### 2. Research with native tools; preserve a useful conclusion

Use native OpenCode delegation. Give the Research agent the goal, `ACTION_ID` and
node `research`. It calls `loom_context`:

```json
{"action_id":"ACTION_ID","node_id":"research"}
```

After actual investigation, call `loom_record` with the observed finding. The text
below is a placeholder, not a finding to record unchanged:

```json
{"operation":"add","action_id":"ACTION_ID","node_id":"research","kind":"result","statement":"REPLACE_WITH_OBSERVED_FINDING_SOURCE_AND_QUALIFICATIONS"}
```

Keep the returned record ID. Optional `artifact_refs` are references, not proof
that Loom read or checked their contents. Optional `evidence_ids` must refer to
existing host observations in this Action, not other conclusion records. Omit
missing evidence rather than manufacture it. Never put credentials in records.

### 3. Hand off identifiers, not another copy of the conversation

Send the chosen Worker agent a native delegation message such as:

> Continue Action ACTION_ID, task explain. Use loom_context for that task.
> Research is recorded as RECORD_ID on task research. Read that complete record
> before writing the explanation; preserve its qualifications. Record your result.

The Worker first calls:

```json
{"action_id":"ACTION_ID","node_id":"explain"}
```

Task context includes sampled dependency conclusions. For the full research
record, use `loom_record` with the explicit Action ID and record ID:

```json
{"operation":"query","action_id":"ACTION_ID","record_id":"RECORD_ID"}
```

**Do not rely on the selected Worker's node filter to retrieve a dependency's
record.** Supplying `action_id` without `node_id` searches the Action rather than
silently inheriting the currently selected task. Supplying only `record_id` can
inherit that task and return no match. Empty results under a filter do not prove
that the historical record never existed.

Configured, enabled agents receive selected-work context on subsequent turns
while instruction injection is enabled. Setting `instructions.enabled: false`
also disables that automatic context block; explicit tools remain available.
Excerpts can omit qualifications. `contract_match` concerns the saved goal/Plan,
not code freshness; `null` is unknown, not success or failure.

### 4. Replan, recover explicitly, then resume in a fresh Session

Read the current Plan and save a complete replacement node list with its current
`expected_revision`. Retain `research`; for the removal trial, remove `explain`
and add an explicitly different task such as `explain-v2`. Do not silently treat
that as equivalent work. Saved history is not deleted by this plan change.

Reading the old `explain` selection should produce `task-not-in-current-plan`
with current-Plan/history queries and recovery choices. Read those records, then
explicitly select `explain-v2`, select Action-only context, or clear selection.
Do not infer replacement from a similar title.

Call `loom_context` with one of these choices, not all three:

```json
{"action_id":"ACTION_ID","node_id":"explain-v2"}
```

```json
{"action_id":"ACTION_ID"}
```

```json
{"clear":true}
```

In a genuinely fresh Session, provide the Action ID, not the old conversation.
Read the Plan, select the intended current task and retrieve the same record by
ID. `loom_action` list can locate Actions; follow `next_offset` if needed. A fresh
Session's `{}` context read does not automatically inherit another Session's task.

## Records, review and finding missing information

A `result` describes work performed; a `claim` records a conclusion with its
support and uncertainty. `assessment` and `qa` are independent record kinds, not
mandatory stages. Load external skills and their ASSESSMENT.md or QA.md companions
where useful. Record review against actual work, for example:

```json
{"operation":"add","action_id":"ACTION_ID","node_id":"explain-v2","kind":"qa","verdict":"inconclusive","statement":"REPLACE_WITH_ACTUAL_REVIEW_FINDINGS_AND_UNTESTED_RISKS"}
```

Review verdicts are `pass`, `fail` or `inconclusive`. They do not establish reviewer
independence or change Action state automatically. Updating an Action requires
its own current `expected_revision`, separate from the Plan revision.

Ledger query pages use `limit` (1-50) and `after`; pass a returned `next_after` as
`after`, stopping at null. General pages shorten long statements; pass an exact
`record_id` for the full record within the existing read limits. Historical records
of a removed task remain queryable with explicit Action/node IDs. To inspect
unpaired observations from this Session without changing work selection:

```json
{"operation":"query","session_only":true}
```

`session_only` cannot be combined with work IDs or used for writes. Observation
start/finish records may be absent or unpaired; neither situation is proof that
native work failed or succeeded. No raw tool output is stored by the observer.
Use the recorded Session/message/call references to investigate the original work.

## Selection outcomes and bounded real-host evidence

**A successful context read survives failed selection saving.** Inspect the
separate `selection.status: "save-failed"` outcome and diagnostics. `persisted`
names the actual saved reference, null if absent, or "unknown" if readback fails.
Automatic context follows persisted selection, not the unsaved request. `{}` reads
the saved selection where storage permits. Explicit Plan and ledger queries offer
history without saving selection. Unreadable context still fails, and a failed
clear must not be interpreted as successful clearing.

The bounded run recorded in [operating policy](operating-policy.md) passed native
research/coder/follow-up, completion/replan/removal and independently checked fresh
recovery, with no automatic continuation authorized or sent. It did not include
restart, source-freshness, transport or save-failure probes. It is not whole-alpha
acceptance. Any broader acceptance run must use installed OpenCode, actual native Research and Worker
execution, and meaningful records. Give Research a distinctive finding that is
not copied into the Worker prompt; verify the Worker actually retrieves it and
retains its qualifications. Then remove its task, exercise explicit recovery,
and verify the same records from a fresh Session, including a host restart.
Record commit/runtime versions, tool results, record IDs, errors and any user
intervention. A written sequence, manual hook calls or an empty database boot
cannot establish this result. This guide does not authorize paid model spending.

The [manual stopped-writers backup/restore procedure](manual-backup-restore.md)
now has meaningful-record isolated proof; it does not restore native Sessions or
replay work. The alpha policy still defers advanced storage automation.
