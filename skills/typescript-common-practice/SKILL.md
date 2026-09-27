---
name: typescript-common-practice
description: "Baseline TypeScript engineering practice for strict projects: use the repository compiler/toolchain as a contract, keep types close to domain meaning, prefer inference without obscuring public APIs, preserve module boundaries, avoid speculative type architecture, and run the TypeScript-specific verification loop. Use for implementation or refactoring of TypeScript source."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

> **House skill.** This is the TypeScript language baseline that complements software-engineering. It does not replace typescript-type-safety, typescript-async, typescript-testing, javascript-runtime, browser-runtime, or framework-specific skills.

## When to load

Load for TypeScript source changes: application code, libraries, CLIs, plugins, build tooling, and typed tests. Do not load for read-only inspection unless TypeScript conventions are themselves the subject.

Load narrower skills only when their concern is material. A synchronous pure refactor does not need the async skill; a type-only change does not automatically need browser-runtime.

## Start from the repository contract

Before changing code, inspect the local TypeScript contract:

- tsconfig files and project references;
- package manager and scripts;
- runtime and module mode;
- lint/format configuration;
- test runner and test environment;
- generated-code boundaries.

Do not invent a second toolchain beside the repository's existing one. Compiler options are part of the codebase contract, not editor preferences.

If the repository uses strict mode, preserve it. Do not weaken compiler settings to make one change compile.

## Types should explain the program

Use types to expose domain meaning at module boundaries while letting inference handle obvious local expressions.

- Public/exported functions and durable data contracts deserve clear types when inference would hide intent.
- Local constants usually do not need redundant annotations.
- Keep related state modeled together instead of parallel booleans and optional fields that permit contradictory combinations.
- Prefer a small meaningful domain type over a generic bag of strings when the distinction prevents real misuse.
- Do not turn every primitive into a branded type or every object into an abstraction. Add type machinery only when it removes a concrete ambiguity or bug class.

Match the repository's established interface/type-alias style unless the distinction itself matters.

## Preserve literal information when useful

Use literal inference deliberately.

- const declarations already preserve more information than let.
- as const is appropriate for genuinely immutable literal data, not as a blanket escape from widening.
- satisfies is useful when a value must conform to a shape while retaining its own useful inferred literal/key types.

Do not replace a clear runtime structure with complex conditional or mapped types solely to demonstrate type-system power.

## Keep modules deep and local

TypeScript makes it easy to create wrappers, interfaces, factories, and re-export barrels. The software-engineering deep-module rule still applies.

- Export the smallest useful surface.
- Keep implementation-only types private.
- Avoid re-export layers that only rename or forward symbols.
- Do not create an interface for a concrete dependency unless substitution, testing, or architecture actually needs that boundary.
- Remove superseded type aliases and APIs after callers are migrated rather than maintaining parallel models.

Generated types are owned by their generator. Change the source schema/generator instead of editing generated output.

## Error values and unknown inputs

Do not assume caught or externally supplied values have the desired shape.

At the language-baseline level:

- keep opaque values opaque until code proves more;
- preserve error context when rethrowing/wrapping;
- do not add any, a broad assertion, or a suppression merely to make the compiler quiet.

Load typescript-type-safety when the task involves runtime parsing, assertions, type guards, discriminated unions, optionality, generics, or other load-bearing type proofs.

## Keep TypeScript and runtime truth separate

A successful typecheck proves consistency within the compiler's model. It does not validate JSON, environment variables, network responses, persisted files, or browser storage.

Likewise, a runtime test may not cover a compile-time API regression. Use both signals when both contracts matter.

## Change and verification loop

After a TypeScript change, use the repository's own scripts/tools. The ordinary inner loop is:

1. run the focused test while developing;
2. run the relevant lint/format verification;
3. run the configured TypeScript typecheck, commonly tsc --noEmit or the repository equivalent;
4. run the relevant module/package test suite;
5. inspect the final diff for needless type complexity, stale exports, suppressions, and dead compatibility paths.

Use the project's package manager (Bun, pnpm, npm, yarn, or another declared tool). Do not silently substitute global tool versions when the project pins its own.

A compiler invocation that does not include the changed files is not verification. Confirm project references/include/exclude when coverage is uncertain.

## Common failure patterns

- weakening strictness instead of fixing the model;
- adding any, non-null assertions, ts-ignore, or broad casts as compiler appeasement;
- duplicating runtime schema types by hand and letting them drift;
- introducing generic abstractions before a second real use exists;
- exporting implementation-only types because it is convenient;
- trusting editor diagnostics without running the repository checker;
- running tests but skipping typecheck, or typechecking while skipping changed runtime behavior.

## Completion check

Before completion:

1. Does the change follow the repository's real TypeScript/runtime/module configuration?
2. Are public types clear without redundant local annotation noise?
3. Did the change add type machinery only where it removes real ambiguity?
4. Are runtime validation and static typing kept distinct?
5. Are obsolete exports/types removed when their replacement is complete?
6. Did the actual configured typecheck include the changed source?
7. Did relevant tests and lint/format checks run using the repository toolchain?
