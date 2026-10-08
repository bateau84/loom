# Eval engine Task 7 migration validation

> Historical checkpoint for Task 7, before skill-owned paired ablation moved to the
> reusable engine in Task 9 Stage 1. See [Task 9 cutover and validation](eval-engine-task-9-cutover.md)
> for current ownership, compatibility, evidence authority, and remaining debt.

This records the compatibility and validation boundary for issue #126 Task 7.

## Execution boundary

`bun run eval:live -- ...` remains the developer entrypoint. Normal, non-ablation cases are resolved by the compatibility wrapper and forwarded as canonical case IDs to:

```text
opencode-eval-runner eval --profile loom_eval_profile:PROFILE ...
```

The generic runner owns case×iteration scheduling, concurrency, target/judge orchestration, retry accounting, evidence readiness, generic classification, and generic artifact/run lifecycle. Loom keeps case normalization, fixtures/workspaces, runtime-evidence requirements, deterministic checks, judge prompt/contract, semantic interpretation, and Loom metadata.

Skill-owned baseline/candidate ablation is intentionally excluded from Task 7. The old implementation is retained temporarily as `scripts/run-evals-legacy.py` only for that Task-8 path and temporary helper compatibility. Normal live cases never call its scheduler.

## Representative validation matrix

| Requirement | Validation |
| --- | --- |
| role-decision | Loom case-adapter tests cover normalization and isolated preparation. |
| conversation-response | Loom case-adapter tests cover the conversation wrapper/prompt path. |
| normal runtime/tool assertion | Evidence/judge adapter tests cover runtime assertion families using canonical `runtime_evidence/v1`. |
| runtime-evidence non-evidence | Evidence/judge adapter tests prove unavailable/incomplete/unsupported evidence fails closed and cannot be backfilled from diagnostics. |
| target transport failure | Pinned Task-6 runner lifecycle tests cover target execution/readiness failure and generic non-evidence classification. |
| judge failure | Pinned runner lifecycle tests cover judge execution/contract failure; Loom also validates its strict judge JSON contract. |
| concurrency/reverse completion | Pinned public-CLI reconciliation tests cover lane concurrency and completion-order-independent durable summaries. |
| common CLI flags/selection | `test_ci_eval_compat_validation.py` checks model/transport/reasoning/concurrency/retry/env/image forwarding and normal-vs-ablation dispatch. |
| no skill-owned ablation migration | Compatibility tests prove normal cases go to generic `eval` while skill-owned cases stay on the Task-8 path. |

CI pins the merged Task-6 runner revision and runs its provider-free generic acceptance/reconciliation tests. No model inference is required for this matrix.

## Intentional differences

Normal cases retain the semantic classifications `pass`, `fail`, and `non-evidence`, but durable artifacts intentionally change from Loom-owned flat case JSON to generic `opencode-eval-runner/eval-artifact/v1` job artifacts plus `opencode-eval-runner/eval-run/v1` `run.json`. Target attempt history, retry decisions, evidence readiness, deterministic checks, judge attempts, semantic decision, and artifact integrity are generic-runner fields; Loom-specific metadata stays in project metadata.

`runtime_evidence/v1` is now authoritative for runtime facts. `observed_tool_results`, `tool_result_evidence`, stdout reconstruction, and other diagnostic projections cannot authorize PASS. Unsupported Code Mode final-result facts become `non-evidence` rather than being reconstructed.

Compatibility details:
- default artifacts remain under `.loom-evals/<run-id>`;
- mixed normal + skill-ablation runs temporarily use `normal/` and `skill-ablation/` subdirectories;
- `--list` remains on the provider-free legacy listing surface until Task 8;
- the previous default of two transport retries is forwarded explicitly;
- common model, transport, reasoning, network, timeout, iteration, concurrency, env, image, auth/config/model-catalog/database controls are forwarded;
- the isolated runtime-evidence runner image is pinned to stock OpenCode 2.0.23 independently of Loom's separate host/plugin 2.0.18 integration contract;
- `--runner-evidence-safety` is rejected for migrated normal cases because canonical runtime evidence is the reviewed authority;
- `--keep-temp` is rejected for migrated normal cases because the profile owns disposable per-job workspaces.

Task 9 can remove the temporary legacy/helper seam after Task 8 migrates skill-owned ablation.
