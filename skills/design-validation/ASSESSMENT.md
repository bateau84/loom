# design-validation Reviewer Assessment

Reviewer verifies that validation is a trustworthy comparison between accepted design and the real implementation.

## Review criteria

- Evidence provenance identifies the actual build/version, environment, viewport/terminal/device/input mode, state/data, and observation method where relevant.
- Representative accepted Scenarios and load-bearing error/loading/empty/recovery/focus/accessibility states are exercised rather than only the happy path.
- Findings trace accepted intent to observed implementation and explain the human consequence; aesthetic preference alone is not drift.
- Direct observation is distinguished from code/static inference, and human-observer-only claims remain explicitly unverified.
- Behavioral, structural, accessibility, visual, and heuristic findings are not conflated.
- Implementation drift is distinguished from an upstream design defect or missing product/behavior/architecture capability.
- Severity follows human/task/accessibility/trust/recovery consequence rather than pixel difference.
- Prototype/mock behavior does not prove the real product journey.
- Untested scenarios/states/surfaces/input modes and evidence limitations bound the claimed PASS.

## Review depth

Scale with journey consequence, state/view/surface breadth, responsive/input-mode variance, accessibility risk, and uncertainty/freshness of observed evidence.
