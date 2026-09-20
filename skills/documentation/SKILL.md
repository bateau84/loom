---
name: documentation
description: Maintain accurate current-reality and publication documentation without changing Loom product/design/architecture authority. Use for Documenter and implementation documentation work.
---

# Documentation

Documentation governs representation, discoverability, and current-reality accuracy. It does not grant semantic authority.

## Current-reality mode

Use for `docs/system/**`, `docs/user/**`, and README-style usage/setup documentation.

1. Discover the governing authority and existing knowledge before editing.
2. Inspect the implementation surface needed to verify changed reality.
3. Update only represented facts that actually changed.
4. Keep system maps navigational rather than file-by-file.
5. Re-run repository knowledge discovery/validation after changes.

If implementation conflicts with normative authority, stop documentation mutation at that boundary and raise the authority mismatch. Do not make docs agree with unauthorized implementation.

## Publication mode

For README, migration, release, API, and user guidance:
- describe only supported behavior;
- keep examples runnable and current;
- distinguish compatibility promises from incidental current behavior;
- do not fabricate versions, guarantees, migration support, or deprecation timelines.
