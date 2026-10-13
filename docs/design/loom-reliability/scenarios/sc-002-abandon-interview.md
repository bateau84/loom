---
type: design
title: SC-002 — Abandon an Unaccepted Interview
description: Leave unwanted intent with an unanswered question and pursue a different request honestly.
tags: [scenario, loom, intent, continuity]
---

# SC-002 — Abandon an unaccepted interview

**Context:** A developer starts an idea interview. A product question remains unanswered when the idea becomes irrelevant.

**Goal:** Do a different request in the same conversation without accepting the unwanted idea.

**Scenario:** The developer says to leave the idea and asks a different question or requests bounded work. Loom marks the interview abandoned, retaining attributed drafts/decisions as history, not accepted authority. The new request is handled at proper depth. Inspection is not execution; the new request supplies any required execution authority.

**Failure / edge condition:** An old answer arrives late, or an unrelated factual aside does not say whether to abandon. The late answer cannot revive abandoned intent. The factual aside can be answered without changing interview state. If new execution would displace ambiguous active work, ask only whether to pause it or keep it active, not for fake draft acceptance.

**Observable outcome:** The old unanswered question is not a prerequisite. The new request receives an answer or authorized path. Returning to the draft means deliberate reconsideration and necessary acceptance, not automatic resurrection. Revising a question before presentation never requires answering obsolete wording.

**Derived from:** [US-002](../user-stories/us-002-leave-and-return.md), Anchor journey 2; discovery J01–J02/J05 motivate stale/unpresented-decision probes.
