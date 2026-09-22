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

Cases under `evals/*.json` attack model behavior with fresh context. A case normally targets an agent. Cases with a `skill` field target that skill through the named production agent and must observe the native skill load.

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
- optional target `skill` (skill cases are runtime-only)
- `execution` mode
- governing requirement IDs
- adversarial `prompt`
- the `trap` being tested
- positive `expectations`
- forbidden `must_not` behavior
- optional deterministic tool assertions
- optional runtime action assertions that match a tool plus one concrete argument with `equals` or `ends_with`

Action assertions are runtime-only. They are evaluated against observed OpenCode tool actions and their captured input arguments. Use them when tool identity alone is insufficient—for example, to prove that Reviewer read a specific `ASSESSMENT.md` or Critic read a specific `QA.md`.

Assertions use stable semantic argument names. The harness currently normalizes OpenCode V2 aliases such as `skill.id` ↔ `skill.name` and `read.path` ↔ `read.filePath`, so behavioral cases do not become coupled to a transport-only parameter rename.

Example:

```json
{
  "actions": {
    "requires": [
      {"tool": "skill", "arg": "name", "equals": "golang-concurrency"},
      {"tool": "read", "arg": "filePath", "ends_with": "skills/golang-concurrency/ASSESSMENT.md"}
    ],
    "forbids": [
      {"tool": "read", "arg": "filePath", "ends_with": "skills/golang-concurrency/QA.md"}
    ]
  }
}
```

The semantic judge sees the observed assistant result and tool list. Deterministic tool/action assertions are evaluated separately and must also pass.

## Scenario authoring standard

Behavioral cases should resemble normal work, not instructions for passing the eval harness.

- Prefer realistic user, teammate, bug, feature, refactor, documentation, and release situations.
- Do not name a Loom mechanism in the prompt unless that mechanism itself is the behavior under test.
- Test both sides of authority boundaries. A good corpus checks that a role refuses work it does not own **and** acts decisively when the work is inside its authority.
- Include ordinary low-risk work as well as adversarial edge cases so the safest learned strategy is not simply to escalate everything.
- Vary domain, pressure, lifecycle state, and task size instead of cloning the same scenario with different nouns.
- In `role-decision` mode, expectations grade the production decision/action the role states; they must not require tool calls or completed side effects that the mode deliberately makes unavailable.
- In `runtime` mode, require observed actions when the behavior depends on actually using Loom tools.
- Keep harness plumbing, marker strings, container details, and judge instructions out of case prompts.

## Benchmark discipline

The behavioral corpus is Loom's model-behavior benchmark.

- When a realistic case fails consistently across fresh runs, change the agent/control-plane behavior by default; do not weaken the case just to make the score green.
- Change an eval only when independent evidence shows that its scenario, expectation, execution mode, or judge contract is unrealistic or measures harness behavior instead of production behavior.
- A proposed eval change must be defensible without referring to the model's current failure. "The model does not pass it" is not a reason to change the benchmark.
- Preserve hard cases that expose recurring production behavior even when they materially lower the aggregate pass rate.
- Track infrastructure/provider errors separately from behavioral FAIL so transport noise does not change benchmark meaning.

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

Run only skill cases, or one skill's cases:

```bash
bun run eval:live -- --target-kind skill --model openai/gpt-5.5
bun run eval:live -- --target-kind skill --target web-ui-design --model openai/gpt-5.5
```

Skill evaluation has two complementary sources:

- central runtime cases in `evals/skills.json` test production-role skill discovery and companion-methodology behavior with one normal runtime execution;
- skill-owned cases are discovered automatically from **every `*.json` file directly under `skills/<skill>/evals/`**, regardless of filename. Existing legacy shapes (`{skill,cases}`, `{skill_name,evals}`, and top-level arrays) are normalized at runtime.

Skill-owned cases use **ablation**, not the agent-eval one-shot contract. Loom runs the same prompt twice:

1. **baseline** — isolated model capability without the target skill available;
2. **candidate** — isolated model capability with only the target skill available/applied.

Both responses are judged independently against the same positive expectations, negative expectations, and named trap. The evidence artifact records:

- baseline absolute behavior score;
- candidate absolute behavior score;
- candidate absolute PASS/FAIL;
- score delta in percentage points;
- whether the skill fixed or introduced the named trap;
- a per-iteration skill-value classification: `material-improvement`, `improvement`, `neutral`, or `regression`.

A skill-owned case still returns PASS only when the **candidate** satisfies the full benchmark. A candidate that improves substantially but misses one requirement remains an absolute FAIL, while the artifact preserves the improvement instead of collapsing the result to one boolean.

A single baseline/candidate pair is one stochastic observation, not proof of stable skill value. Use multiple iterations (and preferably an independent judge model) when the delta itself is load-bearing. The classification describes the observed iteration; it is not a cross-model or statistical claim.

With OpenCode, the baseline project contains no target skill and the candidate project contains only that skill; candidate evidence must confirm a completed native `skill` load. With GitHub Copilot CLI, Loom supplies no skill methodology to the baseline and injects the target `SKILL.md` only into the candidate system context. This preserves the same controlled baseline/candidate contrast across transports.

Central native skill-routing cases still require `--target-transport opencode` because they assert real production-role `skill` loading and companion-file behavior. Skill-owned ablation suites are provider-neutral and may use OpenCode or GitHub Copilot CLI for target and judge.

Each skill-owned case therefore makes four model calls per iteration: baseline target, baseline judge, candidate target, and candidate judge.

The harness chooses Podman first, then Docker. Override it explicitly with `--engine podman` or `--engine docker`. For rootless Podman on SELinux hosts, Loom disables container SELinux labeling for the eval container rather than relabeling your repository or credential files.

The harness pins the runner images by digest so the Action source and container runtime cannot drift independently:

```text
OpenCode: ghcr.io/bateau84/opencode-eval-runner@sha256:6a0e00024f409a4ea01b5fa8dcaf586e78006f918d2de515f04f070072c1a063
Copilot:  ghcr.io/bateau84/opencode-eval-runner@sha256:588038d95a79a809af4e9862fcce037859fe89b019e6b23f1b5322955893db69
```

Override them independently with `--opencode-image` / `--copilot-image`, or use `--image` to force one explicit image for both transports. Changing the pinned runner revision and image digests is one compatibility update.

The OpenCode transport automatically detects the normal auth, V2 credential database, and model catalog when present:

```text
~/.local/share/opencode/auth.json
~/.local/share/opencode/opencode.db
~/.cache/opencode/models.json
```

The host database is never mounted directly. Loom creates a temporary schema-only database containing only provider credential rows and migration journals; session, project, message, event, and other runtime tables remain empty. The sanitized database, auth file, and model catalog are mounted read-only and copied into fresh writable XDG directories inside each eval container.

The model catalog is copied into the isolated cache. OpenCode V2 performs provider/model resolution during the real invocation; Loom does not use the obsolete `opencode models --refresh` path.

It does **not** inherit your global OpenCode config. Pass provider configuration only when the provider actually requires it:

```bash
bun run eval:live -- \
  --cases WORK-01 \
  --model my-provider/my-model \
  --provider-config /path/to/minimal-provider-config.json \
  --models-catalog /path/to/models.json \
  --database /path/to/opencode.db
```

API-key providers may use `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`.

For a custom/private provider catalog that should not be replaced from models.dev, pass it explicitly:

```bash
--models-catalog /path/to/models.json
```

An explicit catalog is copied into the writable isolated cache and used without running `--refresh`.

### Independent judge

A different judge model is preferred:

```bash
bun run eval:live -- \
  --cases WORK-01,REVIEW-01 \
  --model openai/gpt-5.3-codex-spark \
  --judge-model openai/gpt-5.4
```

Target and judge still run in different containers even when they use the same model.

### GitHub Actions credentials

`.github/workflows/loom-live-evals.yml` is manually runnable with `workflow_dispatch`. It uses `bateau84/opencode-eval-runner` as the action/execution boundary for target and judge invocations.

For OpenCode Zen/Go in Actions, add a repository secret named `OPENCODE_API_KEY`. Loom forwards it explicitly into isolated OpenCode target/judge containers. Use normal OpenCode model references:

```text
Zen: opencode/<model-id>
Go:  opencode-go/<model-id>
```

For example: `opencode/gpt-5.4` or `opencode-go/kimi-k3`. The existing `OPENCODE_AUTH_JSON` secret path remains available for credentials that must be represented through OpenCode's auth file rather than a provider environment variable.

Before result JSON is persisted under `.loom-evals/` or uploaded as an artifact, Loom redacts known provider/token environment values plus credential material discovered in auth/config JSON and the sanitized credential database. Raw model/tool evidence remains useful for diagnosis without intentionally preserving those credential values.

This redaction is defense-in-depth, not a trust substitute for hostile checked-out code. The live workflow executes repository-owned harness code while provider credentials are available to the eval step, so dispatch secret-bearing live evals only on refs you trust. Do not use a manual live run as an approval mechanism for untrusted pull-request bytes.

For GitHub Copilot CLI, the workflow grants `copilot-requests: write`. When either transport is `github-copilot-cli`, the action exposes the workflow's built-in `GITHUB_TOKEN` to the harness, and the runner passes it into the isolated Copilot invocation. No separate Copilot secret is required.

Use `target_kind` and `target` to run all agent cases, all skill cases, or a specific agent/skill on demand. A skill target is valid when it has central cases and/or one or more `*.json` files under `skills/<skill>/evals/`. For a selected skill, `cases` may use either the normalized global ID (for example `SKILL-web-ui-design-Web-01`) or the skill-local ID/name from its JSON file (for example `Web-01`). When `cases` is also supplied, it intersects with those target filters rather than being silently ignored. With `all=false`, at least one of `cases`, `target_kind != all`, or `target` must be explicit before inference starts.

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
gh auth token
```

For local runs, if no token environment variable is set and `gh` is authenticated, Loom automatically resolves `gh auth token` on the host and passes it into the isolated Copilot container. GitHub documents the GitHub CLI token as a supported Copilot CLI authentication fallback. The token value is not written to disk or placed on the container command line.

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

Each container emits one JSON result on stdout. The Loom host harness writes `.loom-evals/<CASE>.json` itself, so target/judge containers do not require a writable host bind mount. Infrastructure/provider failures are classified as **non-evidence**, not behavioral FAIL.

## Cost control

`eval:live` refuses to run unless selection is explicit through at least one of:

- `--cases ID1,ID2`;
- `--target name1,name2`;
- `--target-kind agent` or `--target-kind skill`;
- `--all`.

There is no inference-bearing eval in normal PR CI.

## Interpreting failures

A failure may be:

1. **deterministic** — required/forbidden runtime tool behavior was violated;
2. **semantic** — the judge found a positive expectation missing or forbidden behavior present;
3. **harness/provider** — OpenCode/provider/judge execution failed.

Harness/provider failure is non-evidence. It must not be counted as behavioral PASS or FAIL.
