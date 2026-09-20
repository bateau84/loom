# python-observability Assessment Contract

## Review criteria

Reviewer checks instrumentation survives Python concurrency/context and framework boundaries:

- `logging` configuration avoids duplicate handlers/propagation and import-time reconfiguration; structured fields remain stable across libraries;
- `contextvars`/OTel context propagates through async tasks/thread executors/background work without cross-request leakage;
- metric types/units/labels match semantics and avoid unbounded cardinality from exceptions, paths, IDs, or dynamic object reprs;
- spans close on exception/cancellation and preserve parentage/status across async/client/server boundaries;
- exception logging retains useful traceback/cause without duplicate logging at every layer or PII/secret repr leakage;
- exporters/handlers initialize once and flush/shutdown boundedly under ASGI/worker/multiprocess models;
- multiprocess metrics/logging semantics are correct when gunicorn/process workers are used;
- telemetry claims correlate to actual operation outcome rather than intermediate acceptance.

## Adjudication criteria

Critic runs concurrent requests/tasks, executor hops, worker restart/shutdown, exporter failure, and a known error containing sensitive input. Probe duplicate events, context bleed between requests, orphan spans, cardinality explosion, and lost flush.

Block when required diagnostic/security evidence is materially false/missing or telemetry can leak sensitive data/cause serious runtime failure. Cosmetic naming is non-blocking.

## Scaling

Increase depth with async/thread/process concurrency, framework middleware, high volume/cardinality, audit/security use, exporter lifecycle, and SLO dependence.