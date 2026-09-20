# python-error-handling Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic injects errors inside the `try` scope that were not the intended catch target, fails cleanup, raises multiple concurrent exceptions, cancels work, and checks boundary translation/logging. Probe `except Exception: pass`, broad fallbacks, lost traceback/cause, and retrying non-idempotent work.

Block when mandatory failure/recovery/security semantics are wrong or errors can be silently swallowed/misclassified. Internal wording/style is non-blocking absent public contract.

## QA depth

Increase depth with boundary layers, concurrency/ExceptionGroup, cleanup/transactions, retries, public error APIs, security sensitivity, and automated recovery.
