# golang-tui Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer checks the Go TUI event loop/model owns state predictably:

- update/model/view separation preserves one authoritative model; rendering is side-effect free enough to remain reproducible;
- async `Cmd`/goroutines return messages rather than mutating model concurrently; cancellation/shutdown owns background work;
- focus/key/mode state cannot diverge from the visual pane/control state;
- resize, terminal capability, high-frequency events, stale async responses, and out-of-order messages have defined behavior;
- long-running work does not block the event loop and exposes progress/cancel/error semantics;
- terminal setup/restoration occurs on normal quit, error, signal, and external process/shell-out paths;
- tests exercise update transitions/messages and important async ordering, not only snapshots of `View`.
