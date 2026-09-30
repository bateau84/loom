---
type: evaluation
title: Loom Conversation Evals
description: User-facing conversation, status, evidence-selection, formatting, and conversational-boundary cases.
tags: [evaluation, loom, conversation, human-interaction]
---

# Conversation evals

`conversation.json` keeps conversational behavior in one topic suite instead of separating cases by historical labels such as “regression” or “live”.

The suite contains:

- ordinary human-facing response cases such as concise explanation, status, handover, trace fidelity, blockers, stop semantics, JSON-only output, and bounded completion;
- conversation-vs-execution boundary cases for research, diagnosis, exploration, and synthesis;
- opt-in edge cases that stress cause selection, unknown blockers, exact evidence attribution, and remaining-work semantics;
- opt-in runtime probes such as the two-check verification case and real nested Research.

Cases that should not run during ordinary default evaluation set `"default": false` directly on the case. Explicitly selecting `conversation.json` makes those opt-in cases available without putting them in separate “regression” or “live” files.

## Human prompt realism

Human-facing prompts should read like plausible messages from an actual user: terse questions, pasted notes, engineering shorthand, format requests, uneven sentence structure, or contextual follow-ups are all appropriate.

Avoid benchmark scaffolding such as:

- `Returned state:`
- `Current returned state:`
- `Returned investigation notes:`
- `Latest host state supplied to Loom:`

The target prompt supplies facts and user intent. Traps, expectations, and forbidden behavior stay judge-only.

## Useful runs

Run the normal human-facing response cases:

```sh
bun run eval:live -- \
  --suite evals/conversation.json \
  --cases HUMAN-01,HUMAN-03,HUMAN-04,HUMAN-05,HUMAN-06,HUMAN-07,HUMAN-08,HUMAN-09,HUMAN-10 \
  --iterations 3 --parallel 4 --network host \
  --model <model>
```

Run the harder human-facing edge cases:

```sh
bun run eval:live -- \
  --suite evals/conversation.json \
  --cases HUMAN-CAUSE-01,HUMAN-CAUSE-UNKNOWN-01,HUMAN-TRACE-01,HUMAN-JSON-01,HUMAN-JSON-OBSERVED-01,HUMAN-BLOCKER-PRIORITY-01 \
  --iterations 3 --parallel 4 --network host \
  --model <model>
```

Run an opt-in runtime case:

```sh
bun run eval:live -- \
  --suite evals/conversation.json \
  --cases HUMAN-RUNTIME-01 \
  --iterations 1 --parallel 1 --runtime-parallel 1 \
  --network host --model <model>
```

These runs consume provider inference. Deterministic CI validates suite wiring, fixture behavior, prompt isolation, and schema; it does not substitute for provider-backed behavioral evidence.

## Chat-first communication

Chat-first means helping the user understand the work while it happens, not merely keeping discussion outside a workflow. General's core definition owns this behavior; it does not depend on loading an optional communication skill.

The `HUMAN-CHAT-*` response cases assess whether the answer teaches something useful from the supplied facts:

| Case | What the answer must make understandable |
| --- | --- |
| `HUMAN-CHAT-EXPLAIN-01` | Why a reset counter defeats a retry limit across restarts, and why restoring the saved count addresses it. |
| `HUMAN-CHAT-BLOCKER-01` | Why answering a question and updating dependent work are different, without inventing the reason an update is missing. |
| `HUMAN-CHAT-REPLAN-01` | How new evidence moves the diagnosis from the UI to the API, and why the already-authorized work changes direction. |
| `HUMAN-CHAT-REVIEW-01` | What a passing producer check establishes, what independent review adds, and why routine review needs no new user permission. |
| `HUMAN-CHAT-UNKNOWN-01` | What a launch acknowledgement does not establish, without making up activity to fill a quiet period. |

The prompts do not tell General to be educational or prescribe a response template. Judge the actual explanation, not its length, headings, use of a stock phrase, or whether `general.md` contains particular words. A jargon-heavy answer can be factually accurate yet fail to explain the mechanism; a long answer can still omit the useful finding.

Run the new cases with existing counterchecks for a short direct answer, a detailed requested handover, exact evidence, JSON-only output, and bounded completion:

```sh
bun run eval:live -- \
  --suite evals/conversation.json \
  --cases HUMAN-CHAT-EXPLAIN-01,HUMAN-CHAT-BLOCKER-01,HUMAN-CHAT-REPLAN-01,HUMAN-CHAT-REVIEW-01,HUMAN-CHAT-UNKNOWN-01,HUMAN-01,HUMAN-03,HUMAN-07,HUMAN-09,HUMAN-10 \
  --iterations 3 --parallel 4 --network host \
  --model <model>
```

### Verify update timing separately

These isolated `conversation-response` cases prove neither proactive updates nor their timing. They test replies to supplied context, with tools unavailable. The current semantic judge receives assistant text separately from tool calls/results, so an aggregate answer must not be treated as proof that an update appeared before a particular call.

Before claiming that live update timing works, inspect an ordered host conversation trace in a disposable project. Record the model, prompt revision, user request, user-visible messages, tool calls/results, and any gaps in the trace. Do not infer ordering from a final summary alone.

Use a bounded implementation request with a known failing regression check and explicitly requested independent review. Do not ask for progress updates in the baseline request: the point is to observe whether General volunteers them. Check these boundaries:

| Boundary | Required observation | Counterexample |
| --- | --- | --- |
| Before substantial work or delegation | General explains its understanding and next useful step before starting the substantial operation. | Tool calls begin with no orientation, followed only by a final report. |
| After implementation returns and before independent review | General explains the actual result, its limit, and why review comes next, then continues without seeking routine approval. | A silent handoff, only “Worker complete”, a claimed review PASS, or “Should I continue?” |
| New evidence changes direction or blocks work | At the next opportunity to speak, General explains the changed understanding, consequence, and known next step. | A tool diary, unexplained plan switch, or invented cause/progress. |
| Completion | General describes the bounded outcome and observed verification, preserving unresolved required work. | A pleasant summary that hides a failed check or claims whole-product readiness. |

Repeat with a user request for only the final result, and with an exact machine-readable output request. Conversational extras must not override those explicit preferences. A simple explanation should remain direct, not acquire a planning preamble.

A host may prevent General from speaking during a foreground child call. Assess orientation before that call and synthesis when control returns; do not require impossible mid-call messages, duplicate polling, or a switch to background execution. If the trace lacks ordered user-visible messages, report timing as unverified rather than assuming success or failure.
