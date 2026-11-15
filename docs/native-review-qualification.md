---
type: Playbook
title: "Native review evidence qualification"
description: "Reproducible OpenCode 2.2.6 dispatch, admission, evidence and recipient-authority probes with explicit partial and unsupported capabilities."
tags: [loom, learning, review, qualification, native-host]
timestamp: 2026-11-12T00:00:00Z
---

# Native review evidence qualification

## Result and stage boundary

**The installed host proves useful direct-call, child-Session, admission and source-delivery mechanics. It does not yet qualify the complete native review evidence foundation.** In particular, a child's admitted input is not natively linked to the parent dispatch, later model/tool execution cannot be assigned to one of several admitted inputs, and native source-read denial does not prevent an authorized parent from inlining those bytes into a Reviewer prompt.

This stage delivers an executable probe and an [exact implementation contract](learning-native-evidence-spec.md). It does not add production review admission, durable review relationships, a source ACL, richer capture, retrospective scheduling or automatic evaluation. Existing production `src/` and `server.ts` bytes remain unchanged. The accepted architecture and requirements are the baseline; E11 remains future assembled-product acceptance.

The [recorded evidence](native-review-qualification-evidence.json) identifies the tested checkout, actual CLI binary, installed candidate, fixture/harness/helper hashes, native receipt IDs, checks and limitations. It is an output record, never an input that makes the harness pass. CI generates a fresh report and raw synthetic receipts for each candidate in the `installed-native-review-<sha>` artifact.

## Executed candidate record

The evidence record's `source_head` identifies the clean implementation commit
exercised with its packed candidate; `source_dirty` is false. All **eight expected mechanical checks** completed;
Q4 and Q5 retain their whole-capability `UNQUALIFIED` status, and the actual native
incoming-transfer counterexample retains `FAIL`. No real-model reasoning was tested.
The recorded input/runtime hashes allow later documentation-only evidence changes to be
checked against those same tested bytes. The file watcher stayed enabled.

The latest remediation run exercised clean commit `c62081d` and finalized **1,144 audit
receipts**. All eleven recorded input hashes and thirty production/runtime file hashes match
that checkout. Its matrix remains three Verified, five Partial and one Unsupported capability.

Remediation checks passed **239 Python tests**, including **19 oracle tests**, the repository
TypeScript check, and **10 documentation/fixture tests**. The original installed question
and Evaluator observer probes passed in the first stage. Exact-head CI remains independently
observable on the PR; earlier suite results must not be attributed to changed source bytes.

## Cold-review corrections — 2026-11-13

**NRQ-001:** The implementation contract now requires canonical issue intents and atomic
`prepareIssue` creation/lookup before an exclusive issue claim. Every initial caller resolves
to the same attempt; an intentional additional issue requires a distinct, canonical authorization
decision bound to one retry intent. Lost creation acknowledgements recover the same attempt;
lost claim/native acknowledgements grant no new issue permit. The specification includes eight
downstream concurrency/recovery conformance cases. This is a static contract correction, not
an implemented or executed production admission facility.

**NRQ-002:** The receipt oracle rejects reversed hook/progress ordering and joins across
observer boundaries. Its 19 focused tests cover these controls, identical replay, missing
starts, continuity loss and recovery, and legitimate progress-only/delayed-progress observations.
Replaying the original 1,144-receipt CI artifact preserves all 14 dispatch bindings, including
the six distinct Q1/Q2 invocations. Reordered/reduced copies are offline oracle controls;
they are not newly observed native outages or restarts.

The first fresh remediation run at `54d5f7b` failed during Q5 while parsing a live audit
snapshot. Its finalized 728-row audit is valid; a controlled partial append reproduces the
same JSON failure mechanism, although the exact original scheduling is unavailable. The
shared live reader now defers an unparseable final fragment without a line delimiter, while
completed malformed rows remain fatal. Every affected installed consumer performs a strict
final read after its writers stop. Native-review diagnostics are copied before that check;
final corruption remains `FAIL`. The native-review and question runners also reject observer
failures that finish writing during shutdown. Seven supporting reader/finalization tests cover
JSON and UTF-8 fragments, completed corruption, late observer failure, byte preservation,
report retention and existing no-final-newline fixtures.

**NRQ-003:** The reader now owns an append-only audit checkpoint for each qualification
run, shared by every live read and preserved across host restarts. Finalization requires
the audit to exist, contain receipts, preserve every previously observed byte and pass
complete parsing and observer-health checks. Deletion, valid-prefix truncation and changed
earlier receipts invalidate qualification even when the remaining JSON parses. Known
integrity failures remain fatal if the file is later restored. Routing evaluates its
per-mode provider counts against the finalized records, including late arrivals.

The final report's receipt count, byte count and SHA-256 come from the same captured
snapshot retained for review. Available malformed or incomplete bytes are preserved as
failure diagnostics; a missing source is reported as missing rather than replaced with
a fabricated empty audit. This is a local observation-continuity guarantee, not native
history authentication or detection of changes occurring entirely between observations.

## Status meanings

The report deliberately has two result fields:

- `execution_status: PASS` means every planned mechanical check and negative control executed and produced its expected observation.
- `status: UNQUALIFIED` means the required complete review guarantees are unavailable. This remains true even when all probe checks pass.
- A tested unexpected violation produces `execution_status: FAIL`, `status: FAIL`, the active failed scenario and its error. Missing runtime, dependencies or a different CLI version produce `UNQUALIFIED`; no native case is credited.

Q5 also records `native_recipient_transfer_property: FAIL`: the controlled synthetic inline disclosure actually crosses the boundary despite the receiving agent's denied read policy. The probe successfully demonstrates that counterexample. It is not a successful protected transfer contract, and no fixture-owned filter is presented as production enforcement.

Exit code **0** reports completed expected observations, **1** an unexpected failure, and **2** unavailable/incompatible execution prerequisites. Consumers must inspect qualification fields and per-capability limits; exit 0 does not enable learning or approve a protected review.

## Exact inspected and executed boundary

Source inspected: OpenCode **2.2.6**, release commit
[`dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`](https://github.com/anomalyco/opencode/tree/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06).
The inspected CLI, plugin and SDK package manifests declare 2.2.6. The probe separately checks the actual CLI and `/api/info` versions, installed `@opencode/plugin@2.2.6`, candidate package identity and every installed production source byte against the checkout. It records the CLI executable SHA-256. A version label does not cryptographically attest the binary's Git revision; the source revision and installed binary identity remain separate evidence.

The exercised flow is the real host's parent model step → native `subagent` → child Session → native prompt/inbox admission → model step → native read or real Loom tool → native return. Only the external model is scripted. The script emits normal native tool calls and deterministic output; it does not create child Sessions, native prompt receipts, permission decisions, Loom records or attribution conclusions. Separate original mandates and source markers are static test inputs.

The fixture records the actual in-process AI SDK `doStream(input)` boundary. It keeps only the native `x-opencode-session-id` and `x-opencode-parent-session-id` headers. This is a qualified observation of this local adapter's prompt bytes, not HTTP wire evidence or general-provider qualification. An earlier context hook and a later provider receipt retain their distinct boundary names. Neither demonstrates comprehension.

## Host capability matrix

“Verified” always applies to the bounded mechanism in the same row. Q numbers refer to executed checks in the recorded report; source-only limits are independently identified below.

| Question | Classification | Executed evidence and limitation |
| --- | --- | --- |
| Identify actual parent dispatch invocation | **Verified** | Q1/Q2 compare direct native tool `(Session, assistant message, call ID)` hooks and durable terminal events. This does not allocate native IDs for opaque inner calls. |
| Bind invocation to child Session | **Verified** | Q1/Q2 observe `subagent` progress/result child ID, compare terminal metadata and query actual native `parentID`. A child ID alone does not bind its admitted input. |
| Reuse a child without collapsing dispatches | **Partial** | Q2 exercises sequential reuse and two background dispatches while one child is running. Distinct parent calls remain distinct; a shared job/output cannot be counted as a separate completed result for each dispatch. |
| Identify native Reviewer prompt admission | **Verified** | Q3 records durable `session.inbox.enqueued` with exact input ID and original payload; identical-ID retries preserve original content without another enqueue. R1 repeats original-payload readback after process reopen. A prompt hook alone is insufficient. |
| Associate original mandate with admission | **Partial** | Q3 preserves different questions, dimensions, criteria, modes and exclusions for identical WorkRef/artifact subjects. Q4's positive child receives that mandate and actually reads the source. The fixture's authored input and preserved payload do not implement Loom admission or the missing native parent-call-to-input edge. |
| Observe actual supplied material | **Partial** | Q4 observes inline source bytes and native read-result bytes at the Session-labelled provider boundary; pointer-only/citation-only content does not qualify. Exact admitted-review invocation and other provider transports remain unqualified. |
| Bind subsequent retrieval to that same review invocation | **Partial** | Q4 observes actual native read results under the child's exact tool tuple. The host supplies no input-to-model-step causal edge. Q6 exposes collided Code Mode inner tuples and production meta-tool capture exclusion. |
| Enforce receiving-Reviewer authority before protected transfer | **Unsupported** | Q5 observes A's successful read, C's real `Permission.BlockedError`, withheld-source gap, then the same actual C receiving the synthetic bytes inlined by A while its repeated read remains denied. Native read permission is not an incoming-content transfer fence. |
| Preserve attribution through late returns, interruption, restart and compaction | **Partial** | Q7 preserves an outer invocation's original selection/fingerprint while its plan/selection change, and separately verifies a historical `complete(work_ref)`. R1 performs native interruption, compaction and process reopen with exact public completion/Plan readback. In-flight crash reconciliation and per-input shared/background-result attribution remain unqualified. |

## Scenarios and decisive controls

| Scenario | What the real run proves | Remaining qualification |
| --- | --- | --- |
| Q1 | Native child creation, native returned identity, direct child read and actual Session-labelled provider material. | No inferred parent-call → child-input relationship. |
| Q2 | Two overlapping same-label/same-agent children finish in deliberately reversed order. Sequential and running-child reuse retain distinct native parent tuples. | The two running returns are `running`, not two independently completed reviews. |
| Q3 | Security-only and correctness/reliability mandates have identical historical subjects but different original contracts. Later unrestricted Reviewer assertions cannot rewrite the original native payload. Duplicate-ID retry adds no native admission. | This is native input preservation; production immutable manifest admission is subsequent work. |
| Q4 | A native Reviewer receives a frozen test mandate and retrieves actual source bytes. Inline supply has no retrieval receipt. Another Reviewer gets only a manifest pointer and returns plausible citations/inspection claims, with zero source supply/access receipts. | Same-Session observations remain qualified when same-admitted-execution causality is absent. |
| Q5 | Requester read succeeds, recipient read is denied by the exact native permission error, and the requested source remains a named gap. A separate synthetic inline attempt demonstrates the native transfer bypass. | No native Session ACL or test-owned production gate is invented. |
| Q6 | Two actual Code Mode inner Loom calls share the outer native tuple. Loom intentionally records only the outer execution; no inner provenance row is manufactured. Removing provider observations from a captured trace cannot create supply evidence. | The removed-receipt check is an offline oracle negative control, not an injected native observer outage. Opaque inner provenance remains unavailable. |
| Q7 | Real registered Loom calls change Plan/selection inside an outer execution; its late finish keeps the start's original scope/fingerprint. A separate public completion verifies the old WorkRef and original Plan. | Current ordinary observations contain Focus/fingerprint, not complete reconstructible WorkRefs for arbitrary native child dispatches. |
| R1 | Native interrupt and compaction events, followed by a genuinely new host process, preserve completed public historical records and original admission payloads. Postcompaction source-marker visibility is measured rather than assumed. | This is orderly reopen after an interruption, not a crash during the dispatch/admission commit gap. |

The report's receipt numbers are one-based lines in its own `audit.ndjson`; they are local observation references, never native call IDs. Native event IDs and native tool tuples are retained separately. The committed evidence record omits raw synthetic transcript payloads and machine-specific paths; CI's bounded artifact retains diagnostics for independent reproduction.

### Observer continuity and causal ordering

Dispatch interpretation consumes the complete fixture audit stream. Each fixture `ready` row
opens a local observation segment; another `ready` starts a new segment, and `observer-failure`
ends usable continuity until another `ready`. The receipt's `observer_ready_receipt` references
that segment's opening row. It is local observation metadata, not a native execution identity
or proof of a host restart. Markerless reconstructed slices remain unknown. These known fences
do not certify absence of unreported drops or replace independent audit-integrity checks.

The direct native tool path awaits the before hook before execution can publish progress.
Consequently, a matched after hook or establishing progress receipt must follow its before
hook and belong to the same observer segment. The native-event subscription is asynchronous:
progress may arrive after the after hook, so the oracle imposes no progress-before-return rule.
Progress alone can establish the narrow child binding, but never implies a return or admission.
Identical replayed starts/returns remain ambiguous rather than being silently deduplicated.

Oracle unit tests also challenge missing/reused/mismatched native keys, foreign Session payloads, weaker context-only observations, citation-only claims, metadata-only material and unavailable runtime. These are supporting tests of the interpreter. Synthetic unit traces do not constitute installed-host evidence.

## Reproduce

From the candidate checkout, install locked dependencies and an isolated CLI/package as in the existing installed-questions workflow. Do not install the host into Loom's dependency tree or use personal Session state.

```sh
bun install --frozen-lockfile
mkdir -p /ABS/qualification/artifact
npm pack --pack-destination /ABS/qualification/artifact
npm install --prefix /ABS/qualification/plugin --no-audit --no-fund \
  /ABS/qualification/artifact/loom-plugin-2.0.0-alpha.1.tgz
npm install --prefix /ABS/qualification/host --no-audit --no-fund @opencode/cli@2.2.6
python3 tests/installed_native_review.py \
  --opencode /ABS/qualification/host/node_modules/.bin/opencode \
  --plugin /ABS/qualification/plugin/node_modules/loom-plugin \
  --artifact /ABS/qualification/artifact/loom-plugin-2.0.0-alpha.1.tgz \
  --expect-plugin-version 2.0.0-alpha.1 \
  --report-directory /ABS/qualification/new-report
```

The output directory must not exist. `--repository` defaults to this checkout. `--disable-filewatcher` is available only for a substrate that cannot support it; using it is recorded and does not qualify watcher behavior. The recorded installed run kept the watcher enabled.

The harness reuses `PrivateHost`, `isolated_environment`, the real installed candidate inventory and the existing scripted-provider facility. It owns fresh temporary HOME/XDG/config/state directories, a password-protected loopback host and a disposable Git project. It strips normal credentials/provider configuration, removes external providers, uses only synthetic source material, disables sharing/update and deletes temporary host state after closing its processes. Broad fixture agent permissions are confined to that disposable scripted environment; they change no production policy. Reports contain native IDs and synthetic diagnostics, not personal Session history or paid-provider traffic.

Run supporting checks with:

```sh
python3 -m unittest discover -s tests -p test_installed_native_review.py
bun test tests/question-host/*.test.ts tests/okf-native.test.ts
bun run typecheck
```

The existing `test:python`/`test:native` discovery collects the new oracle/parser tests. The existing installed-questions workflow packages the exact candidate, runs this probe and uploads its report even on failure; no parallel framework or replacement host is introduced.

### Final audit-loss controls

The same workflow also runs `tests/installed_native_review_audit_loss_control.py` with
`--fault missing` and `--fault prefix`. Use the native probe's CLI, plugin, artifact and
version arguments above, plus `--repository /ABS/REPO`, `--expect-head REVIEWED_SHA` and
a fresh `--report-directory` for each control. The checkout must be clean at that exact SHA.

Each control executes the real native CLI and all eight mechanical checks. Only after the
actual reopened host stops does it delete the audit or truncate it to one valid JSON row.
Control `PASS` and exit 0 require the specific audit-integrity error, native
`execution_status: FAIL` and native CLI exit 1. An unrelated runtime failure does not pass
the control. The pre-fault audit is retained separately for diagnosis and cannot substitute
for the missing or truncated final audit. CI retains both controls in the
`installed-native-review-audit-loss-<sha>` artifact.

Both controls reproduced the defect on reviewed head `19919bad`: all eight native checks
passed, then the missing audit or one-row valid prefix still produced native execution
`PASS` and CLI exit 0. The controls correctly rejected those results. These were deliberate
post-shutdown faults; the previously inspected successful CI archive was complete.

Both controls passed against clean corrected commit `c62081d`, using the same installed
OpenCode 2.2.6 host and exact packed candidate as its normal successful run. Each reached
all eight mechanical checks before the fault, then produced the intended audit-integrity
error, native execution `FAIL` and CLI exit 1. The missing audit stayed absent; the prefix
control retained exactly the injected 323-byte record. Neither failed native report carries
successful audit hash/count metadata. The evidence record preserves separate source,
driver, candidate and receipt hashes for all four fault-control runs.

## Required upstream guarantees and next stage

1. **Host-owned admission cause:** connect the native parent tool tuple to the exact child input ID. An agent-writable token or matching prompt text is not that receipt.
2. **Input contribution to execution:** expose the admitted input IDs contributing to each model/tool/result step, including sets for shared or steered execution. Do not force a false one-input/one-output mapping.
3. **Recovery lineage:** retain these identities in background completion/recovery, with explicit unknowns for historical or imported records. Child Session and timestamp alone are insufficient.
4. **Protected transfer boundary:** identify and authorize the actual recipient before source bytes enter its native prompt or tool return. Native source-read denial alone cannot enforce incoming disclosure. A controlled Loom source-delivery seam can enforce its own explicitly authorized policy, but does not create a global native ACL.
5. **Final exposure receipt:** if full provider exposure is claimed, preserve the actual transformed payload boundary and execution/input identity. Current local adapter evidence cannot certify every transport.

The next smallest implementation stage is durable immutable review requests, historical subject membership and qualified observation relationships using the existing Store/WorkRef owners. Its public readers should reconstruct original mandates and preserve unknown/denied states. Protected transfer and automatic evaluation remain gated by their actual capabilities and operator-owned policies; the current probe does not activate them.

Operator decisions still open: eligible richer content collection, retention/deletion/backup, permitted recipients and purposes, derived-report readership/declassification, and model/budget permissions for future automatic evaluation. This stage chooses none of those defaults.

## Implementation references

- [Native subagent path](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/tool/plugin/subagent.ts): parent permission, child progress, ordinary prompt, shared child job and return.
- [Awaited tool execution hooks](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/tool.ts), [hook invocation](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/plugin/hooks.ts), and [asynchronous live event bus](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/bus.ts): source basis for the causal ordering and observer-continuity limits above.
- [Native prompt/admission](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/session.ts), [prompt preparation](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/prompt.ts), [inbox](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/inbox.ts), and [event schemas](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/schema/src/session-event.ts).
- [Plugin tool hooks](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/promise/tool.ts), [Session hooks](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/promise/session.ts), [native model request](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/model-request.ts) and [AI SDK adapter](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/aisdk.ts).
- [Code Mode inner context](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/codemode/tool.ts), [native file authorization](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/file-access.ts) and [permission selection](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/permission.ts).
- [Loom qualification harness](../tests/installed_native_review.py), [receipt oracle](../tests/native_review_oracle.py), [implementation specification](learning-native-evidence-spec.md), [existing host trust limits](learning-host-trust-contract.md), and [accepted architecture](learning-evidence-and-review-scope.md).
