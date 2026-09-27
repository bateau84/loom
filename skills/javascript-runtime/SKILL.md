---
name: javascript-runtime
description: "JavaScript runtime semantics beneath TypeScript: values and identity, coercion and absence, lexical scope and closures, ESM module behavior, event-loop ordering, Promise scheduling, exceptions, and object-copy semantics. Use when JavaScript behavior itself can make otherwise type-correct code wrong. Not for TypeScript type modeling, async ownership policy, browser-only APIs, or UI design."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

> **House skill.** Pair with software-engineering for code changes. TypeScript work normally also loads typescript-common-practice. This skill owns JavaScript runtime semantics, not framework style or product behavior.

## When to load

Load this skill when work depends on how JavaScript actually executes: shared object identity, closure capture, truthiness/defaulting, module initialization, event-loop ordering, exception flow, or language-level object behavior. It is useful in Bun, Node.js, browsers, workers, and test runners.

Do not load it merely because a file ends in .js or .ts. Load it when runtime semantics are material to correctness.

## Values, identity, and copying

Primitive values are copied by value. Objects, arrays, maps, sets, functions, dates, and other objects are referenced by identity.

- Assignment of an object creates another reference to the same object.
- Object spread and array spread make shallow copies only. Nested objects remain shared.
- Object keys in Map and object values in Set compare by object identity rather than structural equality.
- Object.freeze is shallow unless nested values are frozen separately.
- A read-only TypeScript type does not make the runtime object immutable.

Before mutating nested state, know who else can observe the same object. Prefer producing a new owned value when shared mutation would make ordering or ownership unclear.

## Absence, equality, and defaulting

Keep null, undefined, falsy values, and invalid numeric values distinct.

- Prefer strict equality for ordinary comparisons.
- Use nullish defaulting when 0, false, or an empty string are valid values.
- Use truthiness only when all falsy values truly mean absence.
- Treat NaN as a distinct invalid numeric state; ordinary equality does not match it.
- Distinguish a missing property from a present property whose value is undefined when the contract cares.

Do not use coercion as a compact substitute for a domain decision.

## Scope, closures, and function context

Closures capture bindings, not frozen snapshots of values. A callback that runs later may observe a variable after it changed.

- Make the intended snapshot explicit when delayed work must use the value as it existed at registration time.
- Prefer lexical state ownership over hidden mutation through outer scopes.
- Arrow functions capture lexical this; normal functions receive this from the call site. Do not switch between them casually when method context matters.
- Avoid callback APIs whose invocation contract is unclear about this, arguments, or lifetime.

When debugging a closure bug, inspect when the callback executes and which binding it reads, not only where the callback was defined.

## ESM modules

ES modules are initialized once per module instance and expose live bindings.

- Imports are live views of exported bindings, not copied snapshots.
- Top-level side effects happen during module evaluation and can make import order observable.
- Cycles can expose partially initialized modules even when every individual import looks valid.
- Module-level mutable state is shared by every consumer of that module instance.
- Avoid making correctness depend on incidental import order.

If a module owns mutable singleton state, make that ownership deliberate and test reset/reload behavior explicitly.

## Event loop and scheduling

JavaScript is run-to-completion within the current job. Promise reactions and queueMicrotask callbacks are microtasks and normally run after the current stack completes but before the next timer/task.

Do not infer execution order from source order once work is scheduled.

When ordering matters:

1. identify the current synchronous section;
2. identify which callbacks enter the microtask queue;
3. identify which callbacks enter later task/timer queues;
4. verify runtime-specific ordering with a minimal executable reproducer when needed.

Do not use setTimeout with a zero delay as a synchronization primitive. It schedules later work; it does not prove another async operation completed.

## Exceptions and finally

Errors are control flow.

- Preserve the original error when adding context; do not replace it with an unrelated message.
- Treat caught values as potentially unknown unless the runtime/framework guarantees otherwise.
- A return or throw in finally overrides an earlier return or throw. Avoid it unless that replacement is intentional.
- Cleanup belongs in finally when it must happen on success and failure, but cleanup errors need an explicit policy rather than silently masking the primary failure.

## Object mechanics that commonly surprise

- Spread copies enumerable own properties, not arbitrary object semantics.
- Getters run when read and can have side effects.
- Destructuring reads values at destructure time; it does not create live bindings to object properties.
- Array sort mutates the array unless using a non-mutating alternative.
- Date, Map, Set, class instances, and typed arrays are not faithfully cloned by plain object spread or JSON round-tripping.

Do not invent a generic deep-clone helper. Choose a copy strategy that matches the concrete data model.

## Diagnostic method

When runtime behavior is uncertain, reduce it to the smallest executable program that preserves the disputed semantics. Run it under the actual project runtime when possible. A ten-line reproducer is stronger evidence than reasoning from TypeScript types or framework assumptions.

## Completion check

Before completing JavaScript-runtime-sensitive work, ask:

1. Is object ownership and mutation clear?
2. Are absence and valid falsy values distinguished correctly?
3. Can a closure observe state later than intended?
4. Does module initialization or shared singleton state affect behavior?
5. Is event-loop ordering assumed or actually established?
6. Can finally, cleanup, or error wrapping hide the real failure?
7. Did verification exercise the actual runtime semantics at issue?
