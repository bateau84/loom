# provider-docs Assessment Contract

## Review criteria

Reviewer compares Registry docs to **schema/runtime/generator truth**:

- every changed provider/resource/data-source/action/function surface maps to the correct template/generated doc target; no implemented public surface is silently undocumented;
- argument/attribute required/optional/computed/sensitive/default/conflict/replacement semantics match actual schema behavior;
- examples use current HCL names/types/import syntax and represent runnable realistic configurations rather than stale SDK generation;
- manual templates add overview/usage/migration guidance without duplicating generated field blocks that will drift;
- `tfplugindocs` generation is reproducible and generated markdown is refreshed after schema/template change; hand edits to generated output are not source-of-truth;
- import, timeout, lifecycle/replacement, compatibility/deprecation and destructive behavior are documented when users need them to avoid state surprises;
- Registry release/tag/manifest/version rules are correct for the repository’s publication path;
- docs never promise behavior the provider does not implement.

## Adjudication criteria

Critic selects representative examples/attributes and traces them docs → schema → CRUD/action behavior, then regenerates docs to detect hand-edited drift. Probe required/computed/ForceNew/RequiresReplace/import semantics and renamed/deprecated fields.

Block materially false public docs that can drive destructive/state/compatibility errors or a release whose Registry docs omit the changed API. Wording polish is non-blocking.

## Scaling

Increase depth with public surface breadth, lifecycle/replacement/import semantics, breaking/deprecated changes, generated/manual boundary, and Registry release consequence.