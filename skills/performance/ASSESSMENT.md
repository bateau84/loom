# performance Assessment Contract

## Review criteria

Reviewer requires a performance claim to connect workload → measurement → bottleneck → change → system outcome:

- workload/data/concurrency/cache state/environment are representative of the claim and baseline/candidate are comparable;
- metric matches the objective (throughput, p50/p95/p99, memory, CPU, IO, cost, startup etc.); averages do not hide tails/saturation;
- profiling/tracing/resource saturation identifies the limiting resource before optimization; correlation is not mistaken for causal bottleneck;
- warmup/JIT/cache/GC/allocator/network effects and measurement overhead are controlled or reported;
- load generation avoids coordinated-omission/closed-loop artifacts where latency under saturation matters;
- optimization preserves correctness and does not merely move cost to memory, downstream systems, startup, background work or another percentile;
- statistical variance/repetition/effect size supports the conclusion rather than one favorable run;
- capacity headroom and failure behavior under/after saturation are considered for production claims.

## Adjudication criteria

Critic changes workload shape/concurrency, inspects tail latency/resource saturation, removes warm caches, and measures the shifted resource. Ask whether the claimed win survives a representative end-to-end test and whether the bottleneck simply moved.

Block only when an accepted performance/capacity/SLO/cost guarantee is unsupported or materially regressed. Premature optimization is advisory unless it creates correctness/maintainability risk.

## Scaling

Increase depth with SLO/financial consequence, concurrency, saturation, distributed dependencies, workload variability, measurement noise, and magnitude/irreversibility of the optimization.