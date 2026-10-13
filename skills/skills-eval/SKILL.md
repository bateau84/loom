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

## Match the actual consumer before authoring cases

For Loom skill-owned ablation, `scripts/run-evals-legacy.py` (`load_skill_owned_cases` / `normalize_skill_eval_case`) is the current case loader used by the paired runner. Its cases require `prompt` and non-empty `expectations`; `trap` and `negative_expectations` (or `must_not`) express the wrong-path behavior. `request` / `expect` / `reject` are not accepted aliases. See the actual parser before relying on any listed field names.

Run `npm run eval:validate` in Loom, or `python3 scripts/validate-skill-evals.py --skills-root /path/to/repo/skills` from a Loom checkout for a portable skill package. These checks prove consumer parsing, **not** behavioral value. A homegrown test that approves a different JSON shape cannot substitute. If the intended consumer is unavailable, label the cases as *unverified specifications*, not executable Loom evals.

Use a realistic task that exercises the method and its observable decision/outcome, plus a credible near miss; do not merely quiz the model on an example already copied into the skill. Reasoning-only ablation can show the decision inline, while file/tool effects need separate runtime proof.

## Native integration proof checklist

When the claim is production skill/companion integration:

1. Put the case in the central native-integration corpus, normally `evals/skills.json`.
2. Use a target transport that can expose the real Loom/OpenCode native actions. In the current harness that means an **OpenCode target**; provider-neutral reasoning-only ablation cannot prove native loading.
3. Assert the native `skill` load and the relevant `loom_assessment` or `loom_qa` action, bound to the same intended skill. A final answer claiming the skill was used is not evidence.
4. Judge the final professional response separately from the integration trace. Tool presence alone does not prove that the methodology was applied correctly.
5. State the scope of the result explicitly: native runtime evidence proves **integration**, not that the skill improves reasoning quality. If methodology value is also a claim, add a separate skill-owned baseline/candidate ablation.

## Authoring method

1. State the behavioral claim before writing the case. Name the decision, method, distinction, or failure mode the skill is supposed to improve.
2. Build a realistic prompt where that claim matters. Do not mention Loom eval plumbing, tell the model how to pass, or require magic phrases.
3. For skill-owned cases, make the prompt and rubric discriminate the skill's **distinctive methodology**, not generic competence the base model is already likely to provide.
4. Name one concrete `trap`: the plausible wrong behavior the skill should prevent.
5. Write positive expectations as observable outcomes. Write negative expectations for important wrong paths and false-confidence shortcuts.
6. Keep the baseline and candidate task identical. The baseline has no target skill; the candidate has only the target skill available/applied. Do not compensate for a weak skill by giving the candidate extra hints.
7. Treat candidate correctness as absolute. Improvement over baseline is useful evidence, but a candidate that is better and still wrong remains a FAIL.
8. Respect the reasoning-only ablation boundary. The response must demonstrate the skill's method inline; do not require filesystem writes, shell mutation, or other side effects that the ablation harness deliberately denies. The candidate project contains only the target skill, so do not use skill-owned ablation to prove that it can load or hand off to a sibling skill.
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

Avoid rubrics that reward verbosity, terminology copied from the skill, or merely calling the skill tool. For testing skills, include cases where **declining extra tests or techniques** is correct and high-consequence gaps where adding a focused test is necessary. Do not require one framework, mock library, or implementation form when multiple approaches protect the same behavior.

The case should still make sense to someone who has never seen the model response that motivated it.
