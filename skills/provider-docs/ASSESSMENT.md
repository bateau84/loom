# provider-docs Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

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
