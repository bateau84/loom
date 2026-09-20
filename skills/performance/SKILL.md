---
name: performance
description: Use when investigating latency reports, designing performance-critical systems, or reviewing code where response time, throughput, or resource consumption could regress — when measurement before optimization, percentile analysis, or profiling methodology would prevent premature or wrong fixes.
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

## When to load

- **architect** — designing a performance-critical system
- **worker** — implementing a hot path or data-intensive operation
- **reviewer** — reviewing a PR that touches a hot path, query, or cache
- **research** — investigating a reported slowness or latency spike

## The 5 rules

### 1. Read the data before forming a hypothesis.
p50 fine + p99 bad is a tail problem, not a slow endpoint. Bimodal distributions (fast + slow requests) differ from a smooth long tail. Identify which shape the data has before suggesting a fix. Before diagnosing on a percentile, confirm the tail with p99.9 — p99 worse than p99.9 is reverse tail, usually a measurement artifact.

### 2. Convert latency into user-impact numbers.
"p99=8s" is abstract. "5,000 requests/day take >8s; 10-second complaints are p99.9 (~50/day)" is concrete. Leadership reacts to concrete.

### 3. Ask 3 questions before analyzing.
What does the code path look like (branches, conditional logic)? Is the slowness clustered by time, user cohort, or deploy? What does the existing instrumentation show? A 5-minute question round shifts hypothesis ranking more than an hour of analysis. If the answer is "I don't have that data," that's the first instrumentation to add — not a reason to guess.

### 4. Instrument before optimizing.
Add per-step timing (HTTP middleware, handler-level breakdown, DB query timing). Wait 4-24 hours. Look at the slow 1% specifically. The instrumentation is the deliverable; the fix waits for the data.

## Instrumentation recipe

What to capture on every request:
- Per-step timing in the handler, each step labeled (auth_duration_ms, db_users_duration_ms, …)
- Slow-request flag: any request > p95 or > 1s
- For every slow request, log: user_id, request_id, deploy_version, all step durations, row counts, response size
- Connection pool depth at slow-request time
- DB: enable pg_stat_statements (mean_time, max_time, calls)
- Cluster tags: hour-of-day, day-of-week, deploy_id, host

### 5. Specify a stop condition.
"After 4 hours of per-step timing in production, if we don't see the slow path, instrument differently." A measurement plan without a feedback loop is just a hypothesis. Define success in advance (e.g., ">500ms step in >70% of slow requests"). Without it, the stop is a timer with no exit.

## Leadership

Template: "Endpoint is bad at p99 — I have a 30-minute plan to find which step is slow. A wrong fix is worse than no fix (the obvious parallelization does nothing here). Give me 4 hours; the fix follows from the data."

## Anti-patterns

| Excuse | Reality |
|--------|---------|
| "It's obviously the 4 sequential queries" | The framing is a hypothesis, not a diagnosis |
| "Let me give a quick fix" | A wrong fix is worse than no fix. Measure first. |
| "We can optimize later" | You can't optimize what you haven't measured |
| "p99 is bad, fix the slowest query" | You don't know which query is slowest without instrumentation |
| "Parallelize the 4 queries" | Parallelism makes the request as slow as the slowest leg |
| "Add a cache" | Cache what? Without data, you're guessing the key |

## The fix-shaped table trap

If you find yourself writing a "if slow step is X, try fix Y" table, stop. The table is a tool, not a deliverable. The deliverable: (a) shape diagnosis, (b) instrumentation spec, (c) stop condition with success criterion, (d) leadership answer. A fix-shaped table is none of these. The table belongs in the post-instrumentation plan, not the pre-instrumentation analysis.

## The percentile cheat sheet

- **p50 fine, p99 bad** → tail problem (one query occasionally slow, not all queries slow)
- **All percentiles bad** → structural problem (cumulative cost, sequential bottleneck)
- **Bimodal** → two distinct code paths or user cohorts
- **p99 worse than p99.9** → reverse tail, usually measurement artifact
- **Node event loop** → a single blocking op stalls all concurrent requests. Profile with `--prof` or clinic.js.
- Percentile shapes are heuristic categories, not a partition — a wide spread can be both tail and bimodal. When in doubt, plot the histogram.

For language-specific optimization patterns, load the language performance skill (`golang-performance`, `python-async`, `app-observability`, `golang-benchmark`).
