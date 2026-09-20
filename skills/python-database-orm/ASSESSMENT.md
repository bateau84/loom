# python-database-orm Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

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
