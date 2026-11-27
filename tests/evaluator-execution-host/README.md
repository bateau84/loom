# Restricted execution consumer fixture

This is a test-only authority and provider. It gives no production component
permission to execute an Evaluator. The installed qualification imports the
production consumer from the packed candidate, prepares synthetic authored
originals through the existing Stage 3 and preparation owners, and connects that
consumer directly to this private fixture. With `--preparation-source
retrospective`, the same driver selects one real ObjectiveIndex trajectory,
previews and freezes it through RetrospectivePopulations/EvaluationStore and
prepares its distinct v2 request. Native execution uses the actual
OpenCode 2.3.0 Session and streaming provider path. No public Loom tool or
configuration can install this authority.

`installed_evaluator_execution.py` creates isolated HOME/XDG directories and a
loopback private host. Its only provider is the in-process scripted model in
`server.ts`; `provider.mjs` rejects use without that hook. The Stage 3 fixture
denies all tools. The retrospective fixture permits only its private
`evaluator_evidence` tool. Both deny external providers, fallback models,
auxiliary requests and native retries. The native title hook supplies a fixed
title without a provider call.
The retry hook is exercised by an actual provider rejection, not a fabricated
consumer receipt.

`authority.ts` owns immutable synthetic grants, shared reservations and readback.
`fixture-store.ts` owns actual provider-send admission in a separate durable
SQLite database. Its immediate transaction consumes each exact authorized request
stage once, before returning scripted output. It checks current synthetic authority, expiry,
source permission, method/configuration, recipient, model, account and the
original prompt digest at every send. Already consumed entries remain consumed
through host restart, lease expiry, lost acknowledgements and restoration of the
Loom store pair. Admission requires an empty native recipient history. The
fixture only reports completion after finding the exact original native input
and one finished native assistant result in that exclusive Session, with exactly
the reserved number of requests consumed.
That restricted input/result association does not establish Q4 contributing
input provenance. Recovery never submits a prompt or wakes a Session.

The resource unit is a synthetic request with fixed scripted input/output usage
of one each. Stage 3 reserves one request. Retrospective execution reserves two:
one native request asks for evidence, and the next consumes its exact tool result
and produces the final response. This tests reservation and settlement mechanics; these numbers are
not tokenization, cost, provider spending enforcement or subscription evidence.
The provider is wholly owned by this fixture and has no network fallback.
Authority loss or rollback alongside Loom is outside the qualified boundary.

The twelve Stage 3 installed checks cover:

- One authorized native logical execution and a completed result.
- Original-result recovery after native host restart.
- Restoring the pre-effect Loom snapshot without another admitted send.
- An actual additional native request denied at the durable provider boundary.
- A duplicate admitted invocation using a legitimate recipient rejected by the oracle.
- A deliberately lost native acknowledgement reconciled without another send.
- Provider send rejection after native input admission and delivery, denied retry,
  zero admitted model sends and authoritative budget release, with the canonical
  claim retained and its native outcome conservative through recovery and replay.
- SIGKILL after native provider admission, uncertain reservation retention, consumer
  replay without dispatch and a denied additional native request after restart.
- Independent consumer processes competing for one shared account-pool unit.
- An external reservation becoming uncertain after reserve: fresh execution,
  recovery and replay leave the canonical issue unclaimed, retain capacity and
  produce zero authority execution entries, native inputs or model requests.
- A losing process failing claim validation while another process owns the
  same issue's held native request: no cancellation, revocation or interruption
  of the winner; its original result completes and recovers without another send.
- The same contention with an aborted losing caller, preserving the winner and
  its original result under the same assertions.

The contender checks use file barriers at the fixture authority's claim
validation boundary. The winning process enters the packed consumer through
the same canonical preparation pins and remains active until the actual held
native response is released. The driver journals authority execution,
cancellation and native interruption entries; failures cannot hide behind a
provider that independently rejects an invalid send. Only the fixture-owned
authority is wrapped to inject uncertainty, a validation failure or caller
abort. Canonical claims and consumer results are produced by the packed code.

The rejection case preserves the earlier source exposure: the original input
was committed to the native inbox, delivered into Session history and presented
to the fixture provider before its send gate rejected it. Fenced zero model
usage justifies releasing this fixture's spending reservation. It does not prove
native pre-admission rejection or retract source access. The effect receipt's
`not-admitted` therefore leaves canonical `native_outcome` as `unknown`, without
reopening its consumed claim. Recovery and execution replay retain that claim
and budget release without another native model request.

The crash case does not assert that every restart automatically retries. It
proves that the consumed fixture reservation survives restart, and deliberately
exercises a later native request against that same durable fence. Native startup
resume remains a required boundary for any eventual production owner.

## Retrospective native retrieval

Run the same harness with `--preparation-source retrospective` to qualify the v2
population path. It runs twenty-one checks: the existing twelve lifecycle controls
with their two-request reservation, plus exact v2 preparation/native retrieval,
later-history stability, wrong request/population, denied recipient, changed
original, invalid reservation, cancellation after actual provider admission and
native tool-output truncation before the second request.

The first provider response calls `evaluator_evidence`. OpenCode supplies the
actual tool Session, agent, message and call identity. The private fixture tool
checks that identity and uses an authenticated ephemeral loopback callback to
the packed consumer's existing source closure. The consumer authorizes and
resolves each frozen member for that actual Evaluator recipient. The callback
retains no original bodies; its short-lived locator/token is deleted when
execution returns. This is fixture wiring, not a registered production adapter.
The positive case issues two simultaneous authenticated callback requests from
the same real native tool context; exactly one can begin source retrieval.
The second is denied before another source read, and only one tool result is
returned to OpenCode. Setup failures close the listener and cleanup removes only
the callback file this invocation created.

The native tool retrieves all nine frozen members: eight permitted ledger,
objective and association originals plus one explicit unresolved source gap.
It never acquires historical or cross-Session native raw evidence. The oracle
compares the actual stored native tool result with the complete ordered frozen
membership, preparation/population pins, original source/view hashes and actual
recipient. The second provider request must contain the same exact tool result
digest. Later appended history must be absent. A third request, another tool
read, a retry, an auxiliary request or a request with changed evidence is denied.

The nine-member envelope exceeds OpenCode 2.3.0's default 51,200-byte tool-output
limit. The qualified fixture explicitly sets the supported `tool_output.max_bytes`
to 180,000, matching its existing complete-response bound; it still compares every
delivered byte. A negative control retains the default limit. It observes the
actual truncated native tool result and the provider's structured content
representation (including the matching truncated text part), rejects the second send,
retains the first effect and uncertain reservation, and proves recovery/replay
cannot dispatch again. Reports include callback, stored native and provider byte
counts; structured provider output also reports its serialized representation
size separately from visible text bytes. This is a bounded fixture policy, not a claim of unlimited production
evidence transfer.

Both turns share one canonical claim, one exact execution admission and one
reservation. A native interruption or uncertain outcome retains consumed
capacity and cannot re-enter consumer dispatch. Completed result recovery is
read-only. The scripted provider proves retrieval/execution mechanics only;
it provides no evidence of genuine Evaluator reasoning, Q4 contributing-input
provenance, Q5 protected transfer or real-account billing authority.

The harness requires a clean exact candidate, its installed tarball, Bun and the
pinned OpenCode binary. `--allow-dirty-development` is a debugging option: its
report is explicitly marked development-only and cannot qualify a reviewed
commit. Reports include source/runtime fingerprints and identifier-only native
and provider events. Temporary databases, configuration and credentials are
deleted when the harness exits. The real installed Evaluator definition, Agent
Run Audit method, genuine reasoning, real account authority, Q4, Q5 and E11 stay
unqualified.
