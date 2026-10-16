# Reported progress and contextual questions

The Plan describes intent. The ledger stores completion reports, reopen events,
questions and answers. The five tool names remain unchanged. The current production
implementation has no scheduler, blocking-question state, approval grant, automatic
parent completion or agent wakeup.

## Coordination candidate, not current tool behavior

The independently reviewed comparison at `c2db6e7` favors answer -> original primary
-> native re-delegation to the same Worker Session, retaining its original
`work_ref`. The native call owns completion return; Loom must not also send a
completion nudge or directly resume Worker for that continuation. See
[Coordination](coordination.md) for assignment/routing, delivery, uncertain-admission
recovery and cancellation requirements. Those capabilities remain unimplemented.
Passive notices are a separate candidate, not a way to resume an idle primary.

The operations below document shipped code in this draft, not proposed fields or
notifications. Do not infer dispatch from `respondent`, completion from native
idleness, or a cancellation effect from an Action label.

## Completing the work actually performed

Before working, read/select the node through `loom_context` and retain its exact
`result.work_ref`. It includes Action ID, node ID, Action revision, Plan revision
and a `loom-work/v1` definition hash. It is a reference, not execution authority
or proof that an agent actually performed the work.

When done, call `loom_record` with `operation: "complete"`, that **retained object**
as `work_ref`, and a truthful `statement`. Optional `artifact_refs` are unverified
references. All four node kinds use this operation. It does not read or change the
caller's selection. Optional explicit Action/node IDs must match the reference.
Never fetch a new reference merely to label earlier work complete against changed
requirements. Missing, forged or unavailable references fail without writing a report.

The report stores the original reference and `work_goal`; historical Plan nodes
remain readable with `loom_plan` at `work_ref.plan_revision`. Action definitions
are archived transactionally before updates, so later goal changes cannot silently
replace the earlier definition. This additive `action_versions` table does not
backfill Action versions lost before this implementation. Missing history is an
error, not permission to substitute the latest version. Avoid mixed old/new writers.

Progress is derived from the latest explicit completion/reopen ledger event:

| State | Meaning |
| --- | --- |
| `open` | No completion report, or explicitly reopened |
| `reported-complete` | The report's definition matches the current work |
| `needs-reconfirmation` | Relevant intent changed, or the node is no longer current |
| `validity-unknown` | The bounded comparison could not establish a match |

Revisions provide traceability but are not the definition identity. Unrelated
Plan edits and Action state-label changes do not invalidate completion. The hash
includes the goal, node contracts, inherited parent contracts, relevant dependencies
and contained work. Descendants count for the selected group and dependency groups,
not for ancestors used only as context. Adding a child therefore reconfirms its group
without invalidating unrelated sibling tasks. Equivalent ordering of nodes,
dependencies, roles and skills does not change identity. Other contract-field changes
are treated conservatively as changed intent, not semantically interpreted by a model.

A completion of historical work is retained even when already outdated. No child,
parent, dependent node or Action is changed automatically. A failed QA verdict or
open question does not prevent reporting completion; reported completion is not
independent acceptance, test success, artifact freshness or resolved uncertainty.

To reopen, use `operation: "reopen"`, explicit `action_id`/`node_id` or a selected
node, and a `statement` explaining why. This appends history without erasing earlier
reports or findings. It can reopen removed work with existing progress history;
it does not restore the node to the Plan. Concurrent reports are ordered by ledger
sequence: the latest explicit report is the current report, not an approval decision.

## Asking and answering without changing assignments

`loom_record` supports:

- `ask`: `statement`, `respondent`, explicit Action/node or selected work;
  optional `background` and `artifact_refs`. The returned record ID is the question ID.
- `answer`: `question_id`, `statement`, optional `artifact_refs` and matching
  `action_id`. Do not supply `node_id`: the original question supplies the scope.

`respondent` is an intended native agent ID or user label, not a dispatch command
or an authority restriction. Answers record the actual calling agent and Session.
A different agent may respond without impersonating the intended respondent.
Research can answer a Worker's question without selecting the Worker's task, even
when Research has an unrelated or unreadable selection. Removed tasks retain their
threads and can receive answers. Sources, background and qualifications remain in
the full ledger records; multiple or conflicting responses are not overwritten.

**Answered means at least one response exists.** It does not mean resolved,
approved, independently verified or permitted to proceed. Use native delegation or
user interaction to bring a respondent in. Loom does not resume an idle agent.

## Context and full retrieval

`loom_context` and its automatic injection expose `work_ref`, `progress` and
`questions`. Questions cover the Action, selected node, parents/dependencies and
questions addressed to the calling agent in this Action. Answer visibility begins
on the next context refresh or explicit read, not an unsolicited push.

Open questions have a separate bucket: up to six oldest open questions plus two
recently answered threads, ordered by answer time. They do not compete with routine
observations. Progress samples at most 16 nodes. Compact rendering can include fewer
items and source prefixes; `collaboration_has_more` and omission counters expose the
limitation. Removed-task notices retain recovery instructions and fit additional
thread/progress previews only where their budget permits.

Use `loom_record operation: "query"` with these views:

| View | Inputs and result |
| --- | --- |
| `ledger` (default) | Existing raw history, exact `record_id`, `after`/`next_after`; selected-task filtering is unchanged |
| `progress` | Action/node or selection; `offset`/`next_offset`; Action-wide pages cover current nodes, explicit node ID can inspect removed progress |
| `questions` | Explicit or selected Action; optional explicit `node_id`, `respondent`, `question_state: open/answered/all`; `after`/`next_after` |
| `thread` | `question_id`; full question and answers; `after`/`next_after` pages answers; optional `action_id` must match |

New views default to 20 items and cap at 50. `questions` defaults to open and does
not inherit a selected-task filter. `session_only` remains a **ledger-only** option.
Thread queries need no selected work. Read full threads before decisions that depend
on qualifications or conflicting answers. Full records are subject to existing read
limits; failures preserve history, not necessarily its availability through these tools.

These combined views use one read snapshot, not a lease against future edits or a
snapshot across separate pages. Collaboration body transfers have a shared 4 MiB
allowance per view/context addition, in addition to the original context allowance;
fingerprinting has its own bounded shared allowance. Output remains within configured
context size. Questions may still require scanning answered question history; added
indexes, total storage growth and whole-process resource use are not capacity guarantees.

## Verification and remaining acceptance

Core tests exercise the agreed flow through real SQLite, including a reopened
connection and new Session. Registered-plugin tests exercise real callbacks and
context hooks using a simulated host. Existing pinned Code Mode tests verify that
search returns complete registered help and signatures, now including these operations.
The record manual has a 6,000-character metadata ceiling; other tools retain 3,600.

The separate [host comparison](handback-comparison.md) now exercises actual Loom
callbacks through installed native delegation with a scripted provider. The user
reports independent acceptance of that comparison's narrow scope at `c2db6e7`.
That does not turn the test-only delivery code into production behavior or establish
live-model usefulness, task-removal/fresh-Session acceptance, or overall readiness.
The pre-existing successful-read/failed-selection limitation, tested manual
backup/restore and wider E operating limits remain separate work. Keep PR #180
draft; this status update does not authorize paid inference, dashboards or scheduling.
