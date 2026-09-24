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
