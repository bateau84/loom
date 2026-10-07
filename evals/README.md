---
type: evaluation
title: Loom Behavioral Evals
description: Adversarial behavioral conformance system for Loom's model-driven roles.
tags: [evaluation, loom, behavioral, conformance, adversarial]
---

# Loom Behavioral Evals

These evals test whether Loom's model-driven roles follow the behavioral contract, not just whether the deterministic control-plane code is correct.

## Authoring methodology

Use `skills/agent-eval` when designing or reviewing agent/role behavioral cases. Use `skills/skills-eval` when evaluating reusable skill value through ablation or native skill integration. The authoring skills (`agent-file-authoring` and `skill-authoring`) decide when evaluation is needed and hand off to these eval skills.

This README remains the harness and execution reference: case shapes, transports, artifact semantics, commands, and benchmark-wide rules live here. The two eval skills own the reusable case-design method.

## Layers

### 1. Deterministic control-plane tests

`bun run test`

These prove rules implemented in code: workflow dependencies, OQ authority, evidence provenance, budgets, task scopes, Product Acceptance state, knowledge sync, intent state, and related mechanics.

### 2. Behavioral role evals

Cases under `evals/*.json` attack model behavior with fresh context. A case normally targets an agent. Cases with a `skill` field target that skill through the named production agent and must observe the native skill load.

Three execution modes exist:

- **runtime** — the target runs through real OpenCode with Loom's plugin and skills loaded. Tool assertions may be used. Use this when the runtime behavior itself matters.
- **role-decision** — the target role is run in fresh context with mutation/subagent tools denied. It must state the production decision/action it would take. This isolates authority and judgment behavior without fabricating a workflow.
- **conversation-response** — the target role answers supplied context with tools denied. This isolates user-facing communication, evidence selection, and format behavior without turning conversation into execution.

Role-decision PASS is evidence about judgment/directive compliance. It is **not** evidence that the complete OpenCode workflow composes correctly.

### 3. Product dogfood

YuHaul remains the full-system acceptance proof. Behavioral evals do not replace the real product build and later cold-session maintenance exercise required by BR-015.

## Suite organization

Top-level suites are grouped by **behavioral topic**, not by the historical bug or PR that introduced a case:

- `conversation.json` — conversational boundaries, human-facing status/evidence/format behavior, and opt-in conversational runtime probes.
- `intent-and-routing.json` — intent shaping, OQ routing, execution transitions, and orchestration entry decisions.
- `delegation-and-convergence.json` — professional ownership, Worker/Reviewer convergence, scope recovery, and shared-method routing.
- `agent-behavior.json` — cross-role behavioral edge cases that do not belong to one narrower topic.
- `authority.json` — role authority boundaries.
- `everyday.json` — ordinary representative engineering work.
- `proportionality.json` — Task/Change/Objective depth and escalation.
- `verification.json` — evidence, Reviewer/Critic, diagnosis, acceptance, planning, memory, and verification integrity.
- `skills.json` — production-role skill loading and companion-method behavior.

Execution cost is case metadata, not suite taxonomy. A case may set `"default": false` to stay opt-in while remaining in its natural topic suite. Explicit `--suite` selection includes all cases in that suite, and explicit `--cases` selection opts into the named cases even without `--suite`; ordinary/default discovery excludes opt-in cases.

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
- optional runtime action assertions that match a tool alone or a tool argument with `equals`, `ends_with`, or `contains`; `actions.any_of` groups accept any one equivalent action

Action assertions are runtime-only. They are evaluated against observed OpenCode tool actions and their captured input arguments. Use them when tool identity alone is insufficient—for example, to prove that Reviewer called `loom_assessment(skill=...)` or Critic called `loom_qa(skill=...)`. Plain reads of companion paths are not methodology-use evidence because the file may instead be under authoring or inspection. `output.contains` and `output.forbids` assert literal text in the target model's final user-facing output.

Assertions use stable semantic argument names. The harness currently normalizes OpenCode V2 aliases such as `skill.id` ↔ `skill.name` and `read.path` ↔ `read.filePath`, so behavioral cases do not become coupled to a transport-only parameter rename.

String argument assertions support `contains` for one required fragment and `contains_all` for multiple fragments that must all occur in the **same observed argument value**. Use `contains_all` when a Code Mode assertion must bind an operation to its intended subject, for example both `tools.loom.code.assessment(` and `golang-concurrency`.

Example:

```json
{
  "actions": {
    "requires": [
      { "tool": "skill", "arg": "name", "equals": "golang-concurrency" },
      {
        "tool": "loom_assessment",
        "arg": "skill",
        "equals": "golang-concurrency"
      },
      { "tool": "execute", "arg": "code", "contains": "tools.browser.preview" }
    ],
    "any_of": [
      [
        { "tool": "loom_status" },
        {
          "tool": "execute",
          "arg": "code",
          "contains": "tools.loom.code.status"
        }
      ]
    ],
    "forbids": [
      { "tool": "loom_qa", "arg": "skill", "equals": "golang-concurrency" }
    ]
  }
}
```

The semantic judge sees the observed assistant result and tool list. Deterministic tool/action assertions are evaluated separately and must also pass.

## Case-design methodology

Runtime cases may also declare `tool_results.requires` or `tool_results.forbids` to check an actual captured result from one exact tool call, not just that the call was attempted. Each assertion selects by `tool` plus a non-empty `args` map, then checks `status`, `output_contains`, `output_contains_all`, or a parsed JSON `json_path`/`equals` pair. `occurrence` selects the 1-based matching call; `after` requires a preceding observed tool call with its own exact tool/input. These fields let a case prove a denial was followed by an unchanged durable state, rather than merely seeing a status from some other point in the turn. Checks fail closed when result evidence is missing, truncated, malformed, or omits events; uncertain forbidden results fail rather than silently counting as absent. Code Mode inner actions are recognized only from the raw structured `state.metadata.metadata.toolCalls` records captured on an observed `execute` event; the harness preserves their exact tool/input and parent-call identity. These invocation records do not by themselves contain per-inner results. The parent `execute` output is an aggregate and is never assigned to a child call; if per-inner output is missing, result-dependent assertions are classified as non-evidence rather than a model failure. An `execute` code string, returned prose, caught error, or discarded return does not establish nested execution. If the transport exposes only a wrapper (or malformed/missing nested metadata), assertions requiring the inner call are unsupported and fail closed as non-evidence. Use a subsequent independently captured status result and JSON path assertions for durable state; tool call counts or the target's prose are not state proof.

## Scenario authoring standard

Use `skills/agent-eval` for agent/role behavioral case design and `skills/skills-eval` for skill-value or native skill-integration case design. Those skills own scenario realism, oracle quality, boundary coverage, benchmark-hardness, and anti-overfitting methodology.

This README defines the harness contract and execution semantics only.

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

### Parallelism and runtime evidence

`--parallel N` parallelizes non-runtime eval work. Runtime cases are serialized by default even when `--parallel` is larger than one.

That distinction is deliberate: one runtime case can already dispatch multiple model-backed Loom subagents internally. Running several runtime cases concurrently changes a behavioral repeatability run into a provider/OpenCode load test and can create wall-clock timeout noise unrelated to the behavioral contract.

Use repeated runtime cases for behavioral stability like this:

```bash
bun run eval:live -- \
  --cases PROP-RUNTIME-01 \
  --iterations 3 \
  --parallel 3 \
  --model openai/gpt-5.6-luna
```

The runtime iterations still execute sequentially; unrelated role-decision/skill cases may use the ordinary parallel budget.

### Budget-continuation incident regression

The budget-continuation cases seed an already-existing unfinished Worker whose ordinary and automatic recovery dispatches are exhausted, then send the same kinds of user requests that exposed the production deadlock. The seed is setup only: recovery itself must use the production Loom tools and a real Worker subagent attachment.

They live in `delegation-and-convergence.json` as case-level opt-ins. Run both conversational forms three times on the normal Loom model:

```bash
bun run eval:live -- \
  --suite evals/delegation-and-convergence.json \
  --cases BUDGET-CONTINUE-RUNTIME-QUOTA-01,BUDGET-CONTINUE-RUNTIME-SAME-OBJECTIVE-01 \
  --iterations 3 \
  --parallel 1 \
  --network host \
  --model openai/gpt-5.6-luna
```

A valid run must observe `loom_budget_continue -> loom_status -> loom_dispatch_grant -> Worker dispatch -> loom_attach` against the seeded workflow `eval-budget-continuation`. Starting replacement work, stopping after budget mutation, or merely describing recovery fails the case.

To intentionally stress concurrent runtime execution, opt in explicitly:

```bash
bun run eval:live -- \
  --cases PROP-RUNTIME-01 \
  --iterations 3 \
  --parallel 3 \
  --runtime-parallel 3 \
  --model openai/gpt-5.6-luna
```

Results from `--runtime-parallel >1` are load/stress evidence as well as behavioral evidence. Provider or wall-clock timeout failures from that mode should not be interpreted as a semantic regression without reproducing them under normal serialized runtime execution.

### Transient transport retries

The harness retries only a narrow pre-execution provider-routing failure: `provider.no-route` with `Model unavailable`. The default is two retries and can be changed with `--transport-retries 0..5`.

Retry is allowed only when no tool/action has been observed. If the invocation already used a tool—whether surfaced through the tool list, structured actions, or raw `tool_use` events—it is not retried, because replay could duplicate side effects. Exhausted retries remain non-evidence transport failures; they are never converted into behavioral PASS/FAIL.

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

Skill ablation is deliberately **reasoning-only**. Baseline and candidate projects are mounted read-only. OpenCode wrappers additionally deny shell/edit mutation and carry a system-level inline-output boundary that remains authoritative over later native skill-tool results. Copilot reasserts the same inline-output boundary after candidate skill methodology is injected into its system context. A skill that normally persists a durable artifact should apply its content/format methodology without writing the artifact during ablation. This keeps the judge's evidence surface identical for baseline and candidate and prevents a production-oriented persistence instruction from scoring as an apparent regression merely because the judge cannot see a container-local file.

Central native skill-routing cases still require `--target-transport opencode` because they assert real production-role `skill` loading and companion-file behavior. Skill-owned ablation suites are provider-neutral and may use OpenCode or GitHub Copilot CLI for target and judge.

A complete skill-owned pair makes four model calls per iteration: baseline target, baseline judge, candidate target, and candidate judge. If a side lacks usable evidence, the generic engine does not invent a missing judge result or score.

Reasoning effort is part of benchmark provenance. Use `--reasoning LEVEL` to pin the same explicit level for target and judge, or `--target-reasoning` / `--judge-reasoning` to override either side. Loom forwards the requested level to the eval runner, which maps it to the transport-native control (OpenCode model variant or Copilot reasoning effort). If no reasoning flag is supplied, Loom sends no override. For OpenCode, an explicit `#variant` already present in the model reference is recorded with source `model-variant`; otherwise the artifact records `provider-default` rather than inferring the provider's current default. Artifacts also record target/judge reasoning source. Skill-ablation baseline and candidate always share the same resolved target reasoning level.

Skill-owned cases now use the generic paired Python API from `opencode-eval-runner` (runner #64). Loom's `eval:live` wrapper starts `scripts/run-skill-ablation.py` for these cases; there is no runner paired CLI flag. The generic engine executes both sides, checks required runtime evidence, manages safe retries and judges, and writes/validates the paired artifacts. Loom alone owns skill-specific prompts, loading, traps, score/delta thresholds, absolute PASS/FAIL, and the comparison decision.

By default, each live invocation writes into `.loom-evals/<generated-run-id>/`. An explicit `--artifact-dir` must be empty. Normal cases use generic single-case artifacts. Skill-owned cases use `opencode-eval-runner/eval-paired-artifact/v1` at `pairs/<case>/iteration-N.json`, with independently validated baseline/candidate side artifacts, a comparison envelope, and a pair integrity ID. The generic artifact store claims directories and verifies durable writes before a case verdict is reported. Comparison remains **non-evidence** when either side is unusable; the harness does not substitute a zero score.

The artifact evidence IDs are **content fingerprints**, not signatures or proof against a process with write access. Keep the artifact directory inside an appropriate trusted storage boundary if tamper authentication matters. Normal and skill-owned cases selected together use separate `normal/` and `skill-ablation/` subdirectories beneath the chosen run root.

Example:

```bash
bun run eval:live -- \
  --cases Design-01,Design-02 \
  --model openai/gpt-5.6-luna \
  --judge-model openai/gpt-5.6-luna \
  --reasoning medium
```

The harness chooses Podman first, then Docker. Override it explicitly with `--engine podman` or `--engine docker`. For rootless Podman on SELinux hosts, Loom disables container SELinux labeling for the eval container rather than relabeling your repository or credential files.

The harness pins the runner images by digest so the Action source and container runtime cannot drift independently:

```text
OpenCode: ghcr.io/bateau84/opencode-eval-runner@sha256:3e5f95ce54fee127230c5bf84a7f09124a2236dfca544269e6547c8f79e8ad5d
Copilot:  ghcr.io/bateau84/opencode-eval-runner@sha256:8def0aa1885b0e60b36a1434c2725667b1b9555def31426f08dd7e2a87dc02c5
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

Each container emits one JSON result on stdout. The Loom host harness writes case JSON into the current run-owned artifact directory (by default `.loom-evals/<eval_run_id>/`), so target/judge containers do not require a writable host bind mount. Infrastructure/provider failures are classified as **non-evidence**, not behavioral FAIL.

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

## Conversation-first tests and explicit cost boundaries

- `role-decision` checks the next production decision with tools denied.
- `conversation-response` checks a user-facing answer from supplied context with tools denied. It receives no decision-only prompt suffix.
- `runtime` runs the real host/plugin and may invoke model-backed specialists.

`CONVERSATION-02` covers research routing. `CONVERSATION-02-SYNTH` supplies a mock Research brief for synthesis, trade-offs, and source preservation. Neither invokes a Research model. The reference check counts distinct supplied URLs, not repetitions or invented references; the semantic judge still checks the comparison.

Every top-level suite remains discoverable and schema-validated. Both suites and individual cases may set `"default": false`. Ordinary discovery excludes opt-in suites/cases; explicit `--suite` includes every case in that suite, while explicit `--cases` opts into exactly the named cases. `--all` without an explicit suite remains bounded to the default corpus. Omitted `default` means true; malformed metadata fails rather than silently spending inference.

Real nested research is opt-in:

```sh
bun run eval:live -- --suite evals/conversation.json --cases CONVERSATION-02-LIVE --iterations 1 --network host --model <model>
```

That case retains a 360-second target limit with at least 420 seconds for the outer container. Other cases keep the global defaults. Runtime cases remain serialized unless `--runtime-parallel` explicitly requests load testing; `--parallel` applies to non-runtime tests.

A mocked synthesis PASS proves only the response from supplied context. It does not prove that Research ran, that the mock describes the current repository, or that the complete runtime interaction passed. Record the tested revision and distinguish focused results from a full same-head suite run.

## Automatic durable knowledge: routing is not persistence proof

`AUTO-ORCHESTRATION-01` checks the bounded Change route and its independent
implementation verification. A terse routing decision is not proof that repository
artifacts were written, and omission of a document announcement alone is not proof
that they would be omitted.

Two additional default, tool-less probes exercise the actual responsibility:

- `AUTO-ORCHESTRATION-01-HANDOFF` asks for specialist assignments, without telling
  General which document types to select. The returned assignments must require
  retrievable design, behavioral, and architecture outputs, scoped to their owners
  and ordered through independent review.
- `AUTO-ORCHESTRATION-01-RECORDS` supplies useful chat and temporary run reports
  while the governing repository documents are still stale. General must return
  the pending work to its owners and preserve the review boundary rather than
  advance on chat-only authority or promote reports as a substitute.

All three probes form the targeted routing/knowledge check. Do not reuse historical
results under the previous combined rubric as passes for this split. The existing
mechanical-edit control still rejects unnecessary authority documents.

These probes run General plus the judge only, with tools denied. They test stated
assignments and continuation decisions, not actual file writes or end-to-end
specialist execution. Runtime artifact creation and independent review need their
own observed evidence; neither a mock PASS nor wording about documents proves them.

## Delegation and convergence

`delegation-and-convergence.json` groups the professional-work cases by the behavior they exercise: Worker outcome ownership, mutation-scope versus knowledge-scope, General outcome-not-method delegation, known-incomplete work not being sent to Reviewer, Reviewer finding convergence, multi-Wave continuation, cross-artifact correction ownership, narrow-scope recovery, and shared-method routing.

The provider-expensive runtime cases live in the same topic suite with case-level `"default": false`. Run them explicitly when changing professional delegation, convergence, scope recovery, or shared-method routing contracts.

`skills/agent-file-authoring/evals/professional-charter.json` uses baseline/candidate ablation to test whether the authoring skill actually produces slimmer professional charters without dropping hard authority, evidence, completion, scope, or review boundaries.

`skills/report-lifecycle/evals/report-lifecycle.json` and `skills/loom-learning/evals/learning.json` ablate the shared cross-cutting methodologies that replaced repeated role-prompt procedure.

Evals verify production behavior; they never create it. Every required behavior must have a production home in control-plane enforcement, an agent charter, or shared methodology that the production role actually loads.
