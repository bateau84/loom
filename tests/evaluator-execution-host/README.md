# Restricted execution consumer fixture

This is a test-only authority and provider. It gives no production component
permission to execute an Evaluator. The installed qualification imports the
production consumer from the packed candidate, prepares synthetic authored
originals through the existing Stage 3 and preparation owners, and connects that
consumer directly to this private fixture. Native execution uses the actual
OpenCode 2.3.0 Session and streaming provider path. No public Loom tool or
configuration can install this authority.

`installed_evaluator_execution.py` creates isolated HOME/XDG directories and a
loopback private host. Its only provider is the in-process scripted model in
`server.ts`; `provider.mjs` rejects use without that hook. The fixture denies
all tools, external providers, fallback models, auxiliary requests and native
retries. The native title hook supplies a fixed title without a provider call.
The retry hook is exercised by an actual provider rejection, not a fabricated
consumer receipt.

`authority.ts` owns immutable synthetic grants, shared reservations and readback.
`fixture-store.ts` owns actual provider-send admission in a separate durable
SQLite database. Its immediate transaction consumes a reservation once, before
returning a scripted result. It checks current synthetic authority, expiry,
source permission, method/configuration, recipient, model, account and the
original prompt digest at every send. Already consumed entries remain consumed
through host restart, lease expiry, lost acknowledgements and restoration of the
Loom store pair. Admission requires an empty native recipient history. The
fixture only reports completion after finding the exact original native input
and one finished native assistant result in that exclusive one-send Session.
That restricted first-response association does not establish Q4 contributing
input provenance. Recovery never submits a prompt or wakes a Session.

The resource unit is a synthetic request with fixed scripted input/output usage
of one each. This tests reservation and settlement mechanics; these numbers are
not tokenization, cost, provider spending enforcement or subscription evidence.
The provider is wholly owned by this fixture and has no network fallback.
Authority loss or rollback alongside Loom is outside the qualified boundary.

The nine installed checks cover:

- One authorized native logical execution and a completed result.
- Original-result recovery after native host restart.
- Restoring the pre-effect Loom snapshot without another admitted send.
- An actual additional native request denied at the durable provider boundary.
- A duplicate admitted invocation using a legitimate recipient rejected by the oracle.
- A deliberately lost native acknowledgement reconciled without another send.
- Actual native provider rejection, denied retry and authoritative zero-effect release.
- SIGKILL after native provider admission, uncertain reservation retention, consumer
  replay without dispatch and a denied additional native request after restart.
- Independent consumer processes competing for one shared account-pool unit.

The crash case does not assert that every restart automatically retries. It
proves that the consumed fixture reservation survives restart, and deliberately
exercises a later native request against that same durable fence. Native startup
resume remains a required boundary for any eventual production owner.

The harness requires a clean exact candidate, its installed tarball, Bun and the
pinned OpenCode binary. `--allow-dirty-development` is a debugging option: its
report is explicitly marked development-only and cannot qualify a reviewed
commit. Reports include source/runtime fingerprints and identifier-only native
and provider events. Temporary databases, configuration and credentials are
deleted when the harness exits. The real installed Evaluator definition, Agent
Run Audit method, genuine reasoning, real account authority, Q4, Q5 and E11 stay
unqualified.
