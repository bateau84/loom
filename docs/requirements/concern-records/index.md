# Concern records

Status: bounded implementation added on 2026-10-19; registered-tool/SQLite acceptance evidence below. Source is the user-authorized intent relayed in this assignment; each normative artifact preserves the relevant wording and derivation. The assignment also supplied prior research summaries; these are compatibility context, not authority for additional behavior.

- [BR-001 — Record traceable concerns](br-001-record-traceable-concerns.md)
- [BR-002 — Expose concerns through ledger views](br-002-expose-concerns-through-ledger-views.md)
- [OC-001 — Concern interpretation and agent duties](oc-001-concern-interpretation-and-agent-duties.md)
- [Change log](log.md)

## Scope and dependencies

Two behavioral requirements and one shared interpretation contract; no quality scenario is warranted. The authorized tool kind is concern. Exact implementation-facing shape belongs to integration/architecture, not these requirements. Existing ledger validation, attribution, evidence, history and limits are compatibility dependencies to reconcile next.

Deferred: concern-specific lifecycle/update/resolve API, structured record-to-record relationships, automatic escalation or notifications, mandatory execution/completion gates, risk scoring, deduplication, global concern queues, and guaranteed delivery of every concern in bounded context. Deferred does not mean resolved or permanently prohibited. No product question currently blocks this bounded scope.

## Preimplementation reconciliation and coder handoff

| Classification | Existing material | Consequence / owner |
| --- | --- | --- |
| Aligned | [Implementation boundaries](../../design.md): attributed history, optional structure, no scheduler/gates, completion is not independent acceptance. | Preserve these boundaries; implementer. |
| Aligned | [Tool guide](../../tools.md): Action/selection scope, same-Action observation-only evidence IDs, unverified artifact pointers, bounded exact/history reads. | Concern uses these existing contracts. Concern IDs must not be passed as evidence IDs; implementer. |
| Missing coverage | [Tool guide](../../tools.md) and [bundled guide](../../../src/skills/loom/SKILL.md) omit concern capture and the agent responsibilities. | Update affected published/live help and guidance with the implementation; implementer. Do not describe the new kind as already shipped in this specification-only change. |
| Missing coverage | [Context relevance](../../context-relevance.md) explicitly lists four conclusion kinds; assignment research reports analogous full-history kind admission. | Include concerns in existing bounded selection/history. Do not increase established limits or promise mandatory delivery; implementer. Update the affected explanatory document with implementation. |
| Open realization, not product question | Existing record references do not provide a general verified record-link field. | Existing prose can cite source Action and concern IDs and readers can retrieve exact records. No new relationship schema is needed. Exact syntax/schema integration remains with architecture/implementer. |
| Downstream-only | Existing documentation includes specific pagination, format and storage mechanisms. | Preserve compatibility; none becomes a new product guarantee solely through this requirement bundle. |

Use existing record validation for concerns: do not require an Assessment/QA verdict, a new status, severity, owner, or resolution field. Suspicion/confirmation and any follow-up may be expressed in ordinary statement text. This is the smallest compatible semantic choice, not a new lifecycle protocol. When consolidating, preserve source Action plus concern record identities in readable content; artifact pointers remain unverified.

### Required verification cases

1. Valid concern through the registered record tool: returned kind/identity and persisted author/session, Action/task, statement, valid same-Action observations and artifact pointers survive fresh reads.
2. Invalid association, nonexistent/wrong-Action/non-observation evidence, and ordinary malformed/oversized input obey existing record rejection rules. No successful concern is reported or stored. Do not broaden existing field requirements.
3. Exact ledger lookup, Session-scoped reading, selected-task context, and Action/Session full history include eligible concerns. Test a concern in a relevant dependency scope and bounded/truncated output; no new context guarantee or limit increase.
4. Later result/claim/assessment cites original concerns by Action and record IDs; originals remain unchanged and retrievable. Do not mistake a concern record ID for an observation ID.
5. Existing-kind calls and pre-change histories retain behavior. Concern creation does not alter task progress, complete/reopen work, dispatch another Session, or create an automatic execution gate.
6. Help/guidance covers all-agent recording, General routing, critic linked consolidation, suspected versus confirmed, and documented/outside-task not equal to resolved. Demonstrate source lookup from a sample consolidation.

These are acceptance observations, not executable test code and not evidence that tests have run. No new human-facing story is needed to settle the bounded extension of the existing tool; there is no separate accepted design artifact in the discovered corpus.

## Implementation evidence

`tests/concerns-native.test.ts` exercises the shipped plugin entry and actual
registered tool callbacks, real observation hooks, validation, SQLite persistence,
context selection and full-history rendering. The registration/Session host is
simulated; no Loom implementation stage is replaced. Records and observations
are produced in the run, not inserted as expected outputs. This is not a live
installed-host trial or proof of future agent compliance.

| Acceptance case | Executable evidence |
| --- | --- |
| 1 | Registered concern, declared schema, exact fresh-reader lookup and separately opened read-only SQLite connection retain identity/origin/task/evidence/artifacts. |
| 2 | Invalid Action/task, missing/wrong-Action/concern evidence, malformed/oversized text and invalid artifacts reject without changing ledger membership; review validation remains. |
| 3 | Dependency-selected context includes the latest two concerns and reports omitted older entries at unchanged limits; Session ledger and paginated Action/task/Session full history retain concerns. Small-budget excerpts disclose truncation and exact reads retain qualifications. |
| 4 | A later assessment on a different selected task cites two source Action/record IDs; explicit exact lookups recover unchanged originals despite selected-task filtering. |
| 5 | Existing result and assessment calls work; concerns leave progress/Action state unchanged and submit no native input. Existing frozen pre-change history tests remain the compatibility proof. |
| 6 | Live help, configured shared/coordination/qa guidance and bundled guide retain capture/routing/consolidation and suspected/confirmed/not-resolved distinctions; the consolidation test exercises source lookup. |

Run `bun test tests/concerns-native.test.ts` for these six tests. Live help remains
within 10000 characters and the bundled guide within its existing 12000-character
ceiling. Legacy tool/design/context documents retain their existing format; their
lack of OKF metadata remains the discovery limitation described below, not a
reason to migrate the unrelated corpus in this extension.

Observed checks: `bun run typecheck` passed; `bun run test:core` passed 336 tests;
`bun run test:native` passed 140 tests; `bun run test:python` passed 26 tests.
The six focused tests passed with 135 assertions. An isolated candidate-copy
mutation removing concern from the history allowlist failed at full-history
retrieval (unsupported record); restoring it returned all six tests to green.
`git diff --check` was clean. No separate lint script is configured.
The separate Code Mode test initially could not initialize without its external
fixture. After installing the documented test-only `@opencode/codemode@2.0.29`
outside the checkout, `LOOM_CODEMODE_ROOT=/tmp/opencode/concerns-codemode bun test
tests/tool-search-codemode.test.ts` passed six tests/156 assertions. This is pinned
search/runtime integration evidence, still not installed-host/model proof.

Updated bundle documents passed individual OKF validation (normative types supplied
as the local vocabulary). Graph checks have no profile loaded and report three
links from normative documents to this existing reserved `index.md` as unindexed;
the file/link targets exist. This is a reserved-file indexing limitation, not
proof of typed relationship coverage. No unrelated legacy corpus migration was
attempted.

## Discovery and validation limits

OKF `get_index` returned an empty tree before authoring, although the repository contains the linked Markdown docs. Those legacy docs lack OKF frontmatter; direct reads were necessary. No local OKF profile or existing bundle index/log was found in the inspected documentation tree. New requirement artifacts carry metadata and have a local index/log; legacy corpus migration is out of scope. Structural validation results must be reported separately from content reconciliation and implementation evidence.

Specification-stage validation recorded individual OKF checks with no errors or warnings; the log's initial cross-link notification was corrected and its recheck was clean. The five-file bundle is discoverable in `get_index`. Graph integrity reported no dangling references and three orphan notifications (the three normative artifacts cite the conversation as their source, not a separately indexed intent document); no profile was loaded, so typed-relationship enforcement was not established. Index inventories and local link targets were checked against the created files. No implementation or executable acceptance tests were run at that stage; subsequent implementation evidence is above.
