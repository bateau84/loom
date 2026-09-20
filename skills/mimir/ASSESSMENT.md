# mimir Assessment Contract

## Review criteria

Reviewer checks Mimir as a distributed multi-tenant TSDB, not just a Prometheus-compatible endpoint:

- `X-Scope-OrgID`/auth propagation isolates tenant writes, reads, rules and limits; write/read tenant mismatch cannot look like “no data” without diagnosis;
- ingester/distributor/memberlist/ring configuration and replication/quorum preserve availability/durability through pod/node failure and rollout;
- object-store credentials/bucket/layout, TSDB shipping, store-gateway synchronization and compactor operation make old blocks durable/queryable; filesystem backends stay dev-only unless explicitly accepted;
- retention/deletion/compaction and per-tenant ingestion/series/query limits match policy and cannot silently drop/throttle important data;
- remote_write/OTLP semantics, HA deduplication/external labels and out-of-order samples align with producers;
- query-frontend/querier/store-gateway caches/splitting improve performance without hiding stale/partial data;
- readiness and self-metrics distinguish ring joining, storage failure, rate limiting and query problems;
- Helm/topology changes preserve component compatibility and safe rollout/rollback.

## Adjudication criteria

Critic kills an ingester during writes, changes tenant header between write/read, saturates ingestion limits, queries data after active blocks moved to object storage, rolls components with version skew, and simulates object-store/compactor/store-gateway failure.

Block when tenant isolation, metric durability/queryability, accepted availability, or retention semantics can fail. Capacity tuning is non-blocking unless it violates an accepted SLO/cost/resource bound.

## Scaling

Increase depth with tenant count, active series/ingest rate, replication/topology, object-store durability, retention, HA producers, query scale, and upgrade/rollback complexity.