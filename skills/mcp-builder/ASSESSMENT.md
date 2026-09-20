# mcp-builder Assessment Contract

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

## Adjudication criteria

Critic treats every tool argument and returned resource text as attacker-controlled. Attempt tool confusion, arbitrary URL/path access, cross-tenant ID substitution, retry after timeout with unknown remote outcome, pagination truncation, prompt-injected tool/resource content, and oversized result/error leakage.

Block when model-visible affordances can cause authority escalation, secret leakage, cross-tenant access, duplicate/destructive side effects, or systematically misleading partial results. Coverage breadth alone is never proof of MCP quality.

## Scaling

Increase depth with mutation/destructive tools, credentials, arbitrary URLs/files, multi-tenancy, open-world APIs, retry uncertainty, result volume, and autonomous model use.