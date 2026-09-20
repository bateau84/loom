---
name: product-acceptance
description: Plan, execute, and audit evidence that accepted outcomes work through the real assembled product-owned path. Use for Loom Acceptance and product-review work.
---

# Product Acceptance

Product Acceptance asks whether the assembled product actually delivers the accepted outcome.

## Real-path rule

For the scenario under proof, use the real production implementation of every mandatory product-owned component on the claimed path.

A controlled external dependency, clock, network fixture, or other non-product seam may be substituted when it does not replace the product behavior being claimed.

A mock/stub/fake that replaces a mandatory product-owned component cannot prove that scenario.

## Method

1. Select the smallest scenarios that materially cover accepted outcomes.
2. Map each scenario to the accepted criterion it proves.
3. Enter through a meaningful external/product boundary.
4. Exercise the real product-owned composition.
5. Observe the externally meaningful result and relevant failure behavior.
6. Record evidence; mark unexecuted or inconclusive scenarios as unproven, never PASS.
7. Keep local/unit evidence as supporting evidence, not a substitute for assembled-product proof.

Acceptance does not redefine requirements to fit the implementation.
