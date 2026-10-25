---
type: Log
---

# Update Log

## 2026-10-25

**Investigation**: [OpenCode Go subscription eligibility](opencode-go-eligibility.md) —
Pinned OpenCode 2.1.4 native source shows only opaque connection IDs and
provider/model metadata, not a verified Go entitlement, Extra Usage state or
pre-request no-paid guarantee. The current Console documents billing_source
and allowance **after** a request, while Extra Usage can draw on paid balance.
No Go adapter was implemented. Added deterministic routing negative-control
tests to retain `billing: unknown` for active Go connections without a verified
external attestation. Automatic Go included routing remains blocked pending a
supported account-bound subscription-only contract.

## 2026-10-24

**Implementation**: [Initial OpenCode 2.1.4 model routing](model-routing.md)
added `src/model-routing-runtime.ts` and
`src/model-routing-adapter.ts` to apply role-selected eligible native models
with exact reasoning variants, opaque native connection and verified-billing
checks, cooldown/attestation interface, and a pre-dispatch guard that rejects
unexpected or ineligible provider calls. Added focused pure and mock V2
adapter tests plus the isolated 2.1.4 installed-host negative-control workflow.
Native stream/account leasing and live fallback remain unproven and are not
implemented. [V2 dispatch investigation](model-routing-v2-dispatch.md)
records the updated seam and restrictions; [README](../README.md) explains
the host/SDK combination. Routing disabled preserves native behavior.


**Creation**: [OpenCode 2.1.1 model-dispatch investigation](model-routing-v2-dispatch.md) —
Audited the pinned V2 request, retry, model resolver and stream/tool boundaries.
Recorded the absent atomic pre-output route-change seam, unproven account affinity,
rejected unsafe workarounds, the separate opaque quota-attestation interface and
minimal upstream host changes required. Source-only; no live failover or host
qualification claimed. [Model routing](model-routing.md), the
[compatibility guide](opencode-2.1.1.md), and this [index](index.md) now link
that blocker. No runtime behavior changed.


**Update**: [`design.md`](design.md) now links to the three indexed
concern requirements rather than the reserved nested `index.md`.
[`installed-host-validation.md`](installed-host-validation.md),
[`manual-backup-restore.md`](manual-backup-restore.md),
[`read-consistency.md`](read-consistency.md),
[`retrieval-limits.md`](retrieval-limits.md), and
[`tools.md`](tools.md) now link to indexed files while preserving intended
section titles in prose. The backup guide refers to the repository `README.md`
without treating it as an OKF concept. [`handoffs.md`](handoffs.md) and
[`reviewer-corrections.md`](reviewer-corrections.md) gained grounded references
to their existing implementation contracts. No new dependency obligations.

**Creation**: [Repository OKF profile](../.okf-profile.yaml) — Declared
the observed concept types and evidence-backed `references` and `depends-on`
heading relationships. No unsupported cardinality obligations were added.

**Update**: [`model-routing.md`](model-routing.md) — Linked the actual
configuration decoder and OpenCode compatibility contracts under
`Depends on`, establishing typed edges grounded in the draft implementation.

**Update**: [`index.md`](index.md) and [README](../README.md) —
Documented profile discovery at the repository scan root, restart semantics,
and the distinction between local source checks and live graph verification.

**Verification**: Extended `tests/okf-native.test.ts` with a profile
vocabulary/alias and grounded-link regression check. Real `okf-mcp`
profile loading and graph-integrity acceptance remain unverified.

**Update**: Added OKF concept metadata (type, title, description, tags and
timestamp) to 24 previously unindexed documents, in three groups:

- [assignment-delivery.md](assignment-delivery.md), [collaboration.md](collaboration.md), [configuration-limits.md](configuration-limits.md), [configuration-parser.md](configuration-parser.md), [context-relevance.md](context-relevance.md), [coordination.md](coordination.md), [design.md](design.md), [evidence-reliability.md](evidence-reliability.md).
- [handback-comparison.md](handback-comparison.md), [handback-experiment.md](handback-experiment.md), [handoffs.md](handoffs.md), [manual-backup-restore.md](manual-backup-restore.md), [migration.md](migration.md), [model-routing.md](model-routing.md), [opencode-2.1.1.md](opencode-2.1.1.md), [processing-limits.md](processing-limits.md).
- [read-consistency.md](read-consistency.md), [retrieval-limits.md](retrieval-limits.md), [review-companions.md](review-companions.md), [reviewer-corrections.md](reviewer-corrections.md), [sender-qualification.md](sender-qualification.md), [task-selection-recovery.md](task-selection-recovery.md), [tool-discovery.md](tool-discovery.md), [tools.md](tools.md).

**Update**: [`index.md`](index.md) now inventories every direct concept
(28 documents), the nested [requirements bundle](requirements/index.md), and the
change log. This replaces the old four-concept classification: earlier
2026-10-24 notes describing `model-routing.md` as outside that bundle are
superseded. Existing nested bundle ownership is unchanged.

**Creation**: `model-routing.md` — Documented the draft role-based model
classes, provider-first fallback policy, billing guardrails, and the separate
runtime adapter work still required. This is supporting Markdown outside the
four-source OKF bundle; it does not claim live OpenCode V2 quota failover —
[Draft: provider-first model routing](/docs/model-routing.md).

**Update**: `index.md` — Added the model-routing guide to the supporting-
document inventory without adding it to the OKF source bundle —
[bundle index](/docs/index.md).

**Update**: `log.md` — Recorded the new supporting guide and index change —
[change log](/docs/log.md).

## 2026-10-22

**Update**: `review-companions.md`, `README.md`, the companion loader and
regression tests — Supported OpenCode's flat `<skill-id>.md` registry entries
without shared-directory companion leakage; documented the per-ID companion
folder and bundled Loom's explicit missing-companion result.

**Creation**: `review-companions.md` documents restored `loom_assessment` and
`loom_qa`, existing role checks, native skill permissions and explicit missing
companions. These are read-only instructions, not a restored workflow engine.

**Update**: README, tool reference, documentation index and bundled guide describe
the seven-tool interface while preserving handoff and independent-review guidance.

**Creation**: `handoffs.md` — Documented exact result handoffs, independent review context, limits and recovery; it remains outside the four-source OKF bundle without OKF frontmatter or typed relationships — [Useful handoffs and independent review](/docs/handoffs.md).

**Update**: `index.md` — Added the handoff guide to the supporting-document inventory without treating it as an OKF source document — [bundle index](/docs/index.md).

**Update**: `log.md` — Recorded the new supporting handoff guide and its index entry — [change log](/docs/log.md).

## 2026-10-19

**Update**: `README.md` — Reconciled installed-question status with the passed packed-candidate 2.0.32 qualification and stated its scope and limits — [Loading the plugin](../README.md#loading-the-plugin).

**Update**: `installed-host-validation.md`, `testing.md` — Recorded completed 2.0.32 installed-question qualification: exact candidate SHA-256 `ef7dad9a30ade952cd055fe5c637ff19d1b7b75ef8da590cde07fad58e7efd15`, SDK/CLI 2.0.32/2.0.32, E1-E3 plus restart and duplicate-input control passed by T2 and independent reviewer rerun. Scripted local-model traffic only; temporary reports are not committed. Selective session-read remains source-qualified N/A (`executed:false`), not PASS. — [Installed-host validation](/docs/installed-host-validation.md), [Tests, scripts and CI](/docs/testing.md).

**Update**: `testing.md` — Retargeted installed-question workflow inventory to the exact packed 2.0.32 candidate and removed obsolete active 2.0.29 host support — [Tests, scripts and CI](/docs/testing.md).

**Update**: `installed-host-validation.md` — Separated historical 2.0.29 boot evidence from sole supported 2.0.32 host/SDK target and documented the unrun T2 candidate E2E — [Installed-host validation](/docs/installed-host-validation.md).

**Update**: `opencode-2.0.29.md` — Reclassified the document as historical upgrade analysis, not a compatibility claim — [Historical OpenCode 2.0.29 analysis](/docs/opencode-2.0.29.md).

**Update**: `operating-policy.md` — Clarified current 2.0.32 applicability and separated boot from question qualification — [Alpha operating policy](/docs/operating-policy.md).

**Update**: `index.md` — Reconciled title and purpose of the historical-version document — [bundle index](/docs/index.md).

**Update**: `log.md` — Recorded 2.0.32-only support and installed-question workflow documentation changes — [change log](/docs/log.md).

**Update**: `assignment-delivery.md` — Updated supporting ordinary Markdown documentation; it remains outside the four-source OKF bundle without OKF frontmatter or typed relationships — [Retired assignment/delivery protocol](/docs/assignment-delivery.md).

**Update**: `collaboration.md` — Updated supporting ordinary Markdown documentation; it remains outside the four-source OKF bundle without OKF frontmatter or typed relationships — [Reported progress and contextual questions](/docs/collaboration.md).

**Update**: `coordination.md` — Updated supporting ordinary Markdown documentation; it remains outside the four-source OKF bundle without OKF frontmatter or typed relationships — [Simple collaboration, native execution](/docs/coordination.md).

**Update**: `design.md` — Updated supporting ordinary Markdown documentation; it remains outside the four-source OKF bundle without OKF frontmatter or typed relationships — [Implementation boundaries](/docs/design.md).

**Update**: `handback-experiment.md` — Updated supporting ordinary Markdown documentation; it remains outside the four-source OKF bundle without OKF frontmatter or typed relationships — [Historical handback experiment](/docs/handback-experiment.md).

**Update**: `tool-discovery.md` — Updated supporting ordinary Markdown documentation; it remains outside the four-source OKF bundle without OKF frontmatter or typed relationships — [Tool help is part of discovery](/docs/tool-discovery.md).

**Update**: `tools.md` — Updated supporting ordinary Markdown documentation; it remains outside the four-source OKF bundle without OKF frontmatter or typed relationships — [Five tools, optional structure](/docs/tools.md).

**Update**: `index.md` — Clarified the four-source OKF bundle inventory and linked all seven updated supporting Markdown files outside the bundle — [bundle index](/docs/index.md).

**Update**: `log.md` — Recorded the seven supporting-document updates and the index/log reconciliation — [change log](/docs/log.md).

**Update**: `testing.md` — Added OKF metadata and recorded the test/support inventory for the bounded 2.0.32 bundle — [Tests, scripts and CI](/docs/testing.md).

**Update**: `installed-host-validation.md` — Added OKF metadata and recorded the boot-only validation boundary — [Installed-host validation](/docs/installed-host-validation.md).

**Update**: `opencode-2.0.29.md` — Added OKF metadata and recorded the separate compatibility-profile scope — [OpenCode 2.0.29 compatibility](/docs/opencode-2.0.29.md).

**Update**: `operating-policy.md` — Added OKF metadata and recorded the bounded support evidence and limitations — [Alpha operating policy](/docs/operating-policy.md).

**Creation**: `index.md` — Created the bundle inventory for the four source documents and log — [bundle index](/docs/index.md).
