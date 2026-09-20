# prometheus Assessment Contract

## Review criteria

Reviewer checks instrumentation/storage/query assumptions around Prometheus’s pull/counter/staleness model:

- metric type/name/unit follows semantics: counters only increase/reset, gauges represent current values, histograms/summaries are chosen according to aggregation needs;
- labels are bounded stable dimensions; IDs/raw paths/errors/user input cannot explode series cardinality;
- scrape target/service discovery/relabeling retains intended targets/labels and cannot silently drop an environment/tenant;
- scrape interval/timeout/staleness and application update rate support the claimed detection/window;
- histogram buckets are useful for target latency ranges and aggregation uses the correct `le` dimensions; summaries are not incorrectly aggregated across instances;
- recording/alert rules preserve units/labels/denominators and evaluate often enough for `for` semantics;
- HA/remote-write duplicate/out-of-order behavior is understood where multiple replicas/backends exist;
- missing target/series is distinguishable from a healthy zero.

## Adjudication criteria

Critic resets counters, removes a scrape target, creates high-cardinality labels, aggregates histograms across instances, sends zero traffic, and changes relabeling. Ask whether the resulting graph/alert can look healthy under missing data.

Block when load-bearing SLI/alerting is materially false or instrumentation can cause serious cardinality/resource failure. Cosmetic metric naming is proportional unless public/standard contracts depend on it.

## Scaling

Increase depth with series cardinality/ingest scale, SLO/alert use, histograms, service discovery/relabeling, HA/remote_write, and multi-tenant/environment aggregation.