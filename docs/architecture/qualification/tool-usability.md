---
type: Qualification Report
title: "Public tool usability qualification"
description: "Measured fresh-agent workflows, schema agreement, guidance budgets and independent review."
tags: [loom, tooling, usability, qualification]
timestamp: 2026-11-27T00:00:00Z
---

# Public tool usability qualification

The candidate supports the exercised historical-discovery, objective, population
and exact-source workflow without implementation inspection. Its fresh agent
made no invalid tool requests; the baseline agent made three failed preview
requests. Both completed the task in 43 registered calls. This is a bounded
usability qualification, not evidence of general call or token savings.

Related: [#227](https://github.com/bateau84/loom/issues/227), building on
[#253](https://github.com/bateau84/loom/pull/253), #254 and #255.
[PR #257](https://github.com/bateau84/loom/pull/257) contains the changes. The
[evidence record](tool-usability-evidence.json) retains exact inputs, response
sizes/hashes, source fingerprints, outcomes and review disposition. The
[compressed raw responses](tool-usability-responses.json.gz) retain every
measured synthetic response for independent verification.

## Public surface and scope

The bundled guide teaches capability selection and composition; discovered tool
descriptions remain the operation reference. Neither the guide nor a Plan is a
new prerequisite. Historical investigation, attributed evidence authoring,
population approval and separately authorized execution remain distinct.

| Tool | Interface review and resulting guidance or contract |
| --- | --- |
| `loom_history` | Selective discovery/trajectories; required operation; scope and paging combinations; nested population selection; history versus preview versions; reusable navigation. |
| `loom_objective` | Exact-source find; optional authoring using real returned `result.id`; operation/source/phase combinations; complete continuations; useful empty-result guidance. |
| `loom_review` | Private original review/work reads; separate population freeze and evaluation preparation; exact approved preview request with complete pins. No new execution operation. |
| `loom_record` | Direct known-ID retrieval, fields projection and explicit JSON; query/write combinations; saved identifiers and supported examples. |
| `loom_action` | Optional shared continuity; create/update fields and revision prerequisites expressed in schema. |
| `loom_plan` | Optional dependencies/resumption; read/save prerequisites and complete replacement guidance. |
| `loom_context` | Read/selection effects; mutually exclusive clear/independent/work selection combinations. |
| `loom_trace` | Timeline versus exact native source; source requires message, part and fields. Access limits retained. |
| `loom_insights` | Reports, preparation and admission distinguished; operation-specific IDs required. No inferred evaluation authority. |
| `loom_trends` | Selected versus all-linked populations; objective IDs required only for selected. |
| `loom_tweak` | Proposal/trial/retirement prerequisites; proposing does not apply a change. |
| `loom_agents` | Roster before delegation; availability, configuration and roles distinguished. No new operation discriminator. |
| `loom_assessment`, `loom_qa` | Existing role/permission-bound loaders reviewed and retained; both included in the 14-schema/discovery checks. |

History/objective envelopes preserve unsupported fields until Loom can reject
them rather than relying on a host to silently discard a mistaken claim. New
diagnostics avoid echoing supplied field names/values or protected source
existence. Stateful ownership, permissions, source existence, cursor validity
and cross-value relationships still require runtime checks. Schema cases are
representative contracts, not exhaustive equivalence with every owner rule.

The history adapter adds operations to known navigation without rewriting source
records or exact owner queries. Results retain response budgets, source rechecks
and final disclosure checks. Source resolution, learning semantics, dispatch,
execution authority and persistence formats are unchanged. The parallel
original-source initiative retains ownership of source resolution.

The parallel implementation is [PR #256](https://github.com/bateau84/loom/pull/256)
at `164f6749e3ddc1b0897da1b5913028d0c33c1493`. A read-only three-way merge check
against our candidate finds overlaps/conflicts in `src/plugin.ts` and
`src/tool-help.ts`. Its `population-source` adds `source_offset`, `source_limit`
and `response_format`. At integration, carry **all three** into this PR's central
history envelope instead of restoring a second inline allowlist; resolving only
the text conflict would leave them rejected. Replace the current JSON-only
source guidance with its supported formats and bounded retrieval instructions.

The independent implementation reviewer also checked non-textual integration:
every large original, including ledger content, can return `content_json`
fragments instead of a complete `value`. Follow returned `navigation.next`, join
fragments in order and verify the original digest. Preparation-source navigation
also targets `history population-source` and carries the population manifest
hash, distinct from the preparation response's own hash. Preserve that returned
request. Document its `unresolved` status and the fresh preview/freeze needed for
previously reference-only members. Recheck schema/runtime cases, large-source
and preparation continuations, and help/search budgets on the combination.
Neither branch is combined or merged here; both target the same main baseline.
Later documentation index/log entries must also retain both initiatives at
integration; those additive records do not change either source contract.

## Method and revisions

Three fresh, instruction-isolated agents used only the bundled skill, public
catalog, registered descriptions/schemas and returned data. They were forbidden
from reading implementation, fixtures, database state or other investigators'
work. They could retain responses and write local processing helpers. This was
instruction isolation, not a filesystem security boundary.

A/B received the same task and equivalent seeded history: investigate an anomaly
from a known Action, retain uncertainty, identify its actual objective, inspect
connected history, prepare complete selected membership, stop for approval,
freeze unchanged and inspect representative exact frozen sources. Both used
selective history and direct reads rather than an exhaustive ledger scan. The
baseline was a competent task attempt, not an optimized script; avoidable agent
handling errors are separately attributed below.

| Run | Production snapshot | Fixture | Bridge SHA-256 |
| --- | --- | --- | --- |
| Baseline A | `0c618ad417519fbc68bfe642662b23682eb6a63c` | Established objective, 240 records | `ffa820facf899080edc5b96ad42710e96578e492981d77e76cd588a71a1109a4` |
| Candidate B | `2eebab2535da3b5a2c4be015ec7d983cf362708d` | Same established scenario, 240 records | Same as A |
| Missing objective C | Same candidate production snapshot | Unplanned history, 500 records, initially no objective/review associations | `1aceea1aaf2c89d2b869148a2b0489b3541a1630805546c4798094dd0da0d263` |

Candidate `2eebab2` has the same Git tree as published `918652b517983c8daaf5f249a5283a21c1545f78`:
`376d11d0318ef21aa4f50e062f60cf2af1f4889e`. The final delta contains only an
existing history paging prerequisite expressed in schema, two cases, the
missing-scenario bridge count correction, and evidence documentation. Fresh runs
remain attributed to their actual snapshots, not later-head executions. Reviewed
delta hashes are recorded separately.

The bridge uses real registration callbacks, stores and source owners with a
simulated native registration/permission host and existing requester access to
review material. It is not a live model-driven OpenCode Session, protected
recipient transfer, native artifact resolver or genuine Evaluator run. Pinned
Code Mode and installed-host CI are separate checks.

The integration owner authorized writes only to disposable synthetic state.
A/B stopped at their exact preview digests before freeze approval. C first
stopped at missing-objective findings and concrete proposed originals; creation
and linking were then authorized. C stopped again at the complete preview before
separate freeze approval. The operation allowlist did not itself enforce these
conversational approval stages.

## Actual measurements

The harness counts registered callback invocations, including thrown failures.
Help is the full description plus JSON Schema. Skill reads are separate. Sizes
are actual UTF-8 content bytes before agent display filtering, not tokens.
`/start`, transport envelopes, chat messages and local displays are excluded.
Per-call wall times are retained; no task-latency comparison is claimed.

| Measurement | Baseline A | Candidate B | Missing objective C |
| --- | ---: | ---: | ---: |
| Registered tool calls | 43 | 43 | 52 |
| Failed calls | 3 | 0 | 2 deliberately seeded |
| Help reads / distinct tools | 6 / 4 | 4 / 4 | 5 / 4 |
| Skill reads | 1 | 1 | 1 |
| Exact repeated tool inputs beyond first | 1 | 1 | 0 |
| Additional semantic page rereads | 0 | 0 | 1 |
| Tool-response bytes | 591,981 | 610,684 | 444,072 |
| Help-response bytes | 110,060 | 72,792 | 84,678 |
| Skill-response bytes | 11,831 | 11,964 | 11,964 |
| **Total measured bytes** | **713,872** | **695,440** | **540,714** |
| Complete selected / frozen membership | 42 / 42 | 42 / 42 | 29 / 29 |
| Representative frozen exact-source reads | 13 | 16 | 3 |
| Completed without implementation inspection | Yes | Yes | Yes |

Candidate tool output was larger; lower total volume reflects fewer help reads.
Unique help definitions actually grew from 60,808 to 72,792 bytes; baseline's two
rereads added 49,252 bytes. Workloads also differ: A used a successful preview
limit of 50, B paged at 20; B inspected 16 frozen sources versus A's 13; A made two
additional historical-work reads. There was one run per condition, different
generated IDs and questions, and no randomized/repeated trial. These numbers do
not establish a causal efficiency improvement, an optimal baseline, general
performance or token savings. The earlier operator rehearsal's 27 calls/~987 kB
is background, not a comparable control.

### Attribution of failures and avoidable work

**A:** The first failed preview copied Action-history pins into an objective
preview, an avoidable scope assumption. An identical retry followed because the
agent's `check_output` wrapper raised before retaining the error content. A then
read objective-scoped history and copied those pins into preview, also invalid.
All three errors said “History relationship sources changed; restart the read.”
Baseline help already showed a minimal preview; the inputs were agent mistakes.
The missing distinction between version domains and ambiguous recovery message
were interface deficiencies. Starting from objective ID/question succeeded.
Candidate guidance/diagnostics explain that transition and preserve deliberate
exclusions. Two duplicate help reads arose from uncached, truncated local display,
not failed Loom retrieval.

**B:** All calls succeeded. A trajectory was requested twice after a local
processing failure whose exception was not retained; both actual responses were
identical, 121,659 bytes. The cause of the local failure cannot be established.
The agent identified two avoidable preemptive help reads, overlapping record and
review reads, and conservative preview paging. These are proposed optimizations,
not measured savings. Returned requests supplied boundaries without reconstruction.

**C:** Intentional malformed calls omitted history's operation and treated
objective find as label search, despite the available guide. Errors named valid
history operations and required exact-source identity with a text-discovery
alternative. No other call failed. One objective help reread and one preview
page-1 repeat were avoidable after oversized display was not retained. The repeat
used a returned pinned request, so its input differs from the initial minimal
request although response bytes match. Approval did not require either reread.

Remaining friction is response density: repeated relationship/provenance
projections and whole multi-operation schemas make combined display expensive.
The guide teaches selective retrieval, fields and exact-path search; this PR does
not redesign projections or invent operation-specific host help. Retaining a
complete response once and displaying only relevant fields avoids these local
handling failures.

### Completion and authority

A/B each previewed and froze 42 members: 20 ledger records, 14 associations, two
review requests, five review relationships and one objective identity. Frozen
digests matched their approved previews and all membership pages were visited.
Exact frozen content inspection was representative, not exhaustive.

C continued reading originals after empty objective results. After authorization
it created one actual objective, used returned `result.id`, retained the automatic
anchor link and appended 13 further links. Its 29 members were 14 originals,
14 associations and one objective. The unrelated formatter source was never
selected; `exclusions: []` is truthful and does not claim an explicit exclusion.
C exhausted preview membership, obtained exact approval, froze, exhausted frozen
membership and inspected the original concern, correction and scoped verification.

All three preserved uncertain historical cause, unchanged-code rerun versus test
correction, scoped verification versus whole acceptance, and authored versus
observed claims. Available selected members do not imply available external or
native artifact bodies. Sources retained limitations and `execution_permit: null`.
No evaluation was prepared/run, no Action/Plan was created, and no original
ledger record was changed. Shutdown verified originals unchanged and cleaned all
three disposable state directories.

## Budgets and regression coverage

The guide is 11,964 characters within its 12,000 ceiling; discovery metadata stays
below 200. Twelve shared help descriptions total 43,664 within 44,000; including
the two unchanged role loaders, all 14 descriptions total 48,658. Each retains
the 3,600 ceiling except record's existing 10,000 allowance. These are character
budgets, not tokenizer-independent context limits.

Real pinned `@opencode/codemode@2.0.29` search includes generated signatures.
Stronger schemas increase some discovery responses:

| Exact search | Baseline UTF-8 bytes | Final candidate bytes | Ceiling |
| --- | ---: | ---: | ---: |
| History | 5,886 | 7,551 | 8,000 |
| Objective | 5,214 | 6,838 | 7,200 |
| Review | 17,521 | 17,779 | 18,000 |
| Record | 16,038 | 16,015 | 16,500 |

Full namespace search is bounded at 84,000 serialized bytes. The shipped
measured-record example executes with `Date.now()`; the pinned runtime tests
establish that `performance`, Node `process` and `Buffer` are absent. String
length does not measure bytes or tokens.

Regression coverage includes valid schemas for all 14 tools and **94 explicit
schema/runtime cases across 12 tools**, using Draft 2020-12 and real callbacks.
The common initial 92-case comparison found 61 baseline schema mismatches and
two runtime acceptances of unsupported objective fields; candidate had none.
The final two cases cover existing history `after` prerequisites. Executable
examples derive IDs and complete the missing-objective/authoring/trajectory/
preview/freeze/source path without a Plan. Other tests cover unchanged returned
requests, budgets, missing operations, bad fields/boundaries, permission denial,
private review ownership and final disclosure. No native dispatch is credited to
these fixtures.

Published `918652b` passed all eight workflows, including main CI's 438 core,
985 native, 11 Code Mode and 322 Python tests, typechecking and production bundle.
The final delta requires its own CI; PR checks are authoritative for the current
head. An earlier producer native run had one stale literal guidance assertion;
wording was corrected before the tested candidate. Published `68089c2` then failed
two documentation-bundle checks in main CI and the routing workflow's unit gate:
this report lacked an index entry and used an unsupported local section-fragment
link. The correction adds the index/log entries and uses the complete document
link. The five focused documentation checks pass; current-head CI remains the
separate final gate. Failed runs are not relabelled as passing.

## Independent review

A cold implementation reviewer examined `2eebab2` versus `0c618ad` before seeing
producer/usability findings. It found no material production defect and passed
119 Bun tests, three Python tests and typechecking. It found a minor harness
defect: committed missing mode asked for 240 records although its fixture
requires at least 500. It independently reproduced both failure and corrected
startup/cleanup. The targeted follow-up accepted that correction and the existing
history paging rule now expressed in schema, passing three schema tests. Final
verdict: **ready within the reviewed scope**. Reviewed file hashes are in the
evidence record. This is an agent review, not GitHub human approval.

Fresh investigators supplied independent usability assessments. A separate
reviewer independently verified all 156 raw hashes/byte counts, archive
reproduction, unchanged freeze requests, complete 42/42/29 membership and all
32 frozen-source content hashes. It found no blocking report/accounting issue:
**ready within the measured usability-evidence scope**. Its initial report hash
and final disposition are retained in the evidence record. Merge authorization
remains separate from unmerged delivery.

## Reproduction

Run normal native/Python suites and the pinned Code Mode command in
[tool discovery](../spec/ars-013-tool-discovery.md). Python schema tests
use test-only `jsonschema==4.26.0`, installed outside plugin dependencies in CI.
For a new fresh-agent exercise:

```sh
LOOM_USABILITY_SOURCE_ROOT="$PWD" bun tests/tool-usability-reader.ts /tmp/loom-usability-new established
# Use a different nonexistent directory and `missing` for the unplanned case.
# Stop by creating /tmp/loom-usability-new/STOP.
```

Give the investigator only `/start`, `/skill`, `/tools/<name>` and `/call`, never
this report or implementation. Keep task instructions equivalent and read/write
approval stages explicit. Retain full responses before compact display. The
bridge prints localhost and file-transport locations. Generated IDs differ;
report/example IDs are not existing objectives in another store.

The gzip archive is a JSON array of `{run,index,content}`. Verify all stored
content bytes with Python's standard library:

```python
import gzip, hashlib, json
from pathlib import Path

root = Path("docs")
evidence = json.loads((root / "tool-usability-evidence.json").read_text())
archive = (root / evidence["raw_responses"]["path"]).read_bytes()
assert hashlib.sha256(archive).hexdigest() == evidence["raw_responses"]["sha256"]
steps = {(name, step["index"]): step
         for name, run in evidence["runs"].items() for step in run["steps"]}
responses = json.loads(gzip.decompress(archive))
assert len(responses) == len(steps)
seen = set()
for item in responses:
    key = item["run"], item["index"]
    assert key not in seen
    seen.add(key)
    step, content = steps[key], item["content"].encode("utf-8")
    assert len(content) == step["bytes"]
    assert hashlib.sha256(content).hexdigest() == step["response_sha256"]
assert seen == set(steps)
```
