# performance Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

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
