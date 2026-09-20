---
name: golang-common-practice
description: "Go verification, code-quality posture, and skill-family conventions for Loom-managed Go work. Load alongside any golang-* implementation/review skill. Methodology only; Loom owns routing, authority, evidence, and gates."
license: MIT
metadata:
  author: Bateau
  version: "2.0.0-loom"
  adapted-from: samber/cc-skills-golang
---

# Go Common Practice

The Go-specific base layer for the `golang-*` skill family.

## Loom boundary

This skill does not dispatch agents, define review severity, create escalation markers, or decide whether a workflow gate may pass. The active Loom role directive and control-plane state own those decisions.

Use this skill only to improve the quality and verification of already-authorized Go work.

## Inner verification loop

After each meaningful implementation change, run the checks applicable to the repository:

```bash
go build ./...
go vet ./...
go test ./...
golangci-lint run   # when configured
```

Add `go test -race ./...` when concurrency is load-bearing.

A domain skill may require stronger checks such as `govulncheck`, fuzzing, benchmarks, or profiling. Treat those as verification expectations when relevant.

Do not use automatic fix flags as a substitute for understanding changes.

When a Loom step relies on test/build/lint/security/runtime results, record them through Loom evidence according to the active role directive.

## Diagnose before fixing

Prefer evidence over intuition. Reproduce and inspect the failure before changing code. When profiling, race detection, static analysis, or runtime tracing is relevant, run the diagnostic first, change one causal factor, then re-check.

## Strictness posture

`MUST`/`NEVER`/`SHOULD` in the Go skills express engineering guidance, not Loom authority.

When local accepted architecture intentionally differs from a generic skill recommendation, current repository authority wins. Name the trade-off rather than silently forcing the generic pattern.

## Cross-reference style

Sibling skills are referenced by bare local name, for example `golang-testing` or `golang-error-handling`.

Load the smallest useful set rather than every Go skill.
