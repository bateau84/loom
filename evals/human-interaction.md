---
type: evaluation
title: Loom Human-Interaction Evaluation
description: Actual-response and optional runtime checks for useful, proportionate, evidence-preserving Loom communication.
tags: [evaluation, loom, conversation, evidence, communication]
---

# Human-interaction evaluation

This extends [BR-020](../docs/requirements/loom/br-020-conversation-is-primary-interface.md), not the workflow engine. General's always-loaded human-facing section owns presentation. Specialists retain detailed assignments, evidence, permissions, and independent verdicts.

## What the cases measure

`human-interaction.json` contains nine default `conversation-response` cases. Each runs the real General directives in a fresh, tool-denied context and grades the actual answer, not a promise to produce one. Existing case IDs are not renumbered.

| Case | Distinguishing behavior |
| --- | --- |
| HUMAN-01 | A simple explanation is direct and plain rather than a workflow announcement. |
| HUMAN-03 | A requested handover remains complete, with verification limits, the blocker, preserved work, and next steps. |
| HUMAN-04 | An update leads with a real finding while preserving causal uncertainty. |
| HUMAN-05 | Synthesis preserves an independent failed gate despite optimistic adjacent evidence. |
| HUMAN-06 | A blocker requests only missing test-service access through a secure channel, not secrets in chat or settled technical choices. |
| HUMAN-07 | A request for exact traces retains commands, named Reviewer attribution, and the failed result. |
| HUMAN-08 | Receipt of Stop is not confirmation that the host operation stopped. |
| HUMAN-09 | JSON-only output preserves verification categories and does not invent remaining obligations. |
| HUMAN-10 | Fully verified bounded work is reported complete without inventing whole-product gates. |

There are no target-visible grading instructions. Deterministic tests check default inclusion, the complete production body surviving the response wrapper, tool-denied isolation, and exclusion of grading metadata. These are wiring checks, not semantic PASS results or a capture of the final provider prompt.

`human-interaction-live.json` is explicitly non-default, including under `--all`. Its `HUMAN-RUNTIME-01` runs two actual repository checks: one passes and one fails on an intentional recovery defect. It checks actual command selection and honest outcome reporting without repair permission. Native shell and Code Mode execution are supported by the action assertions. The fixture uses only Python's standard library and does not modify its files; deterministic tests execute both commands and verify those properties.

### Removed coverage

At the user's explicit request, `HUMAN-02` and `HUMAN-02-EVIDENCE-FIRST` were deleted, along with their stress suite and preservation test. They are not retained as skipped or optional cases. The nine remaining default cases and five existing regressions keep their original prompts and grading.

This removes the two-sentence auth-status scenario and its input-order comparison, including the identical-evidence short/long pair with HUMAN-03. HUMAN-03 still covers the detailed handover, HUMAN-06 covers actionable test-service access, and opt-in HUMAN-CAUSE-01 covers a short missing-archive explanation. Those cases are related coverage, not proof that the removed auth-status omission is fixed. Historical results remain in [PR #59](https://github.com/bateau84/loom/pull/59); they are not converted to passes or re-scored after deletion. General's instructions and the separately recorded action-state limitation are unchanged.

## Running the focused checks

The usual deterministic checks spend no model inference:

```sh
bun run test
bun run eval:validate
bun run eval:harness-test
```

`--suite` chooses which central suite files to load; it does not satisfy the runner's explicit live-run selection guard. Use the `--cases` selectors below to authorize only the intended cases. Do not substitute `--all`: skill-owned cases are also loaded and could expand the paid run beyond the named suite. A selection-guard error occurs before model execution.

For explicit model-backed response coverage, select your configured model:

```sh
bun run eval:live -- \
  --suite evals/human-interaction.json \
  --cases HUMAN-01,HUMAN-03,HUMAN-04,HUMAN-05,HUMAN-06,HUMAN-07,HUMAN-08,HUMAN-09,HUMAN-10 \
  --iterations 3 --parallel 3 \
  --artifact-dir .loom-evals/human-interaction \
  --model PROVIDER/MODEL
```

Run the optional runtime case separately so response reliability is not confused with runtime/provider latency:

```sh
bun run eval:live -- \
  --suite evals/human-interaction-live.json \
  --cases HUMAN-RUNTIME-01 \
  --iterations 1 --parallel 1 \
  --artifact-dir .loom-evals/human-interaction-live \
  --model PROVIDER/MODEL
```

These model runs consume provider budget. Do not enable them in ordinary CI or silently expand default coverage to nested specialist inference. Deleting the two cases does not itself require another model run of unchanged cases.

## Focused status and attribution regressions

`human-interaction-regressions.json` contains five opt-in, tool-denied response cases. They test transfer to other scenarios and guard against errors introduced by more explicit reporting:

| Case | Distinguishing behavior |
| --- | --- |
| HUMAN-CAUSE-01 | A missing snapshot archive remains attached to the blocked replay check in a two-sentence status. |
| HUMAN-CAUSE-UNKNOWN-01 | An incomplete handoff does not become an invented access problem, saved patch, or passing test. |
| HUMAN-TRACE-01 | A requested exact trace retains its independent producer despite a separate Worker success. |
| HUMAN-JSON-01 | Artifact facts stay out of passed-check lists; out-of-scope deployment is not remaining work; queued review is not an invented capability block. |
| HUMAN-JSON-OBSERVED-01 | A genuine executed existence check is valid narrow evidence, and deployment remains required when explicitly in accepted scope. |

The regression suite is excluded from default selection, including bare `--all`. Explicitly load it alongside the default suite. This six-case matrix is available for broader status/evidence verification, not required for every fixture edit. It is not the historical seven-case matrix and does not measure the removed scenario:

```sh
bun run eval:live -- \
  --suite evals/human-interaction.json \
  --suite evals/human-interaction-regressions.json \
  --cases HUMAN-09,HUMAN-10,HUMAN-CAUSE-01,HUMAN-CAUSE-UNKNOWN-01,HUMAN-JSON-01,HUMAN-JSON-OBSERVED-01 \
  --iterations 3 --parallel 5 \
  --artifact-dir .loom-evals/human-interaction-fact-selection \
  --model PROVIDER/MODEL
```

Use a fresh artifact directory and record the checkout SHA for each run. Inspect the actual answers even when their judge reports PASS: a valid JSON shape does not establish correct evidence categories. A failed result stays failed; a justified judge disagreement must be recorded separately rather than overwriting the raw artifact. These fixtures contain scenario facts, not reference answers or target-visible scoring rules. The wiring checks do not themselves establish semantic reliability.

### Grading correction after artifact inspection

HUMAN-09 retains its original expectations and prohibition, with additional judge-only criteria that make the evidence-category and scope boundaries explicit. Its old judge accepted answers listing patch existence as a passed check and unrequested deployment as remaining work. A separate regression case did not prevent those false greens in the original case, so its grading must discriminate them too.

A supplied fact that a file exists is not an executed existence check. Conversely, the positive control supplies an actual existence command with a successful exit and explicitly includes deployment in scope; neither may be suppressed by a blanket rule. No rule bans mentioning that deployment has not happened. The boundary is inventing an obligation from that fact alone. Field placement matters: a factual non-deployment note in `remaining` still presents it as unfinished work. Such a note may appear in `status` when useful, without adding an unrequested key.

Preserve old results under their original grading contract. New HUMAN-09, HUMAN-JSON-01, and HUMAN-JSON-OBSERVED-01 scores use a stricter contract and must not be presented as a directly comparable improvement rate. Their previous failure criteria and target prompts remain intact; no passing threshold has changed. Do not repeat an unchanged failing candidate solely to obtain a green sample.

Grade meanings, not exact wording or a fixed sentence order:

| Supplied boundary | Allowed remaining work | Incorrect extra entry |
| --- | --- | --- |
| HUMAN-09: independent review is required; deployment is not established as scope | Independent review | Deployment, including a factual "not deployed" note |
| HUMAN-JSON-01: patch and review only; deployment excluded | Independent review | Any deployment status or optional follow-up |
| HUMAN-JSON-OBSERVED-01: review and test-environment deployment required; no functional test requirement established | Independent review and test-environment deployment | Functional testing merely because none was run |

An observed existence check still counts as a narrow check. Its lack of functional coverage is a limitation, not proof of functional success and not by itself a new testing obligation. In real work, justified new verification requirements follow the normal authority and routing path; the distinction does not prohibit discovering or proposing them.

### Recording and packaging results

Before running, use a new artifact directory and record provenance without credentials or environment dumps (substitute the actual output directory selected for the run):

```sh
mkdir -p .loom-evals &&
mkdir .loom-evals/human-interaction-fact-selection &&
git rev-parse HEAD > .loom-evals/human-interaction-fact-selection/source-revision.txt &&
git status --porcelain --untracked-files=no > .loom-evals/human-interaction-fact-selection/tracked-worktree.txt &&
sha256sum agents/general.md scripts/run-evals.py \
  evals/human-interaction.json evals/human-interaction-regressions.json \
  > .loom-evals/human-interaction-fact-selection/inputs.sha256
```

Do not edit these inputs during the run. The sidecars identify local source inputs, not the provider payload. A nonempty worktree record means the commit alone does not describe all local changes. Keep the chosen model/judge and command with the result evidence.

After the run, package the entire directory even when evals fail. Run this separately, not after an `&&` tied to eval success:

```sh
tar -czf /tmp/loom-human-interaction-fact-selection.tar.gz \
  -C .loom-evals human-interaction-fact-selection
```

## Evidence limits

A schema-valid case is not a behavioral PASS. An actual-response PASS proves only that response under its supplied context. The mocked Stop case does not establish host cancellation, and the progress update case does not measure time to first update. The optional runtime case exercises check execution and final reporting, not the complete specialist workflow.

A full interruption/timing claim needs an observed host trace: a real in-flight operation, new user input, cancellation or reconciliation events where applicable, and the messages emitted before and after those events. No new cancellation scheduler, timer, or host interrupt mechanism is introduced by the communication contract.

For before/after comparison, run the same cases and fixtures against the baseline and candidate General directives with the same model, settings, and judge contract. Inspect the actual answers, including the longer report, failed-gate, and completed-task controls. Keep provider/infrastructure errors separate from semantic failures. Record changes in coverage separately from changes in model behavior.

## Unit-test discovery convention

`bun run test` first runs `scripts/test_ci_*.py`, then discovers `*.test.ts` under `plugins/loom`, `scripts`, and `dashboard`. Those roots and filenames are reserved for zero-inference unit suites. The report-promotion suite is included automatically. Symlinked suites/directories, dependency trees, browser `.e2e.spec.*` tests, and external skill fixtures are not accidentally enrolled. Real host integration, browser validation, and paid live evals retain their separate entrypoints.
