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

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md)

## Depends on

- [BR-003 — Resolve Technical Unknowns Before Asking the User](br-003-resolve-technical-unknowns-before-user.md)
- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
