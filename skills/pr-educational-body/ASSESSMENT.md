# pr-educational-body Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

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
