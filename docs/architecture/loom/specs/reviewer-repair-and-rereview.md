---
type: architecture-spec
title: Reviewer Repair and Re-review Runtime
description: Runtime realization of bounded Reviewer repair, authorship-aware independent re-review, and Reviewer session continuity.
tags: [architecture, loom, review, session, repair]
---
**Status:** proposed

# Reviewer Repair and Re-review Runtime

## Authority

Realizes [BR-006](../../requirements/loom/br-006-independent-review-and-selective-critic.md) and [OC-001](../../requirements/loom/obligation-contracts/oc-001-review-repair-independence.md).

This mechanism applies only to implementation review. Reviewer acceptance bookkeeping for requirements, design, and architecture keeps its existing narrow semantic boundary.

## State

Each Reviewer gate may carry bounded review-control state:

- assignment mode: `review-only`, `repair-authorized`, or `independent-re-review`;
- last Reviewer session observed on the gate;
- preferred eligible Reviewer session for continuity;
- exact Reviewer session authorized to perform a repair;
- Reviewer sessions ineligible for independent approval because they authored repair;
- whether independent approval remains pending;
- immutable review/repair receipts.

A receipt records attempt, session, assurance classification, outcome, summary, evidence count/ids when present, and repository HEAD checked. Repair receipts additionally retain the authorized finding, change summary, and verification summary.

## Transitions

### Normal review and Worker repair

```text
review-only Reviewer B
  → FAIL
  → General reopens Worker
  → Worker repairs
  → review gate reopens with B as preferred resumable Reviewer
  → B refreshes evidence and rechecks
```

The preference is a continuity hint, not proof. General may request a fresh Reviewer when the old session is unhealthy or a cold review is required.

### Reviewer repair

```text
review-only Reviewer A
  → FAIL
  → General explicitly authorizes bounded repair for A
  → repair-authorized A
  → scope elevation + correction + verification + commit
  → self-verified repair receipt
  → independent-re-review remains pending
  → fresh non-authoring Reviewer B
  → PASS/FAIL
```

A's session ID becomes ineligible for the independent attempt. Redispatching or resuming A cannot bypass this check.

If B finds another defect and General assigns the correction back to A, B is retained as the preferred independent Reviewer for the next round because B did not author that correction.

## Runtime boundaries

- `loom_review_repair_authorize` is General-only and can authorize only a failed `review-implementation` gate. It identifies the exact existing Reviewer session that will repair and reopens the gate in repair mode.
- Reviewer repair does not receive product write scope automatically. The repairing Reviewer discovers exact paths and uses `loom_scope_elevate`; normal project/hard-boundary handling remains unchanged.
- `loom_review_repair_complete` is Reviewer-only, exact-session/attempt bound, requires committed owned mutations, captures the resulting HEAD and evidence, and reopens the same gate as an independent re-review. It never records a gate PASS.
- `loom_dispatch_grant` exposes `reviewMode`, `resumeSessionId` when continuity is preferred/required, and `freshSessionRequired` plus ineligible session IDs for independent re-review.
- `loom_attach` enforces exact repair-session identity and rejects known repair authors from independent re-review.
- Reviewer `loom_complete` PASS/FAIL records a review receipt tied to repository HEAD. PASS from a repair-authorized assignment is rejected; the repair-completion transition must occur first.
- Reopening producer work after a failed review retains an eligible non-authoring Reviewer session as a continuity preference and never converts prior self-verification into independent approval.

## Scope and permissions

Reviewer role configuration permits edits to reach the Loom runtime policy hook. Runtime scope remains fail-closed:

- review-only and independent-re-review begin with only Reviewer report/acceptance surfaces;
- only `repair-authorized` implementation review may self-elevate into product paths;
- acceptance-bookkeeping guards remain active on authority-review gates;
- Git staging/commit still require exact same-attempt ownership and current write scope.

## Completion and evidence

No self-verified low-risk completion class is enabled by this specification. Until durable authority defines one, every Reviewer-authored implementation repair that sits behind a mandatory implementation-review gate proceeds to independent re-review.

Downstream state may rely on a PASS only when its receipt's HEAD corresponds to the state that was reviewed. Producer/reviewer mutation followed by reopening resets affected gate state; old receipts remain history, not approval of newer bytes.
