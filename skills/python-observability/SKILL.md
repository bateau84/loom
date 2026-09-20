---
name: python-observability
description: "Production observability for Python services — structured JSON logging (stdlib logging + python-json-logger), log levels and the named-logger hierarchy, Prometheus metrics with prometheus-client (Counter/Gauge/Histogram), a /metrics endpoint, correlation/context fields, and OpenTelemetry tracing. Use when adding logging, instrumenting metrics, exposing a metrics endpoint, designing log structure, or wiring tracing into a Python service. Also use when the user mentions logging, structured logs, Prometheus, metrics, tracing, or OpenTelemetry in Python."
license: MIT
metadata:
  author: Bateau
  version: "1.1.0"
---

> **House skill.** Follow `python-common-practice` and `current Loom role directive and control-plane state`. Pairs with `python-error-handling` (logging failures) and `python-fastapi` (the `/metrics` route).

**Persona:** You are a Python service engineer. You instrument for the incident you haven't had yet — logs you can query, metrics you can alert on.

# Observability

Three always-on signals: **logs** (what happened), **metrics** (how much/how often), **traces** (where time went). Instrument at boundaries — request in, external call out, job start/end — not on every line.

## Structured logging with the stdlib

Use the `logging` module with **named loggers** per module, never `print`. The name builds a hierarchy you can configure and filter (sortarr uses `logging.getLogger("sortarr.config")`, `"sortarr.api")`, etc.).

```python
import logging
log = logging.getLogger(__name__)     # module-scoped, hierarchical
```

- Get the logger at module level; never `logging.info(...)` on the root logger directly.
- Configure handlers/levels **once** at startup (in `__main__`/lifespan), not in libraries. A library that calls `basicConfig` hijacks the host app's config.
- Use lazy `%`-style args — `log.info("synced %s tracks", n)` — not f-strings. The format string is only rendered if the level is enabled, and the args stay as structured fields.

## JSON logs in production

Human-readable lines don't survive log aggregation. Emit JSON with `python-json-logger` so each field is queryable; keep a plain formatter for local dev (sortarr's `log_file` setting chooses the sink).

```python
from pythonjsonlogger import jsonlogger

handler = logging.StreamHandler()
handler.setFormatter(jsonlogger.JsonFormatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
logging.getLogger().addHandler(handler)
logging.getLogger().setLevel(level)
```

Attach context as fields, not string interpolation, so you can filter by them:

```python
log.info("playlist synced", extra={"playlist_id": pid, "added": n, "skipped": s})
```

Log levels carry meaning — the deciding question is _whose fault is it?_

- **ERROR** — *your system* failed and could not recover (DB unreachable, unhandled exception, 5xx). Use `log.exception(...)` inside `except` to capture the traceback.
- **WARNING** — something unexpected happened but the system recovered (retry succeeded, approaching a limit, deprecated path).
- **INFO** — a normal business event at a boundary (request handled, job completed). If the caller sent bad input and you returned a clean 4xx, that is INFO or DEBUG — your system worked as designed.
- **DEBUG** — diagnostic detail, off in production by default.
- **CRITICAL** — the process cannot continue.

The most common noise source is logging every user-error (HTTP 400/422) as ERROR. Resist it: the system is not broken, the input was. Default production level to `WARNING`/`INFO`, not `DEBUG`.

## Metrics with prometheus-client

Define metric objects **once at module scope** (re-creating a Counter raises a duplicate-registration error). Name them `app_subject_unit` with a stable label set. This mirrors sortarr's `metrics.py`.

```python
from prometheus_client import Counter, Histogram, Gauge

videos_added_total = Counter("sortarr_videos_added_total", "Videos added to playlists")
videos_skipped_total = Counter("sortarr_videos_skipped_total", "Videos skipped", ["reason"])
pipeline_duration_seconds = Histogram(
    "sortarr_pipeline_duration_seconds", "Pipeline run duration",
    buckets=[30, 60, 120, 300, 600, 1800, 3600],
)
last_pipeline_status = Gauge("sortarr_last_pipeline_status", "1=success 0=fail")
```

Pick the right instrument:

| Type | Use for | Example |
| --- | --- | --- |
| `Counter` | monotonic totals (only goes up) | requests, errors, items processed |
| `Gauge` | a value that goes up and down | in-flight jobs, queue depth, last status |
| `Histogram` | distributions / latency (gives quantiles + buckets) | request/job duration |

Update them at the boundary, and time with the context manager so it records even on error:

```python
with pipeline_duration_seconds.time():
    run_pipeline()
videos_skipped_total.labels(reason="duplicate").inc()
```

**Label cardinality is the trap.** Labels must be a small bounded set (`reason`, `endpoint`, `status`). Never label with a user ID, playlist ID, URL, or timestamp — each value creates a new time series and will eventually OOM the scrape target. High-cardinality data belongs in logs/traces, not metric labels.

## The /metrics endpoint

Expose metrics for Prometheus to scrape. With FastAPI, mount the ASGI app:

```python
from prometheus_client import make_asgi_app
app.mount("/metrics", make_asgi_app())
```

## Tracing (OpenTelemetry)

When you need to follow a request across services or async hops, add OpenTelemetry. The FastAPI/httpx instrumentations auto-create spans for inbound requests and outbound calls; add manual spans around expensive domain steps. Propagate context across `await` boundaries so one trace spans the whole operation. Adopt tracing when logs+metrics can't answer "where did the time go" — it's heavier than the other two.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| `print()` for diagnostics | Use a named `logging` logger. |
| `basicConfig`/handlers configured in a library | Configure once at app entry point only. |
| f-strings in log calls | Lazy `%` args + `extra={}` fields — cheaper and queryable. |
| Counter/Gauge created inside a function | Define once at module scope. |
| High-cardinality metric labels (IDs, URLs) | Use a bounded label set; put IDs in logs/traces. |
| `log.error` for an exception | `log.exception(...)` inside `except` to capture the traceback. |
| Plain-text logs to a log aggregator | JSON formatter in production. |

**Diagnose:** 1- `curl localhost:PORT/metrics` — confirm series exist and labels aren't exploding 2- count distinct label combinations per metric — a metric with thousands of series signals a cardinality bug 3- set the logger to `DEBUG` temporarily to confirm a path is even reached.

## Cross-References

See the `observability` skill for the language-agnostic standard (three pillars, log categories, severity contract, audit hard rules, economics). This skill is the Python mechanics layer.

## References

- [logging — Logging facility for Python](https://docs.python.org/3/library/logging.html)
- [Logging HOWTO](https://docs.python.org/3/howto/logging.html)
- [prometheus-client (Python)](https://prometheus.github.io/client_python/)
- [OpenTelemetry Python](https://opentelemetry.io/docs/languages/python/)
