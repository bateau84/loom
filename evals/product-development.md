# Product-development method evals

This opt-in suite checks product judgment and ownership, not whether an answer repeats a checklist. The normal corpus validator discovers the JSON automatically; select these cases explicitly for live runs so adding methodology does not silently increase the default live budget.

| Cases | Boundary |
| --- | --- |
| PRODUCT-DISCOVERY-01, PRODUCT-EXPERIMENT-01, PRODUCT-FEEDBACK-01 | Problem versus requested feature; delivery versus benefit; authorized experiment and limited post-use evidence. |
| PRODUCT-SMALL-01 | A settled typo remains Worker → Reviewer, without the new methods or extra specialists. |
| PRODUCT-SYNTHESIS-01, PRODUCT-SYNTHESIS-02 | Cross-owner cancellation disagreement and a summary that tries to weaken accepted meaning. |
| PRODUCT-LIFECYCLE-01, PRODUCT-LIFECYCLE-02, PRODUCT-PROOF-01 | Fresh installation and existing-user upgrades versus seeded proofs; no enterprise checklist for a disposable prototype. |
| PRODUCT-EARLY-RISK-01 | Resolve decisive offline feasibility before dependent architecture, without unauthorized probes. |
| PRODUCT-VALUE-REVIEW-01, PRODUCT-COMPOSITION-QA-01 | Unaccepted value targets, approval mistaken for evidence, and locally-correct/global-failure composition. |

Four cases use the real runtime: discovery and synthesis exercise General's skill-selection hooks, lifecycle explicitly exercises the skill with Architect, and the typo case exercises the existing small-task path. Their tool assertions supplement semantic outcome expectations; skill loading alone is not success. The other cases isolate role decisions or a conversational response. They do not prove multi-agent convergence, production delivery, or full product acceptance.

## Commands

Validate the skill library and eval corpus in a normal checkout:

```sh
bun run skills:validate
bun run eval:validate
```

Select the four runtime cases with a configured model:

```sh
bun run eval:live -- --cases PRODUCT-DISCOVERY-01,PRODUCT-SMALL-01,PRODUCT-SYNTHESIS-01,PRODUCT-LIFECYCLE-01 --model <configured-model>
```

Select the remaining decision/response cases:

```sh
bun run eval:live -- --cases PRODUCT-EXPERIMENT-01,PRODUCT-SYNTHESIS-02,PRODUCT-LIFECYCLE-02,PRODUCT-PROOF-01,PRODUCT-EARLY-RISK-01,PRODUCT-VALUE-REVIEW-01,PRODUCT-COMPOSITION-QA-01,PRODUCT-FEEDBACK-01 --model <configured-model>
```

Case definitions and static validation are not passing live evidence. Record actual results before claiming the methods change real agent behavior. This draft does not add runtime states, roles, mandatory gates, or test-runner changes.
