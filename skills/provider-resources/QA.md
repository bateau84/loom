# provider-resources Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic forces remote success + client timeout, external deletion/drift, import into empty state, unknown values at plan, eventual consistency, update partial failure, and destroy not-found. Ask whether repeated `terraform plan` converges to empty without hiding real drift.

Block state corruption, perpetual/false diff, destructive wrong-target behavior, duplicate creation, import mismatch, or lifecycle semantics that break Terraform convergence. Schema style preference is non-blocking.

## QA depth

Increase depth with mutable/stateful resources, asynchronous APIs, nested schemas, replacement/destruction, import, eventual consistency, remote side effects, and user data loss potential.
