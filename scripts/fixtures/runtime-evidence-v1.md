# Runtime verdict consumer: PR #45 dependency

Dependency: [bateau84/opencode-eval-runner#45](https://github.com/bateau84/opencode-eval-runner/pull/45), merged as `fd9da10cbe2a8182fc8910ec199a221250deb3ca`.

## Verdict path

Before this migration, `prepare_transport_result` consumed diagnostic `tool_result_evidence` (or parsed stdout) as `observed_tool_results`. `run_case` passed it to the semantic judge, while deterministic checks read diagnostic tools/actions/skill loads. A successful judge could authorize PASS without a runtime-evidence readiness decision.

Now both direct-container and host-runner paths retain the supplied `runtime_evidence`; local credential redaction changes affected available fields to `redacted`. `run_case` validates that object and computes readiness before deterministic checks or judge invocation. Failed readiness writes `non-evidence`, `passed: false`, and `evidence_error`, without invoking the judge. Runtime tools/actions/skill-load facts come exclusively from validated observations. The semantic runtime judge receives the same authoritative object saved in the artifact, including invocation identities and ordering. Diagnostic projections remain available in artifacts only.

Skill ablation has a separate verdict path. Both baseline and candidate now use this gate and authoritative skill-load observations. Its semantic comparison remains answer-only; no new skill scoring criteria are introduced. Non-runtime role-decision and conversation-response cases retain their existing behavior.

## Scope of the existing judge

The existing runtime judge reads the entire trace, including returned results, to judge free-text expectations. There is no per-expectation machine-readable scope. This consumer therefore uses one conservative scope for that judge:

- Require complete `native` and `code_mode_execution` coverage, including for absence/forbidden-call checks.
- Require available tool, actor, session, message, call, parent, input, terminal sequence, and the applicable result or error for every observed invocation. A success does not require its deliberately omitted error field, and vice versa. Available JSON null is still a value.
- If inner Code Mode calls are observed, also require `code_mode_finality`. Stock 2.0.23 cannot satisfy it. Neither outer `execute` output nor diagnostic inner results can supply the missing finality.
- An unsupported, unused finality boundary does not block native-only traces. Complete empty captures remain valid evidence of absence; normal deterministic/semantic expectations still decide behavior.

This intentionally may withhold PASS for a narrower assertion that could be supported in isolation. Selecting narrow per-assertion scopes or changing the judge to ignore certain results is separate work; this PR introduces no assertion DSL and changes no expectations, forbidden rules, scoring, retries, or product-success semantics. A captured tool error is evidence, not automatically a behavioral failure. A successful process is not automatically evidence.

## Source and fixtures

`../runtime_evidence_contract.py` contains only the transitive dependencies of upstream `validate_runtime_evidence` and `assertion_status`, copied verbatim from `container/runtime_evidence.py` at the dependency commit. It excludes the producer, capture, observer, and sanitizer. Keep these definitions synchronized with the reviewed upstream contract rather than maintaining independent accounting semantics.

`runtime-evidence-v1.json` was generated without provider calls by the upstream `build_runtime_evidence`, using `capture`, `native_start`, `native_terminal`, `code_start`, and `code_terminal` from upstream `tests/test_runtime_evidence.py` at that same commit. It contains native success/error, empty capture, missing terminal, unclosed capture, observer/callback failures, Code Mode, and unsupported transport examples. Consumer tests mutate these fixtures to exercise rejection paths.

Run `python3 -m unittest discover -s scripts -p 'test_eval*.py'` or `bun run eval:harness-test`. Tests cover the actual verdict and saved-artifact path using a mocked PASS judge, so ineligible evidence cannot become PASS merely because the model would pass it. They do not require inference, containers, or an upstream checkout.

## Host/image compatibility

Default images and both workflow action/image pairs are pinned to PR #45's merged commit. Published digests were verified in [Publish images run 37590846883](https://github.com/bateau84/opencode-eval-runner/actions/runs/37590846883):

| Transport | Digest |
| --- | --- |
| OpenCode (stock 2.0.23) | `sha256:104a0895c83e4f36fb597e388656a4c6e445035c9a1fb5aaa2c9e922ad172a36` |
| Copilot | `sha256:7b06209cac3a0125a0d90d49a200fd71c7f91dae24477183e95ba4df0a822818` |

Use a matching PR #45-compatible host runner when supplying `OPENCODE_EVAL_RUNNER_BIN`. Legacy/custom images without valid v1 evidence now fail closed. Copilot reports unsupported runtime observation and cannot authorize runtime PASS. The separate Loom host/plugin API compatibility test remains pinned to its existing 2.0.18 pair; this migration updates the eval runner's runtime pair, not Loom's host support policy.
