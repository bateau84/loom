# promql Assessment Contract

## Review criteria

Reviewer validates query mathematics and vector semantics, not just syntax:

- `rate`/`increase` are used on counters with windows long enough for scrape cadence and counter resets; gauges use gauge-appropriate functions;
- denominators and units align; ratios preserve intended labels and handle zero/no-traffic states without NaN/Inf being mistaken for health;
- vector matching (`on`/`ignoring`, `group_left/right`) has known cardinality and cannot silently many-to-many/drop series;
- aggregation keeps/drops exactly the dimensions needed; `sum by` vs `sum without` behavior matches future labels;
- histogram quantiles aggregate buckets with `le` correctly and use compatible bucket schemas; percentiles are not averaged;
- absent/staleness/no-data semantics are explicit; `or vector(0)` is not used to mask ingestion/scrape failure when absence matters;
- label regex/filter and subquery/range/offset semantics match the intended population/time comparison;
- query cost/cardinality is acceptable for dashboard/alert frequency.

## Adjudication criteria

Critic tests no traffic, missing target, counter reset, one missing region, new label dimension, zero denominator, histogram bucket mismatch, and duplicate vector keys. Ask whether a plausible wrong system state yields the same scalar/graph.

Block when a load-bearing alert/SLI/dashboard query can materially misclassify health. Equivalent query style is non-blocking.

## Scaling

Increase depth with SLO/alert consequence, multi-dimensional joins, histograms, recording-rule chains, no-data semantics, large cardinality, and complex time/subquery logic.