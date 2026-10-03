---
type: architectural-decision
title: Eval Evidence Safety Projection
description: Preserve credential provenance and evidence availability through typed projection before eval evidence writes and clipping.
tags: [architecture, decision, loom, evals, security, evidence]
---

**Status:** proposed implementation-facing decision, revision 1; requires independent architecture review. Not implementation acceptance, runner compatibility, full capture support, or Product PASS.

## Derived from

- Accepted bounded task `e2658201-6eb4-460f-9114-c49618fd3cb1`: correct the existing eval capture harness without changing product execution, permissions, eval cases or historical evidence.
- CAP-001–007, exact authority preserved in that workflow's OQ `7034b6d5-4b8e-4dfa-9d7d-d45f0b14271d`: actual results; exact tool/input/actor/session/parent/inner binding; trustworthy order or ambiguity rejection; final caller boundary rather than aggregate output; explicit missing/unsupported/loss; redact secrets before clipping or safely omit; unchanged execution/permissions.
- [Verification model](../verification.md): non-evidence and independent review. Historical draft OQ `57b63ca7-2729-4b73-bad9-3914e0580d51` is not an accepted wire protocol or signing requirement.

## Satisfies

Realizes CAP-005/006 without damaging CAP-001–004 or relaxing CAP-007. One representation-and-projection decision in the existing harness, not a general redaction service, audit platform, isolation redesign, or new retention guarantee.

## Decision question and evidence

How can the harness protect actual credentials without renaming protocol keys, corrupting JSON, or treating altered selectors as exact evidence?

Architect inspected clean Loom `867dd238eb01a18c96e9f9202720287826a30389` through semantic navigation and source reads:

- `scripts/run-evals.py:701–799` flattens source/path/inherited sensitivity into `list[str]` and silently loses read/parse failures. `827–886` substitutes across strings, dictionary keys and serialized JSON. `1480–1596` projects/aligns evidence before public transport construction, then performs whole-object substitution. Preserve the former ordering, not the substitution.
- `2147–2245,2430–2637` distinguish missing/clipped/malformed selectors but lack a redacted-selector disposition. `2640–2687` builds judge input; `3003–3083` persists/checks projected artifacts. Hashes establish consistency, not original fidelity.
- `scripts/fixtures/loom-normal-invoke-observer.ts` omits ordinary opaque call events before append; parser/attachment retain diagnostic-only noneligibility. Legacy `scripts/fixtures/eval-tool-observer.ts:37–59,87–143` writes input/result records without producer sanitization.
- Independently pinned clean intended runner checkout `/home/n23790/git/bateau84/opencode-eval-runner` at `a6ced1b9a346e295ac58bf0fa65718318a2ef940`: `container/invoke.py:153–211,715–806` bounds tool fields/stdout/stderr before Loom receives them; `runner/cli.py:414` writes result JSON before Loom's preparation. This checkout is not proved to be the installed CLI or previously tested `9ee84a58…` image.

Read full `review-think` PASS: sufficient causal evidence for this decision, **not** correction/full-capture acceptance. Exact Diagnostic OQ `78a99dad-2359-42ac-b768-378ceb02a091` and Reviewer OQ `3872fdd1-88fb-4322-b881-54ae89c73eef` were relayed unchanged by General in OQ `945120bd-e2a6-4b65-8810-865bcaf7920e`. Reviewer actually reproduced P1 CamelCase credential leaks, P2 sensitive-ancestor public-descendant admission, and P2 real short-secret JSON/control-key corruption. These remain open; their tests are Reviewer's observations, not Architect executions. Diagnostic's helper experiment was denied before execution; systemic executable/historical attribution remains PROBABLE and original word-artifact origin unresolved. No runtime tests were run here.

The eleven-mechanism PR-118 assessment is third-party analysis relayed by the user, not the user's own findings. `skills-eval-PR-118.tar(1)` was not independently inspected and its revision is not established equal to this HEAD. The support matrix distinguishes its claims from current evidence.

## Drivers and constraints

1. Protect actual secrets at **each in-scope evidence write and clip**, not only final artifacts. Authorized credential input seeds are distinct from evidence copies.
2. Preserve public semantics and trusted structure without treating arbitrary metadata as public constants. A public source label is not a global spelling exemption.
3. Prefer explicit field loss to invented identities, key collisions or false absence. Safe omission is not full-capture success.
4. Reuse capture, transport, scoring and artifact seams. No new service/store, runtime upgrade, default-image change, global install, production plugin changes, issue-42 isolation work, live roster/model inference, real-state mutation, historical rescore or eval-case changes.
5. An actual credential `low` in opaque `follow` cannot always be distinguished from innocent spelling. No length floor, whole-word exception or word allowlist may waive protection. Universal opaque readability is not promised.

## Options considered and comparison

| Option | Mechanism and benefit | Cost, failure modes and authority/compatibility impact |
| --- | --- | --- |
| A. Repair name matching and exempt envelope keys | Smallest patch; closes aliases and top-level `text` collision. | Does not recover completeness, nested roles or selector fidelity; nested keys still collide and earlier writes remain unsafe. Useful mechanics, insufficient architecture. |
| B. Source-aware inventory plus typed field projection (selected) | Keep credential origin/completeness privately; validate protocol roles; project owned field copies before sinks; propagate exact/redacted/omitted dispositions. | Small internal contract and Python/TypeScript conformance fixtures; upstream runner must participate at its sinks. Unknown schemas fail closed. No new product execution/trust authority. |
| C. Omit entire fields on any sensitivity; retain reviewed protocol only | Viable conservative protection with simpler machinery. | Unnecessarily loses independently safe fields and useful text; cannot deliver supported result retention. Same first-sink dependency as B. Use as B's unsupported-path fallback, not the general solution or completion claim. |

B wins because coarse **field** dispositions preserve useful data without a character-taint engine, generic schema registry or path-level assertion framework. Both B and C require correct placement. Retaining a final global substring scrub would reintroduce A's structural defect.

## Decision and minimal interfaces

Replace the untyped inventory/whole-artifact substitution seam with one harness-local contract: source-aware private inventory, schema-owned projection, and explicit availability. Keep `prepare_transport_result` as host composition, not certification of earlier runner writes. Contracts below are normative for this proposal; helper names/file splits remain Worker choices.

### Inventory: preserve source intent and completeness

Loom's collector owns classification of actual selected env/auth/config/models/credential-seed inputs. It must account for runner-resolved defaults rather than assuming an omitted option means no source. Tests use disposable synthetic inputs; this document authorizes no new real-state discovery.

Internal `loom-eval-credential-inventory/v1` contains source entries with opaque handle, adapter/policy version, category (`env`, `auth`, `config`, `models`, `credential_seed`) and state (`complete`, `incomplete`, `not_selected`), plus private classified entries containing source handle, source-local location, role (`credential`, `public`, `unknown`) and original value. Only credential entries supply match material. Unknown entries make that source incomplete; do not silently relabel them public or flatten them into certain credentials. Dedupe match values without dropping origins. Values/locations are private inputs, not evidence output.

Overall completeness requires all selected sources complete under the supported source profile. `not_selected` means proved absent from execution inputs, not unreadable. Unresolved config-root/runtime/default credential sources, unknown credential-bearing extensions, parse/encoding/read failures, depth/size limits or partial database reads are incomplete discovery, never a successful empty set. Incomplete inventory prohibits payload retention dependent on matching; independently generated fixed protocol structure can remain. Completeness describes the declared input profile, not omniscient knowledge of every secret a tool can generate.

Adapters classify by reviewed **source/path/type**, not forwarding, ancestor spelling or value length. Preserve existing provider credential env names and supported aliases `access_token/accessToken`, `refresh_token/refreshToken`, `client_secret/clientSecret`, `secret_key/secretKey`, `api_key/apiKey/apikey`, password, secret, credential, authorization and cookie, including source-supported snake/hyphen/uppercase/prefixed forms. Split CamelCase/acronym boundaries before case normalization. Exact alias-token matching must not classify `max_tokens`, `tokenizer` or `accessibility` as credentials. OAuth `access`/`refresh` and generic `key` are credentials in supported source contexts, not in every JSON object.

Within supported credential objects, declare type/provider/id labels, scope and context public **at their known paths and expected types**, and descend separately into credential leaves. Thus `{credential:{type:'oauth',access_token:'DESC-TOKEN',context:'text',scope:'low'}}` contributes only `DESC-TOKEN`. Unknown descendants are unknown, not automatically public or all credentials. A public role classifies only that input occurrence: if another actual credential equals `text`, output payload `text` still needs protection. Existing extension inputs require a reviewed internal adapter/declaration before claiming complete coverage; no new user-facing declaration flag is introduced. Preserve public-only positive controls through supported public declarations, not arbitrary values as implicit proof of public intent.

Deliver private versioned policy to already-authorized disposable components before capture; do not log it or grant new target credential visibility. A flat `OPENCODE_EVAL_REDACTION_VALUES` list cannot convey completeness. Replace its safety use with versioned delivery acknowledged by the receiving adapter, never a truncated-list fallback. Keep the existing 128,000-byte delivery ceiling unless separately justified: overflow, missing acknowledgement or unknown version means incomplete inventory and safe omission, not a fabricated sentinel credential. Policy bytes never enter results, artifacts or judge prompts.

### Projection: protocol structure is not payload

Validate an exact recognized schema before assigning roles. Fixed property names/discriminators and producer-generated counters/booleans are protocol structure: retain their types/values even when spelling matches a credential (`text`, `1`). Arbitrary tool dictionaries, dynamic actor/tool/call/session identifiers, registration names, errors and metadata are **not** such constants. Unknown fields/schema are unsupported; omit/reject the affected event with safe loss accounting, not recursive passthrough.

Project an owned snapshot of an actual boundary value using its role/representation, inventory and upstream availability; never mutate the object returned to the caller. Existing top-level evidence fields (`input`, output/result, error, assistant text, identities, stdout/stderr) receive these dispositions:

| Disposition | Contract |
| --- | --- |
| `exact` | Original value/type (and original bytes for text); no loss, policy permits retention. Does not itself confer provenance/eligibility. |
| `redacted` | Safe diagnostic value plus `reason=credential_match`; any content/type change anywhere makes the **whole field** non-exact. |
| `omitted` | No value/prefix/suffix/original-key/original-value hash; fixed reason and stage explain unavailability. |

Reasons are `credential_match`, `sensitive_key`, `inventory_incomplete`, `upstream_clipped`, `unsupported_schema`, `unsupported_representation`, `opaque_payload_unverified`, `size_limit`, `missing`, `invalid`, `write_failed`. Stages are `capture`, `runner`, `transport`, `judge`, `artifact`. Truncated/unsupported are omission reasons, not alternative exact values. Exact null means real null, not absence. Accounting overflow itself means incomplete coverage.

- **Structured JSON:** validate complete representation, sanitize leaves, encode once. Never substitute over serialized JSON syntax. At a declared nested JSON-string boundary, decode within supported bounds, sanitize, re-encode preserving the outer string type. An unchanged exact string retains original bytes; changed formatting is diagnostic only. Invalid/duplicate-key/nonfinite/nonrepresentable/cyclic/over-depth data is omitted, not coerced into plausible exact values. JSON-looking opaque strings are not automatically trusted structure.
- **Payload strings:** where complete representation and inventory/encoding coverage are established, known-credential substring masking applies only to the string value, including supported raw/JSON-escaped variants. `***REDACTED***` is display, not the availability signal. Do not rescan generated markers or protocol keys. Keep protection for short secrets; opaque collisions may mask innocent prose and must be labelled redacted. Unknown encoding/coverage is omission. Retain bounded three-layer JSON escaping coverage, omitting unsupported deeper representations rather than promising arbitrary decoding.
- **Payload keys:** never rename to a common marker. Credential-bearing/unsafe keys or potential collisions omit the enclosing top-level payload field with `sensitive_key`; do not emit raw key/path lists. Safe keys stay unchanged; no silent entry drops. No new per-member remapping protocol.
- **Payload scalars:** producer-generated protocol numbers/booleans are retained by role. Arbitrary scalar payloads whose encoding could disclose a known credential are omitted, not converted into invalid JSON tokens. Redacted structured previews are allowed only where their adapter permits that representation; otherwise omit the field. No exact claim survives type/content changes.
- **Identities/selectors:** retain exactly or omit, never mask/normalize into a different usable identity. Lost binding invalidates selection and dependent coverage/order. A safe local ordinal can correlate diagnostic loss, not replace actor/session/inner provenance.
- **Earlier loss and local limits:** without complete pre-loss protection, omit any upstream-clipped field/stream before another write, even if no partial credential matches. Inventory completeness is not an upstream-sanitation attestation. After full sanitation, an oversized field is omitted with `size_limit`; this small contract deliberately has no truncated-preview state. Never persist a clipped JSON prefix as a complete value. Preserve conservative clipped/opaque guards rather than weakening protection for readability.

Ordinary normal-invoke policy continues to omit opaque call payload events. `synthetic-secret-free-fixture/v1` stays internal test-only, never exposed as an ordinary eval opt-out. Existing safe whole-event omission remains valid until a typed adapter proves every retained field; this decision does not expand that channel's retention.

### Ownership, first sinks and failure transitions

| Owner / existing seam | Responsibility |
| --- | --- |
| Loom collector and `invoke_container` | Select actual input profile, retain roles/completeness, deliver private policy before capture, account for runner defaults. Never substitute an empty matcher for unknown support. |
| Loom normal/legacy observer fixtures | Validate, snapshot and project before serialization/size checks/append. Normal stays diagnostic-only. Legacy raw capture must be enforced secret-free synthetic-only or adopt pre-write projection; host scrub cannot protect its sidecar. |
| Runner container/export owner | Protect or omit complete fields/streams before field/stdout/stderr clipping and evidence output; cover timeout, exception and diagnostics. Propagate dispositions and loss stage, not inferred finality/trust. |
| Runner host CLI owner | Validate policy/projection support before output-file write/print; invalid-container/error paths cannot echo raw detail. Write safe projection or omission only. |
| Loom transport composition | Validate versions/roles/dispositions, align available identities in memory before public projection, construct safe public result. Cover actions/tools/text/metadata and failure fallbacks. Defense-in-depth can lower availability, never repair/upgrade earlier loss. |
| Loom scorer/judge/artifact/replay | Consume only safe values plus dispositions; no generic artifact/control-key substitution. Include availability in integrity payload, preserve historical ownership/bytes. |

Order at each boundary: **validate source/roles → snapshot → project or omit → bounded encode/clip with explicit loss → write/export → downstream validate**. Binding complete in-memory data before projection is permitted; persisting raw intermediates is not. Safety/write failures affect evidence only, not arguments, results, errors, permissions, registrations or product execution. Do not retry the tool, fabricate a terminal, or relabel returned denial as throw. No new retry policy.

### Consumer compatibility and non-evidence

New host projections/artifacts carry `evidence_safety` with `schema=loom-eval-evidence-safety/v1`, `policy_version` (string), `inventory_complete` (boolean), `coverage_complete` (boolean), `fields` (array), and `loss_counts` (fixed reason-to-nonnegative-integer map). Each field entry has `event` (safe ordinal, or null for transport-level fields), `field` (adapter-defined protocol field ID), `state` (`exact`, `redacted`, `omitted`), and for non-exact entries `reason` and `stage` from the above enums. Ordinals are nonnegative safe integers unique within that projection, not invented runtime identities. Every consumable retained field has one disposition; missing/duplicate/unalignable metadata fails closed. An omitted field has no original value slot; redacted values are diagnostic. Sidecar metadata never duplicates raw originals or includes secret locations, arbitrary payload keys or low-entropy secret hashes.

This is an internal projection contract, not a silent reinterpretation of external v1 payloads. External producer support requires explicit versioned adapter acknowledgement of policy and covered stages; exact transport negotiation needs runner-owner agreement before compatibility is claimed. Missing/unknown required meaning is unsupported, not optimistic live fallback. Old artifacts remain readable for historical inspection but cannot acquire new safety/eligibility proof from absent metadata. No rewriting, rehashing, rescoring or interpretation of old masks as exact originals.

All action/result/text scoring paths consult dispositions, not just `json_path`. Coarse rule: each assertion's required field must be `exact`; changed/missing tool/input/actor/parent/order selectors mean **indeterminate**, not mismatch. Redacted/omitted results cannot prove required predicates or rule out forbidden ones. Unknown event coverage blocks forbidden absence. Apply this to predecessor/occurrence selection and actions derived from stdout too. No path-level salvage is needed; preserve stricter whole-capture completeness gates.

Judge input uses the same safe projection and labels loss as non-evidence. Prompt-budget clipping lowers the affected field's judge disposition and retains fixed loss reasons. Raw alternate text/actions/source/parent aggregate cannot rescue it. Deterministic eligibility vetoes remain outside model discretion. Normal diagnostics remain `diagnostic_only=true`, `evidence_eligible=false`, `runwide_complete=false`, with upstream clipping coverage unattested. Complete files or successful sanitation never upgrade those flags. Replay preserves or lowers dispositions; parseability, hashes and marker absence cannot restore exactness.

## External dependency: not a Loom-only first-sink claim

**A narrow runner handoff is required** for first-sink closure. The inspected runner clips before host sanitation and writes a file before Loom reads it. Correcting Loom's collector/projector can close local defects and protect Loom-owned sinks, but cannot prove CAP-006 at those external sinks. Disabling unsafe retention there is an acceptable intermediate non-evidence outcome, not full-capture success.

Runner owner needs only existing invoke/export adapters to accept the private policy/completeness contract, project or omit before the identified clips/writes (including timeout/error paths), and return acknowledged dispositions. No isolated Loom service, signing platform, issue-42 redesign or runtime upgrade is requested. Agree its exact producer/host interface and load checkpoint before claiming compatibility; no external checkout edits are authorized here. If necessary in-image adapter changes require different image bytes, report that dependency for separate authorization, not a default-pin change or an assumption the old digest works.

Joint proof identifies Loom commit, runner host commit/actual executable, immutable image digest and loaded observer/policy versions. Source inspection is not source/image pairing or deployment proof. General may relay this section/contract; local Worker implementation may proceed after architecture review while external first-sink/full-capture proof remains blocked. Any newly found uncontrolled earlier evidence sink reopens this boundary; post-hoc scrub/deletion is not protection-before-write proof.

## Verification support matrix and correction paths

| Case / current evidence | Required correction or retained boundary; proof |
| --- | --- |
| **P1 CamelCase aliases: actual Reviewer repro** | Adapter tests across env/auth/config/credential columns and JSON; public output contains no synthetic credential. Preserve snake/hyphen/provider/OAuth and negative `max_tokens/accessibility` controls. |
| **P2 ancestor metadata: actual Reviewer repro** | Known path/type roles select only credential leaves; unknown descendants make discovery incomplete. Five public words plus unrelated `DESC-TOKEN` prove both retention and protection. |
| **P2 actual `1`/`text` JSON/control-key damage: actual Reviewer repro** | Stable protocol keys/counters, protected payload occurrences, parseable JSON. Include actual `0`, `low`, nested/escaped JSON, scalars, identities and colliding payload keys; changed fields stay non-exact. |
| Public extra-env admission: historical/reported mechanism; current narrow public-only Reviewer control passes | Preserve supported public declarations and public-only controls; do not restore all-forwarded-is-secret or claim arbitrary extension coverage. |
| Whole sensitive subtree, public substring collision, nested-key rename: current source mechanisms; PR-118 revision unproved | Distinguish false classification from true same-value ambiguity. No word exceptions; omit unsafe-key fields instead of rename/merge. Preserve trusted nested protocol structure. |
| Upstream field omission and clipped stdout/stderr loss: source-confirmed guards | Necessary until pre-clip protection proved. Test secrets across head/tail and multibyte cuts; explicit upstream loss, not capture PASS. False admission must not activate losses for supported public-only sources. |
| Sensitive-key whole-event, ordinary opaque-event and unknown-schema omission: current normal-observer source | Preserve conservative policy and noneligibility. Test all six native/local event kinds and arbitrary metadata/identity values; these are not protocol constants. |
| Size caps / inventory over 128 KB: source-confirmed, not PR-118 artifact proof | Preserve limits with explicit stage/reason/counts and incompleteness. No partial matcher or sentinel credential. Test exact/over limits, malformed versions, unreadable/invalid sources, unsupported encodings. |
| Scorer/judge/artifact/replay fidelity: source gap, no new execution here | Changed/missing selectors cannot create required success or forbidden absence. Exercise actual builders/writers/replay, immutable historical fixtures and normal-diagnostic scoring separation. |
| Runner clips/file sinks and legacy raw observer: inspected source, integration unproved | Enumerate each first write/clip and protect or omit there. Inspect intermediate files/sidecars in synthetic assembled tests; final-artifact absence alone is insufficient. |

Existing requirements remain **OPEN** before `review-implementation`: `e3fcff3d-6f5f-455d-b649-43c645784bd8` (actual-image native/inner capture), `856b205b-916d-45ae-9cde-d8745a956d80` (binding/finality/order/safety), `ec6377a8-e282-4512-9e34-401a7318cfe7` (first-write/clip → transport → scorer/judge → artifact/replay synthetic-secret proof). This decision neither satisfies nor resets them. Full capture/issue-42 acceptance remains blocked.

Architecture requirement `5a98265f-b905-4662-81f0-79827167a559` additionally persists shared synthetic inventory/projection vectors across Python/TypeScript, incomplete-source and unknown-version handling, observer-on/off equality of arguments/results/errors/permissions without tool retries, and acknowledged external sink/load proof. Exercise actual observer and runner intermediate writes, not replacement test-only serializers. For short secrets, assert confidentiality of **credential-origin payload occurrences** while retaining independently generated protocol constants: byte-wide absence of `1`/`text` would itself demand structural corruption. No real secrets/state/network inference/services are authorized or needed.

## Consequences, confirmation and reconsideration

Positive: separates three current defects into correct source classification, structure-safe projection and explicit fidelity, with testable ownership at each sink. Negative: unknown sources/schemas and ambiguous opaque data lose evidence; old consumers cannot optimistically read new projections; runner cooperation is necessary. Neutral: existing limits and trust restrictions remain; no new store/product policy. Rollback may safely disable capture, not interpret new dispositions as old exact values or rewrite history.

Confirm with the matrix and persisted requirements on exact loaded revisions. Reconsider if source classification would change execution, a mandatory first sink cannot participate, or availability cannot propagate through existing consumers. Route structural/interface gaps to Architect and external facts to runner owner/Research. A genuine requirement for universal opaque same-spelling readability conflicts with available provenance: route to Specifier, never waive CAP-006/007 or automatically make it a user design choice.

## Open questions and handoff status

No unresolved product choice is needed for this bounded decision. External interface agreement/load proof and full capture trust/finality remain **unproved dependencies**, not concealed local completion. Worker may implement the reviewed local contract and report those boundaries; independent Reviewer owns gate verdicts. Original incident/archive attribution remains unresolved and is not required to repair the three current reproduced defects.
