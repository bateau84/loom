---
type: Architectural Specification
title: "Native original-source history and authorized release"
description: "A bounded upstream OpenCode capability for exact historical source reads, with owner, release boundary and falsifiable acceptance criteria."
tags: [loom, learning, evidence, opencode, authorization]
timestamp: 2026-11-27T00:00:00Z
---

# Native original-source history and authorized release

## Required outcome and owner

**OpenCode must expose a supported plugin read of an exact historical message or
tool part, and authorize the returned view for the actual native recipient at
the source-release boundary.** This is the remaining native dependency for
following historical frozen-population members. Loom owns selection, references
and qualification; OpenCode remains the source owner. This handoff requests no
new transcript capture, retention scheme, universal source broker or Evaluator
execution route.

The implementation owner is OpenCode's **Session history/transfer owner**, with
the **plugin SessionDomain** and **permission/return boundary** owners. The Loom
integration owner consumes the supported interface through the asynchronous
[population source resolver](../design/ard-010-learning-retrospective-populations.md). The
accepted [native evidence specification](ars-001-learning-native-evidence-spec.md),
[historical-source contract](../design/ard-007-learning-historical-evidence.md), BR-005 and OC-003
govern identity, gaps and disclosure. The historical proposed labels in the
underlying requirement files are not a reversal of the accepted baseline.

## What is available now

`session.context` supplies normalized messages after the last compaction. The
current original resolver can use that supported method for the **same actual
caller Session**. It returns selected original tool input/output/error/status/
dispatch fields, or the `.text` of an exact native `type:"user"` message. It
excludes hidden reasoning, attachments and arbitrary metadata. A native user
message is not proof of authentic human origin or a particular dispatch's
admission. A tool part containing a skill load preserves those observed bytes;
it does not establish all historical skill loads or effective configuration.

The current tool-part version hashes the exact normalized part. The user-text
view hashes its original normalized user message while returning text only.
Both projections have independent content fingerprints and explicit limited
coverage. Unrelated later context messages do not change either source version.
Compaction/deletion can remove an original from this supported view; a gap does
not mean the native owner has deleted its full history.

The envelope preserves project and workspace identity and explicitly records
`native_store_identity: unavailable`. The paired Loom store identity scopes the
**Loom reference**, not the native database. Identical Session/message/part
strings on another host do not establish a shared source. Moving a frozen
population to another host cannot acquire native provenance from the Loom
backup identity.

Raw exported or cross-Session native content remains unavailable through the
#251 protected-source path. The final native permission assertion observes a
decision; it is not an atomic revocation/source-return fence. Recurring manual
exports, private database queries, imports from OpenCode core internals and
starting a new managed server are not production substitutes for this handoff.

## Focused upstream verification

The repository remains pinned to SDK/CLI **2.3.0**. Existing 2.3.0 and 2.4.1
investigations are retained in the [restricted-execution source
record](../design/evidence/learning-restricted-execution-source-evidence.json); they were not
rerun as host experiments for this increment.

A limited source check on November 27 was justified by the new **2.4.2** release
published November 26. Its tag resolves to
`fc31a485317970bcf6be7b431a9830aaef875731`.

| Inspected source at that revision | Finding |
| --- | --- |
| [Plugin SessionDomain](https://github.com/anomalyco/opencode/blob/fc31a485317970bcf6be7b431a9830aaef875731/packages/plugin/src/promise/session.ts) | `context` is present; full-history message/list/export and source-release methods remain absent. Git blob `d24775c964e3ea2cbd15ffe07d05cb4e522f3f78` is identical to the inspected 2.4.1 file. |
| [Public Session protocol](https://github.com/anomalyco/opencode/blob/fc31a485317970bcf6be7b431a9830aaef875731/packages/protocol/src/groups/session.ts) | `session.context` explicitly returns the post-compaction context. `experimental.session.export` exists for a complete projected export, but is not part of the plugin SessionDomain and does not supply the source/recipient release contract. Git blob `2ac9582a74eed15f4b4e1c86d2207263ed9653d1`. |
| [Native history owner](https://github.com/anomalyco/opencode/blob/fc31a485317970bcf6be7b431a9830aaef875731/packages/core/src/session/history.ts) and [transfer owner](https://github.com/anomalyco/opencode/blob/fc31a485317970bcf6be7b431a9830aaef875731/packages/core/src/session/transfer.ts) | Existing owners already normalize message/part storage. Transfer obtains ordered messages and filters unsettled messages. They are implementation owners to extend, not supported internal imports for Loom. Git blobs `8fa523245d6a753b0f0599ac31a2f8e63c7b3148` and `e944238a3519641581e8c7d3fe58dad44c895c9f`. |
| [Permission owner](https://github.com/anomalyco/opencode/blob/fc31a485317970bcf6be7b431a9830aaef875731/packages/core/src/permission.ts) | `evaluateInput` obtains configured rules before awaiting the permission hook. `assert` may then wait for approval; `reply` resolves the selected pending request without re-evaluating its current configured policy. This remains insufficient for an atomic source-release guarantee. Git blob `196c7f21043296804d3d0d13e04553bd6de82ea6`. |

These are source inspections, not a new executed disclosure exploit, installed
2.4.2 qualification, or a recommendation to upgrade. The source interface and
release gap remain the same for this task.

## Smallest supported interface

Expose an exact-source operation through the plugin SessionDomain, backed by
the existing normalized history owner. The spelling is an upstream API choice;
the required semantic input is:

- An owner-established native source namespace and exact source Session.
- Exact message ID; for a tool field, the containing message and part/call ID.
- A closed, explicit permitted view, such as user text or selected tool fields.
- An optional expected original revision/digest for initial resolution, required
  for an already frozen exact source; a separate permitted-view fingerprint.
- Bounded response size and, if necessary, an owner-bound continuation.
- The actual native caller/recipient, agent/configuration and requested purpose
  obtained or checked by the trusted runtime. Model input cannot nominate a
  different recipient or manufacture a release grant.

The operation returns an exact original projection or a typed gap. An available
response binds namespace, source tuple, original revision, selected view,
returned fingerprint and coverage. It distinguishes original content from an
excerpt, redacted representation or metadata. A source-owner redaction has its
own representation identity and provenance; a redaction-shaped string alone is
not sanitizer proof. Hidden reasoning is never a permitted view.

Use explicit missing, changed, unsupported and incomplete-coverage results.
Denied access is separate: where source existence itself is restricted, return
a generic denial with no identities, sizes, counts or cursor oracle. Do not
replace a missing version with the current message, adjacent tool call, summary
or a content-equivalent record from another source.

The exact-source read is sufficient when the frozen reference already identifies
the message/part. A bounded authorized inventory may reuse the same owner to
locate previously unexposed messages, but it must not require Loom to enumerate
or persist the complete transcript. Existing inline and separate part storage
are normalization details of OpenCode, never schema dependencies of Loom.

### Required source-release boundary

The owner must combine the final source/version/view/recipient decision with
release of the exact bounded bytes using a documented linearization point. An
atomic policy-epoch check and grant consumption, or a qualified equivalent, must
order revocation against release. If revocation wins before release, no forbidden
bytes enter the recipient tool response/history. A check followed by an awaited
approval or ordinary callback does not satisfy that property.

The check covers the full serialized envelope and every selected field. It
does not turn discovery into inspection, inspection into disclosure, or source
read authority into retention or execution authority. Each continuation and
retry needs current authority; a cursor or frozen population is not a grant.
An unavailable authority owner must fail closed rather than reuse a previous
permission observation. Already released material remains a historical exposure;
this interface does not claim to undo it.

The source owner need not introduce permanent version retention. If an original
changed and its frozen version is no longer retrievable, the correct result is a
changed/missing gap. The unresolved product question about later modification of
original records remains open.

## Falsifiable acceptance for the upstream owner

Use disposable native Sessions and controlled sentinel originals. Verify through
the public plugin API, registered Loom tool, new explicit population preview/
freeze and frozen reader; internal database inspection cannot be the consumer's
retrieval path.

| Control | Required observable outcome |
| --- | --- |
| Exact original before and after compaction | A previously committed user correction, dispatch input, tool error and tool result remain retrievable at their exact source identities when the owner retains them; coverage names every excluded class. |
| Inline and separate native part storage | Equivalent normalized originals retain their real identities and selected bytes through the same supported operation. |
| Wrong namespace, Session, message or part | No neighboring original is returned. Two hosts with reused native strings do not alias. |
| Native source changed/deleted | The frozen reference and member count remain unchanged; the old exact original is returned only if actually retained, otherwise an explicit gap. A fresh source version requires a new selected/frozen population. |
| Wrong recipient, source policy or view | No original or protected metadata enters the unauthorized recipient response/history. A discovery grant alone cannot release text or tool output. |
| Revocation while history read or approval is suspended | Release is ordered by the real source-owner fence. Revocation that wins yields zero forbidden bytes, including selected fields, envelope, counts and continuation; a positive authorized control uses the same fence. |
| Oversized original or limited pages | Reject the bounded request or return an explicitly incomplete projection with exact coverage and an authorized continuation. Never certify a prefix as a complete original. |
| Replayed/changed continuation | Wrong source/version/recipient/view and stale policy fail; complete authorized readback reproduces the original pinned bytes. |
| Restart and paired Loom restore | Frozen membership remains identical; a missing native owner/namespace/authority is a truthful gap or denial. Loom recovery cannot create native provenance or reactivate execution. |
| Reasoning and configuration controls | No hidden reasoning is returned. Historical skill/instruction/configuration versions are original only when the native owner actually observed and retained them; current files never replace missing historical content. |

The upstream qualification report must identify the tested OpenCode revision,
plugin API version, source and recipient identities, actual enforced release
ordering and observed denials. Component fixtures demonstrate the consumer
contract only; they are not proof that OpenCode implements the fence. Private
operator originals remain a separate authorized local rehearsal.

## Separate work and next integration

Q4 remains the host's dispatch/admission/assistant-step/source-access causal
receipt contract. Q5 remains the sealed protected-recipient contract covering
all ingress, context reuse and derived output. This exact-source interface is
necessary for protected reads but does not establish either whole contract.
Ordinary authorized current-caller inspection need not wait for those broader
guarantees.

Once the supported owner interface and its release controls pass the table,
replace only the native historical resolver's unsupported branch. Keep the
existing #251 restrictions until that qualification succeeds. Re-run composed
frozen readers, authorization, restart/restore and the separately authorized
operator-local reference case. The retrospective v2 production execution fence,
#249 safeguards and the prohibition on automatic scheduling remain unchanged.
The later controlled retrospective lifecycle uses permitted ledger originals;
its fresh Evaluator cannot inherit the investigator's same-Session native access.
