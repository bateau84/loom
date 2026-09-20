---
type: evaluation
title: Loom Behavioral Evals
description: Adversarial behavioral conformance system for Loom's model-driven roles.
tags: [evaluation, loom, behavioral, conformance, adversarial]
---

# Loom Behavioral Evals

These evals test whether Loom's model-driven roles follow the behavioral contract, not just whether the deterministic control-plane code is correct.

## Layers

### 1. Deterministic control-plane tests

`bun run test`

These prove rules implemented in code: workflow dependencies, OQ authority, evidence provenance, budgets, task scopes, Product Acceptance state, knowledge sync, intent state, and related mechanics.

### 2. Behavioral role evals

Cases under `evals/*.json` attack model behavior with fresh context.

Two execution modes exist:

- **runtime** — the target runs through real OpenCode with Loom's plugin and skills loaded. Tool assertions may be used. Use this when the runtime behavior itself matters.
- **role-decision** — the target role is run in fresh context with mutation/subagent tools denied. It must state the production decision/action it would take. This isolates authority and judgment behavior without fabricating a workflow.

Role-decision PASS is evidence about judgment/directive compliance. It is **not** evidence that the complete OpenCode workflow composes correctly.

### 3. Product dogfood

YuHaul remains the full-system acceptance proof. Behavioral evals do not replace the real product build and later cold-session maintenance exercise required by BR-015.

## Case shape

Each case includes:

- `id`
- target `agent`
- `execution` mode
- governing requirement IDs
- adversarial `prompt`
- the `trap` being tested
- positive `expectations`
- forbidden `must_not` behavior
- optional deterministic tool assertions

The semantic judge sees the observed assistant result and tool list. It must grade every positive and negative clause explicitly.

## Free validation

Normal CI runs:

```bash
bun run eval:validate
python3 -m py_compile scripts/run-evals.py
python3 scripts/run-evals.py --list
```

This spends no model inference.

## Live execution

Live evals are explicit because they consume model budget.

List cases:

```bash
bun run eval:list
```

Run a few cases using your existing OpenCode authentication:

```bash
bun run eval:live -- \
  --cases INTENT-01,REVIEW-01,WORK-01 \
  --model <provider/model> \
  --judge-model <different-provider/model>
```

Run the complete corpus only deliberately:

```bash
bun run eval:live -- --all --model <provider/model>
```

If `--judge-model` is omitted, the target model is reused as judge. A different model is preferred for adversarial independence.

The runner creates a fresh temporary OpenCode project per case. It copies the exact checked-out Loom agents/skills and, for runtime cases, the Loom plugin. It does not modify the user's real project or global Loom configuration.

Provider/model configuration is copied only for provider/model fields into an isolated config root. OpenCode's existing authentication remains available through its normal credential store.

Results are written to `.loom-evals/<CASE>.json`.

## Cost control

`eval:live` refuses to run unless either:

- `--cases ID1,ID2` is supplied, or
- `--all` is supplied explicitly.

There is no inference-bearing eval in normal PR CI.

## Interpreting failures

A failure may be:

1. **deterministic** — required/forbidden runtime tool behavior was violated;
2. **semantic** — the judge found a positive expectation missing or forbidden behavior present;
3. **harness/provider** — OpenCode/provider/judge execution failed.

Harness/provider failure is non-evidence. It must not be counted as behavioral PASS or FAIL.
