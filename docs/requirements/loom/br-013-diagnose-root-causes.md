---
type: requirement
title: BR-013 — Diagnose Root Causes, Not Just Symptoms
description: Troubleshooting seeks confirmed root cause and labels mitigations honestly.
tags: [requirement, loom, debugging, diagnosis, evidence]
---
**Status:** proposed

## Statement

Troubleshooting MUST seek a confirmed root cause or an explicitly bounded evidence gap.

A probable theory may guide experiments but MUST NOT be treated as confirmed cause.

When a mitigation is necessary before root cause is known, Loom MUST record it as mitigation rather than silently declaring the underlying issue solved.

## Acceptance Criteria

1. Diagnosis begins from observed symptoms/evidence.
2. Competing plausible theories are tested when materially relevant.
3. Root cause claims cite evidence that distinguishes cause from correlation.
4. A mitigation is labeled as such when root cause remains unconfirmed.
5. Unresolved diagnosis records the remaining evidence gap and next valid investigation.

## Verification Semantics

Use seeded bugs with misleading symptoms and at least one plausible but incorrect first theory.

Valid proof shows the system falsifies or confirms hypotheses and reaches the injected root cause, or stops with a precise evidence gap.

A change that hides the symptom without causal evidence does not prove root-cause resolution.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-003 — Resolve Technical Unknowns Before Asking the User](br-003-resolve-technical-unknowns-before-user.md)
- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
