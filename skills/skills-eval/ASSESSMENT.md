# skills-eval Reviewer Assessment

Reviewer-only domain contract for evaluating skill-eval design.

## Review criteria

- **Claim alignment:** the case measures the skill claim actually being made: skill value via ablation or native production integration via a central runtime case.
- **Discrimination:** expectations exercise distinctive skill methodology rather than generic competence, phrase matching, or skill-load presence.
- **Ablation integrity:** baseline and candidate receive the same task; the candidate gains only the target skill; reasoning-only constraints are respected.
- **Absolute correctness:** candidate PASS requires the full benchmark, not merely a positive score delta over baseline.
- **Oracle strength:** clearly wrong behavior cannot easily pass, and a defensible correct response is not rejected for irrelevant wording or implementation choices.
- **Negative space:** the trap and negative expectations cover plausible shortcuts, false confidence, and regressions introduced by the skill.
- **Integration proof:** native loading or companion-method use is asserted through observed runtime actions when that is the claim.
- **Stochastic claims:** repeated runs and judge independence are used when stable skill-value improvement is load-bearing.
- **Cost discipline:** runtime/native integration is not used when reasoning-only ablation proves the intended claim.
- **Production-home separation:** the eval verifies behavior; it is not cited as the place that behavior is defined.

Scale review depth with the importance of the skill claim and the risk of benchmark false confidence.
