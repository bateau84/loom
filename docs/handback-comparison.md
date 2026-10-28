---
type: Architecture
title: "Historical handback comparison"
description: "Preserves a historical comparison of handback approaches and their limits."
tags: [loom, historical, handoff]
timestamp: 2026-10-24T00:00:00Z
---

# Historical handback comparison

The comparison at `c2db6e7` evaluated answer-to-primary followed by native
re-delegation to the same Worker Session against an earlier direct bridge.
The user reported independent acceptance of that narrow feasibility scope.
It did not establish live-model usefulness, current production transport or
overall alpha readiness. The compared assignment/delivery machinery is retired.

Current questions/answers do not require assignment registration or continuation
authorization. They use the simple model in [collaboration](collaboration.md),
including fail-closed recipient dispatch and one-shot first-answer resume of the
exact asking Session. There is no primary-first route, withdrawal/retry control,
startup replay or competing completion nudge in the current surface.

Historical evidence remains historical. Replacement CI/harness results must name
their own artifact, scenarios, substitutions and limits, rather than inheriting
the old six-scenario comparison's green status or counts. See
[qualification](sender-qualification.md) and [installed-host validation](installed-host-validation.md).
