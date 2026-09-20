# provider-docs Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic selects representative examples/attributes and traces them docs → schema → CRUD/action behavior, then regenerates docs to detect hand-edited drift. Probe required/computed/ForceNew/RequiresReplace/import semantics and renamed/deprecated fields.

Block materially false public docs that can drive destructive/state/compatibility errors or a release whose Registry docs omit the changed API. Wording polish is non-blocking.

## QA depth

Increase depth with public surface breadth, lifecycle/replacement/import semantics, breaking/deprecated changes, generated/manual boundary, and Registry release consequence.
