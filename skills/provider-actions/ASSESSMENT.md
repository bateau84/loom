# provider-actions Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer treats Terraform Provider Actions as imperative side effects inside a declarative lifecycle, where **uncertain completion and repeatability** are central:

- schema required/optional/computed/default/validator/model types match Framework semantics and experimental API version actually targeted;
- lifecycle hook placement (before/after create/update/destroy) cannot observe/modify an object in an invalid phase or violate Terraform ordering assumptions;
- action side effects are idempotent or carry a safe duplicate/retry strategy; provider/API timeout after remote success has a defined outcome;
- context timeout/cancellation reaches API calls/pollers and does not leave detached operations silently running;
- progress events are truthful and bounded; “completed” means remote final state, not request accepted;
- polling handles terminal failure, transient state, not-found and deadline without infinite wait/thundering queries;
- diagnostics retain enough resource/action identity without leaking secrets;
- destructive/irreversible actions expose guardrails and cannot be retried blindly;
- tests exercise repeated invocation, failure/timeout, lifecycle placement and real/provider semantics where mocks cannot prove side effects.
