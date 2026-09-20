# python-observability Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

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
