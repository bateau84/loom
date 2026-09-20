# python-type-checking Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer verifies the checker proves useful contracts rather than being neutralized by escape hatches:

- `Any`, `cast`, `# type: ignore`, `type: ignore[...]`, stubs, and plugin-specific exemptions are narrow and justified at real dynamic boundaries;
- checker configuration/strictness applies to changed packages/modules; excludes/untyped third-party boundaries do not silently swallow core code;
- `Protocol`/ABC/generic variance/type variables express substitutability correctly; runtime checks are not assumed from static protocols unless explicitly implemented;
- `TypedDict` required/not-required keys, overloads, Literal/enums, Optional narrowing, and type guards match runtime data states;
- `cast` is recognized as no runtime conversion/validation; untrusted data gets runtime validation where needed;
- decorators/descriptors/framework magic preserve signatures through stubs/plugins correctly;
- stub/source types agree and checker version/config is reproducible in CI.
