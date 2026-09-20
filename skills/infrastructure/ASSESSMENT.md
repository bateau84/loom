# infrastructure Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

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
