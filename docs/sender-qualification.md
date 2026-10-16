# Qualifying the bounded opt-in sender

No default automation is enabled. This is an author verification procedure, not
independent acceptance or live-model usefulness evidence.

```sh
bun run typecheck
bun run test:core
bun run test:native
python3 tests/installed_sender_qualification.py \
  --opencode /absolute/path/to/opencode-2.0.29 \
  --report-directory /tmp/opencode/sender-qualification-RUN
```

The last command uses an allowlisted environment and fresh project/config/state/
cache/runtime/home beneath `/tmp/opencode`, rejects ancestor configs and inherited
credential environment, checks exact host version, owns loopback ports, and tears
down its exact processes. It never discovers/restarts the normal service. All
model requests use the local scripted provider; external providers are rejected.
Reports retain raw provider ENTRY and responses, actual synthetic entries/ACKs/
live enqueued events/public plugin context reads, source ledger bytes and outcomes.
They contain fixture prompts only; never run against a real conversation.

Cases: default (zero native calls), normal, lost ACK recovered by live event,
lost ACK recovered by actual plugin context, after-admission receipt-write failure,
managed restart recovering a lost receipt from promoted context, unavailable
context response, real compaction hiding the notice before restart, and explicit
post-notice withdrawal preventing native re-delegation. The last three qualify
uncertainty/suppression, not successful delivery or completion. Positive opt-in cases
start with original delegation returned and exact primary idle before Research
answers. Both primary and Worker read all three pages of conflicting/qualified
answers. Primary delegates the same Worker/original ref natively; Worker explicitly
completes, native returns, primary retrieves exact completion/results and performs
its next coordinating write. There is one initial user prompt, no direct Worker
synthetic, no Loom completion nudge, and one production synthetic per eligible intent.

`tests/sender-host/server.ts` wraps production plugin setup only to count actual
I/O and inject failures. The production sender creates intent/envelope/claim/send/
receipt; wrappers call actual ctx.synthetic/context/event APIs, never richer HTTP
methods or test-owned notice submissions. Default and historical intents stay false.
Raw request counters precede scripted write guards; normal tool-step history is
not counted as duplicate input. Existing `installed_handback_experiment.py` and its
`--comparison` controls remain separate, unchanged test-adapter comparisons.

Focused tests force negative absent/unpromoted/compacted/read-error/mismatched
context outcomes to remain uncertain, plus transactional rollback, supersession,
withdrawal races and startup bounds. These negatives are not delivery successes.
Malformed-persistence regressions also recompute a binding's self-digest after
changing its route, metadata, notice or association/source identity. They assert
zero host lookup/context/synthetic calls for initially inconsistent records, no
positive receipt through ACK/live-event paths, and preservation of valid frozen
requests. They exercise preparation, reconciliation and invalidation during
preflight; these are persistence-invariant tests, not adversarial database security.
The marker-before-native-call crash gap intentionally sacrifices liveness: absent
positive evidence, no replay is allowed. No eventual delivery, arbitrary model-work
exactly-once, bounded native context materialization, backup/restore, E or overall
alpha readiness is claimed.
