---
name: agent-eval
description: Loom behavioral evaluation methodology for agents and roles. Use when creating, changing, or reviewing top-level agent eval cases, choosing execution mode, assertions, or regression coverage. Not for skill-value ablation (use skills-eval).
---

# Loom Agent Evaluation

Evaluate whether a Loom role makes the correct production decision and, when necessary, actually performs the required runtime behavior.

Agent evals verify production contracts. They never create authority, routing, completion semantics, or tool obligations.

## Choose the cheapest sufficient execution mode

Use **conversation-response** when the claim is only about the user-facing response from supplied context.

Use **role-decision** when the claim is about professional judgment, authority, routing, or the next production action and tool execution is not itself the evidence.

Use **runtime** when the claim depends on real Loom/OpenCode behavior: tool use, tool arguments, workflow state, dispatch, attachment, ordering-sensitive recovery, mutation boundaries, or integration that cannot be proven from a stated decision.

A role-decision PASS proves judgment/directive compliance only. It does not prove that the complete runtime workflow composes correctly.

## Authoring method

1. Name the production contract and its owner before writing the case. If the behavior has no production home, fix that first.
2. Choose the cheapest execution mode that can actually falsify the claim. Do not pay for runtime just because runtime feels stronger.
3. Write a realistic work situation rather than a harness instruction. Vary domain, pressure, lifecycle state, and task size across the corpus.
4. Name one concrete `trap`: the plausible wrong decision or shortcut the case is designed to expose.
5. Write positive expectations around decisions and outcomes, not exact phrases. Write negative expectations for important authority crossings, false completion, unsupported claims, or avoidance behavior.
6. Test both sides of important boundaries. Include ordinary in-scope cases so the safest learned strategy is not universal refusal, escalation, or delegation.
7. Use runtime action assertions when the behavior depends on what was actually done. Prefer stable semantic arguments with `equals`, `ends_with`, `contains`, or `contains_all`; use `any_of` for genuinely equivalent production actions.
8. Do not require tool calls in `role-decision` or `conversation-response`; those modes deliberately deny them.
9. Keep assertions at the contract boundary. Do not couple the benchmark to incidental file order, prose wording, transport aliases, or an implementation detail unless that detail is itself authoritative.
10. A regression case should preserve the original behavioral failure in a generalized realistic form. Do not encode the exact historical transcript as the contract.
11. Preserve hard cases. A current model failure is evidence to inspect production behavior, not a reason to make the benchmark easier.
12. Separate behavioral verdicts from provider, transport, or harness errors. Missing execution is non-evidence.
13. Keep expensive runtime cases opt-in when appropriate. Runtime parallelism is a load/stress choice, not ordinary behavioral evidence.
14. Validate schema/discovery before live inference, then run the smallest relevant live set for the changed contract.

## Runtime proof

When final wording can lie about what happened, assert actions.

Examples include:

- a Reviewer actually calling the assessment path for the intended skill;
- a recovery path actually continuing budget, reading state, granting dispatch, dispatching the correct role, and attaching;
- a role being denied a tool/action it does not own;
- a completion call carrying the required outcome and workflow identity.

Do not mistake a model saying "I would do X" for evidence that runtime X happened.
