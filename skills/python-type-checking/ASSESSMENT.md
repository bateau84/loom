# python-type-checking Assessment Contract

## Review criteria

Reviewer verifies the checker proves useful contracts rather than being neutralized by escape hatches:

- `Any`, `cast`, `# type: ignore`, `type: ignore[...]`, stubs, and plugin-specific exemptions are narrow and justified at real dynamic boundaries;
- checker configuration/strictness applies to changed packages/modules; excludes/untyped third-party boundaries do not silently swallow core code;
- `Protocol`/ABC/generic variance/type variables express substitutability correctly; runtime checks are not assumed from static protocols unless explicitly implemented;
- `TypedDict` required/not-required keys, overloads, Literal/enums, Optional narrowing, and type guards match runtime data states;
- `cast` is recognized as no runtime conversion/validation; untrusted data gets runtime validation where needed;
- decorators/descriptors/framework magic preserve signatures through stubs/plugins correctly;
- stub/source types agree and checker version/config is reproducible in CI.

## Adjudication criteria

Critic asks what value could reach runtime despite the static type. Remove/inspect casts/ignores, pass missing TypedDict keys, substitute protocol implementations, and inspect excluded modules/untyped boundaries. Probe a green checker whose core path is effectively `Any`.

Block when a required type-safety claim is illusory or public/runtime behavior can fail due to incorrect type contract. Not every dynamic boundary must be fully typed; explicit bounded `Any` is non-blocking.

## Scaling

Increase depth with public/generic APIs, untrusted runtime data, strictness/config changes, framework/plugin magic, escape-hatch density, and reliance on types for refactoring/security correctness.