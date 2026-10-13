# skills-eval Quality Assurance

Critic-only adversarial contract. Assume competent case authoring and normal Reviewer assessment already occurred.

## QA criteria

- Try to make the candidate PASS without using the skill's distinctive method; generic model knowledge should not satisfy a supposedly discriminating case by accident.
- Try to make a correct candidate FAIL because the rubric rewards exact wording, unnecessary detail, one implementation, or an impossible side effect.
- Look for prompt leakage that tells the model the expected distinction, names the trap too directly, or gives the candidate information the baseline does not receive.
- Attack ablation contamination: hidden extra methodology, mismatched reasoning, different task context, or skill-load evidence mistaken for skill-value evidence.
- Attack central integration cases that prove a tool call but not correct methodology use, or infer runtime use only from the final answer.
- Check whether the benchmark can hide a regression behind a positive baseline-to-candidate delta even though the candidate remains materially wrong.
- Treat one favorable iteration, especially with the same target/judge model, as weak evidence for stable skill value.
- Check that reasoning-only ablation does not require file writes, shell mutation, or durable artifacts unavailable to either side.
- Look for benchmark edits motivated by the current model's failures rather than an independently defensible correction to the case.
- Separate provider/harness noise from semantic evidence; transport failure must not be laundered into a behavioral verdict.

Increase QA depth when the eval is being used to justify broad reuse of a skill or a strong claim of measured improvement.
