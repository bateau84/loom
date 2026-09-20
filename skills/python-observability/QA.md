# python-observability Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic runs concurrent requests/tasks, executor hops, worker restart/shutdown, exporter failure, and a known error containing sensitive input. Probe duplicate events, context bleed between requests, orphan spans, cardinality explosion, and lost flush.

Block when required diagnostic/security evidence is materially false/missing or telemetry can leak sensitive data/cause serious runtime failure. Cosmetic naming is non-blocking.

## QA depth

Increase depth with async/thread/process concurrency, framework middleware, high volume/cardinality, audit/security use, exporter lifecycle, and SLO dependence.
