# golang-troubleshooting Assessment Contract

## Review criteria

Reviewer verifies diagnosis is causal, not merely a plausible patch story:

- the symptom is reproduced or bounded with precise evidence/environment; “cannot reproduce” remains explicit;
- hypotheses predict discriminating observations and are falsified/updated rather than accumulated until one sounds right;
- logs/trace/pprof/race detector/delve/bisect/minimal reproducer are chosen to separate hypotheses with minimal perturbation;
- concurrency/timing instrumentation is recognized as capable of changing the bug (Heisenbug); evidence from `-race`, trace, stress, or controlled scheduling is interpreted accordingly;
- root cause is separated from trigger and downstream damage;
- semantic blast radius (implementation vs architecture/obligation/etc.) is established before the fix exceeds diagnostic authority;
- the correction reproduces the original failure before and eliminates it after, with a regression test/probe that would fail on recurrence.

## Adjudication criteria

Critic asks for the counterfactual: if this were truly the root cause, what observation must change when it is removed? Probe correlation-vs-cause, multiple simultaneous faults, stale evidence, fix-before-reproduction, and diagnostic changes that alter timing/state.

Block a root-cause claim or corrective escalation when discriminating evidence is absent. A useful mitigation may proceed under its own authority, but must not be mislabeled as confirmed root cause.

## Scaling

Increase depth with nondeterminism/concurrency, production-only state, cross-system blast radius, incident consequence, multiple plausible causes, and difficulty reproducing the failure.