# python-how-to Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer treats Python guidance as copy/paste-capable technical advice:

- Python/library/version/environment assumptions are explicit where syntax/API behavior differs;
- examples run in the stated environment or are clearly illustrative, with imports/dependencies/setup sufficient to reproduce;
- simplified snippets do not omit cleanup, exception, async, security, typing, or state requirements that make the recommended production use unsafe;
- mutable defaults/import side effects/virtualenv/package-manager details do not undermine the example silently;
- version-sensitive facts are checked against current authoritative docs/tool output when consequential;
- destructive/system commands state their effects and platform assumptions.
