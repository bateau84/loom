# terraform-module-testing Assessment Contract

## Review criteria

Reviewer asks what `.tftest.hcl` actually proves at **plan vs apply** level:

- each `run` uses `command = plan` or `apply` appropriate to the claim; plan-mode/mocked evidence is not presented as proof of provider/control-plane behavior;
- variables/providers/state keys and cross-run references create intentional isolation/dependency; parallel runs do not share mutable real infrastructure unsafely;
- assertions verify semantic outputs/resource configuration/invariants rather than tautologies such as “ID is non-empty” when stronger behavior is claimed;
- `expect_failures` targets the intended validation and cannot pass because an unrelated expression/provider failure occurred;
- mock providers/data have defaults/values realistic enough for the configuration logic being tested and are not used to prove integration semantics;
- apply-mode tests clean up temporary resources and account for credentials/cost/region/quota;
- Terraform version gates match features used (mocking, parallel/state_key etc.);
- scenarios cover defaults, boundary validation, conditional resources, important outputs and integration paths proportional to module contract.

## Adjudication criteria

Critic breaks the intended invariant while preserving the current assertion, injects a different expected failure, replaces real provider behavior with permissive mock values, and runs tests in parallel/reordered. Ask whether a green test can exist while the module’s accepted behavior is wrong.

Block when cited module-test evidence is non-discriminating or plan/mock evidence is used to claim real infrastructure behavior. More apply tests are not inherently better when plan tests prove the intended contract safely.

## Scaling

Increase depth with real-resource apply tests, state sharing/cross-run dependencies, provider mocks, destructive/costly infrastructure, version-specific features, and breadth of the module contract.