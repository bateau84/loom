---
type: Playbook
title: "Evaluate an ordinary Session"
description: "Select a Session, inspect and freeze its foundation, and read bounded learning outside the conversation."
tags: [loom, learning, sessions, walkthrough]
timestamp: 2026-11-28T00:00:00Z
---

# Evaluate an ordinary Session

You do not need to create an Action, Plan or objective. Use the actual Session ID returned by native discovery. Evaluation and learning reports remain outside that engineering conversation.

## Inspect and freeze a foundation

Call `loom_review` with `operation:"establish-subject"`, `target:{kind:"session",id:"ACTUAL_SESSION_ID"}`, and your question. The default cutoff is point-in-time. To select a recorded completion, use `cutoff:{kind:"recorded-completion",record_id:"ACTUAL_COMPLETION_RECORD"}`. Neither option verifies that the work succeeded.

Copy the returned `preview` request into `loom_history`. Add `response_format:"html"` for the human view. Inspect all pages using `navigation.next`, and use each member's `inspect` request to open its exact source before freezing. An initial preview containing only target/question is also read-only; it returns an establishment request rather than a freeze request.

After inspection, send the exact returned `freeze` request to `loom_review`. Membership and source versions are pinned. Later continuation needs a new subject or automatic increment. Source permission and current availability are checked again when reading; a frozen reference is not an access grant. An empty selection cannot be frozen for evaluation.

For the separate preparation/retrieval audit, use the returned `activity` request or `history subject-activities` with the exact subject ID/hash. Failed reads are audit material and are not evidence that the engineering attempt failed.

## Read accumulated learning

`loom_insights` with `operation:"learning-progress",response_format:"html"` shows the calling Session's coverage and saved increments. Open a report's exact request, then retained concerns and their original-source requests. `learning-source` fragments have a complete `next` request; use it instead of enumerating histories.

“Processed through the observed boundary” means the learning cursor caught up. It does not mean the Session, its running descendants or its goals are complete. Resumed work moves the observed frontier beyond committed coverage. Failed/cancelled processing retains the previous successful cursor.

Deterministic processing uses coalesced native events, idle opportunities and startup catch-up. Configure `learning.max-sources` and `learning.coalesce-ms` for bounded quanta. `learning.incremental:false` retains the legacy Stage3 processing mode for existing qualification/workflows.

Model interpretation is optional and disabled by default. It requires a pinned method and resource policy, and independently qualified execution authority. This candidate deliberately does not connect production authority. The dashboard reports that limitation; deterministic learning still works. A successful interpretation has a separate authorized S5 read request with its own evidence boundary.

A stronger admitted Evaluator may read earlier reports and selectively inspect their original evidence. Earlier interpretations remain immutable. Context references preserve them; explicit corrections can supersede or contest them. A passing correction is not another independent objective.

## Source limits

Use the returned supported requests. Do not crawl native implementation files, caches or unrelated histories when a source owner reports denied or unsupported access. Historical native bodies, protected transfer and model resource accounting retain their existing upstream requirements. Unknown relationships stay unknown. Consult [the interface contract](../architecture/spec/ars-015-session-learning.md) and [qualification](../architecture/qualification/session-learning-rebuild.md) for exact limits and remaining acceptance work.
