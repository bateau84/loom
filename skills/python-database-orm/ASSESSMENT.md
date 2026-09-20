# python-database-orm Assessment Contract

## Review criteria

Reviewer traces ORM object/session state rather than trusting generated SQL abstractions:

- session/unit-of-work scope matches request/job/transaction ownership; rollback/close occurs after exceptions and sessions are not shared unsafely across concurrent tasks/threads;
- autoflush, expire-on-commit, identity-map caching, detached objects, and refresh semantics cannot make code observe stale/unexpected state;
- relationship loading strategy avoids hidden N+1/explosive eager joins and does not trigger IO from serialization or after session close unexpectedly;
- cascades/orphan delete/passive delete and database FK behavior match intended lifecycle; deletes cannot fan out surprisingly;
- transaction/isolation/locking/retry semantics preserve invariants under concurrent writers;
- schema/model nullability/default/server-default/enum/type semantics match migrations and database reality;
- async ORM usage does not cross sync/greenlet boundaries incorrectly or hide blocking drivers;
- tests include real-database integration for behaviors the ORM/mock layer cannot prove.

## Adjudication criteria

Critic closes/rolls back the session early, commits then reads expired state, serializes lazy relationships, runs concurrent updates, deletes a parent, retries deadlock/serialization failure, and checks emitted query count where performance is load-bearing.

Block data-integrity/lifecycle/concurrency defects, or when ORM behavior can appear correct in unit tests yet fail against the real DB contract. Query-style preference is non-blocking absent an accepted SLO.

## Scaling

Increase depth with relationship graph complexity, cascades, concurrent writes, async sessions, migrations, large result sets, serialization, and correctness dependence on ORM implicit behavior.