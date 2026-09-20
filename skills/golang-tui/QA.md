# golang-tui Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic sends resize/key/async result in awkward orders, returns stale response after navigation, cancels while work runs, floods messages, and forces panic/error/interrupt during terminal mode. Probe background mutation, blocked update loop, lost focus/mode, and terminal not restored.

Block when real workflows become nondeterministic/unresponsive, accepted interaction semantics fail, or terminal/resource lifecycle is corrupted. Framework style preference is non-blocking.

## QA depth

Increase depth with async commands, panes/modes, high event rate, external processes, persistent state, cancellation, and complexity of terminal lifecycle.
