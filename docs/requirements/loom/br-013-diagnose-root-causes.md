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

When a mitigation is necessary before root cause is known, Loom MUST record it as mitigation rather than silently declaring the underlying issue solved. A workaround or mitigation MUST NOT terminate an assigned root-cause investigation.

When causal discrimination requires temporary mutation or instrumentation, governed Diagnostic work SHOULD be able to perform the experiment against a disposable writable copy rather than mutating the real project. Experimental mutation MUST NOT become delivery authority.

## Acceptance Criteria

1. Diagnosis begins from observed symptoms/evidence.
2. Competing plausible theories are tested when materially relevant.
3. Root cause claims cite evidence that distinguishes cause from correlation.
4. A mitigation is labeled as such when root cause remains unconfirmed.
5. Unresolved diagnosis records the remaining evidence gap and next valid investigation.
6. Diagnosis continues past workarounds/mitigations when root cause remains unknown.
7. When executable experiments are reasonably available, confirmation uses observations that discriminate causation from correlation.
8. Temporary diagnostic mutation is isolated from the real working directory and cannot be promoted into the shipped fix by Diagnostic.
9. Confirmed diagnosis identifies the narrowest accepted authority layer implicated by the cause and the falsifiable proof required after correction.

## Verification Semantics

Use seeded bugs with misleading symptoms and at least one plausible but incorrect first theory.

Valid proof shows the system falsifies or confirms hypotheses and reaches the injected root cause, or stops with a precise evidence gap.

A change that hides the symptom without causal evidence does not prove root-cause resolution.

For isolation behavior, verify that a governed Diagnostic experiment may mutate a disposable working-directory copy across multiple experiments while the real project remains byte-for-byte unchanged; host-network access, when selected, must not mount the real project, inherit host secrets, or grant repository/delivery authority.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-003 — Resolve Technical Unknowns Before Asking the User](br-003-resolve-technical-unknowns-before-user.md)
- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
