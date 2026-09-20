# architectural-spec Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

- Interfaces, state ownership, lifecycle, invariants, failure contracts, and compatibility boundaries are implementation-ready.
- Exact contracts remain structural and do not create unaccepted product semantics.
- Cross-component assumptions are explicit enough for independent Workers to implement consistently.
- Versioning/migration requirements are stated where old/new states may coexist.
- Verification hooks are specified for load-bearing structural guarantees.

## Review depth

Scale review depth with consequence, uncertainty, boundary count, and blast radius.
