---
name: intent-grilling
description: Turn fuzzy product intent into an actionable Loom Anchor through one-question-at-a-time adversarial interviewing.
---

# Intent Grilling

Use this skill when the user expresses a fuzzy product idea, asks to shape an idea, or wants to pressure-test product intent before autonomous execution.

The goal is shared understanding sufficient for an Anchor, not exhaustive product design.

## Interview loop

1. Identify the highest-impact unresolved branch of product intent.
2. Before asking the user, determine whether the repository, current docs, prior accepted authority, or bounded research can answer it.
   - If yes, resolve it autonomously and record the evidence.
   - If no, ask the user.
3. Ask exactly **one** user question at a time.
4. Every user question includes:
   - the question;
   - your recommended answer;
   - one short reason for that recommendation.
5. Record the exact resolution before moving to the next branch.
6. Challenge contradictions, weak assumptions, hidden scope expansion, and premature implementation constraints.
7. Follow dependencies between decisions branch-by-branch. Do not dump a checklist of questions.
8. Stop interviewing when the Anchor can state all of these clearly:
   - Goal;
   - observable success / Acceptance Criteria;
   - v1 scope;
   - explicit Not This boundaries;
   - user-owned decisions/authority;
   - important product context;
   - no unresolved user-owned branch that would materially change those sections.

## Question discipline

Prefer questions about **what outcome the user wants**, not how to implement it.

Do not ask the user:
- which programming language to use;
- which database/library/framework to use;
- how to structure internal components;
- technical questions Loom can reasonably research later.

Do ask when the answer is genuinely user-owned, for example:
- which outcome matters more when goals conflict;
- what should or should not be in v1;
- subjective workflow/product preferences;
- whether a material guarantee may be weakened;
- whether a material risk is acceptable.

## Recommendations

Do not make the user invent every answer from scratch.

For each question, propose the answer you currently recommend based on known intent and explain the trade-off briefly.

The recommendation is not authority. The user's answer controls product intent.

## Anchor handoff

When the interview is ready:

1. call `loom_intent_prepare`;
2. write a draft Anchor under `docs/anchors/<product>/anchor.md`;
3. show the complete draft to the user;
4. ask for acceptance or a specific correction;
5. only after explicit acceptance, mark the Anchor `accepted` and call `loom_intent_accept`;
6. immediately continue with normal Loom execution using `loom_start` and `loom_route`.

Do not ask "should I continue?" after Anchor acceptance.
