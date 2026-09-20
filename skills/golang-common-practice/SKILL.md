---
name: golang-common-practice
description: "Go style, verification, severity tiers, and agent-OS integration for code review and subagent dispatch. Use when writing or reviewing Go code, doing a Go review, dispatching a Go subagent, or applying the shared review tier to a Go finding. Load this alongside any `golang-*` skill. Defines the Go-specific layer on top of the system-wide `current Loom role directive and control-plane state`."
license: MIT
metadata:
  author: Bateau
  version: "1.1.0"
  adapted-from: samber/cc-skills-golang
---

# Go Common Practice

The Go-specific base layer for every `golang-*` skill in this set. The other skills describe *what* good Go looks like; this one describes *how you, the agent, operate* while applying them.

These are house skills, adapted from `samber/cc-skills-golang`. They are authoritative for this workspace; there is no further "company override" layer above them.

> **System protocols live in `current Loom role directive and control-plane state`.** Delegation (hub-and-spoke), escalation markers, the memory system, stagnation, and step-limit honesty are defined there and apply to all agents — this skill does not restate them. When a domain skill says something like "launch up to 5 parallel sub-agents," treat it as shorthand: **only `general` dispatches sub-agents** (per `current Loom role directive and control-plane state`). A spoke covers all the listed domains itself, sequentially, in one pass, then reports to `general`.

## Verification — the inner compile loop

Never hand back code you have not verified. After each meaningful change, run the inner compile loop and fix what it surfaces before continuing:

```bash
go build ./...
go vet ./...
go test ./...            # add -race when touching concurrency
golangci-lint run        # if the repo configures it
```

A skill's tool commands (e.g. `govulncheck ./...`, `go test -race`, `go test -fuzz`) are part of *your* verify step, not optional extras. Run them, read the output yourself, and apply fixes with an explanatory comment — do not rely on `--fix` flags to mutate code silently.

If you cannot make the loop pass after focused attempts, stop and escalate rather than looping indefinitely (see stagnation handling in `current Loom role directive and control-plane state`).

## Severity mapping (reviews and audits)

Domain skills score issues on their own scales (e.g. security uses Critical/High/Medium/Low with DREAD). When you report inside a review, map to the `reviewer` tiers so findings route correctly:

| Domain severity | Review tier | Action |
| --- | --- | --- |
| Critical / High | `CRITICAL` | Block. Must be fixed before merge. |
| Medium | `MAJOR` | Fix or get explicit sign-off. |
| Low / style | `MINOR` | Note; fix opportunistically. |

A `CRITICAL` finding warrants an `[ESCALATE: QUALITY]` back to `general`; a finding rooted in a design flaw warrants `[ESCALATE: ARCHITECTURE]` (markers defined in `current Loom role directive and control-plane state`).

## Strictness posture

These skills are intentionally strict. `MUST`/`NEVER`/`SHOULD` carry their RFC weight. The strictness is the point — it encodes conventions that hold *beyond* the current codebase, so apply them even when local code is inconsistent.

When you deliberately break a rule, **add a code comment** explaining why. An unexplained deviation reads as a mistake; an explained one reads as a decision.

**Agent navigability:** When human readability and agent navigability conflict, prefer the option that serves both; when they genuinely conflict, name the trade-off explicitly.

## Cross-reference style

Skills in this set reference each other by **bare local name** in backticks — e.g. "see the `golang-naming` skill", "→ See `golang-error-handling` skill". There is no `owner/repo@` prefix; every `golang-*` name resolves to a sibling skill in `~/.config/opencode/skills`.

## Diagnose before fixing

Prefer evidence over intuition. When a skill offers a `Diagnose:` step (a profiler, the race detector, `go vet`, `govulncheck`), run it and read the output *before* changing code. Confirm the hypothesis, then fix one thing, then re-measure.
