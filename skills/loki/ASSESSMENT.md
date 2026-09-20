# loki Assessment Contract

## Review criteria

Reviewer checks Loki around its defining constraint: labels are indexed metadata, log bodies are not.

- stream labels are low-cardinality/stable dimensions; request IDs, user IDs, raw URLs/errors and other high-cardinality values remain log fields/structured metadata unless strongly justified;
- parsers/patterns/regex/logfmt/json stages match real line shape and parse failures are visible rather than silently producing empty labels/zero values;
- line filters are placed early where possible and queries avoid unnecessary broad scans/expensive regex over huge ranges;
- metric queries distinguish line count/rate/bytes/unwrapped values and handle parser errors, units, grouping and absent streams correctly;
- structured metadata vs labels is chosen according to query/index needs; relabel/drop stages do not destroy required diagnostics;
- tenancy/auth/retention/object-store/compactor/ingestion limits match operational policy in deployed Loki, not just local query syntax;
- “no logs” is distinguished from zero events/healthy service/ingestion outage;
- sensitive data is redacted before durable log storage/query exposure.

## Adjudication criteria

Critic creates a high-cardinality label, malformed log line, missing stream, empty tenant, retention boundary, and broad long-range query. Ask whether the query returns plausible numbers even when parsing failed or logs stopped arriving.

Block when load-bearing diagnosis/alerting materially lies, tenant/security/retention boundaries fail, or label/query design can cause serious availability/cost impact. Minor query style is non-blocking.

## Scaling

Increase depth with ingest volume/cardinality, tenant count, retention, broad query ranges, parser diversity, alert/SLO use, sensitive logs, and distributed Loki architecture.