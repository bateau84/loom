# agent-eval Reviewer Assessment

Reviewer-only domain contract for agent behavioral eval design.

## Review criteria

- **Production traceability:** every case maps to an existing agent/control-plane contract rather than inventing behavior through the benchmark.
- **Mode sufficiency:** conversation-response, role-decision, or runtime is chosen according to the evidence actually required.
- **Scenario realism:** the prompt resembles normal work and does not reveal harness mechanics or the expected answer.
- **Oracle strength:** wrong decisions cannot easily pass, while correct professional judgment is not rejected for harmless wording or implementation variation.
- **Boundary coverage:** important authority rules are tested on both sides, including ordinary in-scope action so refusal/escalation is not the universal winning strategy.
- **Action evidence:** runtime-dependent claims use observed tools/arguments rather than self-reported prose.
- **Assertion stability:** action checks bind to semantic behavior and intended subjects without overfitting transport aliases, incidental ordering, or one implementation.
- **Regression fidelity:** historical failures are generalized to the underlying production contract rather than frozen as transcript-specific tests.
- **Failure classification:** provider/harness failure remains non-evidence and is not counted as behavioral PASS/FAIL.
- **Cost discipline:** expensive runtime and repeated execution are used only where cheaper isolated evidence is insufficient.

Scale review depth with authority consequence, runtime side effects, and the cost of a false PASS.
