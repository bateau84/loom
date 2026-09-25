# risk-driven-planning Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

- Assumptions that could change feasibility, decomposition, dependency order, scope, or acceptance evidence are identified.
- Blocking uncertainty is resolved before dependent planning; carryable uncertainty is explicitly bounded.
- Risky executable work is front-loaded only when its result can invalidate meaningful downstream effort.
- Verification is placed where the risk becomes observable.
- Verification for a known failure mode discriminates corrected behavior from the known-bad behavior; a check that can pass without exercising the relevant mechanism is not sufficient closure.
- Known failed reviews/findings affecting the planned boundary are explicitly closed, carried as risk, or represented in acceptance criteria before dependent execution.
- Superseded or stale evidence is not silently used to close a current planning risk.
- Research and decisions remain with their proper authorities.

## Review depth

Scale review depth with consequence, uncertainty, boundary count, and blast radius.
