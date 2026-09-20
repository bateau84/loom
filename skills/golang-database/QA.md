# golang-database Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic interrupts between writes, forces commit/deadlock/timeout errors, runs concurrent writers, returns NULL/no-row/duplicate data, and retries uncertain outcomes. Probe partial commit, double side effect, connection leak, unsafe SQL construction, and schema skew.

Block when data integrity/persistence semantics, security, or recovery can fail plausibly. Query style/performance preferences are non-blocking unless tied to an accepted SLO/resource guarantee.

## QA depth

Increase depth with concurrent writers, multi-statement transactions, retries/side effects, migrations, destructive schema changes, high data volume, and recovery/compatibility consequence.
