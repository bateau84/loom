---
name: golang-observability
description: "Go production observability — structured logging with slog, Prometheus metrics, OpenTelemetry tracing, continuous profiling with pprof/Pyroscope, alerting, and Grafana dashboards. Use when instrumenting a Go service for production monitoring, adding metrics or tracing, migrating from zap/logrus/zerolog to slog, correlating logs and traces, or setting up alerting. Not for slog multi-handler pipelines (→ See `golang-samber-slog`), benchmark profiling (→ See `golang-benchmark`), or optimization patterns (→ See `golang-performance`)."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
  adapted-from: samber/cc-skills-golang@golang-observability
---

> **House skill.** Adapted from `samber/cc-skills-golang@golang-observability` for this workspace. Follow `golang-common-practice` and `current Loom role directive and control-plane state`.

**Persona:** You are a Go observability engineer. You treat every unobserved production system as a liability — instrument proactively, correlate signals to diagnose, and never consider a feature done until it is observable.

**Modes:**

- **Coding / instrumentation** (default): Add observability to new or existing code — declare metrics, add spans, set up structured logging, wire pprof toggles. Follow the sequential instrumentation guide.
- **Review mode** — reviewing a PR's instrumentation changes. Check that new code exports the expected signals (metrics declared, spans opened and closed, structured log fields consistent). Sequential.
- **Audit mode** — auditing existing observability coverage across a codebase. Check every signal (metrics, logging, tracing, profiling, RUM). Within the current Loom task, checks all signals itself, sequentially.

# Go Observability Best Practices

Observability is the ability to understand a system's internal state from its external outputs. In Go services, this means five complementary signals: **logs**, **metrics**, **traces**, **profiles**, and **RUM**. Each answers different questions, and together they give you full visibility into both system behavior and user experience.

When using observability libraries (Prometheus client, OpenTelemetry SDK, vendor integrations), refer to the library's official documentation and code examples for current API signatures.

## Best Practices Summary

1. **Use structured logging** with `log/slog` — production services MUST emit structured logs (JSON), not freeform strings
2. **Choose the right log level** — Debug for development, Info for normal operations, Warn for degraded states, Error for failures requiring attention
3. **Log with context** — use `slog.InfoContext(ctx, ...)` to correlate logs with traces
4. **Prefer Histogram over Summary** for latency metrics — Histograms support server-side aggregation and percentile queries. Every HTTP endpoint MUST have latency and error rate metrics.
5. **Keep label cardinality low** in Prometheus — NEVER use unbounded values (user IDs, full URLs) as label values
6. **Track percentiles** (P50, P90, P99, P99.9) using Histograms + `histogram_quantile()` in PromQL
7. **Set up OpenTelemetry tracing on new projects** — configure the TracerProvider early, then add spans everywhere
8. **Add spans to every meaningful operation** — service methods, DB queries, external API calls, message queue operations
9. **Propagate context everywhere** — context is the vehicle that carries trace_id, span_id, and deadlines across service boundaries
10. **Enable profiling via environment variables** — toggle pprof and continuous profiling on/off without redeploying
11. **Correlate signals** — inject trace_id into logs, use exemplars to link metrics to traces
12. **A feature is not done until it is observable** — declare metrics, add proper logging, create spans
13. **[awesome-prometheus-alerts](https://samber.github.io/awesome-prometheus-alerts/) provides ~500 ready-to-use alerting rules** organized by technology for infrastructure and dependency monitoring

## Cross-References

See the `observability` skill for the language-agnostic standard (three pillars, log categories, severity contract, audit hard rules, economics). This skill is the Go mechanics layer.

See `golang-error-handling` skill for the single handling rule. See `golang-troubleshooting` skill for using observability signals to diagnose production issues. See `golang-security` skill for protecting pprof endpoints and avoiding PII in logs. See `golang-context` skill for propagating trace context across service boundaries. See `promql-cli` skill for querying and exploring PromQL expressions against Prometheus from the CLI.

### Go 1.26+: slog multi-handler

For simple fan-out to multiple slog handlers, prefer stdlib `slog.NewMultiHandler` before adding third-party handler-composition dependencies.

```go
logger := slog.New(slog.NewMultiHandler(
    slog.NewJSONHandler(os.Stdout, nil),
    auditHandler,
))
```

Use third-party slog handler libraries only when the stdlib handler composition is insufficient.

## The Five Signals

| Signal | Question it answers | Tool | When to use |
| --- | --- | --- | --- |
| **Logs** | What happened? | `log/slog` | Discrete events, errors, audit trails |
| **Metrics** | How much / how fast? | Prometheus client | Aggregated measurements, alerting, SLOs |
| **Traces** | Where did time go? | OpenTelemetry | Request flow across services, latency breakdown |
| **Profiles** | Why is it slow / using memory? | pprof, Pyroscope | CPU hotspots, memory leaks, lock contention |
| **RUM** | How do users experience it? | PostHog, Segment | Product analytics, funnels, session replay |

## Detailed Guides

Each signal has a dedicated guide with full code examples, configuration patterns, and cost analysis:

- **[Structured Logging](references/logging.md)** — Why structured logging matters for log aggregation at scale. Covers `log/slog` setup, log levels (Debug/Info/Warn/Error) and when to use each, request correlation with trace IDs, context propagation with `slog.InfoContext`, request-scoped attributes, the slog ecosystem (handlers, formatters, middleware), and migration strategies from zap/logrus/zerolog.

- **[Metrics Collection](references/metrics.md)** — Prometheus client setup and the four metric types (Counter for rate-of-change, Gauge for snapshots, Histogram for latency aggregation). Deep dive: why Histograms beat Summaries (server-side aggregation, supports `histogram_quantile` PromQL), naming conventions, the PromQL-as-comments convention (write queries above metric declarations for discoverability), production-grade PromQL examples, multi-window SLO burn rate alerting, and the high-cardinality label problem (why unbounded values like user IDs destroy performance).

- **[Distributed Tracing](references/tracing.md)** — When and how to use OpenTelemetry SDK to trace request flows across services. Covers spans (creating, attributes, status recording), `otelhttp` middleware for HTTP instrumentation, error recording with `span.RecordError()`, trace sampling (why you can't collect everything at scale), propagating trace context across service boundaries, and cost optimization.

- **[Profiling](references/profiling.md)** — On-demand profiling with pprof (CPU, heap, goroutine, mutex, block profiles) — how to enable it in production, secure it with auth, and toggle via environment variables without redeploying. Continuous profiling with Pyroscope for always-on performance visibility. Cost implications of each profiling type and mitigation strategies.

- **[Real User Monitoring](references/rum.md)** — Understanding how users actually experience your service. Covers product analytics (event tracking, funnels), Customer Data Platform integration, and critical compliance: GDPR/CCPA consent checks, data subject rights (user deletion endpoints), and privacy checklist for tracking. Server-side event tracking (PostHog, Segment) and identity key best practices.

- **[Alerting](references/alerting.md)** — Proactive problem detection. Covers the four golden signals (latency, traffic, errors, saturation), [awesome-prometheus-alerts](https://samber.github.io/awesome-prometheus-alerts/) provides ~500 ready-to-use rules by technology, Go runtime alerts (goroutine leaks, GC pressure, OOM risk), severity levels, and common mistakes that break alerting (using `irate` instead of `rate`, missing `for:` duration to avoid flapping).

- **[Grafana Dashboards](references/dashboards.md)** — Prebuilt dashboards for Go runtime monitoring (heap allocation, GC pause frequency, goroutine count, CPU). Explains the standard dashboards to install, how to customize them for your service, and when each dashboard answers a different operational question.

## Correlating Signals

Signals are most powerful when connected. A trace_id in your logs lets you jump from a log line to the full request trace. An exemplar on a metric links a latency spike to the exact trace that caused it.

### Logs + Traces: `otelslog` bridge

```go
import "go.opentelemetry.io/contrib/bridges/otelslog"

// Create a logger that automatically injects trace_id and span_id
logger := otelslog.NewHandler("my-service")
slog.SetDefault(slog.New(logger))

// Now every slog call with context includes trace correlation
slog.InfoContext(ctx, "order created", "order_id", orderID)
// Output includes: {"trace_id":"abc123", "span_id":"def456", "msg":"order created", ...}
```

### Metrics + Traces: Exemplars

```go
// When recording a histogram observation, attach the trace_id as an exemplar
// so you can jump from a P99 spike directly to the offending trace
obs := histogram.WithLabelValues("POST", "/orders")
if eo, ok := obs.(prometheus.ExemplarObserver); ok {
    eo.ObserveWithExemplar(duration, prometheus.Labels{"trace_id": traceID})
} else {
    obs.Observe(duration)
}
```

## Stack decisions (locked for this workspace)

These decisions were resolved through architecture review and are binding — not guidelines. The *why* lives in `observability`; this section is the *how*.

### Logger: zap + otelzap

Library: `zap` + `go.opentelemetry.io/contrib/bridges/otelzap`.

**Bridge setup — once at startup:**
```go
zapLogger, _ := zap.NewProduction()
otelLogger := otelzap.New(zapLogger)
// Use otelLogger everywhere; pass ctx at every call site
```

**The only acceptable call pattern:**
```go
// CORRECT — trace_id and span_id injected automatically from ctx
otelLogger.Ctx(ctx).Info("payment processed",
    zap.String("order_id", orderID),
    zap.Float64("amount", amount),
)
```

**Reviewable anti-pattern — mandatory fix in code review:**
```go
// WRONG — compiles, runs, emits no trace_id. Silent failure.
otelLogger.Info("payment processed",
    zap.String("order_id", orderID),
)
```

The failure mode is silent: the log emits normally but is permanently unlinked from its trace. Any `logger.Info(` / `.Error(` / `.Warn(` / `.Debug(` without `.Ctx(ctx)` is a mandatory fix, not a suggestion. Consider a wrapper type that removes the context-free methods from the exported API entirely to make the wrong thing impossible.

---

### Loki label strategy

Loki indexes on labels, not field values. Every unique label combination is a separate log stream — unbounded cardinality kills performance silently and progressively.

**Permitted labels — low cardinality only:**
```
{service="payment-api", env="production", level="error", host="pod-x"}
```

**Forbidden as labels — live as JSON body fields instead:**
```
trace_id, span_id, user_id, order_id, request_id, correlation_id
```

**What cardinality explosion looks like in numbers:**
```
# BAD — 10M users × 3 envs × 6 levels = 180M streams. Loki dies.
{user_id="u_8a3f", trace_id="4bf92f35...", env="production", level="info"}

# GOOD — 3 envs × 6 levels × ~50 hosts = ~900 streams. Stays fast.
{env="production", level="info", service="payment-api", host="payment-api-pod-3"}
# user_id and trace_id are inside the JSON body, queryable via:
# {service="payment-api"} | json | user_id="u_8a3f"
```

`trace_id` does not need to be a label to be findable. Grafana's Loki→Tempo data link follows the `trace_id` field value in the JSON body — no label required.

---

### Async trace propagation: RabbitMQ

Trace context travels as W3C `traceparent` in RabbitMQ AMQP message **headers**, not the body. The OTEL AMQP instrumentation handles injection and extraction automatically when given the context.

**Enqueuing side:**
```go
// PublishWithContext + OTEL AMQP instrumentation injects traceparent into headers
err := ch.PublishWithContext(ctx, exchange, routingKey, false, false, amqp.Publishing{
    ContentType: "application/json",
    Body:        payload,
    // OTEL injects automatically: Headers["traceparent"] = "00-<trace_id>-<span_id>-01"
})
```

**Consuming side:**
```go
// Restore the trace context from the message headers before doing any work
ctx = otel.GetTextMapPropagator().Extract(ctx, amqpHeaderCarrier(msg.Headers))
// All subsequent otelLogger.Ctx(ctx).Info(...) calls emit the original trace_id
```

**Result:** HTTP request → enqueue → consume appears as one unified trace tree in Tempo. Async worker logs carry the originating request's `trace_id` and link directly into that trace.

---

### Audit log implementation

| Decision | Choice | Rationale |
|---|---|---|
| Storage | Azure Immutable Blob Storage, **Compliance mode** | Cannot be overridden even by subscription owner. Governance mode is not acceptable — allows admin override under pressure. |
| Retention | 12 months minimum (SAQ A-EP baseline) | Revisit if PCI-DSS scope assessment changes. |
| Tamper evidence | Compliance mode (storage-enforced) | Sufficient for current SAQ A-EP scope; add hash chaining if scope changes to full PCI. |
| Actor identity / PII | Hash + pepper at write time | `actor.id = SHA256(user_id + secret_pepper)`. Pepper lives in Azure Key Vault. Plaintext mapping table stored separately — deletable on GDPR erasure request without touching audit records. |
| Write mode | Synchronous — no in-memory buffering | Unflushed buffer before crash = lost evidence. Audit writes must block until durable. |
| Pipeline | Separate from operational logs | Backpressure on operational pipeline must never shed audit records. Separate AMQP connection, separate sink. |

**PCI-DSS scope:** Braintree handles card data; this service handles tokens only (SAQ A-EP). Raw card numbers must never appear in any log. Braintree tokens (`tok_...`) may appear in audit records as `resource.id`.

**Mandatory audit record shape:**
```json
{
  "@timestamp": "2026-06-30T14:23:01.542Z",
  "event.action":  "payment.authorised",
  "event.outcome": "success",
  "actor.id":      "SHA256(user_id+pepper)",
  "actor.type":    "user",
  "resource.type": "payment",
  "resource.id":   "tok_4xSjF...",
  "source.ip":     "203.0.113.12",
  "request_id":    "req_01J3QMNT",
  "service.name":  "payment-api"
}
```

---

### HTTP status log level convention

Always emit `http.status` as a structured field regardless of level — lets Prometheus track error rates without elevating user mistakes to alerts.

| Status | System state | Level |
|---|---|---|
| 400 Bad Request | Invalid input — system worked as designed | `INFO` |
| 401 Unauthorized | Missing/invalid credentials — expected | `INFO` |
| 403 Forbidden | Valid credentials, insufficient permissions | `INFO` |
| 404 Not Found | Resource doesn't exist — expected | `INFO` |
| 422 Unprocessable | Validation failure — system worked as designed | `INFO` |
| 429 Too Many Requests | Rate limit enforced — system working correctly | `WARN` |
| 5xx | System fault — your code failed | `ERROR` |

The deciding rule (from `observability`): if *your system* failed, it's `ERROR`. If *the caller* sent bad input and you returned a clean response, it's `INFO` — your system worked exactly as designed.

---

## Migrating Legacy Loggers

If the project currently uses `zap`, `logrus`, or `zerolog`, migrate to `log/slog`. It is the standard library logger since Go 1.21, has a stable API, and the ecosystem has consolidated around it. Continuing with third-party loggers means maintaining an extra dependency for no benefit.

**Migration strategy:**

1. Add `slog` as the new logger with `slog.SetDefault()`
2. Bridge handlers during migration route slog output through the existing logger: [samber/slog-zap](https://github.com/samber/slog-zap), [samber/slog-logrus](https://github.com/samber/slog-logrus), [samber/slog-zerolog](https://github.com/samber/slog-zerolog)
3. Gradually replace all `zap.L().Info(...)` / `logrus.Info(...)` / `log.Info().Msg(...)` calls with `slog.Info(...)`
4. Once fully migrated, remove the bridge handler and the old logger dependency

## Definition of Done for Observability

A feature is not production-ready until it is observable. Before marking a feature as done, verify:

- [ ] **Metrics declared** — counters for operations/errors, histograms for latencies, gauges for saturation. Each metric var has PromQL queries and alert rules as comments above its declaration.
- [ ] **Logging is proper** — structured key-value pairs with `slog`, context variants used (`slog.InfoContext`), no PII in logs, errors MUST be either logged OR returned (NEVER both).
- [ ] **Spans created** — every service method, DB query, and external API call has a span with relevant attributes, errors recorded with `span.RecordError()`.
- [ ] **Dashboards and alerts exist** — the PromQL from your metric comments is wired into Grafana dashboards and Prometheus alerting rules. Ready-to-use alert rules for common infrastructure dependencies are available at [awesome-prometheus-alerts](https://samber.github.io/awesome-prometheus-alerts/).
- [ ] **RUM events tracked** — key business events tracked server-side (PostHog/Segment), identity key is `user_id` (not email), consent checked before tracking.

## Common Mistakes

```go
// ✗ Bad — log AND return (error gets logged multiple times up the chain)
if err != nil {
    slog.Error("query failed", "error", err)
    return fmt.Errorf("query: %w", err)
}

// ✓ Good — return with context, log once at the top level
if err != nil {
    return fmt.Errorf("querying users: %w", err)
}
```

```go
// ✗ Bad — high-cardinality label (unbounded user IDs)
httpRequests.WithLabelValues(r.Method, r.URL.Path, userID).Inc()

// ✓ Good — bounded label values only
httpRequests.WithLabelValues(r.Method, routePattern).Inc()
```

```go
// ✗ Bad — not passing context (breaks trace propagation)
result, err := db.Query("SELECT ...")

// ✓ Good — context flows through, trace continues
result, err := db.QueryContext(ctx, "SELECT ...")
```

```go
// ✗ Bad — using Summary for latency (can't aggregate across instances)
prometheus.NewSummary(prometheus.SummaryOpts{
    Name:       "http_request_duration_seconds",
    Objectives: map[float64]float64{0.99: 0.001},
})

// ✓ Good — use Histogram (aggregatable, supports histogram_quantile)
prometheus.NewHistogram(prometheus.HistogramOpts{
    Name:    "http_request_duration_seconds",
    Buckets: prometheus.DefBuckets,
})
```
