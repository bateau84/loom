# python-how-to Assessment Contract

## Review criteria

Reviewer treats Python guidance as copy/paste-capable technical advice:

- Python/library/version/environment assumptions are explicit where syntax/API behavior differs;
- examples run in the stated environment or are clearly illustrative, with imports/dependencies/setup sufficient to reproduce;
- simplified snippets do not omit cleanup, exception, async, security, typing, or state requirements that make the recommended production use unsafe;
- mutable defaults/import side effects/virtualenv/package-manager details do not undermine the example silently;
- version-sensitive facts are checked against current authoritative docs/tool output when consequential;
- destructive/system commands state their effects and platform assumptions.

## Adjudication criteria

Critic follows the instructions literally from a clean environment and looks for stale APIs, hidden prerequisites, examples that only work in a REPL/local state, and “minimal” code that teaches a dangerous production pattern.

Block materially false/unsafe guidance that would drive wrong implementation decisions. Explanation style is non-blocking if facts and steps remain sound.

## Scaling

Increase depth with external-library churn, packaging/environment sensitivity, async/concurrency/security/persistence topics, destructive commands, and likelihood of direct production copying.