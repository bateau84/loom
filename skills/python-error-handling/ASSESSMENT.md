# python-error-handling Assessment Contract

## Review criteria

Reviewer follows exception identity/context across boundaries:

- exception scopes are narrow; bare `except`/`BaseException` do not swallow `KeyboardInterrupt`, `SystemExit`, cancellation, or unrelated programmer defects;
- translation uses explicit chaining (`raise ... from ...` / `from None` deliberately) so causal provenance is neither lost nor noisily duplicated;
- domain/public exception types are stable only where callers should branch on them; internal library exceptions do not leak accidentally;
- `finally`/context-manager cleanup does not mask the primary exception or silently convert failure into success;
- `ExceptionGroup`/concurrent failures are not reduced to the first error when aggregate semantics matter;
- retry decisions distinguish transient/terminal/idempotent cases and honor cancellation/deadlines;
- error responses/logs redact secrets/PII and avoid exposing tracebacks/internals to untrusted callers;
- partial-success state is explicit before raising/translation.

## Adjudication criteria

Critic injects errors inside the `try` scope that were not the intended catch target, fails cleanup, raises multiple concurrent exceptions, cancels work, and checks boundary translation/logging. Probe `except Exception: pass`, broad fallbacks, lost traceback/cause, and retrying non-idempotent work.

Block when mandatory failure/recovery/security semantics are wrong or errors can be silently swallowed/misclassified. Internal wording/style is non-blocking absent public contract.

## Scaling

Increase depth with boundary layers, concurrency/ExceptionGroup, cleanup/transactions, retries, public error APIs, security sensitivity, and automated recovery.