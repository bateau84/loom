# Research: Logging Formats, Practices, and Distributed Tracing — Language-Agnostic Reference

---

## Section 1 — Dominant Structured Logging Formats

### 1.1 JSON Lines (JSONL / ndjson)

The most widely deployed format for application logging in modern environments. One JSON object per newline. Every field has an explicit type (string, number, boolean, object, array).

```json
{"timestamp":"2026-06-30T14:23:01.542Z","level":"info","message":"user authenticated","service":"auth-api","trace_id":"4bf92f3577b34da6a3ce929d0e0e4736","span_id":"00f067aa0ba902b7","user_id":"u_8a3f","ip":"10.4.1.22","latency_ms":12}
```

**Strengths:** Type-safe; queryable by every major log aggregator (Splunk, Datadog, Loki, Elasticsearch); supports nested context.  
**Weaknesses:** Hard to read in a terminal without `jq`; larger byte footprint than logfmt (~30–50% heavier in practice); serialization overhead measurable at very high throughput.

---

### 1.2 logfmt

Developed by Heroku, popularized by `logrus` and Go's `slog`. Flat key=value pairs on a single line, space-separated. Values containing spaces are quoted.

```
level=info msg="user authenticated" service=auth-api trace_id=4bf92f3577b34da6a3ce929d0e0e4736 user_id=u_8a3f latency_ms=12
```

**Specification:** No formal RFC; the canonical reference is https://brandur.org/logfmt (Heroku origin) and the Go library `github.com/kr/logfmt`.  
**Key rules:** Keys are bare identifiers; values with spaces are double-quoted; no nesting (flat only).  
**Strengths:** Human-readable in a terminal without tooling; compact; easy to parse; the `msg` field carries the human-readable summary.  
**Weaknesses:** No nested types; ambiguous for arrays; strict parsers must agree on escaping rules.

> Source: https://brandur.org/logfmt

---

### 1.3 Elastic Common Schema (ECS) — v9.4.0

ECS is a **field-naming schema** (not a wire format), designed to normalise JSON log records across heterogeneous sources into Elasticsearch. It defines field sets: Base, Event, Service, Tracing, Error, User, Host, Cloud, etc.

**Base (root-level) fields — all events:**

| Field | Type | Requirement | Example |
|---|---|---|---|
| `@timestamp` | date (ISO 8601) | Required | `2016-05-23T08:05:34.853Z` |
| `message` | match_only_text | Core | `Hello World` |
| `labels` | object (flat k/v) | Core | `{"env":"production"}` |
| `tags` | keyword[] | Core | `["production"]` |

**Tracing fields** (note: NOT nested under `tracing.`, top-level `trace.` prefix):

| Field | Type | Level | Example |
|---|---|---|---|
| `trace.id` | keyword | extended | `4bf92f3577b34da6a3ce929d0e0e4736` |
| `span.id` | keyword | extended | `3ff9a8981b7ccd5a` |
| `transaction.id` | keyword | extended | `00f067aa0ba902b7` |

**Event fields (key subset):**

| Field | Notes |
|---|---|
| `event.kind` | `alert\|asset\|enrichment\|event\|metric\|state\|signal` |
| `event.category` | `authentication\|configuration\|file\|iam\|network\|process\|web\|…` |
| `event.action` | `user-password-change`, `process-started` |
| `event.id` | Unique event ID |
| `event.created` | When agent first read the event (may differ from `@timestamp`) |
| `event.ingested` | When data arrived in central store |
| `event.duration` | nanoseconds |
| `event.hash` | Hash of raw field for log integrity |

> Source: https://www.elastic.co/guide/en/ecs/current/ (ECS v9.4.0)

---

### 1.4 OpenTelemetry Log Data Model (OTEL) — Status: Stable

The OTEL spec defines a data model that any log format can be mapped to and from. Fields come in two kinds: **named top-level** (typed, efficient on wire) and **Attributes** (open key-value bag).

**Named top-level fields:**

| Field | Type | Notes |
|---|---|---|
| `Timestamp` | uint64 (ns since UNIX epoch) | When event occurred at source |
| `ObservedTimestamp` | uint64 (ns) | When OTel collector observed the event |
| `TraceId` | 16-byte sequence | W3C trace ID |
| `SpanId` | 8-byte sequence | W3C span ID |
| `TraceFlags` | 1 byte | W3C trace flags (bit 0 = sampled) |
| `SeverityText` | string | Original level string (e.g., "WARN") |
| `SeverityNumber` | uint8 (1–24) | Normalised severity |
| `Body` | AnyValue | Human-readable message or structured payload |
| `Resource` | Resource | Describes the emitting entity (service.name, etc.) |
| `InstrumentationScope` | Scope | Library/module that emitted the record |
| `Attributes` | key→AnyValue | All other structured context |
| `EventName` | string | If set, record is an "Event" — identifies the event class |

The OTEL **Resource** carries what ECS calls "source of the log" — canonical attributes are `service.name` (REQUIRED), `service.version`, `service.namespace`, `deployment.environment`, `host.name`, `container.id`, `k8s.pod.name`, etc.

> Source: https://opentelemetry.io/docs/specs/otel/logs/data-model/ (stable)

---

### 1.5 GELF (Graylog Extended Log Format) — v1.1

Designed to overcome syslog's 1024-byte limit, lack of types, and dialect diversity. A JSON payload sent via UDP (with optional chunking/compression) or TCP.

**Mandatory fields:**

| Field | Type | Requirement |
|---|---|---|
| `version` | string | MUST be `"1.1"` |
| `host` | string | Source hostname or app name |
| `short_message` | string | Human-readable short description |

**Optional core fields:**

| Field | Type | Notes |
|---|---|---|
| `full_message` | string | Long message, can contain backtrace |
| `timestamp` | number | Seconds since UNIX epoch (with decimal for ms) |
| `level` | number | syslog severity integer (0–7) |
| `_<additional>` | string or number | Any custom field MUST be prefixed with `_` |

```json
{
  "version": "1.1",
  "host": "example.org",
  "short_message": "A short descriptive message",
  "full_message": "Backtrace here\n\nmore stuff",
  "timestamp": 1385053862.3072,
  "level": 1,
  "_user_id": 9001,
  "_some_info": "foo"
}
```

> Source: https://go2docs.graylog.org/current/getting_in_log_data/gelf_format.html

---

### 1.6 Syslog — RFC 5424

RFC 5424 (IETF, March 2009) is the current Standards Track syslog spec (obsoletes RFC 3164). It defines a wire protocol (not just a format), three layers (content, application, transport), and structured data elements.

**HEADER fields:** `PRIORITY (facility+severity)`, `VERSION`, `TIMESTAMP (RFC 3339)`, `HOSTNAME`, `APP-NAME`, `PROCID`, `MSGID`  
**STRUCTURED-DATA:** Optional `[SD-ID param="value"...]` blocks  
**MSG:** The log body (UTF-8 with BOM)

Example full message:
```
<34>1 2003-10-11T22:14:15.003Z mymachine.example.com su - ID47 [exampleSDID@32473 iut="3" eventSource="Application" eventID="1011"] BOM'su root' failed for lonvick on /dev/pts/8
```

> Source: https://datatracker.ietf.org/doc/html/rfc5424 (RFC 5424, IETF, March 2009)

---

### 1.7 CEF (Common Event Format) — ArcSight/Micro Focus

CEF is a SIEM-oriented format used heavily in security contexts. It uses syslog as a transport and has a fixed pipe-delimited header plus a key=value extension section.

**Wire format:**
```
<syslog-prefix> CEF:Version|Device Vendor|Device Product|Device Version|Device Event Class ID|Name|Severity|[Extension]
```

**Example (v0):**
```
Sep 19 08:26:10 host CEF:0|Security|threatmanager|1.0|100|worm successfully stopped|10|src=10.0.0.1 dst=2.1.2.2 spt=1232
```

**Severity:** 0–3 = Low, 4–6 = Medium, 7–8 = High, 9–10 = Very-High (numeric 0–10; OR string: Unknown/Low/Medium/High/Very-High).  
**Use case:** Primarily SIEM integrations and security device event normalisation. Not commonly used for application-layer logs.

> Source: https://www.microfocus.com/documentation/arcsight/arcsight-smartconnectors-8.4/cef-implementation-standard/

---

### 1.8 W3C Trace Context — `traceparent` / `tracestate`

Not a log format, but the **correlation mechanism** linking logs to distributed traces. W3C Recommendation (23 Nov 2021).

**`traceparent` header structure:**
```
00-{trace-id:32hex}-{parent-id:16hex}-{flags:2hex}
```
- `version`: `00` (currently the only defined version)
- `trace-id`: 16 bytes (128-bit), randomly generated, lowercase hex — **NOT PII**
- `parent-id`: 8 bytes (64-bit), identifies the current span/operation in the call
- `flags`: 8-bit, bit 0 = `sampled` (1 = recording likely, 0 = not)

```http
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

**`tracestate` header:** Vendor-specific key=value pairs (e.g., `rojo=00f067aa0ba902b7,congo=t61rcWkgMzE`). Vendors MUST NOT include PII.

> Source: https://www.w3.org/TR/trace-context/ (W3C Recommendation, 2021-11-23)

---

## Section 2 — Three Core Log Categories

| Dimension | Operational / Diagnostic | Audit | Trace-Correlated |
|---|---|---|---|
| **Purpose** | Observe system health; debug failures; monitor performance | Legal, compliance, and security accountability | Understand a specific request's journey across services |
| **Primary consumer** | Developers, SREs, on-call engineers | Security teams, compliance officers, auditors, lawyers | Developers debugging latency/errors, APM dashboards |
| **Retention** | Short: hours to 30–90 days (cost-driven) | Long: 1–7+ years (regulation-driven; GDPR/SOX/HIPAA) | Medium: days to weeks (trace data is verbose) |
| **Mutability** | Can be dropped, sampled, rotated | MUST be immutable. Append-only. Tamper-evident. Separate pipeline | Can be sampled (head/tail); broken traces are acceptable noise |
| **Schema shape** | Flexible, service-specific context fields | Fixed: `actor`, `action`, `resource`, `outcome`, `timestamp`, `request_id` | Inherits log schema + mandatory `trace_id`, `span_id` |
| **PII handling** | Avoid PII; if needed, pseudonymise | Complex: PII often legally required (actor ID, IP) but subject to GDPR deletion tension | trace_id MUST NOT contain PII (per W3C) |
| **Sampling** | Allowed. Common at DEBUG/INFO in high-throughput systems | **Forbidden.** Every event must be captured | Traces are sampled; logs tied to sampled traces can be filtered |
| **Volume profile** | High — most logs by count | Low — every significant user action | Medium — one record per span |
| **Storage type** | Rolling log files, log aggregators (Loki, Datadog) | Write-once object storage, WORM, blockchain ledger, separate database | Trace backends (Jaeger, Tempo, Zipkin) or unified OTLP pipeline |

### Critical distinction: Why they must be separated

Operational logs are written primarily to answer "what is the system doing *right now*?" Audit logs answer "who did what, to what, and did it succeed, and when?" The former can be noisy and short-lived; the latter must be reliable, complete, and long-lived. Mixing them in the same pipeline risks audit records being dropped during backpressure events, and mixing them in the same retention tier wastes money.

---

## Section 3 — Severity Levels Across Major Systems

### 3.1 RFC 5424 Syslog (8 levels, 0 = most severe)

| Code | Keyword | Semantic meaning |
|---|---|---|
| 0 | `Emergency` | System is unusable — kernel panic, total service failure |
| 1 | `Alert` | Immediate action required — e.g. DB down, primary disk failure |
| 2 | `Critical` | Critical conditions — e.g. hardware fault, backup system failing |
| 3 | `Error` | Error conditions — a request failed, a transaction rolled back |
| 4 | `Warning` | Warning conditions — unusual but not an error (e.g. deprecated API used) |
| 5 | `Notice` | Normal but significant — startup, config reload |
| 6 | `Informational` | Informational — request completed successfully |
| 7 | `Debug` | Debug-level — detailed diagnostic data |

> Source: RFC 5424 §6.2.1

---

### 3.2 OpenTelemetry SeverityNumber (numeric ranges, 1–24)

OTEL maps all existing systems to a 24-step numeric scale with named "ranges":

| SeverityNumber range | Range name | Semantic meaning |
|---|---|---|
| 1–4 | `TRACE` | Fine-grained debugging; typically disabled in default configs |
| 5–8 | `DEBUG` | Debugging events |
| 9–12 | `INFO` | Informational — an event happened |
| 13–16 | `WARN` | Warning — not an error, but worth noting |
| 17–20 | `ERROR` | Error — something went wrong |
| 21–24 | `FATAL` | Fatal — application or system crash |

Each range has 4 sub-values (e.g. `WARN`, `WARN2`, `WARN3`, `WARN4`) to allow finer discrimination without losing interoperability.

> Source: https://opentelemetry.io/docs/specs/otel/logs/data-model/#severity-fields (stable)

---

### 3.3 Language/Framework Level Cross-Reference

| System | TRACE | DEBUG | INFO | WARN | ERROR | CRITICAL/FATAL |
|---|---|---|---|---|---|---|
| **RFC 5424** | 7 (Debug) | 7 (Debug) | 6 (Informational) | 4 (Warning) | 3 (Error) | 0–2 (Emergency/Alert/Critical) |
| **OTEL** | 1–4 | 5–8 | 9–12 | 13–16 | 17–20 | 21–24 (FATAL) |
| **Log4j 2 / SLF4J** | TRACE | DEBUG | INFO | WARN | ERROR | FATAL |
| **Python `logging`** | — | DEBUG (10) | INFO (20) | WARNING (30) | ERROR (40) | CRITICAL (50) |
| **Go `slog`** | — | DEBUG (-4) | INFO (0) | WARN (4) | ERROR (8) | — |
| **CEF** | — | Low (0–3) | Medium (4–6) | High (7–8) | Very-High (9–10) | — |

**Key alignment observation:** All modern systems agree on the same 5 or 6 abstract bands (DEBUG, INFO, WARN, ERROR, FATAL/CRITICAL). The main divergence is:
- Python uses `WARNING` (not `WARN`) and `CRITICAL` (not `FATAL`)
- RFC 5424 is inverted numerically (0 = worst)
- OTEL uses numeric ranges specifically to bridge these inconsistencies
- `TRACE` is absent from Python's stdlib (use DEBUG with sub-levels)

### 3.4 Semantic contracts — when to use each level

| Level | When to use | When NOT to use |
|---|---|---|
| **TRACE** | Extremely verbose internal state. Hot-path variable values, loop iterations. Disabled in all environments except local debugging. | Never in production default config. |
| **DEBUG** | Significant internal decisions: cache miss, which branch taken, connection pool state. Useful during incident investigation but too noisy for default-on production. | Do not log every entry/exit of high-frequency functions. |
| **INFO** | Business-meaningful events that operators should know about: request received (at request boundaries), service started, config loaded, user authenticated, job completed. Normal, expected flow. | Every sub-operation within a request. Do not log at INFO inside tight loops. |
| **WARN** | Something unexpected happened that the system recovered from, OR a precondition that will lead to future errors: approaching quota, deprecated API called, retried successfully, degraded mode. | Errors the system could not recover from (use ERROR). Expected operational conditions (use INFO). |
| **ERROR** | A specific operation failed and the system could not recover without external intervention: DB query failed and request returned 500, file not found when expected, failed to send email. | Warnings (use WARN). Fatal conditions (use FATAL). Do not use for expected validation errors returned to callers (prefer INFO/DEBUG). |
| **FATAL / CRITICAL** | Unrecoverable state — the process is about to exit or the system is in a totally degraded state: out of memory, database connection completely lost, corrupted core data structure. Triggers immediate page. | Anything recoverable. |

---

## Section 4 — Canonical Fields: Mandatory and Optional

### 4.1 Mandatory fields (every log record, every category)

| Field | Canonical name(s) | Format | Notes |
|---|---|---|---|
| **Timestamp** | `timestamp`, `@timestamp`, `time` | ISO 8601 with timezone (`2026-06-30T14:23:01.542Z`) OR uint64 nanoseconds since Unix epoch | Always UTC. Nanosecond precision preferred for high-frequency systems. ECS uses ISO 8601 string. OTEL uses uint64 ns. |
| **Severity** | `level`, `severity`, `SeverityText` | String constant: `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL` | UPPERCASE convention. Include numeric form when targeting OTEL. |
| **Message** | `message`, `msg`, `Body` | String | The human-readable description. Must be interpretable without context fields. Must NOT contain structured data that belongs in dedicated fields. |
| **Service name** | `service.name`, `service`, `app` | String | Identifies the emitting service. OTEL: `service.name` in Resource. ECS: `service.name`. |

### 4.2 Strongly recommended fields (most services)

| Field | Canonical name(s) | Format | Notes |
|---|---|---|---|
| **Service version** | `service.version` | Semver or git SHA | Required for correlating incidents to deployments |
| **Environment** | `service.env`, `deployment.environment` | `production`, `staging`, `development` | Prevents production logs being mixed with staging |
| **Trace ID** | `trace_id`, `trace.id`, `TraceId` | 32-hex lowercase string | W3C trace ID. Enables log→trace correlation. |
| **Span ID** | `span_id`, `span.id`, `SpanId` | 16-hex lowercase string | Links log to the specific span |
| **Caller location** | `caller`, `code.filepath`, `code.lineno`, `code.function` | `"file.go:42"` or structured | Valuable for DEBUG/ERROR; expensive to compute; skip in INFO hot paths |
| **Error details** | `error`, `error.message`, `error.type`, `error.stack_trace` | Object or string | OTEL: `exception.type`, `exception.message`, `exception.stacktrace` in Attributes |
| **Request/Correlation ID** | `request_id`, `correlation_id` | UUID or nanoid | Application-layer correlation not dependent on trace context |
| **Host** | `host.name`, `hostname` | String | The machine/pod/container name |

### 4.3 Audit-log specific mandatory fields

| Field | Canonical name(s) | Notes |
|---|---|---|
| **Actor / Subject** | `user.id`, `actor.id`, `subject` | Who performed the action |
| **Actor type** | `actor.type` | `user`, `service-account`, `api-key`, `system` |
| **Action** | `event.action`, `action` | What was done: `create`, `update`, `delete`, `read`, `login`, `logout` |
| **Resource** | `resource.type`, `resource.id` | What was acted upon |
| **Outcome** | `event.outcome`, `outcome` | `success`, `failure` |
| **Source IP** | `source.ip`, `client.ip` | For authentication events |
| **Request ID** | `request_id` | Ties audit entry to specific HTTP request |

### 4.4 OTEL Resource fields (source identity, same for all records from same service instance)

| Field | Notes |
|---|---|
| `service.name` | Required |
| `service.version` | Semver string |
| `service.namespace` | Optional grouping |
| `deployment.environment` | `production`, `staging` |
| `host.name` | Machine FQDN |
| `container.id` | Docker/K8s container ID |
| `k8s.pod.name` / `k8s.namespace.name` | K8s metadata |
| `telemetry.sdk.language` | `go`, `python`, `java`, `nodejs`, etc. |

> Sources: OTEL Resource semconv https://opentelemetry.io/docs/specs/semconv/resource/, ECS v9.4.0

---

## Section 5 — OpenTelemetry Unified Observability Model and W3C Trace Context

### 5.1 The three OTEL signals and their relationship

OTEL defines three primary signals:
1. **Traces** — A directed acyclic graph of **Spans** representing a request through a distributed system. Each span has a `trace_id` (shared across the whole trace) and a unique `span_id`.
2. **Metrics** — Pre-aggregated measurements (counters, gauges, histograms). No per-request detail.
3. **Logs** — Records of events. Can stand alone OR be correlated to a trace via `TraceId`/`SpanId`.

**The convergence point:** When a log record is emitted *inside* an active span, the OTEL SDK (via a log appender/bridge) injects the active span's `TraceId`, `SpanId`, and `TraceFlags` into the log record. This creates a **hard link** between the log and the trace span — meaning a user can navigate from a log entry directly to the full distributed trace timeline in a backend like Jaeger, Grafana Tempo, or Honeycomb.

### 5.2 OTEL Log Appender / Bridge Pattern

For languages with implicit context (Java, .NET): The appender automatically captures the active span from thread-local context and injects `TraceId`/`SpanId` into each `LogRecord.Attributes` it emits.

For languages with explicit context (Go, Rust): The developer must capture the `context.Context` at span creation and pass it to the logger. The wrapper/appender then extracts the trace context from it.

```
// Conceptual — not language-specific
logger.Info("payment processed",
  ctx,  // carries active span
  "amount", 99.99,
  "currency", "EUR")
// → LogRecord.TraceId = <from active span>
// → LogRecord.SpanId  = <from active span>
```

> Source: https://opentelemetry.io/docs/specs/otel/logs/supplementary-guidelines/

### 5.3 W3C Trace Context — detailed header semantics

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             ^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ^^^^^^^^^^^^^^^^ ^^
          version        trace-id (128-bit)         parent-id      flags
                          32 lowercase hex          16 hex          sampled=1
```

**Processing rules (W3C spec):**
- If no `traceparent` received: generate new `trace-id` and `parent-id`
- If `traceparent` received: inherit `trace-id`; generate new `parent-id` representing the current service's span; forward both
- `sampled` flag (bit 0 of flags): `01` = recording likely, `00` = not recording. Downstream services SHOULD respect this but are not required to
- Vendors MUST NOT put PII in either header
- `tracestate` may carry vendor-specific data, never PII

**Correlation ID vs Trace ID distinction:**
- `trace_id` is generated by the tracing infrastructure and follows the W3C format
- `correlation_id` / `request_id` is a simpler, often application-layer ID (e.g. `X-Request-ID` header, often a UUID) that predates OTEL. It survives when there is no distributed tracing infrastructure. In a fully OTEL-instrumented system, `trace_id` supersedes `correlation_id` but both may coexist during migration.

### 5.4 Where tracing diverges from logging

| Dimension | Logs | Traces (Spans) |
|---|---|---|
| **Granularity** | Discrete events at a point in time | Duration-bounded operations (start time + end time + duration) |
| **Structure** | Append-only records | Tree structure (parent-child relationships between spans) |
| **Purpose** | "What happened at this moment?" | "How long did this operation take and what did it call?" |
| **Volume** | Very high (many log lines per request) | Lower (one span per operation, typically 5–50 spans per request) |
| **Sampling** | Can be level-filtered but rarely sampled by probability at INFO+ | Commonly sampled — 1% of production traffic at high volume |
| **Cardinality** | Low (structured fields have bounded cardinality) | Span attributes have the same cardinality concerns |
| **Storage** | Flat per-record (Loki, Elasticsearch, S3) | Trace stores (Jaeger, Tempo) with inter-span relationships |

**Where they converge:** OTEL treats logs as a first-class signal that participates in the same pipeline as traces. A `LogRecord` with `TraceId`/`SpanId` set IS a trace-correlated log — the backend can pivot between them. OTEL's `EventName` field makes a `LogRecord` an "Event" in the structured-log sense, further unifying the concepts.

---

## Section 6 — Sharp Trade-offs

### 6.1 JSON vs. logfmt for developer experience

| Dimension | JSON | logfmt |
|---|---|---|
| **Machine parseability** | Excellent — native type system, nested objects, no ambiguity | Good — flat only, all values are string or number |
| **Terminal readability** | Poor without `jq` or pretty-print | Good — readable as-is |
| **Byte overhead** | Higher (~30–50% more characters than logfmt for same data) | Lower |
| **Development environments** | Tools like `jq`, `fx`, `humanlog` help | `logfmt` formatters (logrus pretty mode, `slog` text handler) |
| **Industry trend** | JSON has become the dominant default | logfmt remains strong in Go ecosystem and Heroku-lineage services |
| **Recommendation** | JSON for production aggregation pipelines (indexing, structured queries) | logfmt for dev console output; JSON in the background via dual handlers |

**Practical solution:** Use a logger with configurable output formatters — JSON in production (shipped to aggregator), human-formatted (logfmt or colorised) in development terminals. Most modern logging libraries (Go `slog`, Python `structlog`, `logrus`, `winston`) support this.

---

### 6.2 Verbosity vs. cost

Log volume translates directly to **storage cost**, **query latency**, and **network egress** in cloud environments.

**Rule of thumb from Stripe (canonical log lines pattern):** Instead of many fine-grained log lines per request, emit ONE rich "canonical log line" at request boundary containing all key facts. This collapses `N` DEBUG lines into 1 INFO line at the boundary without losing information.

> Source: https://brandur.org/canonical-log-lines

**Concrete cost drivers:**
- Datadog charges per ingested GB — a 10x verbosity increase means 10x cost
- Loki charges by stream and by ingestion rate
- Elasticsearch costs scale with index size and query complexity
- Cloud log shipping (Kinesis, Pub/Sub) has per-message pricing

**Mitigation strategies:**
1. Set DEBUG disabled in production by default; toggle dynamically via log-level API
2. Use canonical log lines at service boundaries
3. Suppress expected/benign INFO logs inside loops — log once with a count instead
4. Apply conditional logging: `if logger.IsEnabled(DEBUG) { ... }` to avoid building expensive log payloads that will be dropped

---

### 6.3 Log sampling

Sampling is the practice of recording only a fraction of log records to control volume and cost.

**Head-based sampling** (decided at request entry): Simple and cheap. The W3C `sampled` flag communicates the decision downstream. Flaw: you don't know at request start whether it will be interesting.

**Tail-based sampling** (decided after request completes): Can prioritise errors/slow requests. Requires buffering all spans and logs until the trace is complete. Expensive but produces much higher-quality samples. OTEL Collector supports tail sampling via the `tailsamplingprocessor`.

**Hard rule:** **Audit logs MUST NEVER be sampled or dropped.** Sampling is only appropriate for operational/diagnostic logs. Sampling audit logs creates legal and compliance risk.

**Log sampling vs. trace sampling:** These are independent decisions. You can log at 100% while sampling traces at 1%. The challenge: a log with `trace_id` set points to a trace that may not exist in the trace store if that trace was sampled out. Tooling must handle this gracefully (display the `trace_id` even if no trace backend entry exists).

---

### 6.4 Synchronous vs. asynchronous log emission

| Approach | Latency impact | Risk |
|---|---|---|
| **Synchronous** | Each log call may block on I/O write | Noisy logs can measurably slow down request handling |
| **Asynchronous (buffered)** | Near-zero latency on hot path | Buffer can be lost on crash (last N lines before crash disappear) |
| **Best practice** | Async buffering with synchronous flush on FATAL/ERROR | Use `-1` or "no-wait" buffer on DEBUG, synchronous on ERROR+ |

For audit logs: **synchronous write to persistent storage is mandatory** — you cannot buffer audit records in-memory and risk losing them on crash.

---

### 6.5 PII and cardinality explosion

**Cardinality explosion:** Adding high-cardinality values (user IDs, request IDs) as **label/index keys** rather than as **field values** is a common mistake. In metrics systems (Prometheus), a label key with 10M user IDs means 10M distinct time series — this kills cardinality-constrained systems. In logs, high-cardinality fields are fine as values (they're queryable) but should never be label keys.

**PII in logs:**
- Operational logs: never log raw passwords, tokens, SSNs, credit card numbers. Mask/redact at emission time or via pipeline processor.
- Audit logs: PII (user ID, IP address, email) is often legally required to be present for attribution. The tension with GDPR Article 17 (right to erasure) is real: standard resolution is **pseudonymisation** — store a hashed or encrypted actor identifier that can be de-identified without deleting the audit record.
- Trace headers (`traceparent`, `tracestate`): W3C spec explicitly states they MUST NOT contain PII.

---

### 6.6 Structured vs. plain text — the pipeline complexity trade-off

Plain text logs have near-zero emission cost and work everywhere. Structured JSON requires a serialisation step, but enables:
- Field-level indexing in Elasticsearch/Datadog
- Exact-match queries (not regex)
- Aggregations (count errors by `service.name`)
- Cost-based routing (drop DEBUG logs before shipping)

**The false economy:** Logging in plain text and parsing in the aggregator pipeline (grok/regex patterns) is appealing but costly. Parsing is CPU-intensive at scale. Parsing breaks when log format changes. Every format change requires updating fragile regex patterns across multiple pipeline stages. Teams that start with plain text almost universally regret it at scale.

---

## Section 7 — Audit Log Practices

### 7.1 Fundamental schema: the six questions every audit record must answer

Every audit log entry MUST answer:
1. **Who?** — `actor.id`, `actor.type`, `actor.name` (or pseudonymised equivalent)
2. **Did what?** — `event.action` (verb: `create`, `update`, `delete`, `read`, `login`, `export-data`)
3. **To what?** — `resource.type`, `resource.id` (e.g. `document:d_8a3f`, `user:u_12`)
4. **With what result?** — `event.outcome`: `success` or `failure`
5. **When?** — `timestamp` (always UTC, always millisecond or better precision, never mutable)
6. **From where?** — `source.ip`, `user_agent`, `request_id` (for HTTP-layer attribution)

**Complete audit record example (JSON):**
```json
{
  "@timestamp": "2026-06-30T14:23:01.542Z",
  "event.kind": "event",
  "event.category": ["iam"],
  "event.action": "user-password-change",
  "event.outcome": "success",
  "actor.id": "u_8a3f",
  "actor.type": "user",
  "resource.type": "user",
  "resource.id": "u_8a3f",
  "source.ip": "203.0.113.12",
  "user_agent.original": "Mozilla/5.0 ...",
  "service.name": "auth-api",
  "request_id": "req_01J3QMNT4A5BHXGPE7F4GKWC9P",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

### 7.2 Immutability and tamper evidence

Audit logs must be **append-only**. Mechanisms:
- **WORM storage** (Write Once Read Many) — AWS S3 Object Lock, Azure Immutable Blob Storage
- **Cryptographic hash chaining** — each record includes the SHA-256 of the previous record, making any insertion or deletion detectable
- **Separate write pipeline** — audit logs go through a dedicated pipeline with no shared fate with operational logs. Backpressure on operational logs must never drop audit records.
- **Sequence numbers** — monotonically increasing per-service sequence number on each record enables gap detection

### 7.3 Retention obligations

| Regulation | Domain | Minimum retention |
|---|---|---|
| GDPR (EU) | Any EU person's data processing | Depends on purpose; security logs often 1–2 years |
| PCI-DSS v4 | Payment card data | 12 months online, 3 months immediately accessible |
| SOX (Sarbanes-Oxley) | US public companies, financial records | 7 years |
| HIPAA | US healthcare | 6 years |
| ISO 27001 | Information security | Policy-defined, typically 1–3 years |

### 7.4 GDPR conflict: right to erasure vs. audit immutability

Article 17 GDPR grants individuals the right to erasure. Audit logs contain the actor's identity. Resolution strategies:
1. **Pseudonymisation at write time:** Store `actor.id = hash(user_id + pepper)` in the audit log. The plaintext user ID is stored in a separate mapping table that can be deleted. The audit record remains; the link to the individual is severed.
2. **Encryption with key destruction:** Encrypt sensitive fields with a per-user key. On erasure request, delete the key. Records persist but are unreadable.
3. **Legal basis override:** In many jurisdictions, keeping audit records for legal/compliance purposes overrides the erasure right for those specific records. Document the legal basis.

### 7.5 What audit logs are NOT

Audit logs are not:
- Error logs (those go in operational)
- Performance metrics (those go in metrics)
- Debug traces (those go in diagnostic logs)
- The same as access logs (access logs track all HTTP requests; audit logs track security-relevant actions specifically)

---

## Section 8 — Good vs. Bad Log Entries

### 8.1 BAD → GOOD: Operational log

**❌ Bad:**
```
ERROR: something went wrong
```

Problems: No timestamp context. No structured fields. "Something went wrong" is useless — which service? which operation? what error? No trace correlation.

**✅ Good:**
```json
{
  "timestamp": "2026-06-30T14:23:01.542Z",
  "level": "error",
  "message": "payment processing failed: insufficient funds",
  "service.name": "payment-api",
  "service.version": "2.14.3",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "error.type": "InsufficientFundsError",
  "error.message": "balance 15.00 insufficient for charge 99.99",
  "order_id": "ord_01J3QMNT4A5BHXGPE7F4GKWC9P",
  "user_id": "u_8a3f",
  "amount_requested": 99.99,
  "currency": "EUR",
  "caller": "payment/processor.go:142"
}
```

---

### 8.2 BAD → GOOD: Avoiding log-in-loop noise

**❌ Bad:**
```python
for item in items:  # 10,000 items
    logger.debug(f"Processing item {item.id}")
    process(item)
logger.info("Done")
```
At DEBUG enabled: 10,000 log lines per batch. In production DEBUG enabled accidentally: cost explosion.

**✅ Good:**
```python
logger.debug("starting batch", batch_size=len(items))
for item in items:
    process(item)
logger.info("batch completed", processed=len(items), duration_ms=elapsed_ms)
```

---

### 8.3 BAD → GOOD: Embedding data in message strings

**❌ Bad:**
```
INFO: User 12345 created order ord_9876 for $99.99 at 2026-06-30 14:23:01
```

Problems: All data is embedded in the string — unqueryable. You cannot filter by `user_id=12345` or `amount>50` without regex. The timestamp is in the message and potentially duplicates or conflicts with the envelope timestamp.

**✅ Good:**
```json
{
  "timestamp": "2026-06-30T14:23:01.542Z",
  "level": "info",
  "message": "order created",
  "user_id": "u_12345",
  "order_id": "ord_9876",
  "amount": 99.99,
  "currency": "USD"
}
```

---

### 8.4 BAD → GOOD: Logging inside errors but hiding context

**❌ Bad:**
```go
err := db.QueryRow(...)
if err != nil {
    log.Error("db error")
    return err
}
```

Problems: logs at every error propagation layer (log-and-return anti-pattern — creates duplicate logs); "db error" carries no query context, no operation name, no error type.

**✅ Good:**
```go
user, err := userRepo.GetByID(ctx, userID)
if err != nil {
    // Log ONCE at the boundary where you handle the error
    // Wrap errors and pass them up; log only at the top handler
    return fmt.Errorf("get user %s: %w", userID, err)
}
// At the top-level handler:
logger.Error("request failed",
    "trace_id", traceID,
    "error", err,
    "operation", "get_user",
    "user_id", userID)
```

---

### 8.5 BAD → GOOD: Audit log without complete context

**❌ Bad:**
```json
{"event": "user updated", "time": "today", "level": "info"}
```

Problems: Which user did what to whom? What changed? Success or failure? This is useless for audit purposes.

**✅ Good:**
```json
{
  "@timestamp": "2026-06-30T14:23:01.542Z",
  "event.action": "user.role-change",
  "event.outcome": "success",
  "actor.id": "admin_u_55",
  "actor.type": "admin",
  "resource.type": "user",
  "resource.id": "u_8a3f",
  "change.from": "viewer",
  "change.to": "editor",
  "source.ip": "10.4.2.55",
  "request_id": "req_01J3XYZ",
  "service.name": "iam-service"
}
```

---

## Key Findings Summary

1. **JSON Lines is the dominant production format**; logfmt is preferred in Go/terminal contexts. Both are viable — use a dual-handler approach.
2. **OTEL Log Data Model is the authoritative reference** for field names and severity ranges. Map everything to it when building cross-language conventions.
3. **W3C `traceparent` is the standard for propagating trace context** between services. It provides `trace_id` and `parent_id` without PII.
4. **Three fundamentally different categories** (operational, audit, trace-correlated) require separate pipelines, different retention, and different immutability contracts.
5. **OTEL SeverityNumber 1–24 bridges all major systems** — syslog's 8 levels, Log4j's 5, Python's 5, Go slog's 4.
6. **Audit logs require the actor+action+resource+outcome quadruple**; must be immutable, never sampled, and retained for regulatory periods (up to 7 years).
7. **GDPR pseudonymisation** (not deletion) is the practical resolution for right-to-erasure conflicts in audit logs.
8. **Sampling MUST NOT apply to audit logs**; head/tail sampling for traces is normal and expected.
9. **The canonical log line pattern** (one rich INFO record at request boundary) dramatically reduces noise while preserving diagnostic value.
10. **PII must never appear in traceparent/tracestate** (W3C normative requirement) and should be pseudonymised in all operational logs.

---

## Constraints Discovered

- **Hard:** W3C Trace Context MUST NOT contain PII in `traceparent` or `tracestate` fields (normative, per W3C spec).
- **Hard:** Audit logs MUST NOT be sampled. All audit events must be written.
- **Hard:** Audit log retention periods are non-negotiable regulatory minimums (SOX = 7 years, HIPAA = 6 years, PCI = 12 months accessible).
- **Hard:** OTEL `SeverityNumber=0` means "unspecified" — do not use as a level in practice.
- **Soft:** OTEL recommends `service.name` as REQUIRED in the Resource — every service must set it.
- **Soft:** GELF's `_facility`, `_line`, `_file` fields are deprecated in v1.1 — use additional fields instead.
- **Soft:** ECS tracing fields are at `trace.id` / `span.id`, NOT `tracing.trace_id` (a common mistake when migrating).
- **Soft:** `log-and-return` (logging an error AND returning it for the caller to log again) produces duplicate log entries — log only at the top handler.

---

## Open Questions (Require Architecture/Design Decision)

1. **Audit log tamper evidence level:** Hash chaining vs. WORM storage vs. external blockchain — which is appropriate for the target use case?
2. **PII pseudonymisation strategy for audit logs:** Static hash (fast, simple, irreversible without the pepper) vs. encryption with key management (reversible, more complex) — decision depends on legal jurisdiction and data classification.
3. **Sampling strategy for traces:** Head-based (simpler, loses interesting traces) vs. tail-based (complex, requires buffering) — depends on budget and observability maturity.
4. **Log level for "expected" 4xx errors:** Should `HTTP 400 Bad Request` from user validation failure be logged at WARN, INFO, or DEBUG? (Common debate — no universal standard answer; convention is INFO or DEBUG since it's an expected user error, not a system error.)
5. **Canonical log line scope:** Per-HTTP-request only, or also per-background-job, per-queue-message, per-cron-run? The pattern generalises but the boundary definition is a design decision.
6. **log_id / uid for deduplication:** OTEL's `log.record.uid` is opt-in. Whether to mandate a ULID/UUID per log record depends on whether the pipeline has idempotent deduplication requirements.

---

## Sources

| Source | URL |
|---|---|
| OTEL Log Data Model | https://opentelemetry.io/docs/specs/otel/logs/data-model/ |
| OTEL Resource Semconv | https://opentelemetry.io/docs/specs/semconv/resource/ |
| OTEL Sampling | https://opentelemetry.io/docs/concepts/sampling/ |
| OTEL Supplementary Guidelines | https://opentelemetry.io/docs/specs/otel/logs/supplementary-guidelines/ |
| W3C Trace Context | https://www.w3.org/TR/trace-context/ |
| ECS Field Reference v9.4.0 | https://www.elastic.co/guide/en/ecs/current/ |
| ECS Base Fields | https://www.elastic.co/guide/en/ecs/current/ecs-base.html |
| ECS Tracing Fields | https://www.elastic.co/guide/en/ecs/current/ecs-tracing.html |
| ECS Event Fields | https://www.elastic.co/guide/en/ecs/current/ecs-event.html |
| RFC 5424 (Syslog) | https://datatracker.ietf.org/doc/html/rfc5424 |
| GELF Format v1.1 | https://go2docs.graylog.org/current/getting_in_log_data/gelf_format.html |
| CEF Format | https://www.microfocus.com/documentation/arcsight/arcsight-smartconnectors-8.4/cef-implementation-standard/ |
| logfmt | https://brandur.org/logfmt |
| Canonical Log Lines | https://brandur.org/canonical-log-lines |
