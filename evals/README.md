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

Live execution uses the reusable OCI boundary from `bateau84/opencode-eval-runner`. Install Podman or Docker first. The target and semantic judge run in **separate fresh containers**.

Run a few cases with your existing OpenCode `auth.json`:

```bash
bun run eval:live -- \
  --cases INTENT-01,REVIEW-01,WORK-01 \
  --model openai/gpt-5.3-codex-spark
```

The harness chooses Podman first, then Docker. Override it explicitly with `--engine podman` or `--engine docker`.

The default image is:

```text
ghcr.io/bateau84/opencode-eval-runner:edge
```

The OpenCode transport automatically seeds the normal credential file when present:

```text
~/.local/share/opencode/auth.json
```

It does **not** inherit your global OpenCode config. Pass provider configuration only when the provider actually requires it:

```bash
bun run eval:live -- \
  --cases WORK-01 \
  --model my-provider/my-model \
  --provider-config /path/to/minimal-provider-config.json
```

API-key providers may use `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`.

### Independent judge

A different judge model is preferred:

```bash
bun run eval:live -- \
  --cases WORK-01,REVIEW-01 \
  --model openai/gpt-5.3-codex-spark \
  --judge-model openai/gpt-5.4
```

Target and judge still run in different containers even when they use the same model.

### GitHub Copilot CLI transport

Pure role-decision cases and the semantic judge may use GitHub Copilot CLI:

```bash
export COPILOT_GITHUB_TOKEN=...

bun run eval:live -- \
  --cases WORK-01,REVIEW-01,CRITIC-01 \
  --model gpt-5.4 \
  --target-transport github-copilot-cli \
  --judge-transport github-copilot-cli
```

Authentication precedence is:

```text
COPILOT_GITHUB_TOKEN
GH_TOKEN
GITHUB_TOKEN
```

Runtime cases such as `INTENT-01` require the `opencode` target transport because the eval asserts real Loom tool calls. A Copilot CLI judge can still be used with an OpenCode target:

```bash
bun run eval:live -- \
  --cases INTENT-01 \
  --model openai/gpt-5.3-codex-spark \
  --judge-transport github-copilot-cli \
  --judge-model gpt-5.4
```

Run the complete corpus only deliberately:

```bash
bun run eval:live -- --all --model <provider/model>
```

For each case, Loom creates separate target and judge projects. Runtime targets receive the checked-out Loom plugin/skills plus a read-only mount of the checked-out `node_modules`; judges receive only the judge agent. Container-local HOME/XDG/session state is discarded after every invocation.

Results are written to `.loom-evals/<CASE>.json`. Infrastructure/provider failures are classified as **non-evidence**, not behavioral FAIL.

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
