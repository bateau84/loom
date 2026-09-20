# python-database Assessment Contract

## Review criteria

Reviewer checks DB access as transactional/resource behavior independent of framework convenience:

- parameter binding is used for values; dynamic identifiers/fragments are allowlisted rather than interpolated from untrusted input;
- transaction scope, commit/rollback, isolation, savepoints, retries, and partial-success semantics match accepted invariants;
- connection/cursor/result resources close on all paths and pool sizing/timeouts cannot deadlock the application under expected concurrency;
- `None`/NULL, decimal/timezone/binary/JSON/type conversion preserves domain semantics rather than silently coercing;
- no-row/many-row/duplicate-key/deadlock/serialization/timeout errors are classified for the right recovery behavior;
- streaming/batch queries bound memory and respect cancellation;
- migrations and mixed-version application compatibility are considered where schema changes accompany access code;
- integration tests use the actual database dialect/features for claims mocks cannot establish.

## Adjudication criteria

Critic interrupts between writes, forces commit/deadlock/timeout, returns NULL/duplicates, retries an uncertain side effect, and saturates the pool. Probe injection through dynamic SQL pieces and cleanup after generator/stream abandonment.

Block data-integrity/security/recovery/resource defects. Query aesthetics or ORM-vs-driver preference are non-blocking if guarantees remain sound.

## Scaling

Increase depth with multi-step transactions, concurrent writers, retries, streaming, pool pressure, migrations, dialect-specific behavior, and destructive/data-loss consequence.