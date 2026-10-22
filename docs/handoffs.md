# Useful handoffs and independent review

Keep the useful work outside the conversation so the next task can start fresh.
Loom uses its existing result records and work selection. It does not add a report
stage, dispatch agents, decide when to resume, or certify that the work is complete.

## One result, two readers

At a useful stopping point, write one ordinary result for the caller and the next
specialist. State the goal and source revision; decisions or changes; observed
evidence and limits; unfinished work; and the next useful step. Link to actual
code, documents and evidence through `artifact_refs`. Do not duplicate a large
architecture document or save every speculative branch of the conversation.

The native handback carries the Action ID, destination task ID and exact result
ID. The receiving session can select work with:

```json
{"action_id":"ACTION_ID","node_id":"NEXT_TASK_ID","mode":"continuation","handoff_id":"RESULT_ID"}
```

`handoff.record_id` is kept outside sampled history. It points to the exact
existing `kind:result` record, even if newer results crowd it out of the normal
context preview. It is not a full-text injection or a newly generated summary.
The source task can differ from the destination, but the Action must match.
Missing, wrong-kind and cross-Action pins fail before saving the selection.

Read the full result without inheriting the destination task's filter:

```json
{"operation":"query","action_id":"ACTION_ID","record_id":"RESULT_ID"}
```

Check the source revision, current applicability and remaining proof. A matching
task definition does not prove that code or evidence is fresh. A pinned result
can still be wrong, outdated or incomplete. Recording or handing off unfinished
work does not make the original task complete.

`handoff_id:null` clears a pin; selecting a different task or Action drops an
inherited pin. A new explicit pin is allowed with the new selection.

## Keep first assessments independent

Fresh sessions can still receive old opinions through automatic context. To avoid
that, the caller provides accepted goals/requirements, current artifacts and
source evidence, then the new reviewer selects independent context **before**
reading work history:

```json
{"action_id":"ACTION_ID","node_id":"REVIEW_TASK_ID","mode":"independent"}
```

This view reads current Action/task/related contracts and computes the normal
`work_ref` without reading ledger or collaboration history. It withholds results,
claims, concerns, Assessment/QA verdicts, reported progress, questions and answers
from both the tool response and later automatic context blocks. Missing-task
recovery follows the same policy. `history_withheld:true` means not presented,
not absent or resolved. The original work reference still needs to be retained
before doing work; a processing limit may leave it unavailable, as reported.

First record the reviewer's own observations. Then switch explicitly:

```json
{"mode":"continuation"}
```

Read exact known finding IDs and relevant paged history, compare them with current
evidence, and reconcile unresolved defects before the final verdict. The normal
view remains sampled; merely switching modes does not prove reconciliation.
Follow-up reviews can use prior findings immediately and resume useful context.
They should not be labelled independent rediscovery.

This policy is a context aid, not a security boundary or proof of independence.
It cannot remove opinions already present in native messages, sanitize task text
or configuration instructions, block explicit history reads, or change native
question-answer notifications. Starting fresh and choosing an appropriate source
packet remain the caller's responsibility. No hidden finding is auto-dismissed.

## Persistence, limits and recovery

Mode and pin are optional fields in the existing saved selection JSON. No new
ledger kind, database table, migration, mandatory report or tool is introduced.
Old selections default to continuation. Ordinary reads and explicit reselection
retain the saved mode; explicit mode/pin changes also save without repeated IDs.
Creating an Action or clearing selection resets the preferences. Clear cannot
combine with work IDs, mode or pin.

Unreadable saved selection still permits explicit navigation. With no explicit
mode, recovery uses independent context rather than assuming old history was
allowed. Invalid modes fail visibly. Selection write failures are reported;
`persisted` identifies the old selection, null, or unknown. Later automatic
context follows that persisted state, not the failed request. Retry in a fresh
session before claiming isolation. A removed task is not silently replaced.

The existing character budget covers the response and configuration diagnostics.
Summaries can be excerpted; exact handoff IDs remain usable for full reads.
Independent context deliberately omits reported progress and history, not the
required work. Source files and full plan reads still provide the detailed input.
Older plugin versions ignore these preferences: use the installed tool schema
and help to establish support before relying on the mode.

## Verification scope

`tests/context-policy.test.mjs` covers selection policy and rendering with a
bounded Store test double that throws on forbidden history reads.
`tests/context-handoff.test.mjs` covers actual SQLite persistence, exact handoff
reads and write failures. `tests/context-handoff-native.test.ts` uses the public
plugin with a simulated OpenCode host to check schemas, saved mode, automatic
injection, missing-task recovery and full dependency-result reads.

These tests do not establish that an LLM will follow the review procedure or that
live OpenCode delegation preserves a particular prompt. Model-driven trials and
installed-host acceptance remain separate evidence. No test is claimed passed
merely because its fixture is present.
