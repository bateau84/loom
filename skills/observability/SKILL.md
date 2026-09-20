---
name: observability
description: "Logs, metrics, and traces written into code as a first-class deliverable — structured logging, log levels, metrics cardinality, request-flow tracing, and correlation. Use when deciding what to log, choosing between a log / metric / trace, separating operational vs audit vs diagnostic logs, instrumenting a feature or boundary, or judging whether code is observable enough to ship. Not for language or APM mechanics (→ See `golang-observability`, `python-observability`, `app-observability`)."
license: MIT
metadata:
  author: Bateau
  version: "1.2.0"
---

> **House skill.** Language-agnostic observability discipline for this workspace. The per-agent role hooks (who writes / flags / advises) live in `current Loom role directive and control-plane state` -> Observability & Logging; language mechanics live in `golang-observability` / `python-observability`. This skill is the standard they share.

**Persona:** You treat an unobservable system as a liability. You instrument proactively, you reach for the _right_ signal rather than reflexively adding a log line, and you do not consider a feature done until you could diagnose it in production from its output alone.

## The first principle

Observability is the ability to understand a system's internal state from its external outputs. It is a **deliverable of the work, not a favor to your future self** — wired in as you build, the same way tests are. But it is _not_ free (see Economics below), so it is a deliberate design choice at every point: the goal is the **most signal for the least noise, cost, and risk.**

## Three pillars — reach for the right one

The reflex "I want to see how the code is processing" usually wants a **trace**, not a log. Pick the signal that answers the question:

| Pillar | Question it answers | Reach for it when |
| --- | --- | --- |
| **Logs** | _What exactly happened in this one event?_ | A discrete event, decision, or error whose details you'll want after the fact. |
| **Metrics** | _How much / how often / how bad, in aggregate?_ | Rates, counts, latencies, saturation — anything you alert on or watch trend over time. |
| **Traces** | _Where did this request go, and where did the time go?_ | Following one request across functions/services, finding the slow or failing hop. **This is the tool for "watch it process."** |

The mistake to avoid: fossilizing print-debugging as **narration logs** ("entering X", "got here", "value=5"). That play-by-play is what a trace (or a debugger session) gives you for free, and it becomes pure noise in production. Log _decisions and outcomes_; trace _flow_; measure _aggregates_.

Traces are the under-used pillar. On any multi-step or cross-service path, a span tree answers "what happened and how long did each part take" far better than a scatter of logs you have to reassemble by hand. Set up the tracer early; add spans to service methods, DB queries, external calls, and queue operations.

## Log categories — they are not one thing

Split logs by audience and purpose; they have different levels, retention, and security rules. Lumping them produces logs that serve none well.

| Category | Purpose / audience | Typical level | Retention & handling |
| --- | --- | --- | --- |
| **Operational** | What the system did, for the operators running it (request handled, job ran, dependency degraded). | Info / Warn | Short-to-medium; the bulk of your volume — keep it lean. |
| **Audit** | Who did what, for compliance and security (authn, authz decisions, data access, config change). | Info (dedicated stream) | Long, often regulated; **immutable, access-controlled, never mixed into ops logs**. |
| **Diagnostic** | Why something happened, for the developer debugging it (branch taken, computed value, intermediate state). | Debug | Off or sampled in prod; on-demand. Must be cheap to disable. |

A single event can warrant entries in more than one stream — an auth failure is an _audit_ record _and_ an _operational_ warning — but write them deliberately to their stream; do not conflate them.

### Audit log hard rules

1. Every audit record answers the six questions: _who_ (`actor.id`, `actor.type`), _did what_ (`event.action`), _to what_ (`resource.type`, `resource.id`), _outcome_ (`success` / `failure`), _when_ (`timestamp`, UTC, immutable), _from where_ (`source.ip`, `request_id`).
2. **Never sampled, never dropped.** Audit travels on a separate pipeline with no shared fate with operational logs — backpressure on ops must never shed audit records.
3. **Immutable.** Append-only storage (WORM / hash-chaining / sequence-gapped alerting). No engineer, including you, may delete or alter.
4. **GDPR erasure tension:** Pseudonymise the actor identity at write time (hash + pepper, or per-user encryption key). The audit record persists; the link to the person is severable. This is complex — flag it as a design decision early, not a surprise at launch.
5. **Synchronous durability is mandatory.** An in-memory buffer that hasn't flushed before a crash means lost evidence. Audit writes must survive process death.

## The discipline (what turns expensive spray into cheap signal)

- **Log at the boundaries, not in the hot loop** — inputs received, external/IO calls (DB, network, queue) and their outcome, state transitions, and every error path. The edge where data enters or leaves a component is the right place; the interior of a tight loop is the wrong one.
- **Log an error exactly once, at the handler.** Below the handler, wrap and propagate (`fmt.Errorf("get user %s: %w", id, err)` / raise with context). Do not log _and_ return — every layer that does creates a duplicate. The single log at the top handler carries the full chain plus the request context. This is the difference between a useful error trail and a wall of repeated noise.
- **Structured over freeform.** Emit key/value fields rather than interpolated prose. A structured field is greppable, aggregatable, and _assertable in a test_. Use JSON in production (shipped to the aggregator) and a human-readable format (logfmt / colourised) on the developer terminal — one logger, two handlers.
- **Canonical fields.** Every record carries at minimum: `timestamp` (UTC, ISO 8601 or ns-epoch), `level`, `message`, `service.name`. Add when in scope: `trace_id` + `span_id` (correlation), `service.version` (tie incidents to releases), `environment` (never mix prod/staging), `error.type` + `error.message` (on error paths), `caller` (file:line, on Error/Debug). Put data in named fields, never baked into the message string — `"user 12345 paid $99"` is unqueryable; `user_id=u_12345 amount=99.99` is searchable.
- **Right level, every time.** The deciding question is _whose fault is it?_
  - **Error** — *your system* failed and could not recover without intervention (DB down, unhandled exception, 5xx returned).
  - **Warn** — something unexpected happened but the system recovered (retry succeeded, approaching a quota, deprecated path hit).
  - **Info** — a normal business event at a boundary (request handled, job completed, config loaded). If the caller sent bad input and you returned a clean 4xx, that is Info or Debug — your system worked as designed.
  - **Debug** — diagnostic detail that is off in production by default.
  
  The most common noise source is logging every user-error (HTTP 400) as an Error. Resist it: the system is not broken, the input was.
- **Correlate the pillars.** Thread a request/trace id through logs, metric exemplars, and spans so all three line up for a single request. An uncorrelated log is archaeology.
- **Respect the transport.** Never write logs to a channel the protocol owns — for a stdio server, stdout is the wire, so logs go to stderr or a file.
- **Never log secrets or PII.** Tokens, passwords, keys, personal data. A careless log is a breach sitting in storage waiting to be grepped, and a compliance liability under GDPR/CCPA.

## The honest economics — cheap when disciplined, expensive when sprayed

"It costs nothing when dormant" is a myth. A log you never read still costs:

- **Compute** — an unguarded `debug(expensiveFormat(x))` pays the formatting/allocation even when the level is off. Guard hot-path logs, or pass structured fields the handler formats lazily.
- **Money** — ingestion, indexing, and retention are often the single biggest observability line item. Over-logging is the bill that gets budgets cut, taking the _good_ logs with it.
- **Attention** — every line is something a future reader must triage. Over-logging buries the one line that matters; noise is _negative_ value.
- **Risk** — every log is a potential PII/secret leak and an attack surface in storage.
- **Cardinality** — putting unbounded high-cardinality values (user IDs, request IDs) as *metric label keys* rather than *log field values* creates a time-series explosion that kills Prometheus-style systems. Fine in a log record's fields; catastrophic as a dimension on a counter or histogram.

So: more logging is not more observability. Deliberate signal is.

**The canonical log line pattern.** Instead of N fine-grained INFO lines scattered through a request, emit **one rich record at the request boundary** that collects everything worth knowing (method, path, status, latency, user, key IDs, trace_id). This collapses noise into a single searchable, alertable line — reinforcing both boundary-logging and cost discipline. Extend the pattern to background jobs, queue messages, and cron runs: anywhere there is a logical unit of work with a clear entry and exit.

## Observability is not prevention

Logging makes a failure _detectable_; it does not make it _not happen_. Keep it strictly **below** "make illegal states unrepresentable" (types, assertions, validate-at-the-boundary). The trap is _"we'll see it in the logs"_ becoming the excuse a weak invariant ships behind. The strongest code makes the error impossible; the next best makes it loud. Observability is the second tier — invaluable, but not a substitute for a guarantee. (This is the runtime counterpart to the silent-wrong-output defect: instrumentation _surfaces_ a confidently-wrong value; a real invariant _prevents_ it.)

## Observability is testable behavior

A structured log line or emitted metric is observable output, so assert on it (see `test-driven-development`): that a failure path logs at Error with the offending input, that a boundary records what it decided, that the audit event fires on a privileged action. Writing the test for the signal first is the cheapest way to make "fail loudly" real instead of aspirational.

Observable output is also the **agent's primary verification signal** — agents confirm their own changes are correct by running code and checking output, not by re-reading source. A silent code path, a swallowed error, or a missing log line is invisible to that verification loop: the agent has no way to confirm the change worked. This makes observability a direct enabler of agent autonomy (see P3 — Verifiable End States): an unobservable feature cannot be self-verified, so it requires human inspection to confirm correctness.

## A feature is not done until it is observable

Before you call it done, check:

1. Could an operator who has never read the code diagnose a failure from its output alone?
2. Is every external call and error path observable (log / metric / span), carrying a correlation id?
3. Is the right pillar used — trace for flow, metric for aggregate, log for the event?
4. Are audit-worthy actions on their own stream?
5. Does anything log a secret or PII? (Must be _no_.)
6. Is diagnostic detail cheap to disable in production?

## Cross-references

- `current Loom role directive and control-plane state` -> **Observability & Logging** — the per-agent role hooks (coder writes, reviewer flags, debugger advises).
- `golang-observability` — Go mechanics: logger choice, `zap`/`otelzap` wiring, `context.Context` propagation rules, Loki label strategy, RabbitMQ `traceparent` propagation, audit storage decisions, HTTP status level conventions, Prometheus, pprof.
- `python-observability` — Python mechanics: `logging` / `structlog`, metrics, OpenTelemetry.
- `test-driven-development` — asserting on logs/metrics/spans as observable behavior.

---

This skill is the standard; the language `*-observability` skills are the mechanics. Load both for an instrumentation task.
