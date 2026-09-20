# python-pydantic Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic supplies coercible-but-wrong values, explicit `None`, omitted fields, unknown fields, alias collisions, union edge cases, invalid data through `model_construct`, and serialization round trips. Probe validators whose ordering makes them appear to run but miss the real state.

Block when external/security/data semantics can be silently misvalidated or misserialized. Preference for strictness everywhere is non-blocking; strictness follows the boundary contract.

## QA depth

Increase depth with public schemas, alias-heavy compatibility, nested/discriminated unions, custom validators, untrusted input, persistence/round trips, and v1/v2 migration.
