# golang-security Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer builds the trust/authority map before checking snippets:

- authentication and authorization are distinct; every privileged object/action is authorized against the intended subject/tenant, not merely an authenticated request;
- untrusted input is validated at the semantic boundary and encoded/parameterized for SQL/HTML/shell/path/URL contexts rather than generically “sanitized”;
- filesystem/network/process operations address traversal/symlink, command injection, SSRF/rebinding, unsafe redirects, and privilege boundaries where applicable;
- secrets/credentials use appropriate source/lifetime/redaction and never enter logs/errors/URLs/artifacts accidentally;
- cryptography uses maintained standard primitives, secure randomness, key/nonce lifecycle, and authenticated encryption/signature verification correctly; custom crypto is suspect;
- fail-open behavior, confused deputy, TOCTOU, race/concurrency, replay/idempotency, and partial authorization are considered on state-changing paths;
- dependencies/config/defaults preserve least privilege and secure-by-default behavior;
- security tests exercise bypass paths, not only successful login/validation.
