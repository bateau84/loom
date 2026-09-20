# observability Assessment Contract

## Review criteria

Reviewer starts from the operational questions/invariants that must be answerable, then checks signals:

- each load-bearing failure/state transition has enough metrics/logs/traces/events to distinguish cause classes rather than merely prove “something failed”;
- correlation identity survives service/async boundaries and timestamps/timezones/sampling do not make evidence impossible to join;
- metrics use appropriate type/unit/denominator/window/cardinality; logs preserve structured context; traces sample/propagate in a way compatible with the diagnosis claim;
- dashboards/alerts distinguish absence/staleness/telemetry outage from healthy zero values;
- SLI/SLO measurements correspond to user/product outcomes or explicitly state the proxy and its blind spots;
- telemetry volume/cardinality/sampling/retention has a bounded cost and cannot itself overload the system;
- secrets/PII/audit data are governed and access/retention match sensitivity;
- observability failure degrades diagnosis, not product correctness, unless explicitly designed otherwise.

## Adjudication criteria

Critic injects a known failure and asks whether an operator can reconstruct **what failed, for whom, where, and whether recovery worked** without reading source. Then remove one signal/collector, create no-traffic, high-cardinality, partial failure and sampled traces to expose false confidence.

Block when an accepted operational/security/audit guarantee is unobservable or telemetry materially lies/leaks/causes outage. More telemetry is not inherently better.

## Scaling

Increase depth with distribution/async workflows, SLO/audit dependence, security/privacy, sampling, signal volume/cardinality, external dependencies, and operational consequence.