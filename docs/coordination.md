---
type: Architecture
title: "Simple collaboration, native execution"
description: "Describes optional agent coordination using native OpenCode execution."
tags: [loom, coordination, execution]
timestamp: 2026-10-24T00:00:00Z
---

# Simple collaboration, native execution

Loom stores attributed questions and answers, shared context and qualified
completion history. OpenCode owns execution, native delegation, Sessions,
agent/model choice and permissions. There are still five tools. An Action and
Plan are optional; neither assignment registration nor a workflow engine is
required to ask a question.

Use [the five-tool walkthrough](tools.md), live tool search for exact schemas,
and [collaboration semantics](collaboration.md). On the OpenCode 2.1.1 upgrade candidate
host, a saved ask
does **not** contact its recipient: dispatch is
`not-attempted / policy-capability-unavailable`. Arrange manual native handling.
If that has been arranged, a blocking asker may naturally yield; blocking is
intent, not an enforced wait or execution gate.

The first committed answer to a new-format blocking question alone qualifies
for one postcommit best-effort exact-asking-Session resume. Later/nonblocking/
legacy answers never submit asker input. Failure or crash may permanently lose
liveness; no retries, transfer, replay or eventual consumption promise exists.
Target checks are not leases; admission is not processing or completion.

The former assignment/delivery/authorization/retry operations and views are
retired, not an optional alternative. [Historical records](assignment-delivery.md)
remain readable and inert. Completion/reopen still use the original worked-against
reference and do not imply independent acceptance or complete parents.

Use `query view:full_thread` for complete stored relational history under an
explicit Action/node or Session scope. Follow its cursor and labelled record
parts; do not assume a single page is complete, expand evidence recursively or
invent raw observation bodies. Storage/read bounds and manual offline backup
safety remain unchanged. No dashboard, scheduling, automatic maintenance,
external-agent rewrite or host upgrade is part of this model.
