# golang-database Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer traces persistence through `database/sql` (or equivalent) as a transactional resource:

- transaction boundaries include all-or-nothing work; `BeginTx` context/isolation and rollback-on-error/commit error are handled correctly;
- queries use parameters for values; dynamic identifiers/fragments are allowlisted/constructed safely rather than interpolating untrusted data;
- `Rows`/statements/connections are closed, `rows.Err()` is checked, and context cancellation/timeouts reach the driver;
- `sql.ErrNoRows`, NULL scanning, type conversion, affected-row semantics, and driver-specific errors are classified intentionally;
- connection pool settings/lifetimes match workload and do not create starvation/leak/stale-connection pathologies;
- concurrency/isolation assumptions address lost update, write skew, lock ordering, retries, and idempotency where relevant;
- schema/migration compatibility supports mixed application versions/rollback when required;
- integration evidence uses the real DB semantics for claims mocks cannot prove.
