---
name: obligation-contract
description: Define implementation-independent shared semantic guarantees at correctness-sensitive seams between independently realized parties. Use for OC artifacts; not for concrete API/schema/protocol realization.
---

# Obligation Contract

Use only when shared semantic agreement across a seam is load-bearing.

## When warranted

Scan for seams where independently realized parties must agree on one or more of:

- authority/permission;
- lifecycle or state ownership;
- ordering, duplication, idempotency, retry, cancellation, or defer semantics;
- failure interpretation or recovery responsibility;
- evidence/provenance continuity;
- security-sensitive behavior;
- external compatibility meaning.

Do not create an OC for ordinary private helper boundaries merely because values cross them.

## Method

1. Name semantic participants by responsibility, not packages/services unless structure is already authoritative.
2. State the preconditions under which the contract applies.
3. Define the guarantees each participant may rely on without choosing transport, field names, schema, storage, or language interface.
4. Define semantic input/output as meaning crossing the seam, not representation.
5. Make failure semantics first-class: denial, timeout, partial completion, duplicate input, stale state, retry, cancellation, unavailable participant, or ambiguity where applicable.
6. State invariants that must remain true across the seam and through failure/recovery.
7. Trace every consequential guarantee to accepted semantic authority or legitimate Specifier-owned ordinary detail. Architecture may reveal that a seam exists; its current mechanism does not authorize a new semantic promise.
8. Define verification semantics against the real participating behaviors. A neighboring unit check is insufficient when the guarantee spans parties.
9. If exact endpoint/schema/protocol/interface realization is needed, route that work to Architect/`architectural-spec`; the OC should remain stable across alternative realizations.

## Durable artifact

```markdown
# OC-NNN — <descriptive title>

**Participants:**
- <semantic participant>
- <semantic participant>

**Preconditions:**
- <condition>

**Guarantees:**
- <shared semantic promise>

**Semantic input/output:**
- Input: <meaning>
- Output: <meaning>

**Failure semantics:**
- <shared behavior/meaning during failure>

**Invariant:**
- <condition that must remain true across the seam>

**Verification semantics:**
<what must be observed across the real participants to prove/falsify the contract>

**Derived from:**
- <closest accepted semantic authority>
```
