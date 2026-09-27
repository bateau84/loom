---
type: user-guide
title: Loom User Guide
description: Entry point for using Loom through OpenCode.
tags: [user-guide, loom, navigation]
---

# Loom User Guide

Loom is meant to feel like one engineering partner, not a collection of agents you have to coordinate.

## Start here

- [Getting started](getting-started.md) — how to talk to Loom, when repository work begins, and what happens after you ask Loom to execute.
- [Control panel](dashboard.md) — inspect sessions, workflows, plans, progress, and cleanup state in the local dashboard.
- [Runtime upgrades](upgrades.md) — what to expect when Loom's durable runtime state changes across upgrades.

## Common questions

### Do I need to choose an agent?

No. Talk to Loom normally. Loom routes work to the appropriate specialist when needed.

### Does asking a question start a workflow?

No. Explanation, brainstorming, research, diagnosis, inspection, and findings-only review stay conversational by default.

A governed workflow starts when you clearly ask Loom to mutate the repository or explicitly ask for tracked/governed work.

### When will Loom ask me something?

Loom should resolve technical and implementation questions itself. It should ask you only when the remaining choice is genuinely yours, such as product scope, subjective behavior, weakening an accepted guarantee, accepting material risk, or authorizing a hard capability boundary that Loom cannot self-grant.

### How do I see what it is doing?

Open the local control panel at:

```text
http://127.0.0.1:54318
```

The dashboard starts automatically with the Loom plugin unless auto-start is disabled.

### What if Loom cannot finish safely?

It should stop with the completed work and evidence preserved, explain what is blocked, and avoid claiming success. Retry and dispatch loops are bounded.

## Deeper repository documentation

User guides describe how to operate Loom. For implementation and architecture details, use the [system map](../system/index.md).
