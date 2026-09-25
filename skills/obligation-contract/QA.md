# obligation-contract Quality Assurance

## QA criteria

- Give the contract to two independent implementers and find any load-bearing meaning they could interpret differently while each satisfies the text.
- Attack timeout, duplicate, stale, retry, cancellation, partial completion, restart, and unavailable-peer cases where applicable.
- Search for authority or provenance that can be detached, replayed, substituted, or accepted by the wrong participant.
- Look for a guarantee that is true locally on each side but false across the seam because ownership/order/atomicity is undefined.
- Challenge whether the OC is compensating for an architecture choice rather than expressing stable semantics.
- Attack verification that checks only one participant or mocks away the actual cross-party guarantee.
- Search for an omitted failure meaning that would force Architect/Worker to invent product semantics later.

## QA depth

Increase depth where independently correct parties can compose into a semantically incorrect system.
