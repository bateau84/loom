---
type: user-guide
title: Getting Started with Loom
description: Use Loom as a conversation-first engineering partner inside OpenCode.
tags: [user-guide, loom, getting-started, opencode]
---

# Getting Started with Loom

Loom runs inside OpenCode and presents one primary engineering partner. You describe the outcome; Loom decides which internal specialists and checks are needed.

## 1. Start OpenCode

Loom is designed to live in the OpenCode configuration root:

```text
$XDG_CONFIG_HOME/opencode
```

or, by default:

```text
~/.config/opencode
```

Once the Loom configuration is in place, start OpenCode normally:

```bash
opencode
```

There is no Loom mode to select before you start talking.

## 2. Talk normally

These requests stay conversational by default:

```text
What do you think about this design?
Compare these two approaches.
Do a deep dive on this library.
Why is this request failing?
Review this helper and tell me what you find.
```

Loom may use Research, Diagnostic, Brainstorm, or other internal capabilities, but you do not need to choose them.

Conversation is not permission to change the repository.

## 3. Ask Loom to execute when you want a change

Clear execution requests include:

```text
Fix this.
Implement the approach we agreed on.
Build it.
Apply this design.
Create the PR.
```

Loom then chooses the smallest delivery path that can safely complete the work.

### Task

Used for a clear bounded change or explicitly governed verification.

Typical implementation path:

```text
Worker → Reviewer → done
```

Research or diagnosis may come first when the cause or required facts are genuinely unknown.

### Change

Used when the bounded request needs new product-facing behavior, UX, or architecture decisions before implementation.

Loom routes only the missing authority to Designer, Specifier, or Architect, then continues through implementation and independent review.

### Objective

Used for broad product work that benefits from persistent planning and whole-product verification.

An Objective can include a holistic Plan, multiple implementation Waves, Product Acceptance, documentation sync, product review, and a final Critic gate.

**When the Plan needs to change:** explain the new finding or correction in the conversation. Loom's Planner can amend the current Plan as a new numbered revision even if work has started. Loom keeps earlier revisions for inspection; you can ask it to show what changed between revisions. Unchanged completed Tasks are reused only when their original result and evidence remain valid. Changed Tasks and affected dependents run again after a fresh independent Plan review. No earlier acceptance or review is silently carried forward.

You do not choose Task, Change, or Objective yourself.

## 4. Let Loom handle professional decisions

Loom should not ask you to make ordinary engineering choices.

It should normally resolve:

- implementation details;
- technical architecture inside accepted constraints;
- testing strategy;
- debugging hypotheses;
- researchable technical facts;
- work decomposition;
- routine review findings.

It should ask you when the unresolved choice is genuinely user-owned, such as:

- changing the product goal or material scope;
- choosing subjective product behavior not already settled;
- weakening an accepted guarantee;
- accepting material security, privacy, legal, financial, or destructive-operation risk;
- authorizing a hard capability boundary that Loom deliberately cannot grant to itself.

### Write-scope discovery and hard boundaries

Loom does not require General to predict every file an implementation will need before work starts. Inside the current project, an attached producing agent can expand its write scope when discovery reveals another required file or folder; Loom records that elevation and the agent continues in the same session.

Some paths are deliberately different. Writes outside the current project, through a symlink that resolves outside it, or into protected Git/Loom runtime state require an explicit user decision. Loom returns control and presents an exact menu:

- **Allow once** — authorize only the disclosed path(s) for that current step attempt;
- **Deny** — keep the boundary closed.

This approval is never remembered and does not become a standing policy.

## 5. Inspect progress

The normal interactive status view is the local control panel:

```text
http://127.0.0.1:54318
```

It starts automatically with Loom unless dashboard auto-start is disabled.

The control panel is organized around:

```text
Working directory → Session → Workflow
```

Detailed workflows can also expose Objective → Phase → Wave → Task state, open questions, evidence, review state, and acceptance progress.

See [Control panel](dashboard.md) for configuration and safety details.

## 6. Understand what "done" means

Loom does not treat a model saying "looks good" as proof.

Depending on the work, completion can require observed tests, runtime checks, independent review, Product Acceptance, or a final adversarial Critic pass. If a required check cannot be performed, Loom should report the missing evidence instead of turning it into a PASS.

Retries are bounded. Repeated work must produce new evidence, change the hypothesis/strategy, or reduce the unresolved set.

## 7. Stop or replace work explicitly

If you want an active governed workflow cancelled or replaced, say so clearly.

Loom preserves completed work and evidence. Cancellation does not undo repository changes or pretend unfinished gates passed.

## Optional: worktrees and model/provider profiles

Loom includes shell helpers for creating/reusing a Git worktree and starting OpenCode with a local profile:

- `scripts/ocw.sh`
- `scripts/ocw.zsh`
- `scripts/ocw.fish`

Example for Bash:

```bash
source ~/.config/opencode/scripts/ocw.sh
ocw feature-branch --profile openai
```

To inspect profile resolution:

```bash
ocw --profile openai --explain
```

The helper expects the selected profile and its CLI profile to already exist in the OpenCode config root. It does not create provider credentials for you.

## Next

- [Control panel](dashboard.md)
- [Runtime upgrades](upgrades.md)
- [Loom system map](../system/index.md)
