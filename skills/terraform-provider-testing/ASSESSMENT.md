# terraform-provider-testing Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer verifies acceptance tests exercise Terraform’s **plan→apply→refresh→final-plan→destroy** convergence, not merely API success:

- scenarios cover basic/update and special lifecycle behavior (import, disappears, validation/regression, replacement, ephemeral) relevant to the resource;
- final empty plan is preserved unless `ExpectNonEmptyPlan` is intentional and justified; drift is not hidden by weak checks;
- `ConfigStateChecks`/plan checks verify meaningful known/unknown/sensitive/nested values; assertions are not tautological restatements of config;
- import verifies canonical state and ignores only attributes that truly cannot be reconstructed; broad `ImportStateVerifyIgnore` does not hide provider defects;
- `CheckDestroy`/sweepers prove remote cleanup and are safe/scoped enough not to delete unrelated resources;
- parallel acceptance tests use unique names/accounts/regions and do not share mutable global/provider state unsafely;
- `ExpectError` matches the intended diagnostic rather than any failure; prerequisites/skips do not turn absent credentials/provider features into green evidence;
- cross-step comparison captures actual mutation/preservation semantics and external-disappears tests exercise Read convergence;
- ephemeral resource tests respect no-persistent-state semantics rather than forcing ordinary resource assumptions.
