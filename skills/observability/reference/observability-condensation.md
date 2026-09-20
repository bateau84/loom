# Logging & Tracing — Core Principles
### Plain-language condensation of the observability research report

---

## The Big Idea First

A log is a **timestamped record that something happened**. But not all logs are created equal. There are three fundamentally different *kinds* of logs, each serving a different master.

---

## The Three Kinds of Logs

### 1. 🔧 Operational / Diagnostic Logs
> *"What is the system doing right now — and why is it broken?"*

These are the notes a system leaves for its **engineers**. They answer questions like: "Why did the server slow down at 2pm?" or "Which database query failed?"

- **Lifespan:** Short — hours to 3 months. Cost drives deletion.
- **Volume:** High — potentially millions per hour.
- **Can be dropped or sampled?** Yes. If you're logging 10,000 things per second, you can keep 1% and still spot patterns.
- **Sharp edge:** If you leave DEBUG mode on in production by accident, costs can explode overnight. These logs must have an on/off switch per level.

---

### 2. 🏛️ Audit Logs
> *"Who did what, to what, and did it succeed — forever."*

These are the **legal record**. They answer questions like: "Who deleted that user account at 3am?" or "Who exported the customer list on May 4th?"

- **Lifespan:** Long — years. Laws dictate minimums (financial records: 7 years; healthcare: 6 years; payment cards: 1 year).
- **Volume:** Low — only security-relevant actions.
- **Can be dropped or sampled?** **NEVER.** Dropping an audit log is a compliance crime.
- **Must be immutable.** Nobody — including your own engineers — should be able to alter or delete them. This is enforced technically (write-once storage), not just by policy.
- **Sharp edge #1 (GDPR):** You're legally required to record WHO did something (PII). But you're also legally required to "forget" people on request. The solution is **pseudonymisation** — you store a scrambled version of their identity. The audit log stays; the link to the real person gets deleted. This is complex, and if you get it wrong, you've either broken your audit trail or violated privacy law.
- **Sharp edge #2:** Audit logs travel on a **separate pipeline** from all other logs. If your system gets overwhelmed, operational logs can be shed — audit logs cannot.

---

### 3. 🕸️ Trace-Correlated Logs
> *"Follow a single request through 12 services and show me exactly what happened, step by step."*

Modern apps are made of dozens of services talking to each other. A single button-click from a user might touch 12 services. **Tracing** stitches all of that together into one timeline. Logs that carry a trace ID become part of that timeline.

- **Lifespan:** Days to weeks.
- **Can be sampled?** Yes — at very high traffic, you typically record 1% of requests in full detail. But when something goes wrong, you capture 100% of errors.
- **Sharp edge:** A log can point to a trace that no longer exists (because it was sampled out). Tools must handle this gracefully — show the trace ID even when there's no trace to navigate to.

---

## The Log Entry Itself — What Goes Inside

Think of a log entry like a **structured form**, not a diary. Every field has a name and a value. This makes logs searchable and sortable by machines.

### The Four Fields Every Log *Must* Have

| Field | What it is | Example |
|---|---|---|
| **Timestamp** | Exact moment it happened, in UTC | `2026-06-30T14:23:01.542Z` |
| **Level** | How serious is this? | `INFO`, `WARN`, `ERROR` |
| **Message** | One sentence a human can read | `"payment processing failed"` |
| **Service name** | Which system sent this | `"payment-api"` |

### The Fields That Make Logs Useful (Not Mandatory, But Close)

| Field | Why it matters |
|---|---|
| `trace_id` | Ties this log to a distributed trace (the 12-service journey) |
| `span_id` | The specific step in that journey |
| `error.type` / `error.message` | What actually failed, precisely |
| `request_id` | A simpler ID when there's no trace infrastructure yet |
| `service.version` | Which release was running when this happened |
| `environment` | `production` vs `staging` — critical for not mixing them up |
| `caller` | File and line number where the log was emitted |

---

## Severity Levels — The Alarm Dial

All major logging systems agree on the same six bands, even if they spell them differently:

| Level | Meaning | Wake someone up? |
|---|---|---|
| **TRACE** | Every tiny internal step. For developer debugging only. Never in production. | No |
| **DEBUG** | Significant internal decisions. Turned OFF in production by default; toggled on during incidents. | No |
| **INFO** | Normal business events: user logged in, order placed, job completed. | No |
| **WARN** | Something unexpected happened but we recovered: retried successfully, approaching a limit, using a deprecated feature. | Maybe (trends) |
| **ERROR** | An operation failed and the system couldn't fix it itself: database query failed, email not sent. | Yes (on-call) |
| **FATAL / CRITICAL** | The system is going down or is in an unrecoverable state. Exit imminent. | Yes (immediate) |

**Sharp edge:** The hardest question in logging is whether to log an `ERROR` or a `WARN`. The rule: if *your system* failed, it's an `ERROR`. If *the user* gave you bad input and you returned a clean error message to them, that's `INFO` or `DEBUG` — because your system worked exactly as designed.

---

## The Formats — How Logs Are Written on the Wire

There are two dominant production formats, and they represent a genuine trade-off:

### JSON Lines
```json
{"timestamp":"2026-06-30T14:23:01Z","level":"info","message":"order created","order_id":"ord_9876","amount":99.99}
```
✅ Machines love it — queryable, typed, indexable by every log tool.  
❌ Humans hate it in a terminal — requires a tool like `jq` to read.

### logfmt
```
level=info msg="order created" order_id=ord_9876 amount=99.99
```
✅ Humans can read it straight in a terminal.  
❌ Flat only — can't represent nested data. No formal standard.

**The industry solution:** Write JSON in production (shipped to a log aggregator) and use a human-readable format on the developer's terminal. Most modern logging libraries support both simultaneously.

---

## Other Notable Formats

### ECS (Elastic Common Schema)
Not a wire format — it's a **naming convention** that tells you what to call your fields. Use `trace.id` not `traceId`, use `@timestamp` not `time`, use `event.action` not `action`. It standardises how JSON fields are named so that Elasticsearch (and other tools) can understand logs from any service the same way.

### OTEL Log Data Model
OpenTelemetry's specification for what a log record *is*, at a data model level. Defines typed top-level fields (Timestamp, TraceId, SpanId, SeverityNumber, Body) plus an open-ended Attributes bag. It's the Rosetta Stone that maps every other logging system onto a single common schema — the authoritative reference for cross-language interoperability.

### Syslog (RFC 5424)
The UNIX/networking original. Still used for infrastructure and system logs. Defines both a wire protocol (how to transmit logs) and severity levels (0 = Emergency down to 7 = Debug). Its numering is inverted from most modern systems (0 is worst, not best), which trips up developers migrating from modern libraries.

### GELF (Graylog)
A JSON-over-UDP format designed to fix syslog's 1024-byte limit. Custom fields must be prefixed with `_`. Mainly used when sending logs directly to a Graylog server.

### CEF (Common Event Format)
A pipe-delimited SIEM format from ArcSight/Micro Focus. Used for security device integration (firewalls, IDS, WAF), not application logging. You will encounter it in security contexts.

---

## Tracing — The Extra Dimension

Tracing is **not logging**, but they work together. Here's the distinction:

| | Log | Trace/Span |
|---|---|---|
| **Records** | That an event happened | That an operation *ran* (with start + end time) |
| **Structure** | Flat list of records | A tree of parent→child operations |
| **Volume** | Very high | Lower (5–50 spans per user request) |
| **Question answered** | "What happened at this moment?" | "How long did this take and who called whom?" |

The **W3C Trace Context** standard (`traceparent` header) is how services pass the trace ID to each other across network calls. It looks like:
```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ^^^^^^^^^^^^^^^^ ^^
                     trace ID (shared forever)      current span   sampled=yes
```

**Critical rule:** This header must NEVER contain personal information — it's a routing ID, not a data field.

OpenTelemetry (OTEL) is the open standard that unifies logs, traces, and metrics into one pipeline. When your log is emitted inside an active trace, OTEL automatically injects the `trace_id` and `span_id` — creating a hard link you can click to navigate from a log to its full request timeline.

---

## The Sharp Edges (Summary Table)

| Edge | What it means in practice |
|---|---|
| **Audit logs can never be sampled or dropped** | Build a separate, isolated pipeline. Treat backpressure as a P0 incident, not a log loss shrug. |
| **GDPR + audit immutability is a genuine conflict** | Pseudonymise actor IDs at write time, or use per-user encryption keys. There is no other clean solution. |
| **Debug logs left on in production = surprise bill** | Dynamic level control (an API to change log levels without restarting) is essential infrastructure. |
| **Log-and-rethrow creates duplicate entries** | Log errors exactly once — at the top-level handler where you decide what to do with them, not at every layer that passes them up. |
| **Putting data in the message string makes it unqueryable** | `"user 12345 paid $99"` in a string is useless for aggregation. `user_id=12345, amount=99` as separate fields is searchable. |
| **Trace IDs must NOT contain PII** | W3C normative requirement. Using an email or user ID as a trace ID is a privacy violation. |
| **Retention costs are real** | 10x more log verbosity = 10x cloud storage bill. The canonical log line pattern (one rich entry per request boundary) is a deliberate cost optimisation, not just aesthetics. |
| **Plain text logs feel simple but become a trap** | At scale, parsing free-text logs with regex is expensive, fragile, and breaks every time the format changes. Structured fields from day one. |
| **Synchronous audit writes are mandatory** | Async buffering is fine for operational logs. For audit logs, an in-memory buffer that hasn't flushed before a crash means evidence is gone. |
| **Cardinality explosion in metrics** | Never use a user ID or request ID as a *label key* in a metrics system. Fine in logs as a *value*, catastrophic in Prometheus-style time series as a *dimension*. |

---

## What a Good vs. Bad Log Looks Like

**❌ Bad — operational:**
```
ERROR: something went wrong
```
Nobody knows what, where, which service, which user, or how to find it.

**✅ Good — operational:**
```json
{
  "timestamp": "2026-06-30T14:23:01.542Z",
  "level": "error",
  "message": "payment processing failed: insufficient funds",
  "service.name": "payment-api",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "error.type": "InsufficientFundsError",
  "order_id": "ord_01J3QMNT",
  "amount_requested": 99.99,
  "currency": "EUR"
}
```
An engineer who has never seen this service before can understand what happened, find the full trace, and know exactly which order to investigate.

**❌ Bad — audit:**
```json
{"event": "user updated", "time": "today", "level": "info"}
```
Which user? Updated what? By whom? Succeeded? Completely useless as an audit record.

**✅ Good — audit:**
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

## The Canonical Log Line Pattern

Instead of logging dozens of small events per request, emit **one rich record at the request boundary** that collects everything worth knowing:

```json
{
  "timestamp": "2026-06-30T14:23:01.542Z",
  "level": "info",
  "message": "POST /payments",
  "service.name": "payment-api",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "http.method": "POST",
  "http.path": "/payments",
  "http.status": 200,
  "latency_ms": 142,
  "user_id": "u_8a3f",
  "order_id": "ord_01J3QMNT",
  "amount": 99.99,
  "currency": "EUR"
}
```

This one line replaces 20 smaller INFO lines and is far cheaper to store, ship, and query.

---

## What This Points Toward in a Skill

The research confirms three independent but interrelated concerns for a logging skill:

1. **Operational logging** — structured fields, severity contracts, canonical log lines, level control, cost discipline, single-point error logging
2. **Audit logging** — actor+action+resource+outcome schema, immutability, separate pipeline, regulatory retention, GDPR pseudonymisation
3. **Trace correlation** — W3C `traceparent`, OTEL log bridge, `trace_id`/`span_id` in every log, head vs. tail sampling strategy

These must NOT be collapsed into one concept. They have different rules, different infrastructure requirements, and different failure consequences.

---

## Open Questions Before Skill Authoring

1. **Tamper evidence level for audit logs:** Hash chaining (cheap, detects gaps) vs. WORM storage (foolproof, costs money) vs. both?
2. **PII pseudonymisation strategy:** Static hash+pepper (simple, irreversible) vs. per-user encryption key (reversible, complex)?
3. **Trace sampling strategy:** Head-based (simple) vs. tail-based (captures interesting traces, requires buffering)?
4. **Log level for expected user errors (HTTP 400):** INFO or DEBUG? No universal standard — needs a project convention.
5. **Canonical log line scope:** HTTP requests only, or also background jobs, queue messages, cron runs?
6. **Deduplication requirement:** Should every log record carry a ULID/UUID for idempotent pipeline processing?
