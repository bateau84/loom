# mcp-builder Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer evaluates an MCP server from the model/client’s authority and uncertainty boundary, not only API coverage:

- tool names/descriptions/input schemas are discriminating enough that a model can select the right operation and cannot confuse read, mutate, destructive, idempotent, or open-world behavior;
- annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) match reality but are never relied on as the only enforcement boundary;
- validation constrains identifiers/URLs/files/query shapes before reaching the external service; SSRF/path traversal/command injection/prompt-injected resource content cannot expand tool authority;
- authentication/tenant/user identity and credential scope are bound to the operation; tools do not accept arbitrary credentials or leak them in results/errors;
- mutation tools define retries/idempotency/uncertain-completion semantics so a model retry cannot duplicate destructive side effects;
- pagination/filtering/output schemas expose enough provenance/completeness for the model to know whether results are partial; huge responses are bounded;
- error responses distinguish invalid input, auth, not-found/conflict/rate-limit/transient/uncertain side effect and give safe next actions;
- transport/session/cancellation/timeouts/resource cleanup survive client disconnect/restart;
- evaluations measure real task completion and include tool-selection/negative cases, not only stable read-only trivia that cannot expose mutation/security defects.
