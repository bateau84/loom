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

Use [the tool walkthrough](tools.md), live tool search for exact schemas,
and [collaboration semantics](collaboration.md). On OpenCode 2.2.0, a new
`recipient` can target a role, named agent, dispatcher or user. A single eligible
agent is contacted through OpenCode's native subagent tool, which enforces
permissions and depth. Children relay to their parent. A question addressed to
the dispatcher is answered directly by that dispatcher, even if it consults a
specialist; no specialist binding is needed. Forwarded agent/role questions
require binding the verified native child with `bind-respondent`; other siblings
cannot answer. For user-targeted questions, the parent asks the user and cites
the actual decision. Primary Sessions use native user interaction.
Legacy `to_agent` questions remain manual. A delivered notice is not an answer.
Blocking is intent, not an enforced wait or execution gate.

Direct blocking typed OQs use native foreground subagents; one returned
result continues the asker without another Loom answer notice.
Direct nonblocking OQs rely on native background completion. For legacy v1
or forwarded typed v2 blocking OQs, only the first answer may trigger
best-effort exact-asker Loom resume. Later/nonblocking answers submit
no additional Loom notice. Failure or crash may permanently lose
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
