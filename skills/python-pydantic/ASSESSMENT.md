# python-pydantic Assessment Contract

## Review criteria

Reviewer distinguishes Pydantic v2 validation, construction, and serialization semantics:

- strict/coercive validation is deliberate for each trust boundary; strings/numbers/bools/datetimes are not silently coerced where identity/security meaning requires strictness;
- required/optional/nullable/default/default_factory states are distinct and mutable defaults do not leak;
- validation aliases vs serialization aliases, field exclusion, `by_alias`, computed fields, and round-trip output match external contract;
- field/model validators run in the intended `before`/`after`/wrap order and do not depend on fields/state unavailable at that phase;
- `model_construct`/trusted-data bypass is not used on untrusted input or presented as validated state;
- `extra` policy prevents silent acceptance/loss of unknown fields where schema evolution/security matters;
- discriminated unions/generics/nested models preserve unambiguous parsing and error location;
- `SecretStr`/sensitive fields remain protected through repr/logging/serialization;
- schema/OpenAPI output matches runtime behavior and version-migration assumptions (v1→v2) are current.

## Adjudication criteria

Critic supplies coercible-but-wrong values, explicit `None`, omitted fields, unknown fields, alias collisions, union edge cases, invalid data through `model_construct`, and serialization round trips. Probe validators whose ordering makes them appear to run but miss the real state.

Block when external/security/data semantics can be silently misvalidated or misserialized. Preference for strictness everywhere is non-blocking; strictness follows the boundary contract.

## Scaling

Increase depth with public schemas, alias-heavy compatibility, nested/discriminated unions, custom validators, untrusted input, persistence/round trips, and v1/v2 migration.