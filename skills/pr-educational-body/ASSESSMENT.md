# pr-educational-body Assessment Contract

## Review criteria

Reviewer reads the PR body as a cold reviewer and verifies it teaches the **actual conceptual delta** without becoming a second commit log:

- “why” describes the prior problem/outcome rather than invented retrospective rationale; commit history plus diff support the narrative;
- before→after conceptual delta matches the complete branch diff, including removals/behavioral changes not highlighted by commit titles;
- repository-specific terminology is introduced after the underlying concept so an external reviewer can build the right mental model;
- “what changed” groups by behavior/concern, not file inventory, and exposes security/migration/compatibility/state/authority changes proportional to risk;
- review notes point to genuinely load-bearing or risky areas rather than flattering summaries;
- verification lists exact checks/commands and observed status only when actually run; unverified areas remain explicit;
- breaking changes/follow-ups/deferred risk are visible when material;
- PR body does not claim normative authority over source specs/architecture or duplicate every commit message verbatim.

## Adjudication criteria

Critic hides the diff/commit list and asks whether the body would cause a cold reviewer to inspect the right risks; then compare every material claim with the actual branch. Probe invented motive, omitted breaking/migration/security change, verification theater, and a body generated mechanically from commit titles.

Block when the PR body materially misrepresents scope/risk/verification in a way that can mislead review or release decisions. Missing prose polish is non-blocking.

## Scaling

Increase depth with cross-cutting file/domain breadth, security/authority/migration changes, commit count/history complexity, external reviewers, and amount of behavior not obvious from the diff.