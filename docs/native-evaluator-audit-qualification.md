---
type: Playbook
title: "Native Evaluator audit qualification"
description: "Run and assess one real OpenCode Evaluator audit through original Session evidence and public Loom persistence, without claiming simulated tests are native proof."
tags: [loom, evaluator, learning, qualification]
timestamp: 2026-11-10T00:00:00Z
---

# Native Evaluator audit qualification

**Current verdict (2026-11-11): PASS for scripted installed persistence/recovery mechanics; UNPROVEN for a real original-work Evaluator audit and instruction effectiveness.** E7 exercised public Loom writes and reads across an actual OpenCode 2.2.6 host restart with a local scripted provider. That check did not run a genuine Evaluator, inspect authorized original work or establish model judgment. The real-audit procedure below still requires original native Session evidence, installed Evaluator and skill identities, and an authorized provider/account. No real-work audit or treatment trial is claimed.

## Source identity and proof boundary

Intended path: **real OpenCode General request → native Evaluator child → installed skill load → original parent/child Session evidence and real verification → public Loom write → host reopening → public Loom read**. All those product-owned stages must actually execute. A local simulated plugin, CI packaging job or scripted provider does not establish the Evaluator's real model judgment.

| Source | Verified main revision | Qualification |
| --- | --- | --- |
| [agents #13](https://github.com/bateau84/agents/pull/13) | `cfbf668d7bf952e285d707d29ff755f14e1c892d` | Source Evaluator definition merged; **not** host installation |
| [skills #27](https://github.com/bateau84/skills/pull/27) | `67794eb948bf9e8ab662631aef834cff10a850ef` | Source `agent-run-audit` merged; **not** loaded content |
| [Loom #217](https://github.com/bateau84/loom/pull/217) | `edab7a96e7c5a9172ceb98b8518c47c48a1d7c09` | Starting source revision; **not** installed plugin identity |

The Phase 2 source check found agents `main` still at `cfbf668d7bf952e285d707d29ff755f14e1c892d` and skills `main` at `5072d3e8163b56bcbe5139b9b008091dbfc8947b`. The inspected source bytes are:

| Definition | Source SHA-256 |
| --- | --- |
| `agents/evaluator.md` | `8642064709f2bd67942f0ab99093454905b5fd03265bfc7481153484d210c2e1` |
| `skills/agent-run-audit/SKILL.md` | `af5445ff71b21db45bfe9b58f71982f94d9226513b4937d3a8601b67842ea80c` |

These are reproducible source identities. Compare with the actual installed files; a matching source hash does not prove that a native request delivered those instructions.

Loom source pins `@opencode/plugin@2.2.6` and tests on Bun 1.4.2 (`>=1.4.2 <2.0.0` supported). Installed-host CI separately provisions `@opencode/cli@2.2.6`; the separate Code Mode *search fixture* is `@opencode/codemode@2.0.29`. These source/test versions do not prove the operator's actual executable, plugin or SDK. A Git revision/blob ID is not an installed file SHA-256.

Collection limits from the source: `loom_trace` has up to 50 projected events per page, a 16 MiB authorized export cap and a 256 KiB response cap; `loom_insights` allows up to 200 observations/page; `loom_record` up to 50 records/page; `loom_tweak` allows 128 KiB candidate content, 20 evidence references and 20 trial reports/page. These are **not** model context, output, quota or cost limits. Verify the live tool descriptions.

## Preflight on an authorized native host

Run from the relevant checkout; record only redacted outputs. **Resolve installed files from the actual host configuration**, not from the GitHub source layout:

~~~sh
git rev-parse HEAD
opencode --version
opencode run --help
opencode api agent.list --param "location[directory]=$PWD"
bun --version
# From the installed Loom plugin directory:
node --input-type=module <<'NODE'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
let directory = path.dirname(fileURLToPath(import.meta.resolve('@opencode/plugin')))
for (;;) {
  const file = path.join(directory, 'package.json')
  if (fs.existsSync(file)) {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (pkg.name === '@opencode/plugin') { console.log(pkg.version); break }
  }
  const parent = path.dirname(directory)
  if (parent === directory) throw new Error('Resolved OpenCode SDK package not found')
  directory = parent
}
NODE
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

## Observe public receipts during one authorized audit

The opt-in [Evaluator observer](../tools/evaluator-observer/server.ts) records native model-request identities, direct Evaluator-child ancestry, skill-result hashes, source trace page chains, and exact public `loom_record` write/read hashes. It makes no model requests and never captures prompts, statements, source excerpts, skill text, raw errors or credentials. It writes at most 512 receipts and approximately 1 MiB per observer instance, using a private file opened exclusively with mode 0600. A collection failure cannot reject a completed tool or activate learning features.

The observer is a separate qualification plugin. It is **not** enabled by installing Loom. Use the same checked-out Loom revision and locked dependencies, then add the absolute directory `CHECKOUT/tools/evaluator-observer` to the existing OpenCode `plugins` array. Preserve other configuration. Do this only for the one authorized audit. Existing `ledger.capture: off`, invalid capture configuration or a different native project suppress collection; do not override a privacy opt-out just to obtain a receipt.

Prepare private scope before starting the host. OpenCode 2.2.6's `run --session` accepts an explicit new Session ID and creates it when absent; the native Session ID schema requires the `ses` prefix. Random IDs let the observer bind the audit and later reader before either request is sent. Neither an ID nor this settings file is a human-authorization receipt.

~~~sh
umask 077
export AUDIT_SESSION_ID="ses_$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
export RECOVERY_SESSION_ID="ses_$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
export AUDIT_PROJECT_DIRECTORY="$PWD"
export AUDIT_PRIVATE_DIRECTORY="$private_dir"
mkdir -m 700 "$private_dir/receipts"
export LOOM_EVALUATOR_OBSERVER="$private_dir/observer.json"
python3 - <<'PY'
import json, os
from pathlib import Path
scope = {
    'format': 'loom-evaluator-observer/v1',
    'project_directory': str(Path(os.environ['AUDIT_PROJECT_DIRECTORY']).resolve()),
    'receipt_directory': str(Path(os.environ['AUDIT_PRIVATE_DIRECTORY']).resolve() / 'receipts'),
    'audit_session_id': os.environ['AUDIT_SESSION_ID'],
    'recovery_session_id': os.environ['RECOVERY_SESSION_ID'],
}
fd = os.open(os.environ['LOOM_EVALUATOR_OBSERVER'], os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as out:
    json.dump(scope, out)
PY
~~~

Confirm the observer appears active on the exact host. Use the explicitly authorized provider/model and the prompt in the next section. The fresh reader request must be separately included in the approved budget. These commands execute models; the collector below does not.

~~~sh
timeout -s TERM -k 20s 600 \
  opencode run --standalone --session "$AUDIT_SESSION_ID" --agent general \
  --model "$MODEL" --format json "$(cat "$private_dir/audit-prompt.txt")" \
  > "$private_dir/native-run.jsonl"

# First retain the actual Action/record IDs returned by the completed Evaluator.
# Write recovery-prompt.txt with only the exact public read request shown below.
# A second standalone invocation owns a new host process and a distinct Session.
timeout -s TERM -k 20s 120 \
  opencode run --standalone --session "$RECOVERY_SESSION_ID" --agent general \
  --model "$MODEL" --format json "$(cat "$private_dir/recovery-prompt.txt")" \
  > "$private_dir/recovery-run.jsonl"
~~~

For the audit, require a completed native `subagent` call to `evaluator`, the real `skill` call for `agent-run-audit`, all selected original trace pages, one source-linked result write, and its exact record-ID query before returning. For recovery, request `loom_record {"operation":"query","action_id":"ACTUAL_ACTION_ID","record_id":"ACTUAL_RECORD_ID"}` and bounded insights/full-thread readback. A model saying that it performed these operations cannot satisfy the receipt checker.

After both invocations finish, collect the private receipts. Resolve symlinked installed agent/skill paths to their real files first. Repeat `--child-export` for every selected source descendant and `--observer-log` for the actual audit and recovery files (at most four).

~~~sh
python3 tools/native_evaluator_qualification.py \
  --observer-log "$private_dir/receipts/ACTUAL_AUDIT_INSTANCE.ndjson" \
  --observer-log "$private_dir/receipts/ACTUAL_RECOVERY_INSTANCE.ndjson" \
  --parent-export "$private_dir/parent.json" \
  --child-export "$private_dir/child.json" \
  --agent-file /ACTUAL/RESOLVED/AGENT/PATH/evaluator.md \
  --skill-file /ACTUAL/RESOLVED/SKILL/PATH/agent-run-audit/SKILL.md \
  --record-id ACTUAL_RECORD_ID \
  --report "$private_dir/qualification.json"
~~~

`receipt_consistency: COMPLETE` means the **supplied local receipts agree** on the native child, skill observation, selected trace page chains, exact public record and a distinct observer-instance reader. Exit 0 has only that meaning. Each instance must close normally, preserve the selected audit/recovery scope and agree on native child ancestry. Replaying the same native Session/message/call tuple across instances is rejected; a provider reusing a call ID in a different message is not itself a replay. Native Code Mode can give several nested tool results the same tuple within one instance; those remain separate local observations ordered by receipt sequence, not invented host subcall identities. The report always retains `native_evaluator: UNPROVEN`: local files are editable, a plugin-instance change alone does not attest a host reboot, model-request hooks are not final provider-input receipts, and hashes cannot judge reasoning or billing. Known scripted fixture providers explicitly leave consistency qualification incomplete. Missing events, partial files, repeated instances/calls, changed authors/content, unsupported host versions and incomplete trace pages remain visible failures or gaps.

Retain the process-start/exit evidence privately to corroborate the actual restart. An independent Reviewer should then inspect the original audit and classify **observed facts, agent-reported claims, independent verification, corrective work, interpretation, missing evidence, useful practices and practices to leave unchanged**. Matching mechanical receipts cannot replace that assessment. Share only the reviewed `qualification.json` and concise redacted assessment; do not upload the original exports, raw JSONL, credentials or provider configuration. Remove the observer entry and unset `LOOM_EVALUATOR_OBSERVER` when the bounded audit ends.

## Execute native dispatch, not role imitation

The shipped Evaluator is `mode: subagent`. The primary path is to ask **installed General** to dispatch it using the host's **native delegation**. Capture the actual child Session identity and the actual tool/skill call receipts. A role-labelled response without a native child is UNPROVEN, not a delegated audit.

Supply an instruction to General with the actual eligible source IDs:

> Dispatch exactly one read-only audit to the installed evaluator through native delegation. The Evaluator must load agent-run-audit through the real skill tool, inspect original authorized parent/child Session evidence using public loom_trace, and join corrections and verification into one objective when the identities justify it. Preserve favorable practices, friction, observed facts, interpretations, evidence gaps and actual user outcome separately. Use public loom_insights, loom_action and loom_record; persist one redacted source-linked result, return the exact Action ID and record ID. Do not implement work, edit instructions, launch unrelated agents, infer a trend, propose a tweak, or manufacture a candidate. Stop if original history, public operations, budget or authorization cannot be established.

Write that instruction with the actual source IDs to
`$private_dir/audit-prompt.txt` **before** the single scoped audit invocation
above. Use that `--standalone --session "$AUDIT_SESSION_ID"` command once;
this section supplies its prompt, not a second audit invocation. Preserve the
original output instead of overwriting it with a rerun.

Do not pass `--auto`. Capture the native dispatch/child Session, skill-load event and content identities from the real host (keeping JSONL private). A requested dispatch without completed child evidence is not a success. Direct `--agent evaluator` is a distinct boundary; label it separately if the primary delegation is unavailable. Distinguish host-observed skill result hashes from source file-byte hashes and final provider-input exposure, which neither alone attests.

**Original-parent child-inventory boundary (retained from #220):** The native
`loom_trace children` view can enumerate direct children only for the caller's
verified Session family. A newly launched detached General/Evaluator Session
cannot truthfully claim it enumerated an old parent's complete child tree.
When an authorized operator intentionally needs that specific proof, they may
resume the **original parent** with an independently approved model and
`opencode run --session "$ORIGINAL_PARENT_SESSION" --agent general`, after
checking the installed CLI help and preserving private snapshots. This writes
a new, separately identified audit turn into the original Session and must not
be counted in the historical engineering objective. If the operator does
not authorize such a mutation, use explicit original parent/child exports
and record native family enumeration as **UNPROVEN**, not as a failure of the
Evaluator. Do not create a new source Session or relax read permissions to
make the claim pass.

## Persist and recover through public Loom operations

Reuse a correctly scoped existing Action or explicitly create an Action for audit continuity; do not assume every Action represents one objective. The Evaluator must use registered tools, **not direct SQL**. Check `loom_insights {"operation":"action","action_id":"ACTION_ID","limit":50}` and follow `next_before` with `before`; its counts are observations, not success rates.

After inspecting actual evidence, write a concise attributed record:

~~~json
{"operation":"add","action_id":"ACTION_ID","kind":"result","statement":"ONE objective. OBSERVED: [source IDs and verification]. POSITIVE: [supported practice]. FRICTION: [supported episode]. INTERPRETATION: [qualified explanation]. UNKNOWN: [missing original history / instruction exposure / user feedback]. No trend or treatment established.","artifact_refs":["ACTUAL_SOURCE_REFERENCE"]}
~~~

Await the returned write, retain its real ID and read full content with `loom_record {"operation":"query","action_id":"ACTION_ID","record_id":"RECORD_ID"}`. Read `loom_record {"operation":"query","view":"full_thread","action_id":"ACTION_ID","response_format":"json","limit":20}` through its cursor.

**Reopen the same host-owned Loom state** and use a fresh native Session to retrieve the same Action/record ID, full content, sources and qualifications through public tools. Requery bounded insights. Compare exact records rather than accepting a model's summary. Simulated plugin reopening, a direct SQLite query, or a new empty database is not this proof.

A `loom_tweak` candidate is **not required**. Only create and trial a fixed candidate when independent evidence, eligible real work, explicit host/Session isolation, actual delivered content, assignment receipt, stable criteria and correctness/human-intervention safeguards justify it. A stored proposal is not a delivered treatment; an unexercised variant is not effectiveness evidence. Do not force `not-exercised` reports to create artificial results.

## Redacted evidence inventory, 2026-11-11

| Claim | Public evidence / observation | Verdict |
| --- | --- | --- |
| A real Code Mode discovery test failed | [CI 42715887637](https://github.com/bateau84/loom/actions/runs/42715887637), head `8994cdbe9b143560dcef8882906e5673672f8ab6`: test expected 0 remaining after a page of 8 but received 2 | OBSERVED CI failure, not an agent outcome |
| Later changed source passed that pipeline | [CI 42835238699](https://github.com/bateau84/loom/actions/runs/42835238699), head `f7e6be672695128a668e33fb6755003b629339fc` | OBSERVED CI pass, not verified whole-objective satisfaction |
| Qualification workspace assembled source and pinned tools | [CI 42837587690](https://github.com/bateau84/loom/actions/runs/42837587690), head `34fd746c152c7d6a78a454d43ede88c200dff3d4` | Packaging only |
| Native public Loom record, insights and full_thread survived host restart | [Installed questions CI 42919207181](https://github.com/bateau84/loom/actions/runs/42919207181), PR head `ad799b6736788960a8b33d4c71539ebe17724722`; E7 PASS with a fresh reader Session | **PASS for installed persistence/recovery mechanics only.** Scripted external model, no native Evaluator judgment or original work |
| Actual installed Evaluator/skill, hashes, model/limits, provider authorization | Not accessible in this preparation environment | UNPROVEN |
| Native General → Evaluator child, skill load and original Session/child inspection | No original-work dispatch, skill-delivery or source-inspection receipts | UNPROVEN |
| Persistence and recovery of a real original-work Evaluator-authored audit | No authorized original-work Evaluator audit has been executed | UNPROVEN |
| Instruction treatment delivery and measured improvement | No justified candidate, assignment, exposure or comparison | NOT EXERCISED |

**Bounded finding:** the implementation's real-interface test caught a stale eight-tool expectation. A later revision passed. Preserving installed-interface verification is a favorable practice; the original agent trajectory, number of dispatches, model usage, human effort and eventual objective outcome remain unknown. One observed correction is not a longitudinal trend or basis for a universal skill change.

An eventual executed qualification should retain *privately*: source and installed hashes/versions, selected provider/model/variant and quota, parent/child Session IDs, native actual tool events, exports' source IDs and coverage, original tests/outcome, redacted actual Loom write receipt, fresh-host read receipt, wall time/tokens/cost, per-claim PASS/FAIL/UNPROVEN, and any external substitutions. Publish only reviewed redacted IDs and short findings, never raw transcripts, credentials or full run JSONL. Remove private exports when no longer required.

## Implementation references

- [Learning evidence and provisional experiments](learning-experiments.md)
- [Original Session trace scope and limits](retrospective-trace.md)
- [Installed-host validation](installed-host-validation.md)
- [Public Loom tools](tools.md)
- [Model routing qualification boundary](model-routing.md)
