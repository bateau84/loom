# Software Engineering — Quality Assurance

Critic-only adversarial methodology for work produced with `software-engineering`. Assume a competent implementation and normal Reviewer pass already exist. Attack residual false confidence: systemic, compositional, recovery, compatibility, operational, and evidence failures that ordinary file-by-file review can miss.

## QA criteria

1. **Attack local simplicity that creates system complexity.** A change can look minimal in its own module while duplicating policy, bypassing an existing invariant, or forcing other components to know implementation detail. Trace the behavior across its real callers and boundaries.
2. **Attack the chosen module boundary.** A "deep module" can become a god module, hide unrelated policy, centralize contention, or couple lifecycle decisions that should remain independent. Test whether the small interface hides cohesive complexity rather than merely concealing it.
3. **Attack deletion assumptions.** Search for hidden consumers outside obvious call sites: reflection, registration, configuration keys, migrations, plugins, scripts, generated references, serialized names, external callers, or rollback/recovery paths. Deletion is good only when the obsolete path is genuinely obsolete.
4. **Attack apparently honest green.** Real code and real input can still test the wrong boundary. Look for missing composition, concurrency, recovery, migration, backward-compatibility, environment, and failure-injection cases where unit-level reality does not establish system behavior.
5. **Attack error-path composition.** Verify that retries, fallback, wrapping, cancellation, partial success, and cleanup preserve the original failure meaning across layers. Look for double handling, lost causality, retry storms, or success reported after partial failure.
6. **Attack observability as a failure source.** Look for secrets or personal data in logs, unbounded/high-cardinality labels, duplicate signal storms, misleading success events, telemetry on hot paths with material cost, and missing correlation at the actual failing boundary.
7. **Attack change isolation.** A focused diff can still rely on an unstated coordinated change elsewhere. Test deployment order, mixed-version operation, schema/data compatibility, rollback, stale workers, cached state, and generated artifacts where relevant.
8. **Attack convention-following when the convention is wrong here.** Existing repository patterns are evidence of consistency, not proof of correctness. Check whether copying the pattern reproduces a known limitation, security weakness, shallow boundary, or historical workaround.
9. **Attack delivery confidence.** Compare the PR/commit narrative to the actual diff and evidence. Look for omitted risky changes, verification that proves only a subset of claims, and follow-ups that quietly carry required work.
10. **Attack cross-skill composition.** Language, framework, security, database, concurrency, observability, and domain skills can impose constraints that conflict with generic simplicity. Verify the generic engineering baseline did not override stronger task-specific obligations.

## Adversarial probes

Use probes proportionally to the change:

- remove or disable the "old" path in your mental model and ask what external or recovery path breaks;
- follow one defining input across every boundary to its final observable outcome;
- force the primary dependency to fail slowly, partially, repeatedly, or after side effects;
- run the change in mixed old/new versions where deployment is not atomic;
- ask what happens on retry, rollback, cancellation, duplicate delivery, restart, and stale state;
- inspect what an operator would see during the failure and whether those signals identify cause without leaking sensitive data;
- compare the tests' exercised boundary with the strongest claim made by the implementation or PR.

## Confidence rule

Do not demand speculative redesign merely because another architecture is imaginable. Raise a finding when a plausible residual failure can violate an accepted obligation, corrupt data/state, hide a material failure, defeat recovery, create unsafe operations, or make the supplied evidence materially weaker than claimed.
