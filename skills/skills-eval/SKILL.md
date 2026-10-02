---
name: skills-eval
description: Loom evaluation methodology when the primary evaluation target is a reusable skill: skill-owned ablation for methodology value, or central runtime proof of native skill/companion loading and use. Not for general role contracts unrelated to skill behavior (use agent-eval).
---

# Loom Skills Evaluation

Evaluate a skill for the claim it actually makes: **does this methodology improve behavior, or does Loom load/use it correctly in production?**

Skill evals do not create production behavior. The behavior must live in the skill, an agent charter, or control-plane enforcement.

## Boundary with agent-eval

Choose by the **primary claim**, not by which agent executes the case.

- Use `skills-eval` when the claim is that a skill adds value, is natively loaded, or its Reviewer/Critic companion methodology is actually consumed.
- Use `agent-eval` when the claim is about a role's authority, decision, routing, conversation, workflow, or tool behavior independent of a particular skill contract.

A central runtime case may execute Reviewer or Critic and still belong to `skills-eval` when skill loading/use is the thing being proved.

## Choose the evidence type

Use **skill-owned ablation** under `skills/<skill>/evals/*.json` when the question is:

> Does having this skill materially improve the model's behavior?

Use a **central native integration case** in `evals/skills.json` when the question is:

> Does a production role discover, load, or consume this skill/companion methodology correctly?

Do not use native skill loading as a proxy for skill usefulness, and do not use reasoning-only ablation to prove runtime integration.

## Authoring method

1. State the behavioral claim before writing the case. Name the decision, method, distinction, or failure mode the skill is supposed to improve.
2. Build a realistic prompt where that claim matters. Do not mention Loom eval plumbing, tell the model how to pass, or require magic phrases.
3. For skill-owned cases, make the prompt and rubric discriminate the skill's **distinctive methodology**, not generic competence the base model is already likely to provide.
4. Name one concrete `trap`: the plausible wrong behavior the skill should prevent.
5. Write positive expectations as observable outcomes. Write negative expectations for important wrong paths and false-confidence shortcuts.
6. Keep the baseline and candidate task identical. The baseline has no target skill; the candidate has only the target skill available/applied. Do not compensate for a weak skill by giving the candidate extra hints.
7. Treat candidate correctness as absolute. Improvement over baseline is useful evidence, but a candidate that is better and still wrong remains a FAIL.
8. Respect the reasoning-only ablation boundary. The response must demonstrate the skill's method inline; do not require filesystem writes, shell mutation, or other side effects that the ablation harness deliberately denies.
9. Use central runtime integration cases when the evidence depends on real production behavior such as native `skill` loading, Reviewer `loom_assessment`, Critic `loom_qa`, or companion-file use. Assert observed actions when load/use matters; final wording alone is not proof.
10. Prefer the cheapest evidence that proves the claim. Skill-owned ablation is provider-neutral; central native integration requires the OpenCode target transport.
11. When skill-value delta is load-bearing, run multiple iterations and preferably an independent judge. One baseline/candidate pair is one stochastic observation, not a stable capability claim.
12. Treat provider, transport, and harness failures as non-evidence. Do not turn missing execution into behavioral PASS or FAIL.
13. Do not weaken a realistic benchmark because the current model fails it. Change a case only when independent evidence shows the scenario, oracle, mode, or harness contract is wrong.
14. Validate the corpus before live inference. Run the smallest relevant live selection only when behavioral evidence is actually needed.

## Oracle design

A strong skill eval should make these distinguishable:

- baseline wrong, candidate correct;
- baseline correct, candidate correct;
- baseline wrong, candidate improved but still wrong;
- candidate introduces a new trap.

Avoid rubrics that reward verbosity, terminology copied from the skill, or merely calling the skill tool.

The case should still make sense to someone who has never seen the model response that motivated it.
