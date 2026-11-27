---
type: Playbook
title: "S3 handoff: one genuine Evaluator audit through the prepared execution chain"
description: "Operator authorization, original-work selection and independent assessment for the first restricted real audit; execution remains unavailable until its authority adapter qualifies."
tags: [loom, learning, evaluator, qualification]
timestamp: 2026-11-27T00:00:00Z
---

# One genuine Evaluator audit

**Prepare one audit of the durable Stage 4 preparation objective in [PR #236](https://github.com/bateau84/loom/pull/236), then obtain separate operator authorization before inference.** This is a candidate with implementation, review findings, corrections and final scoped acceptance. Its original native Sessions and private exports have **not** been established as available. Public PR prose is supporting evidence, not a replacement for the original work.

Production execution is currently unavailable: [the consumer](../../src/evaluator-execution.ts) has no production `EvaluatorExecutionAuthority`. The [authority contract](../../src/evaluator-execution-contract.ts) requires effective recipient/method/source/account authority, an enforceable shared resource pool, durable effect admission and reconciliation. Implementing its TypeScript shape or passing local-provider fixtures does not supply those guarantees. This document authorizes no source export, transfer, model call, dispatch activation or spending.

## 1. Fix the original-work scope

Ask the native-work operator to identify the original request and owner Session for #236, then enumerate exact linked source Sessions, immutable artifacts and review receipts. Freeze only the records necessary for this trajectory:

| Evidence | Question the audit must resolve |
| --- | --- |
| Original objective, accepted #235 contract and first #236 implementation | What capability was requested, implemented and explicitly deferred? |
| Backup-marker finding and correction | Why could a surviving preparation marker misclassify missing extension state, and what verification established the correction? |
| Runtime/lifecycle test failures and targeted rechecks | Which failures were test-boundary problems, which behavior was inspected, and what remained unproven after each scoped recheck? |
| [Targeted runtime review](https://github.com/bateau84/loom/pull/236#issuecomment-6919287136) | Why did that review accept its limited test correction without granting overall acceptance? |
| [Final bounded acceptance](https://github.com/bateau84/loom/pull/236#issuecomment-6919899799), exact reviewed artifacts and verification | What ultimately passed, including the stated artifact-equivalence limit on Stage 3 evidence? |
| [Unfinished obligations](https://github.com/bateau84/loom/issues/227#issuecomment-6918622661) | Which capabilities and the original-source modification question stayed open? |

Keep initial completion claims, reviewer findings, failed runs, correction commits, original test outputs and final outcome evidence. Do not give the Evaluator only a cleaned-up final summary or tell it which practice to praise. One corrected objective remains one trajectory; independent roots and causal effectiveness are not established.

The current preparation view admits **the calling Session's existing evidence**. An accessible relationship to another Session does not authorize its original bytes. Select an owner/source set that supports the meaningful trajectory within that boundary. Record unavailable cross-Session originals as gaps; if essential evidence is missing, choose another genuine permitted objective or stop this audit. Do not import exports as invented ledger facts, broaden source filters or present public review summaries as inspected private executions.

## 2. Complete the authorization record

The operator must approve the **filled-in values**, not this template. Keep the approval and original evidence private; retain only approved redacted references in public evidence.

| Required approval | Exact values to record |
| --- | --- |
| Purpose and subject | One read-only whole-objective audit; original request/owner Session, prepared `batch_id`, `request_id`, `manifest_sha256`, initial `attempt_id`, source-store identity and frozen membership |
| Source handling | Each original/excerpt and its version/coverage; permission to export locally, process, transfer to the exact Evaluator/model, retain the result and disclose it to the named assessor; retention/deletion and backup scope |
| Installed method | Effective Evaluator definition, actual `agent-run-audit` skill, instruction bundle, rubric, result format and relevant native/project instructions; resolved locations, versions and SHA-256 values |
| Recipient | Qualified native host identity and one fresh, restricted `evaluator` Session; permitted source/tool surface; no project writes, instruction mutation, experiments or unrelated delegation |
| Fixed account route | Exact `provider_id`, `model_id`, variant/reasoning/context/output settings, opaque effective `account_id`, credential revision, account authority and enforced included-only policy; no wildcard, paid fallback or automatic account switching |
| Shared budget | Authority/pool identity, approved limits below, reservation scope across competing issues, expiry, revocation, cancellation and uncertain-spend handling |
| Recovery and assessment | Permission for no-inference original-result/accounting reads after restart, authorized result audience and named independent assessor; any assessor model usage needs its own authorization |

**Proposed first-audit limits, requiring explicit approval:** one logical evaluation; concurrency **1**; at most **12 actual provider requests**, **120,000 cumulative input tokens**, and **16,000 cumulative output tokens** across the entire evaluation; **zero paid overage**; no automatic retry, provider fallback or restart resume; stop new work after **10 minutes**, with grant expiry **15 minutes** after issue. Tool continuations and any permitted auxiliary requests count against the same totals. Disable unnecessary title/compaction requests. Record the authority's exact token-counting semantics, including reasoning/cache use; reduce or revise the scope before approval if the selected method cannot fit.

These are proposed operator limits, not configuration defaults or proven enforcement. The authority must enforce the actual sends and resource totals, including native retries and continuity. A local timer, `max_tokens`, a declared policy reference, available subscription quota or an operator checkbox is insufficient. Uncertain consumption remains reserved after expiry/cancellation; it is not released on a timeout. If the fixed account's included-only boundary or resource enforcement cannot qualify, no real call is permitted.

## 3. Run the no-inference preflight

After approval to inspect/export the selected sources, run from the checkout matching the qualified installation. Substitute the actual identifiers and resolved installation files. These commands inspect/export/check files; they do not request model execution.

```sh
umask 077
s3_private=$(mktemp -d /tmp/loom-evaluator-s3.XXXXXX)
s3_parent_session=ACTUAL_ORIGINAL_PARENT_SESSION
s3_child_session=ACTUAL_SELECTED_SOURCE_CHILD_SESSION
s3_agent_file=/ACTUAL/RESOLVED/AGENT/PATH/evaluator.md
s3_skill_file=/ACTUAL/RESOLVED/SKILL/PATH/agent-run-audit/SKILL.md
s3_bundle_file=/ACTUAL/RESOLVED/INSTRUCTION/BUNDLE
s3_rubric_file=/ACTUAL/RESOLVED/RUBRIC
s3_model_settings=/ACTUAL/RESOLVED/MODEL/SETTINGS
git rev-parse HEAD
opencode --version
bun --version
opencode api agent.list --param "location[directory]=$PWD"
sha256sum "$s3_agent_file" "$s3_skill_file" "$s3_bundle_file" \
  "$s3_rubric_file" "$s3_model_settings"
opencode session export "$s3_parent_session" --sanitize > "$s3_private/parent.json"
opencode session export "$s3_child_session" --sanitize > "$s3_private/child.json"
python3 tools/native_evaluator_preflight.py \
  --parent-export "$s3_private/parent.json" \
  --child-export "$s3_private/child.json" \
  --report "$s3_private/source-preflight.json"
```

Repeat the export and `--child-export` argument for **every selected source child**, including intervening ancestry. The tool requires at least one child; do not fabricate a child to make an unrelated single-Session case pass. Its success establishes bounded export shape/ancestry consistency, not authenticity, completeness, authorization or source receipt. Sanitization is best effort; inspect exports privately before any transfer. Exports stay outside the repository and are not inputs to an unrestricted model command.

Verify the actual installed plugin/SDK pair, source/package identity and effective agent configuration. Resolve inherited/project instructions and the selected model settings from the real host; source-file hashes alone do not prove instruction delivery. Before accepting the audit, require native evidence that the Evaluator actually loaded the installed Agent Run Audit skill and used the admitted method. Preserve the distinction between installed bytes, a skill-tool result, named host input and final provider exposure.

## 4. Execute only through the qualified owner

**There is no supported public execution command in this increment.** The integration owner must first qualify and connect a genuine authority adapter in trusted owner code. The intended entry is `EvaluatorExecution.execute(actor, pins, signal)` with the four preparation pins above, followed by `recover(actor, pins)` or `cancel(actor, pins)`. Production `Learning` constructs that consumer without an adapter. Tool/configuration input cannot install one.

The future qualified adapter prepares the exact recipient without source transfer/inference, reserves its real shared pool, supplies the immutable admission and enforces the actual effect boundary. It may use native Session create/prompt identities internally, but native input deduplication is not a provider-effect guarantee. Source access remains through the prepared source callback; outcome references must identify the original host/Session/input/result. This is a **direct prepared Evaluator route**, distinct from the legacy General→subagent audit guide.

Do not run `opencode run --agent evaluator`, the legacy General dispatch command, or a fixture entry point to bypass the missing adapter. Do not use a second model call to read a result that qualified native lookup can recover without inference. No instruction mutation or automatic Stage 4 scheduling is part of this audit; result-reference reconciliation is not S5 interpretation publication.

For the authorized run, privately retain the preparation/admission/reservation bindings, effective method/account receipts, complete authorized source-return coverage, each actual invocation and its kind, native original-result identity, terminal usage/settlement and cancellation/recovery observations. Compare individual invocations with the approved sequence, including auxiliary calls. After a controlled host restart, recover the same result with **zero additional model requests**; keep unknown states and held capacity if authoritative recovery is unavailable.

## 5. Use existing collectors within their actual scope

`native_evaluator_preflight.py` above is reusable source-shape checking. The existing `native_evaluator_qualification.py` checks **legacy General→Evaluator child, skill/trace and public `loom_record` write/read receipts**. It cannot certify the direct prepared route or its result-reference recovery. For genuine receipts from that separately authorized legacy profile only, its no-inference command is:

```sh
python3 tools/native_evaluator_qualification.py \
  --observer-log "$s3_private/receipts/ACTUAL_AUDIT_INSTANCE.ndjson" \
  --observer-log "$s3_private/receipts/ACTUAL_RECOVERY_INSTANCE.ndjson" \
  --parent-export "$s3_private/parent.json" \
  --child-export "$s3_private/child.json" \
  --agent-file "$s3_agent_file" --skill-file "$s3_skill_file" \
  --record-id ACTUAL_LEGACY_RECORD_ID \
  --report "$s3_private/legacy-receipt-consistency.json"
```

Do not invent delegation, record-write or recovery receipts for the new route. Even exit **0** means supplied local receipt consistency; the collector always reports `native_evaluator: UNPROVEN`. For this direct-route audit, the independent assessor must reconcile the actual consumer, authority and native receipts against the approved sequence. Scripted-provider reports remain mechanics evidence only.

## 6. Independently assess the actual reasoning

Give an independent human assessor, or a separately authorized Reviewer, the original evidence and exact audit output before the producer's verdict. Require source citations for material findings and assess whether the Evaluator:

- reconstructs one objective across attempts, review findings, corrections and independently verified outcomes;
- distinguishes completion claims from verification and preserves each original review/recheck's actual scope;
- identifies useful practices as well as failures, necessary exploration and avoidable rework, without turning post-outcome instructions into evidence of prior benefit;
- explains mechanisms, alternatives and counterevidence, including the strongest evidence against its recommendations;
- identifies missing originals, chronology/independence uncertainty and source-coverage limits;
- recommends a justified, testable improvement or concludes that no change/insufficient evidence is warranted.

Challenge the assessment with the misleading early completion claim, partial runtime recheck and Stage 3 artifact-equivalence limitation present in the original trajectory. The audit must not turn those into unqualified full acceptance. Do not plant false originals or mandate a favorable finding.

Record separate verdicts for **deterministic implementation**, **installed mechanics**, **authority/account qualification**, and **genuine original-work reasoning**, with exact artifact identities and unresolved gaps. One useful audit does not establish instruction efficacy, independent recurring patterns, full S4, Q4/Q5 or E11. Publish only reviewed redacted evidence; retain/delete private exports and receipts under the approved policy and remove the owned temporary directory when that work is complete.
