# quality-scenario Quality Assurance

## QA criteria

- Construct a system that passes the happy path but fails the claimed quality under a realistic degraded, peak, recovery, adversarial, or partial-failure environment.
- Vary the stimulus source and timing to expose a scenario that only works for the producer's assumed sequence.
- Attack invented precision: thresholds with no authority, measurements that ignore tail behavior, averages hiding failure, or success metrics that can be gamed.
- Search for an architectural target smuggled into the scenario such that an equally valid realization is excluded.
- Check whether the verification method can observe the actual response measure under the stated environment.
- Look for overlapping BR/QS language that creates contradictory guarantees or double-counts the same obligation.

## QA depth

Increase depth where a quality can look healthy under nominal tests while failing at the operational boundary that matters.
