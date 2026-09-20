# python-pydantic Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

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
