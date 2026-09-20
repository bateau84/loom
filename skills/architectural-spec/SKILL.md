---
name: architectural-spec
description: Define exact implementation-facing APIs, schemas, protocols, configuration shapes, messages, and interfaces after Loom architecture decisions are settled.
---

# Architectural Specification

Use this skill when behavior and structural choices are already accepted and implementation needs an exact contract.

## Method

1. Trace the specification to accepted behavior and parent architecture.
2. Define exact names, fields, types, methods, ordering, validation, error representation, and compatibility shape.
3. Define invariants that implementations on both sides of a seam must obey.
4. Separate required contract from examples.
5. Include enough detail for independent implementations to interoperate.
6. Identify conformance evidence.

## Stop conditions

Do not use a specification to smuggle in a new store, protocol family, compatibility layer, lifecycle state, trust boundary, synchronization mechanism, or other material architectural choice.

Route new structural choices back to Architect decision/design work. Route missing product semantics to Specifier.
