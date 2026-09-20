# provider-actions Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic times out immediately after the remote API may have succeeded, retries the action, cancels polling, runs it at each lifecycle boundary and injects terminal provider errors. The key question is whether Terraform/model retry can duplicate or lose an imperative effect.

Block destructive/irreversible duplication, false completion, lifecycle corruption, or ambiguous uncertain-outcome handling. Progress wording/style is non-blocking unless it lies about state.

## QA depth

Increase depth with destructive/irreversible side effects, async/polling duration, lifecycle coupling, retry ambiguity, auth/privilege, and experimental API/version risk.
