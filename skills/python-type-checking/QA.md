# python-type-checking Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic asks what value could reach runtime despite the static type. Remove/inspect casts/ignores, pass missing TypedDict keys, substitute protocol implementations, and inspect excluded modules/untyped boundaries. Probe a green checker whose core path is effectively `Any`.

Block when a required type-safety claim is illusory or public/runtime behavior can fail due to incorrect type contract. Not every dynamic boundary must be fully typed; explicit bounded `Any` is non-blocking.

## QA depth

Increase depth with public/generic APIs, untrusted runtime data, strictness/config changes, framework/plugin magic, escape-hatch density, and reliance on types for refactoring/security correctness.
