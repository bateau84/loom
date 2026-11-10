---
type: Playbook
title: "Native Evaluator audit qualification"
description: "Run and assess one real OpenCode Evaluator audit through original Session evidence and public Loom persistence, without claiming simulated tests are native proof."
tags: [loom, evaluator, learning, qualification]
timestamp: 2026-11-10T00:00:00Z
---

# Native Evaluator audit qualification

**Current verdict (2026-11-10): UNPROVEN for native model-driven execution, persistence/recovery and instruction effectiveness.** This is a reproducible qualification protocol and an evidence inventory, **not** a completed native audit. The preparation environment had GitHub access but no OpenCode or Bun executable, original native Session store, installed Evaluator registration or authorized provider credential. No inference, native delegation, source export, public Loom write, host restart or treatment trial was performed for this document. Do not convert this blocker into PASS.

## Source identity and proof boundary

Intended path: **real OpenCode General request → native Evaluator child → installed skill load → original parent/child Session evidence and real verification → public Loom write → host reopening → public Loom read**. All those product-owned stages must actually execute. A local simulated plugin, CI packaging job or scripted provider does not establish the Evaluator's real model judgment.

| Source | Verified main revision | Qualification |
| --- | --- | --- |
| [agents #13](https://github.com/bateau84/agents/pull/13) | `cfbf668d7bf952e285d707d29ff755f14e1c892d` | Source Evaluator definition merged; **not** host installation |
| [skills #27](https://github.com/bateau84/skills/pull/27) | `67794eb948bf9e8ab662631aef834cff10a850ef` | Source `agent-run-audit` merged; **not** loaded content |
| [Loom #217](https://github.com/bateau84/loom/pull/217) | `edab7a96e7c5a9172ceb98b8518c47c48a1d7c09` | Starting source revision; **not** installed plugin identity |

Loom source pins `@opencode/plugin@2.2.6` and tests on Bun 1.4.2 (`>=1.4.2 <2.0.0` supported). Installed-host CI separately provisions `@opencode/cli@2.2.6`; the separate Code Mode *search fixture* is `@opencode/codemode@2.0.29`. These source/test versions do not prove the operator's actual executable, plugin or SDK. A Git revision/blob ID is not an installed file SHA-256.

Collection limits from the source: `loom_trace` has up to 50 projected events per page, a 16 MiB authorized export cap and a 256 KiB response cap; `loom_insights` allows up to 200 observations/page; `loom_record` up to 50 records/page; `loom_tweak` allows 128 KiB candidate content, 20 evidence references and 20 trial reports/page. These are **not** model context, output, quota or cost limits. Verify the live tool descriptions.

## Preflight on an authorized native host

Run from the relevant checkout; record only redacted outputs. **Resolve installed files from the actual host configuration**, not from the GitHub source layout:

~~~sh
git rev-parse HEAD
opencode --version
opencode run --help
opencode agent list
bun --version
# From the installed Loom plugin directory:
node -p 'require("./node_modules/@opencode/plugin/package.json").version'
# Replace both placeholders with the ACTUAL paths registered by OpenCode:
sha256sum /ACTUAL/AGENT/PATH/evaluator.md /ACTUAL/SKILL/PATH/agent-run-audit/SKILL.md
~~~

Record actual plugin location and commit/package fingerprint; source and *installed* agent/skill SHA-256; CLI/SDK/Bun versions; General and Evaluator native roster/modes; `loom_agents` availability/roles/capture and `learning.available`; native discovery of `loom_trace`, `loom_insights`, `loom_action`, `loom_record` and `loom_tweak`; selected provider, model, variant, context and output limits; and the billing/remaining quota boundary. A registered definition is not evidence of a skill's delivery or use.

**Stop before inference** if any required installation, actual host version, public tool, permission or provider/account eligibility is missing. Only choose a provider/model already authorized with verified included-only/no-paid-overage protection. Do not enable unqualified Loom model routing, paid fallback, `--auto` permissions or shared skill-registry mutation. An OS timeout is not itself a provider billing cap. Bound the attempt to **one original objective, one native General → Evaluator dispatch and one later recovery read**, with an explicit operator-approved quota and at most 10 minutes for the audit request. Record observed token use/cost and incomplete budget controls.

## Original evidence selection and access

Select one *genuine*, already authorized AOS objective with original request, coordination/parent Session, relevant child Sessions, corrections, verification and later outcome. Loom [PR #217](https://github.com/bateau84/loom/pull/217) is a useful lead because public CI shows a correction; **it is not eligible unless original native Sessions can be retrieved**. Otherwise select another genuine eligible objective or stop; do not create unrelated work or synthetic failure samples.

Discover via `opencode session list --format json` (check installed help) and, inside the native host, `loom_action {"operation":"sessions","limit":20}`. Follow actual parent/child identities, work references and source IDs, not similar titles. A Session can contain multiple objectives and an Action can span several.

`loom_trace` reads current context for its own caller only. For another Session, produce a **separately authorized** sanitized native export within the same project and pass a project-relative path. Review the export privately: sanitization is best-effort, and sanitized directory identity may be unverified.

~~~sh
umask 077
private_dir="$(mktemp -d "$PWD/.native-evaluator-audit.XXXXXX")"
# Exclude this directory from git locally; never commit it.
opencode session export "$SOURCE_SESSION_ID" --sanitize > "$private_dir/source.json"
# Repeat for relevant children; confirm the IDs and project match.
~~~

Use real `loom_trace` calls with `{"operation":"timeline","session_id":"SESSION_ID","export_path":"PROJECT_RELATIVE_PRIVATE_EXPORT.json","include_text":false,"limit":25}`. Follow `next_cursor` through the final page. `{"operation":"children","session_id":"SESSION_ID","limit":20}` can enumerate children **only within the caller's own native Session family**; it cannot enumerate arbitrary historical source Sessions from an unrelated new audit. For historical objectives, obtain each parent/child ID through authorized native Session inventory, export metadata and explicit work links, then supply a separate permitted export for each timeline. Do not misrepresent inaccessible children as inspected. Record missing/compacted/opaque history. Inspect user requirements, actual dispatches, child work, corrections, tool calls, loaded instructions and tests/CI, not only the handback. An Action ledger or a source export is not automatically complete native history. Never commit raw exports or private transcripts.

## Executable source-export preflight (no inference)

Before attempting any model run, export the authorized original parent and each linked child through the installed OpenCode CLI, then check the byte-bounded native export structure:

~~~sh
umask 077
# Export in the original work's project; never publish these JSON files.
opencode session export "$PARENT_SESSION_ID" --sanitize > "$private_dir/parent.json"
opencode session export "$CHILD_SESSION_ID" --sanitize > "$private_dir/child.json"

python3 tools/native_evaluator_preflight.py \
  --parent-export "$private_dir/parent.json" \
  --child-export "$private_dir/child.json" \
  --report "$private_dir/source-preflight.json"
~~~

For additional descendants, repeat `--child-export`. The preflight checks native Session IDs, parent chains, common project identity, recorded paths where visible, user messages, export size and stable byte hashes; it rejects unrelated/duplicate Sessions, nonregular/symlink files, malformed exports and missing children. It writes only a mode-0600 redacted summary, never transcript text. **A successful source-shape preflight is still UNPROVEN for source authenticity, comprehensive coverage, native Evaluator execution, correctness or instruction effectiveness.** The run stops before model inference; the full native host still needs to own and authorize those Sessions for `loom_trace`. The CLI output itself is not proof that the Evaluator inspected or understood it.

Run the component checks with `python3 -m unittest discover -s tests -p 'test_native_evaluator_preflight.py'`. Synthetic test exports are negative/structural fixtures, **not** completed native audit work.

## Execute native dispatch, not role imitation

The shipped Evaluator is `mode: subagent`. The primary path is to ask **installed General** to dispatch it using the host's **native delegation**. Capture the actual child Session identity and the actual tool/skill call receipts. A role-labelled response without a native child is UNPROVEN, not a delegated audit.

Supply an instruction to General with the actual eligible source IDs:

> Dispatch exactly one read-only audit to the installed evaluator through native delegation. The Evaluator must load agent-run-audit through the real skill tool, inspect original authorized parent/child Session evidence using public loom_trace, and join corrections and verification into one objective when the identities justify it. Preserve favorable practices, friction, observed facts, interpretations, evidence gaps and actual user outcome separately. Use public loom_insights, loom_action and loom_record; persist one redacted source-linked result, return the exact Action ID and record ID. Do not implement work, edit instructions, launch unrelated agents, infer a trend, propose a tweak, or manufacture a candidate. Stop if original history, public operations, budget or authorization cannot be established.

If the installed host supports the flags, a noninteractive Linux invocation is:

~~~sh
# Write the approved instruction with source IDs to this private file first.
# MODEL must identify a verified included-only authorized provider/model.
timeout -s TERM -k 20s 600 \
  opencode run --agent general --model "$MODEL" --format json "$(cat "$private_dir/audit-prompt.txt")" \
  > "$private_dir/native-run.jsonl"
~~~

Do not pass `--auto`. Capture the native dispatch/child Session, skill-load event and content identities from the real host (keeping JSONL private). A requested dispatch without completed child evidence is not a success. Direct `--agent evaluator` is a distinct boundary; label it separately if the primary delegation is unavailable. Distinguish host-observed skill result hashes from source file-byte hashes and final provider-input exposure, which neither alone attests.

## Persist and recover through public Loom operations

Reuse a correctly scoped existing Action or explicitly create an Action for audit continuity; do not assume every Action represents one objective. The Evaluator must use registered tools, **not direct SQL**. Check `loom_insights {"operation":"action","action_id":"ACTION_ID","limit":50}` and follow `next_before` with `before`; its counts are observations, not success rates.

After inspecting actual evidence, write a concise attributed record:

~~~json
{"operation":"add","action_id":"ACTION_ID","kind":"result","statement":"ONE objective. OBSERVED: [source IDs and verification]. POSITIVE: [supported practice]. FRICTION: [supported episode]. INTERPRETATION: [qualified explanation]. UNKNOWN: [missing original history / instruction exposure / user feedback]. No trend or treatment established.","artifact_refs":["ACTUAL_SOURCE_REFERENCE"]}
~~~

Await the returned write, retain its real ID and read full content with `loom_record {"operation":"query","action_id":"ACTION_ID","record_id":"RECORD_ID"}`. Read `loom_record {"operation":"query","view":"full_thread","action_id":"ACTION_ID","response_format":"json","limit":20}` through its cursor.

**Reopen the same host-owned Loom state** and use a fresh native Session to retrieve the same Action/record ID, full content, sources and qualifications through public tools. Requery bounded insights. Compare exact records rather than accepting a model's summary. Simulated plugin reopening, a direct SQLite query, or a new empty database is not this proof.

A `loom_tweak` candidate is **not required**. Only create and trial a fixed candidate when independent evidence, eligible real work, explicit host/Session isolation, actual delivered content, assignment receipt, stable criteria and correctness/human-intervention safeguards justify it. A stored proposal is not a delivered treatment; an unexercised variant is not effectiveness evidence. Do not force `not-exercised` reports to create artificial results.

## Redacted evidence inventory, 2026-11-10

| Claim | Public evidence / observation | Verdict |
| --- | --- | --- |
| A real Code Mode discovery test failed | [CI 42715887637](https://github.com/bateau84/loom/actions/runs/42715887637), head `8994cdbe9b143560dcef8882906e5673672f8ab6`: test expected 0 remaining after a page of 8 but received 2 | OBSERVED CI failure, not an agent outcome |
| Later changed source passed that pipeline | [CI 42835238699](https://github.com/bateau84/loom/actions/runs/42835238699), head `f7e6be672695128a668e33fb6755003b629339fc` | OBSERVED CI pass, not verified whole-objective satisfaction |
| Qualification workspace assembled source and pinned tools | [CI 42837587690](https://github.com/bateau84/loom/actions/runs/42837587690), head `34fd746c152c7d6a78a454d43ede88c200dff3d4` | Packaging only |
| Native public Loom record, insights and full_thread survived host restart | [Installed questions CI 42893709670](https://github.com/bateau84/loom/actions/runs/42893709670), PR head `2a14f4c7a4ebff9cfeb5fd90ce1b8e1c987ae5ae`; E7 PASS with a fresh reader Session | **PASS for installed persistence/recovery mechanics only.** Scripted external model, no native Evaluator judgment or original work |
| Actual installed Evaluator/skill, hashes, model/limits, provider authorization | Not accessible in this preparation environment | UNPROVEN |
| Native General → Evaluator child, skill load and original Session/child inspection | No native host, originals or delivery receipts | UNPROVEN |
| Public Loom persistence and full-record read after native restart | No native calls or restart | UNPROVEN |
| Instruction treatment delivery and measured improvement | No justified candidate, assignment, exposure or comparison | NOT EXERCISED |

**Bounded finding:** the implementation's real-interface test caught a stale eight-tool expectation. A later revision passed. Preserving installed-interface verification is a favorable practice; the original agent trajectory, number of dispatches, model usage, human effort and eventual objective outcome remain unknown. One observed correction is not a longitudinal trend or basis for a universal skill change.

An eventual executed qualification should retain *privately*: source and installed hashes/versions, selected provider/model/variant and quota, parent/child Session IDs, native actual tool events, exports' source IDs and coverage, original tests/outcome, redacted actual Loom write receipt, fresh-host read receipt, wall time/tokens/cost, per-claim PASS/FAIL/UNPROVEN, and any external substitutions. Publish only reviewed redacted IDs and short findings, never raw transcripts, credentials or full run JSONL. Remove private exports when no longer required.

## Implementation references

- [Learning evidence and provisional experiments](learning-experiments.md)
- [Original Session trace scope and limits](retrospective-trace.md)
- [Installed-host validation](installed-host-validation.md)
- [Public Loom tools](tools.md)
- [Model routing qualification boundary](model-routing.md)
