# Continuity architecture

**Status:** review-ready Architect recommendation, not independently accepted architecture or implementation authorization. Workflow `735f1bce-1974-4f34-9158-4ec7ed5572de`, architect attempt 0, 2026-10-09. Static discovery only.

**Authority:** [accepted Anchor](../../../anchors/loom-reliability/anchor.md) at `54e0c23543958640d763b5019c5f1d78b0c5b191`; [accepted experience](../../../design/loom-reliability/continuity-experience.md); [accepted requirements and P1–P8](../../../requirements/loom-reliability/index.md), acceptance bookkeeping `2874f121311f56570fd8beceaf5f0f5a336722f3`. These remain the semantic owners.

- [Fact model and continuity decision](fact-model-and-continuity.md): alternatives, retained/removed authority, transaction and continuity boundaries.
- [Realization seams](realization-seams.md): compiler, applicability, effective capabilities, ownership, transitions and resource preflight.
- [Proof and recovery](proof-and-recovery.md): independent isolation, controlled upgrade/offline recovery, P1–P8 and publication regression traces.

Select a normalized transactional fact model, not a facade over existing stores or full event replay. Preserve original facts by verified lossless export/import into immutable identities; do not retain old mutable formats as an execution adapter. Compile execution from one Plan. Keep irreversible external outcomes, user consent, consumer judgments and independent assessment distinct.

This is a bounded structural replacement of conflicting milestone mechanisms in existing architecture, not blanket supersession of unrelated facts. Delivery must remove the listed writers, not just add these interfaces. Independent review and the holistic Plan must carry both acceptance gates separately. Existing verification `86bc57c4-f443-4deb-860f-116660031130` remains required before review-plan; documentary coverage is not product proof. No runtime tests, imports, engine operations, installed-state reads or production recovery occurred.
