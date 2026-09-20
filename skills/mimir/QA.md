# mimir Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic kills an ingester during writes, changes tenant header between write/read, saturates ingestion limits, queries data after active blocks moved to object storage, rolls components with version skew, and simulates object-store/compactor/store-gateway failure.

Block when tenant isolation, metric durability/queryability, accepted availability, or retention semantics can fail. Capacity tuning is non-blocking unless it violates an accepted SLO/cost/resource bound.

## QA depth

Increase depth with tenant count, active series/ingest rate, replication/topology, object-store durability, retention, HA producers, query scale, and upgrade/rollback complexity.
