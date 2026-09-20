# infrastructure Assessment Contract

## Review criteria

Reviewer evaluates infrastructure as a stateful, failure-prone control system:

- desired state, current state/drift and ownership are explicit; apply/rollout cannot accidentally adopt/delete resources outside the intended authority boundary;
- dependency/order and eventual consistency are modeled where providers/control planes are asynchronous;
- replacement/destroy semantics, data persistence, backups, migration and rollback/backout are understood before applying irreversible changes;
- IAM/network/secrets/encryption boundaries use least privilege and secure defaults; bootstrap/admin exceptions are visible and time-bounded where possible;
- availability/capacity/quota/region/AZ failure modes and scaling assumptions match accepted SLOs;
- config/state/locks/credentials are protected and recoverable; concurrent operators/automation cannot silently race the same ownership domain;
- cost/resource limits and leak cleanup are considered for autoscaling/ephemeral/test resources;
- plan/diff evidence is tied to the actual target/workspace/account/region and reviewed before execution when consequential;
- monitoring/diagnosis/rollback signals exist for the changed infrastructure path.

## Adjudication criteria

Critic simulates partial apply, provider timeout after remote success, concurrent operator, region/AZ dependency failure, quota exhaustion, drift, rollback after state/schema changed, and destroy/recreate of a stateful resource. Probe “plan is green” assumptions that ignore control-plane runtime behavior.

Block when accepted availability/data/security/authority guarantees can be violated, irreversible destruction/migration lacks controlled path, or target/state identity is ambiguous. Cost/style optimization is proportional unless tied to an accepted budget/SLO.

## Scaling

Increase depth with destructive/stateful changes, IAM/secrets/network perimeter, cross-region/AZ design, control-plane eventual consistency, shared state/automation, cost blast radius, and rollback difficulty.