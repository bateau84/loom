# golang-tui Assessment Contract

## Review criteria

Reviewer checks the Go TUI event loop/model owns state predictably:

- update/model/view separation preserves one authoritative model; rendering is side-effect free enough to remain reproducible;
- async `Cmd`/goroutines return messages rather than mutating model concurrently; cancellation/shutdown owns background work;
- focus/key/mode state cannot diverge from the visual pane/control state;
- resize, terminal capability, high-frequency events, stale async responses, and out-of-order messages have defined behavior;
- long-running work does not block the event loop and exposes progress/cancel/error semantics;
- terminal setup/restoration occurs on normal quit, error, signal, and external process/shell-out paths;
- tests exercise update transitions/messages and important async ordering, not only snapshots of `View`.

## Adjudication criteria

Critic sends resize/key/async result in awkward orders, returns stale response after navigation, cancels while work runs, floods messages, and forces panic/error/interrupt during terminal mode. Probe background mutation, blocked update loop, lost focus/mode, and terminal not restored.

Block when real workflows become nondeterministic/unresponsive, accepted interaction semantics fail, or terminal/resource lifecycle is corrupted. Framework style preference is non-blocking.

## Scaling

Increase depth with async commands, panes/modes, high event rate, external processes, persistent state, cancellation, and complexity of terminal lifecycle.