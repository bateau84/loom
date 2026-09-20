# python-database-orm Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic closes/rolls back the session early, commits then reads expired state, serializes lazy relationships, runs concurrent updates, deletes a parent, retries deadlock/serialization failure, and checks emitted query count where performance is load-bearing.

Block data-integrity/lifecycle/concurrency defects, or when ORM behavior can appear correct in unit tests yet fail against the real DB contract. Query-style preference is non-blocking absent an accepted SLO.

## QA depth

Increase depth with relationship graph complexity, cascades, concurrent writes, async sessions, migrations, large result sets, serialization, and correctness dependence on ORM implicit behavior.
