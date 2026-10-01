# Product-development method evals

The opt-in suites check product judgment, ownership, and a bounded governed handoff. The normal corpus validator discovers both JSON files automatically; select cases explicitly for live runs so methodology changes do not silently increase the default live budget.

| Cases | Boundary |
| --- | --- |
| PRODUCT-DISCOVERY-01, PRODUCT-EXPERIMENT-01, PRODUCT-FEEDBACK-01 | Problem versus requested feature; delivery versus benefit; authorized experiment and limited post-use evidence. |
| PRODUCT-SMALL-01 | A settled typo remains Worker → Reviewer, without the new methods or extra specialists. |
| PRODUCT-SYNTHESIS-01, PRODUCT-SYNTHESIS-02 | Cross-owner cancellation disagreement and a summary that tries to weaken accepted meaning. |
| PRODUCT-LIFECYCLE-01, PRODUCT-LIFECYCLE-02, PRODUCT-PROOF-01 | Fresh installation and existing-user upgrades versus seeded proofs; no enterprise checklist for a disposable prototype. |
| PRODUCT-EARLY-RISK-01 | Resolve decisive offline feasibility before dependent architecture, without unauthorized probes. |
| PRODUCT-VALUE-REVIEW-01, PRODUCT-COMPOSITION-QA-01 | Unaccepted value targets, approval mistaken for evidence, and locally-correct/global-failure composition. |
| PRODUCT-HANDOFF-RUNTIME-01 | Owner-authored corrections → independent authority review → current downstream implementation → lifecycle proof → implementation review. |

The original `product-development.json` has four runtime cases and eight isolated role/response cases. Discovery and synthesis there are advisory; lifecycle explicitly exercises the skill with Architect; the typo exercises the ordinary small-task path. Those cases alone do not prove multi-agent convergence or product delivery.

## Governed handoff regression

`product-development-governed.json` adds one bounded Change, not a full Objective. A local notes CLI has conflicting proposed requirements and experience. Designer must correct the error/empty-state model; Specifier must correct manual-setup semantics. Their current documents must pass existing independent authority review before Worker consumes them. The structure is already accepted, so no new Architect, Planner, Critic, or Product Acceptance gate is warranted.

The target request gives the product outcome and fixed constraints, not the conflict diagnosis, agent sequence, or verification-tool recipe. The proposed source documents retain their incompatible clauses but no longer explain their own defects. Those diagnoses and required handoff outcomes remain in judge-only expectations. A run must therefore demonstrate discovering and handling the gap, not merely following a user-supplied procedure. The read-only test command remains explicit to make product-proof execution comparable.

The accepted lifecycle commitments cover an absent store, first addition without manual setup, persistence between separate processes, explicit invalid-store failures without data loss, and a non-directory ancestor. They must survive as current specialist-created verification requirements targeting implementation review, satisfied by the matching real test observations. A coordinator summary, a tool call without a successful result, or an obsolete requirement does not close this expectation.

The fixture supplies read-only `tests/test_notes_contract.py` and a deliberately incomplete `notes.py`. The checks call the real CLI in separate processes, use fresh temporary paths and generated note values, and examine returned data and stored bytes. Distinct values in deliberately unsorted order plus duplicates distinguish insertion order from sorting, reversing, or prepending. The absent-store check inspects the whole fresh state root, not only the deepest directory, so partial ancestor creation cannot escape. They do not stub initialization or storage. The target must repair the implementation, not the tests or accepted Anchor.

Tool/action assertions check necessary events only. The semantic judge must correlate the role-bound edits, current source contents, independent review results, Worker input/reads, and the verification requirement/proof observations in order. Final General reads alone do not prove Worker consumption. Essential missing or truncated trace evidence leaves that expectation unmet; it must not be inferred from a final success statement. The existing runner provides tool results to the judge; this change does not introduce a second runner or evidence protocol.

## Commands

Validate the library, corpus, and fixture controls in a normal checkout:

```sh
bun run skills:validate
bun run eval:validate
python3 -m unittest discover -s scripts -p test_ci_product_development.py -v
```

Run the new governed regression with the existing small-task control:

```sh
bun run eval:live -- --cases PRODUCT-HANDOFF-RUNTIME-01,PRODUCT-SMALL-01 --model <configured-model>
```

Run the original advisory runtime cases:

```sh
bun run eval:live -- --cases PRODUCT-DISCOVERY-01,PRODUCT-SYNTHESIS-01,PRODUCT-LIFECYCLE-01 --model <configured-model>
```

Run the original decision/response cases:

```sh
bun run eval:live -- --cases PRODUCT-EXPERIMENT-01,PRODUCT-SYNTHESIS-02,PRODUCT-LIFECYCLE-02,PRODUCT-PROOF-01,PRODUCT-EARLY-RISK-01,PRODUCT-VALUE-REVIEW-01,PRODUCT-COMPOSITION-QA-01,PRODUCT-FEEDBACK-01 --model <configured-model>
```

## Evidence limits

`test_ci_product_development.py` is discovered by existing zero-inference CI. It calibrates the product conformance fixture against a separate positive control, the original broken product, and ten negative implementations (manual setup, corrupt-as-empty, non-directory-as-empty, no persistence, lost prior notes, read-side mutation, reversed output, prepending, sorted storage, and partial ancestor creation by `list`). All twelve calibration tests execute the same five product checks. Negative controls must parse and fail the relevant contract assertion, not pass calibration through a runtime error. The positive control is not copied into the target project. These tests establish that the fixture can reject known defects, not that Loom produced a correction or reconciled any handoff.

The Critic-guided fixture probe at `ecec956` demonstrated false greens: reversed output, prepended notes, and intermediate-directory creation all passed the earlier five-check contract. The stronger fixture and added controls address those concrete gaps; removing the supplied handoff recipe addresses a separate autonomy-coverage gap. Neither change alone proves a live agent follows the intended method.

Case definitions, fixture checks, corpus validation, and existing CI are not passing provider-backed evidence. Retain the actual live case results and correlated trace before closing a live-behavior verification finding. No complete product-acceptance or independent fresh-Reviewer claim follows from static review of these cases.
