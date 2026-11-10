---
type: Playbook
title: "Native Evaluator audit qualification"
description: "Qualify one installed Evaluator against original engineering Sessions and durable public Loom records without claiming simulated execution as a real audit."
tags: [loom, evaluator, learning, native-host, qualification]
timestamp: 2026-11-10T00:00:00Z
---

# Native Evaluator audit qualification

**Status: UNPROVEN — native audit not executed.** This is an executable acceptance procedure and a source-backed preflight, not a successful native run. A review using simulated plugin registration, a scripted provider, or public CI history cannot satisfy the Evaluator execution claim. Do not publish Session exports or full model transcripts.

## Exact source baseline and scope

As inspected on 2026-11-10:

| Source | Revision / status |
| --- | --- |
| Loom `main` | `edab7a96e7c5a9172ceb98b8518c47c48a1d7c09`; PR #217 merged |
| Agents `main` | `cfbf668d7bf952e285d707d29ff755f14e1c892d`; Evaluator PR #13 merged |
| Skills `main` | `67794eb948bf9e8ab662631aef834cff10a850ef`; agent-run-audit PR #27 merged |
| Declared Loom SDK | `@opencode/plugin@2.2.6`; `bun.lock` controls dependencies |
| Declared verification host | CLI `@opencode/cli@2.2.6` in installed-host workflows; not proof of the operator's installed CLI |
| Declared Bun | `.bun-version` = `1.4.2`, supported `>=1.4.2 <2.0.0` |

**Installed state is a separate identity.** Record the executable path and `opencode --version`, installed Loom package/path and SDK version, enabled native agent IDs and actual agent/skill file SHA-256s, observed native skill-load receipt hashes, selected model and limits, effective Loom capture status, and provider/account entitlement without copying credentials. Git source hashes and file presence are *not* installed instruction fingerprints. The operator must verify the actual Evaluator definition, the `agent-run-audit` skill and applicable `retrospective`/`learning` guidance as seen by this host.

**Current execution boundary:** The environment that prepared this procedure could read the three GitHub repositories but had no OpenCode executable, Bun runtime, model credentials, AOS config or original Session history. Consequently it made **no model call, native subagent dispatch, live Loom tool write or recovery read**. No host, agent, instruction exposure, or model budget was inferred from source. Stop and mark the corresponding claim UNPROVEN if the installed environment cannot establish it.

## Choose one original objective

Preferred *candidate*, subject to actual native source access: PR [#217](https://github.com/bateau84/loom/pull/217), which corrected CI and tool-registration issues during one engineering objective. [Failed CI 42715887637](https://github.com/bateau84/loom/actions/runs/42715887637) and [later passing CI 42835238699](https://github.com/bateau84/loom/actions/runs/42835238699) are public verification references **only**. They do not identify the user request, original parent/child Sessions, instructions exposed, interventions or complete outcome. Do not turn those CI outcomes into separate objectives or infer a success rate. If authorized original native Sessions for this objective cannot be found, use another genuine authorized AOS objective whose original history is available; otherwise stop the real-work claim as UNPROVEN. Do not fabricate a source objective or induce fresh failures.

Select the actual parent Session, its local child Sessions, explicit continuations, correction prompts and verification artifacts. Do not join unrelated Sessions solely by repository or title. The Evaluator must inspect the original request, coordination, dispatches, revisions, checks and final outcome, retaining successful practices and material friction. Distinguish observed fact, interpretation and missing evidence.

## Preflight on an authorized installed host

Run from the **same canonical project/workspace** as the original Sessions. These commands inspect only identities; never export credentials or upload their output unreviewed:

```sh
git rev-parse HEAD
command -v opencode
opencode --version                   # require exact expected 2.2.6, or requalify
opencode plugin list                 # inspect active Loom, not a failed listing
opencode models                      # inventory only; not included-billing proof
opencode session list --format json  # parent Sessions; does not enumerate children
bun --version                        # relevant to local plugin build, not embedded CLI proof
```

Read the effective native agent roster and Loom's registered `loom_agents {}` output. Require an available, enabled Evaluator with native `mode: subagent`, access to `agent-run-audit` through the native `skill` tool, active Loom tools, and `result.learning.available:true`. Check the actual resolved installed instruction paths, then run `sha256sum` on those *installed* files and record their identities in a private report. Record agent registry hash, actual skill tool-result hash (if paired), and any registry snapshot hash *separately*. None proves final model-input exposure. Check `loom_agents` capture/config diagnostics; do not proceed on silent plugin failure.

**Budget gate:** Before invoking the model, choose and record an explicitly authorized provider/model/account, model context/input/output limits and remaining included quota. Confirm both parent and subagent effective model routes and that neither permits paid fallback or bypasses Loom's early routing guard. An explicit `--model` is not evidence that the child uses the same route. If no included-only route can be established, **do not send a prompt**. Limit this pilot to one parent dispatch of one Evaluator, one bounded audit and recovery read; stop on unexpected extra dispatch, denied provider, quota exhaustion or insufficient evidence. No `--auto` permission bypass, model alias fallback, global skill mutation or shared registry overlay.

## Original evidence and native dispatch

OpenCode 2.2.6's tagged CLI implements `opencode session export SESSION_ID --sanitize`. Export the original parent and *each* relevant child separately to a private, non-tracked directory under the same project for Loom's read-permission checks. Set restrictive permissions, add the directory to local `.git/info/exclude` (not the committed `.gitignore`), inspect sanitization before use, and remove the exports after the audit. Verify source Session/project identities, page boundaries, missing windows and export authenticity limits. Do not commit the exports.

Loom `loom_trace` has two different boundaries:

- `{"operation":"children","session_id":"PARENT_ID","limit":20}` enumerates direct children **only in the caller's native Session family**; follow `next_cursor` and relevant descendants. Running a detached Evaluator root cannot claim this proof.
- `{"operation":"timeline","session_id":"SOURCE_ID","export_path":".private-evaluator/SOURCE_ID.json","limit":25}` reads another Session only through an explicit, permission-checked, project-local export. Follow `next_cursor`; `include_text:true` requires separate privacy review. The caller's own unexported `timeline` is post-compaction context, not full history.

For the child-discovery claim, dispatch the Evaluator **from the original parent Session** so it belongs to that native family; otherwise mark direct-child inventory UNPROVEN. Use a new subagent child for independent investigation and instruct it to inspect source, not accept General's handback as the verdict. The tagged 2.2.6 CLI supports `run --session`, `--agent`, `--model` and `--format json`. Example, with operator-verified IDs and routes:

```sh
cd /ABS/AUTHORIZED/PROJECT
umask 077
opencode run --session "$ORIGINAL_PARENT_SESSION" \
  --agent general --model "$APPROVED_INCLUDED_MODEL" --format json \
  "Dispatch the installed evaluator once through native subagent delegation. Audit the already-completed AOS objective tied to $ORIGINAL_PARENT_SESSION using agent-run-audit. Independently inspect its original request, child Sessions, corrections, verification and outcome using authorized Loom trace and exact source links. Record beneficial practices, friction, missing evidence, host/model/instruction uncertainty and a whole-objective verdict. Use public Loom record operations to persist a source-linked finding. Do not edit code or shared instructions, create candidates, launch other engineering work, or infer a trend from this case."
```

Capture **private** native event metadata establishing actual `subagent` invocation, a new child Session ID with `agent=evaluator`, real model request/terminal response, native `skill` load, registered `loom_trace` calls and evidence page completion. A coordinator saying it dispatched an agent is insufficient. Record time, Session/message/call IDs, version, successful/failed tool statuses, usage and capped expenditure; redact model text, tokens, credentials and private prompts before sharing evidence. A blocked model request or missing child terminal response is not native Evaluator PASS.

## Durable record and later read

The Evaluator writes an ordinary evidence-backed `loom_record add` result, claim or Assessment, using an existing Action ID **only if the objective really belongs to it**. Without an Action, use the Evaluator's own Session scope. For an Assessment, provide `verdict:pass|fail|inconclusive` based on evidence, not a preselected PASS. Include stable, redacted Session/message/call/PR/CI references in the statement or `artifact_refs`; `evidence_ids` accept only valid same-scope Loom observation IDs. A record is a stored opinion, not automatic objective satisfaction.

Retain the returned record ID and actual storage scope. Prove exact readback through registered `loom_record {"operation":"query","action_id":"ACTION_ID","record_id":"RECORD_ID"}` for Action records, or `loom_record {"operation":"query","view":"full_thread","session_id":"EVALUATOR_SESSION_ID","limit":20}` for Session-scoped records; follow `next_cursor` to null and read the **full** statement, provenance and qualifications rather than a preview. Then stop and reopen the **same** project-local Loom state through an authorized native host restart or fresh host process, and repeat the retrieval from a new Session. Do not restart another user's active host to manufacture recovery evidence. If reopening is unavailable, record a successful in-process read only, with restart recovery UNPROVEN. Neither `loom_insights` counts nor `loom_tweak` candidates replace durable original-source findings.

`loom_insights` pages at most 200 Action-ledger events (default 100) and returns per-page descriptive counts; time filtering is page-local. `loom_trace` pages 1–50 events (default 25), export files are limited to 16 MiB and responses to 262144 bytes. `full_thread` pages at most 50 entries and may split large records. These are **source collection ceilings**, not model context limits or full-history guarantees. Document omitted pages, inaccessible children, compaction, Code Mode opacity, divergent fingerprints and author-reported completion.

## Experiment decision and acceptance ledger

**Default for this pilot: no instruction candidate and no trial.** One audit does not establish a trend. A real treatment is optional only after a source-backed hypothesis, genuinely eligible authorized comparison work, separately isolated host/workspace and unchanged evaluation criteria exist. If justified later, record complete immutable candidate content and SHA-256 with `loom_tweak propose`, stable objective-level assignment, observed **actual** candidate delivery (not only assignment or a registry snapshot), correctness and human-intervention guards, and a subsequently attributed `trial`. A manual trial lacking verified exposure is inconclusive/not-exercised, not A/B effectiveness. No automatic overlays, global promotion or shared skill edits.

| Acceptance claim | Required native evidence | Current result |
| --- | --- | --- |
| Actual installed Evaluator and method | Effective native roster, installed fingerprints, real skill load and child model terminal response | UNPROVEN — no installed runtime |
| Original objective reconstruction | Parent/child trace IDs, authorized exports, source coverage, real verification and corrections | UNPROVEN — no original native Session data |
| Public Loom persistence | Real registered `loom_record` write, returned ID and full retrieval | UNPROVEN — no live Loom instance |
| Restart recovery | New host/Session reads complete stored records from the same state | UNPROVEN — no host state |
| Delivered instruction treatment | Fixed content, isolated assignment and actual delivery receipt | NOT EXECUTED — no justified candidate |
| Effectiveness or trend | Multiple comparable independent objectives, coverage and counterexamples | NOT CLAIMED — one candidate example |

**No execution evidence was generated in this documentation-only preparation.** Public PR/CI links establish only a plausible real engineering source to investigate. On a real run, retain a private, access-restricted audit bundle with the recorded revision/versions, effective model and caps, redacted event IDs/statuses, exact public-tool request/response identities, the source coverage matrix, full record-read receipts, restart evidence and a bounded PASS/FAIL/UNPROVEN verdict per claim. Publish only reviewed non-sensitive metadata. Existing [learning](learning-experiments.md), [trace](retrospective-trace.md) and [installed-host](installed-host-validation.md) documents remain the current API/coverage references.
