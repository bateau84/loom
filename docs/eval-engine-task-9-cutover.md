# Eval engine Task 9: cutover and validation

Issue: [Loom #127](https://github.com/bateau84/loom/issues/127).
Integration: `eval-engine/09-cutover`. Stage 1 merged through
[PR #146](https://github.com/bateau84/loom/pull/146) at
`4ef43568fbffd4be247cdabfed56ff3ab28d8dec`.

This document defines the **final intended ownership boundary** and a
repeatable validation matrix. Stage 2A cleanup and Stage 2B documentation are
separate PRs. The docs PR alone does **not** establish that cleanup or
same-head live validation is complete.

## Ownership: one generic engine, Loom-specific policy

| Responsibility | Owner |
| --- | --- |
| Case/iteration planning, job lanes and concurrency | Reusable `opencode-eval-runner` |
| Target/judge invocation and container lifecycles | Reusable runner |
| Bounded retries and evidence readiness | Reusable runner |
| Generic PASS/FAIL/NON-EVIDENCE lifecycle and error taxonomy | Reusable runner |
| Artifact allocation, writing, sealing, integrity and run manifests | Reusable runner |
| Case discovery/selection, opt-in rules, case normalization | Loom |
| Role and skill prompts, fixtures and isolated workspaces | Loom |
| Required runtime boundaries and deterministic action/result checks | Loom |
| Strict judge prompt/contract and semantic interpretation | Loom |
| Skill baseline/candidate setup, traps, absolute correctness, score/delta, material-value comparison | Loom |
| Stable developer-facing CLI | Thin Loom compatibility entrypoint |

Normal role-decision, runtime and conversation cases follow:

`bun run eval:live -- ...` → `scripts/run-evals.py` →
`opencode-eval-runner eval --profile loom_eval_profile:PROFILE`.

Skill-owned ablation follows the **same entrypoint** →
`scripts/run-skill-ablation.py` → runner's **generic paired Python API**.
The runner does not expose a public paired CLI option. Loom makes the
skill-value comparison decision; the runner owns both evaluation lifecycles.
Mixed selections use separate `normal/` and `skill-ablation/` subdirectories.

The Stage 1 baseline still has legacy helpers and a private
`runner.eval_cli._run_lane` import in the pair bridge. Stage 2A must remove
duplicated active orchestration without copying generic scheduling, retry,
observer, artifact or classification logic back into Loom. Reconcile Stage 2A
before claiming only one implementation remains.

## Runtime evidence is authoritative

For runtime facts, the only authority is
`opencode-eval-runner/runtime-evidence/v1` produced at the runner's
independent invocation boundary. Loom specifies which observation boundaries
and fields the case requires; the runner checks readiness before allowing
judgment. Loom checks actual tool identity, input, outcome, ordering,
actor/session binding, and results when required.

**Missing, invalid, incomplete, redacted, omitted or unsupported required
facts are NON-EVIDENCE**, not a model failure. Do not reconstruct a PASS/FAIL
from `observed_tool_results`, `tool_result_evidence`, `tools`, `actions`,
`skills_loaded`, model prose, stdout or stderr. Parent `execute` output is
not a child Code Mode tool result. Exact Code Mode inner-call final results
unsupported by stock OpenCode remain unsupported rather than invented.

For OpenCode native-skill ablation, the candidate requires a completed
observed native `skill` call bound to the expected skill, agent and target
session, with a complete native boundary; the baseline must not load it.
A diagnostic `skills_loaded` claim does not prove this. Copilot CLI
ablation uses inline methodology and **does not claim native-load proof**.
Model output remains valid *semantic input* to the judge, not tool-execution
evidence.

Artifact evidence IDs are **content fingerprints**, not cryptographic
signatures against an attacker with artifact-write access.

## `eval:live` compatibility and intentional differences

- `bun run eval:list` and `bun run eval:live -- --list` are provider-free.
  Live execution requires an explicit `--cases`, `--target`,
  `--target-kind agent|skill` or `--all` selection, plus `--model`.
- The thin wrapper forwards relevant `--suite`, `--iterations`,
  `--parallel`, `--runtime-parallel`, models, transports, reasoning, network,
  engine, timeout, retries, images, auth/config/catalog/database,
  environment and artifact controls. Some controls only apply to one mode.
- `--parallel N` permits non-runtime concurrency. Runtime jobs remain
  **serialized by default** (`--runtime-parallel 1`), even with
  `--parallel 3`. Explicitly raising runtime parallelism is a stress test.
- Each invocation defaults to `.loom-evals/<generated-run-id>/`.
  Normal cases use the generic `opencode-eval-runner/eval-artifact/v1`
  job artifacts and `opencode-eval-runner/eval-run/v1` `run.json`, **not**
  previous flat `<case>.iteration-N.json` files. Paired jobs use
  `opencode-eval-runner/eval-paired-artifact/v1` at
  `pairs/<case>/iteration-N.json` under their selected artifact root.
  An explicit artifact directory must be empty.
- Preserve the meaning of `pass`, `fail` and `non-evidence` when
  comparing pre/post cutover; do not demand byte-for-byte artifact or
  stdout compatibility. A positive score delta never overrides a
  skill candidate's failed absolute benchmark. An unusable side cannot be
  treated as score zero or made into a valid pair comparison.
- `--runner-evidence-safety` is retired and rejected. Normal generic
  evals reject `--keep-temp`; neither option may silently restore
  legacy authority. Native skill-routing runtime cases require an OpenCode
  target. Skill-owned ablation accepts OpenCode or Copilot CLI.
- Local skill-owned paired runs require the runner Python module on
  `PYTHONPATH`, or `OPENCODE_EVAL_RUNNER_BIN` pointing to a compatible
  checkout. The pinned live workflow provides this library.
- The runner action, transport images and paired Python API must be
  reviewed and pinned together. Do not depend on moving runtime image tags.
- **Intentionally unsupported:** exact inner Code Mode final result/error
  not provided by stock runtime; backfilling absent/redacted tool facts;
  native-load claims on Copilot's inline methodology; tamper-proof
  fingerprints; normal PR CI executing paid inference.

## Provider-free validation matrix

Offline tests establish wiring and contract behavior under fixtures.
**They do not establish semantic PASS of a real model run.**

| Scenario | Provider-free check | Live representative |
| --- | --- | --- |
| Normal role/agent | Stage 2B subprocess CLI smoke forwards `INTENT-02`; Loom case adapter tests | `INTENT-02` |
| Conversation | Same smoke forwards `HUMAN-01`; adapter builds conversational wrapper | `HUMAN-01` |
| Runtime | Smoke forwards `INTENT-01`; runtime action/evidence tests | `INTENT-01` |
| Skill baseline/candidate ablation | `test_ci_skill_ablation_cutover.py`: isolated pairs, traps, score, correctness, sealed pair, non-evidence | `Skills-Eval-02` |
| Multi-iteration | Smoke forwards `--iterations 3`; runner acceptance tests expand jobs | Three iterations |
| Parallel non-runtime | Smoke forwards `--parallel 4`; runner reconciliation tests check completion order | Two non-runtime cases with `--parallel 3` |
| Default runtime serialization | Smoke asserts `--runtime-parallel 1`; runner owns lane enforcement | `INTENT-01 --iterations 3 --parallel 3` |
| Optional runtime stress | Smoke verifies explicit `--runtime-parallel 2` forwarding | Only when deliberately load-testing |
| Non-evidence | Loom evidence/judge and skill tests; pinned runner lifecycle tests | Inspect genuine missing-provider/evidence cases |
| Evidence readiness | Loom required-boundary tests + runner generic acceptance/lifecycle tests | Inspect complete authoritative runtime boundaries |
| CLI compatibility | `test_ci_eval_compat_validation.py` and Stage 2B subprocess smoke | Commands below |
| Listing/corpus | `bun run eval:validate`; `run-evals.py --list` | No model calls |

Run provider-free checks, with the pinned reusable runner importable
where needed:

```bash
bun run eval:validate
python3 scripts/run-evals.py --list
python3 -m unittest scripts.test_ci_eval_stage2b_validation
python3 scripts/test_ci_eval_compat_validation.py
python3 scripts/test_ci_loom_eval_case_adapter.py
python3 scripts/test_ci_eval_evidence_judge_adapter.py
python3 scripts/test_ci_skill_ablation_cutover.py
bun run eval:harness-test
```

`bun run test` automatically discovers `scripts/test_ci_*.py`, including
the new provider-free CLI smoke. Ordinary CI additionally runs the
pinned runner's generic-profile acceptance, public-CLI reconciliation and
lifecycle suites, and pinned-image integration checks.

## Representative live matrix (model budget required)

Run against **one trusted revision** and record its SHA, model/judge model,
transport/image digests, flags, per-iteration artifacts and classification.
Compare the **meaning** of results, not the old and new JSON file shapes.

```bash
# Role-decision + conversation: 3 iterations, parallel non-runtime
bun run eval:live -- --cases INTENT-02,HUMAN-01 \
  --model <provider/model> --iterations 3 --parallel 3

# Runtime: 3 iterations, intentionally serialized by default
bun run eval:live -- --cases INTENT-01 \
  --model <provider/model> --iterations 3 --parallel 3

# Skill-owned baseline/candidate pairs: 3 iterations
bun run eval:live -- --cases Skills-Eval-02 \
  --model <provider/model> --iterations 3 --parallel 2

# Optional stress only; not the serialized behavioral baseline
bun run eval:live -- --cases INTENT-01 \
  --model <provider/model> --iterations 3 \
  --parallel 3 --runtime-parallel 2
```

Distinguish genuine semantic FAIL from engine failure, provider/auth failure,
invalid judge output and absent evidence. Review `run.json`, target/judge
attempts, required-boundary completeness, independent baseline/candidate
artifacts and comparison. Do not transform a real behavioral FAIL into
NON-EVIDENCE to make the cutover look green.

The manually dispatched `.github/workflows/loom-live-evals.yml` can run
selected cases on a trusted ref with configured credentials. **Never
run secret-bearing live evals on untrusted pull-request code.**
No paid inference runs in ordinary PR CI.

## Validation record and remaining debt

- **Stage 1:** PR #146 merged at `4ef43568`. Its prior-head real model
  observations and checks are not a Stage 2B same-head live validation.
- **Stage 2B provider-free:** results must be recorded from this PR's
  CI. A recording-runner CLI smoke establishes forwarding, **not**
  actual container execution or model behavior.
- **Live full matrix:** not established solely by this documentation
  and provider-free test change. It requires live execution and artifact
  inspection on the final reconciled head.
- **Stage 2A integration:** reconcile cleanup PR, verify just one active
  orchestration and no accidental diagnostic authority, then run the full
  matrix again on the combined integration commit.
- **Known Stage 1 wrapper debt until Stage 2A is reconciled:** legacy
  helper/list compatibility, private paired `_run_lane` scheduling import,
  and separate normal/paired subprocess/artifact roots. Update this ledger
  against the *actual* merged Stage 2A diff; do not assume debt is fixed.
- `docs/eval-engine-task-7-validation.md` describes a historical
  pre-ablation checkpoint, not the final Task 9 contract.
