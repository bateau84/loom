---
type: component
title: Loom Verification
description: Observed evidence, independent review, Product Acceptance, and final adversarial verification.
tags: [component, loom, verification, evidence]
---

# Verification

## Evidence Ledger

Non-Loom tool executions are observed by plugin hooks. Evidence claims reference observed events; prose alone cannot establish build/test/runtime success.

Source:
- `plugins/loom/evidence.ts`
- evidence hooks in `plugins/loom/index.ts`

## Review Layers

1. Worker self-check.
2. Observed mechanical evidence.
3. Reviewer implementation review.
4. Product Acceptance through the real assembled product.
5. Designer validation for human-facing products.
6. Reviewer product review.
7. Final Critic attack.

## Product Acceptance

Scenario state is workflow-local in `plugins/loom/acceptance.ts`. PASS requires Product Acceptance evidence claims. Upstream rework invalidates prior acceptance results.

## Independently supervised unit workload

The delivered scoped reliability first Wave provides a finite provider-free
`bun run test` path through `scripts/loom-isolation/container_driver.py run`
(`inner-tests` alias). A rootless OCI fixture contains a pinned bubblewrap/seccomp
inner boundary; the external parent verifies source/image/receipt binding and
actual namespace, mount, FD, capability, filter and recursive cgroup observations
before separately releasing imports/setup/tests. HOME/XDG/DB and Git are private
synthetic state. Environment redirection or passing tests alone is not this proof;
production databases/credentials are never verification inputs or an oracle.

See the [test image and supervisor usage guide](../../../scripts/loom-isolation/README.md)
for build/run commands, finite purpose operations, fixture security baseline,
source binding, evidence subjects, and refusal/cleanup semantics. Normal `run`
uses the approved per-container scoped `/proc/*` unmask and preexisting
`label=disable` baseline, not SELinux container process-label isolation. The
combined workload stream limit is 4 MiB; cross-stream interleaving is unproven.
Recursive-zero observation is distinct from the narrowly platform-qualified
retirement path; missing paths or errno alone do not establish cleanup.

The scoped Task passed independent implementation review at
`eb4703221e3a57337b197637ae9bf47481bb56b9`. Its refreshed producer run
`f6088b96f5fd46f2872cfac01a767803`, image
`sha256:cfc15833dd417780dba8b209f383e14d6c12ec63729e9bbce7bba5769e5b7dd0`,
passed 140 Python and 603 Bun tests. Reviewer assurance was independent
artifact/source inspection, not runtime replay. Older 741-test and fault-scenario
records retain their original subjects, not newly executed current-image proof.
Documentation changes invalidate selected-byte image binding for future runs;
the recorded image is not retroactively rebound to this updated tree.

This is a known-image/validated-platform workload path, not arbitrary-image or
whole-platform isolation, installation-wide stale-writer custody, repaired native
Git publication, upgrade/offline recovery, or whole-Objective acceptance. The
older `supervisor.py` manifest checkpoint still refuses without launching.
Model/provider/eval execution requires separate authorization and is not enabled
by this unit-test path; its image-contained eval-runner Python API is library-only.

## Behavioral Conformance

The corpus under `evals/` attacks model-driven failure modes such as user-herding, authority drift, fake verification, shallow diagnosis, unsafe planning, stale-memory authority, and incomplete Product Acceptance.

- `scripts/validate-evals.ts` validates case shape and BR traceability without inference.
- `scripts/run-evals.py` runs selected cases through isolated real OpenCode sessions and a fresh semantic judge.
- `.github/workflows/loom-live-evals.yml` exposes inference-bearing evals only through explicit manual dispatch.

Runtime cases provide composition/tool evidence. Role-decision cases provide fresh-context directive-compliance evidence. Neither replaces real YuHaul Product Acceptance.

## Depends on

- [Control Plane](control-plane.md)
- [Agent Runtime](agent-runtime.md)
