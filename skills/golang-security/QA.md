# golang-security Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic assumes attacker control over every external string/header/path/identifier and tries cross-tenant object substitution, repeated/replayed requests, malformed encodings, redirect/URL tricks, concurrent state changes, credential leakage, and downstream failure after authorization.

Any plausible bypass of a mandatory security/authority guarantee, secret disclosure, privilege escalation, injection, or unsafe fail-open state is blocking. Hypothetical hardening outside the accepted threat model is proportional, not automatically critical.

## QA depth

Depth follows consequence/attack surface, not diff size. Increase aggressively with credentials, privilege, destructive actions, external input, network/file/process access, multi-tenancy, crypto, and security-boundary changes.
