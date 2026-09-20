# observability Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic injects a known failure and asks whether an operator can reconstruct **what failed, for whom, where, and whether recovery worked** without reading source. Then remove one signal/collector, create no-traffic, high-cardinality, partial failure and sampled traces to expose false confidence.

Block when an accepted operational/security/audit guarantee is unobservable or telemetry materially lies/leaks/causes outage. More telemetry is not inherently better.

## QA depth

Increase depth with distribution/async workflows, SLO/audit dependence, security/privacy, sampling, signal volume/cardinality, external dependencies, and operational consequence.
