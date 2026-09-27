# typescript-common-practice Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer verifies the TypeScript change fits the repository's actual language contract:

- changed source is covered by the applicable tsconfig/project reference rather than accidentally excluded;
- strictness, module mode, target, runtime types, and repository scripts are preserved rather than weakened to accommodate the patch;
- exported/public types communicate useful domain meaning while obvious locals are not buried in redundant annotation;
- type aliases, interfaces, generics, wrappers, barrels, and helper abstractions exist for a concrete boundary rather than speculative extensibility;
- generated types are changed through their source of truth and duplicate hand-maintained models are not introduced beside generated/runtime schemas;
- any, assertions, non-null operators, ignores, or compiler suppressions are not used as ordinary error-resolution mechanisms;
- obsolete types/exports are removed when migration is complete instead of leaving parallel APIs;
- verification used the repository's pinned toolchain and the typecheck actually included the changed files.

Reviewer should load typescript-type-safety assessment when the correctness claim depends on casts, narrowing, runtime input validation, generics, or union exhaustiveness rather than duplicating those checks here.
