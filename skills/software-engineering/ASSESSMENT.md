# Software Engineering — Reviewer Assessment

Reviewer-only methodology for implementation work produced with `software-engineering`. Review against accepted behavior, the actual diff, and observed evidence. Do not demand abstractions, telemetry, compatibility, or cleanup that the task does not need.

## Review criteria

1. **Defining behavior is correct.** Reconstruct the smallest set of observable outcomes, failures, edge cases, and compatibility obligations that make the change correct, then verify the implementation and tests cover them.
2. **The solution is proportionate.** Flag speculative abstractions, future scaffolding, unused extension points, duplicate compatibility paths, feature flags without an accepted need, or broad refactors unrelated to the accepted change.
3. **Modules are deep enough.** Substantial implementation detail should sit behind a small useful interface. Flag needless forwarding layers, wrapper chains, or one behavior scattered across files without a real boundary.
4. **Replacement actually replaces.** When a new path supersedes an old one, verify obsolete implementation was removed or that a concrete remaining consumer, migration, or compatibility obligation justifies keeping it.
5. **Failures remain failures.** Meaningful errors must be surfaced with useful context and must not be silently converted into success, duplicate, fallback, or partial-success states contrary to accepted behavior.
6. **Operational visibility is proportional.** Runtime boundaries, important state transitions, external calls, retries, and failure paths should be diagnosable when operators depend on them. Pure local logic should not be penalized for lacking logs, metrics, or traces.
7. **Green means real behavior.** Tests must exercise the behavior they claim to prove, cover the defining case and material failure/edge paths, and not become green by bypassing the unit under test, hand-injecting its expected output, skipping the hard case, or weakening the assertion.
8. **The diff is coherent.** Flag unrelated edits, stale comments, dead code, generated-output mistakes, accidental compatibility layers, or mixed concerns that make the change harder to understand or revert.
9. **Delivery artifacts match the work.** When commits or a PR are part of the task, verify the dedicated Git/PR skill was used and that the artifact accurately explains the change and observed verification rather than overstating proof.

## Evidence boundaries

- Static inspection can establish source defects and missing coverage; it cannot establish that build, test, runtime, security, or integration checks passed.
- Existing test output supports only the paths it actually exercised.
- A small diff is not evidence of low risk when it changes a public contract, persistence format, concurrency behavior, security boundary, or failure semantics.
- A large diff is not automatically wrong; the defect is unnecessary or incoherent mechanism, not line count itself.

## False-confidence patterns

Pay particular attention to:

- a one-use abstraction introduced for hypothetical future backends or variants;
- new code added while the superseded path remains reachable without a named obligation;
- "defensive" fallbacks that hide actionable failures;
- mocks that replay the expected answer instead of exercising the behavior;
- logs that announce success before the outcome is known;
- a refactor whose main effect is moving one behavior across more files;
- compatibility code with no identified consumer or migration requirement;
- observability added mechanically to pure local logic while the real operational boundary remains dark.

Do not turn stylistic preference into a finding. Review whether the implementation is correct, proportionate, diagnosable where needed, honestly verified, and easier rather than harder to maintain.
