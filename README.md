# Loom

Loom is a conversation-first agent operating system for [OpenCode](https://opencode.ai/).

You talk to **Loom** as one engineering partner. Loom decides when it needs research, design, specification, architecture, planning, implementation, review, QA, documentation, or product acceptance. You should not need to pick agents or manually manage normal handoffs.

Loom is built around one rule: **evidence beats model confidence**. Work is bounded, important changes are independently reviewed, and Loom stops when it cannot safely prove completion.

## What using Loom looks like

You can use Loom for normal engineering conversation without starting a workflow:

- ask questions or compare options;
- brainstorm an idea;
- request a deep technical investigation;
- diagnose a failure;
- inspect or review something.

When you clearly ask Loom to change the repository — for example **"fix this"**, **"build it"**, or **"create the PR"** — Loom crosses into governed execution and chooses the smallest safe delivery path.

| Work | Typical path |
| --- | --- |
| Small, clear change | Worker → Reviewer |
| Change that needs new UX, behavior, or architecture decisions | Relevant specialist(s) → Worker → Reviewer |
| Broad product work | Specialists → Critic → Planner → Plan review → Workers → Product Acceptance → product review → final Critic |

These paths are selected automatically. They are not user-facing modes.

For a fuller explanation, see [Getting started](docs/user/getting-started.md).

## Current capabilities

Loom currently provides:

- conversation-first routing with one primary user-facing identity;
- fresh specialist contexts for design, specification, architecture, research, diagnosis, planning, implementation, review, QA, acceptance, and documentation;
- bounded Task, Change, and Objective workflows;
- persistent Objective → Phase → Wave → Task planning;
- traceable write scopes that can grow during project-local discovery, with exact specialist/step attachment;
- independent review and selective adversarial Critic gates;
- evidence tracking for tests, runtime checks, and acceptance;
- bounded retry and dispatch budgets;
- explicit one-time user approval for writes that cross Loom hard boundaries such as the current project or protected runtime/Git state;
- cross-role open questions without turning every uncertainty into a user question;
- project/session isolation and durable runtime upgrades;
- living repository knowledge and evidence-backed learning;
- an automatically managed local dashboard for workflow status.

The current system map is in [docs/system/index.md](docs/system/index.md). Product intent is defined by the accepted [Loom Anchor](docs/anchors/loom/anchor.md).

## OpenCode setup

Loom is designed to be the global OpenCode configuration/plugin bundle. The included helpers resolve that configuration from:

```text
$XDG_CONFIG_HOME/opencode
```

or, when `XDG_CONFIG_HOME` is not set:

```text
~/.config/opencode
```

Keep or link this repository at that configuration root using the setup method that fits your machine. Do not overwrite an existing OpenCode configuration without preserving anything you still need.

Once Loom is available as the OpenCode configuration, start OpenCode normally:

```bash
opencode
```

Then talk to Loom normally. No Loom-specific command is required to begin a conversation.

### Optional worktree/profile launcher

The repository includes Bash, Zsh, and Fish helpers under `scripts/ocw.*`. They can create or reuse a Git worktree and start OpenCode with a local model/provider profile.

Example for Bash:

```bash
source ~/.config/opencode/scripts/ocw.sh
ocw feature-branch --profile openai
```

Inspect the resolved profile without starting normal work:

```bash
ocw --profile openai --explain
```

Profiles are local OpenCode configuration. The helper expects the selected profile and matching CLI profile to exist under the OpenCode config root.

## Dashboard

The local control panel starts automatically with the Loom plugin.

Default URL:

```text
http://127.0.0.1:54318
```

It shows working directories, sessions, workflows, plans, progress, open questions, verification state, and failed/cancelled workflow cleanup.

See [Dashboard guide](docs/user/dashboard.md) for port overrides, foreground/debug operation, cleanup behavior, and the security boundary.

> Do not expose the dashboard directly to the public internet. It is loopback-only by default and does not provide shared-host user authentication.

## User documentation

Start at [docs/user/index.md](docs/user/index.md).

- [Getting started](docs/user/getting-started.md) — how to talk to Loom, when execution begins, what Loom handles, and how to inspect progress.
- [Dashboard](docs/user/dashboard.md) — control-panel usage and safety.
- [Runtime upgrades](docs/user/upgrades.md) — upgrade and resumed-session behavior.

## Development and behavioral evals

Install repository dependencies with your normal Bun workflow, then use the repository scripts below.

Validate the eval corpus without model calls:

```bash
bun run eval:validate
```

List available cases:

```bash
bun run eval:list
```

Run one live case:

```bash
bun run eval:live -- \
  --cases INTENT-01 \
  --model openai/gpt-5.5
```

Run the full behavioral system suite once:

```bash
bun run eval:system -- \
  --model openai/gpt-5.5
```

Run repeated cases with bounded parallelism:

```bash
bun run eval:live -- \
  --all \
  --model openai/gpt-5.5 \
  --iterations 3 \
  --parallel 4
```

The shorthand stress command runs three iterations of every case with concurrency capped at four:

```bash
bun run eval:stress -- \
  --model openai/gpt-5.5
```

Use `--parallel` without a number for the whole selected matrix, or `--parallel N` to cap concurrency. The default is sequential execution.

Each live invocation gets a generated run ID. Without `--artifact-dir`, artifacts are isolated under:

```text
.loom-evals/<RUN-ID>/<CASE>.json
.loom-evals/<RUN-ID>/<CASE>.iteration-<N>.json
```

An explicit `--artifact-dir` is a single-run evidence destination and must be empty before the run starts.

Runtime cases use isolated OpenCode target containers with Loom injected into the standalone runtime. Target and judge run separately.

Runtime PASS now requires valid `opencode-eval-runner/runtime-evidence/v1`,
from [runner PR #45](https://github.com/bateau84/opencode-eval-runner/pull/45).
Missing, invalid, incomplete, or unsupported required evidence is reported as
`non-evidence` and skips the judge. Diagnostic tool results cannot fill gaps.
The current whole-trace judge requires exact inputs, identities, and terminal
results/errors across its observed calls. Native-only traces can pass despite
unsupported Code Mode finality; traces with inner Code Mode calls cannot yet
pass this result-reading judge on stock 2.0.23. This does not mark their behavior
as failed. See [consumer scope and verification](scripts/fixtures/runtime-evidence-v1.md).

## Repository maps

- [User guides](docs/user/index.md)
- [System map](docs/system/index.md)
- [Autonomous product workflow](docs/system/flows/product-workflow.md)
- [Requirements](docs/requirements/loom/index.md)
- [Architecture](docs/architecture/loom/index.md)
- [Design](docs/design/loom/index.md)
- [Skills and methodology](skills/README.md)
