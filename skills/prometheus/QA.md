# prometheus Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic resets counters, removes a scrape target, creates high-cardinality labels, aggregates histograms across instances, sends zero traffic, and changes relabeling. Ask whether the resulting graph/alert can look healthy under missing data.

Block when load-bearing SLI/alerting is materially false or instrumentation can cause serious cardinality/resource failure. Cosmetic metric naming is proportional unless public/standard contracts depend on it.

## QA depth

Increase depth with series cardinality/ingest scale, SLO/alert use, histograms, service discovery/relabeling, HA/remote_write, and multi-tenant/environment aggregation.
