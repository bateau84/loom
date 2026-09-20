# provider-resources Assessment Contract

## Review criteria

Reviewer evaluates Terraform resource/data-source behavior through **plan → apply → refresh → import → drift → destroy**:

- schema required/optional/computed/sensitive/default/validators and model types preserve Terraform null/unknown/known semantics; defaults do not erase explicit zero/false values;
- plan modifiers (`RequiresReplace`, `UseStateForUnknown`, etc.) match remote mutability/stability and do not fabricate known values;
- Create sets stable identity/state only after remote success; uncertain API outcome cannot blindly duplicate resources on retry;
- Read converges remote truth into state, handles not-found/disappears correctly, and does not preserve stale attributes accidentally;
- Update computes from plan/state and performs only intended changes; partial remote failure leaves recoverable/state-consistent behavior;
- Delete treats already-absent as success where appropriate, waits for real deletion when needed, and removes state only with correct semantics;
- import reconstructs sufficient canonical state and subsequent plan is empty or intentionally explained;
- eventual consistency/waiters/retries classify transient vs terminal errors and honor context/timeouts;
- tags/sets/maps/lists/nested objects preserve ordering/hash/normalization semantics and avoid perpetual diff;
- acceptance tests prove basic+update+import+disappears/destroy and any special regression/lifecycle path.

## Adjudication criteria

Critic forces remote success + client timeout, external deletion/drift, import into empty state, unknown values at plan, eventual consistency, update partial failure, and destroy not-found. Ask whether repeated `terraform plan` converges to empty without hiding real drift.

Block state corruption, perpetual/false diff, destructive wrong-target behavior, duplicate creation, import mismatch, or lifecycle semantics that break Terraform convergence. Schema style preference is non-blocking.

## Scaling

Increase depth with mutable/stateful resources, asynchronous APIs, nested schemas, replacement/destruction, import, eventual consistency, remote side effects, and user data loss potential.