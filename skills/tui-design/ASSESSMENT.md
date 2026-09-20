# tui-design Assessment Contract

## Review criteria

Reviewer checks the TUI as a **stateful keyboard-first terminal application**, not a GUI drawn with characters:

1. **Key model** — primary operations, navigation, cancellation/back, destructive actions, and text entry use a consistent conflict-free scheme with a discoverability mechanism.
2. **Focus/mode visibility** — current pane/control/mode is always inferable; modal entry/exit and focus return cannot trap the user.
3. **State/redraw truth** — asynchronous updates, loading/error/progress, stale data, selection, and background changes remain coherent across redraws.
4. **Resize/capability behavior** — a declared supported minimum terminal size and behavior below/around it are explicit; color depth, NO_COLOR/monochrome, Unicode/fallbacks, and narrow terminals degrade without losing essential meaning.
5. **Terminal lifecycle** — alternate screen, raw mode, cursor, signals, shell-out/external command behavior, crash/quit, and restoration expectations are designed where relevant.
6. **Accessibility/sensory redundancy** — semantic state is not color-only; focus/selection/status have textual/symbolic cues where needed.
7. **Long-running operations** — cancellation, input while busy, progress, completion, and errors do not freeze or silently discard user intent.
8. **Surface fit** — no pixel/hover/mouse-first assumptions are required for core supported workflows unless explicitly part of the product.

## Adjudication criteria

Critic probes hidden modes, keyboard traps, conflicting shortcuts, resize during modal/progress state, async update while selection/focus changes, terminal capability loss, Ctrl-C/quit during work, and crash restoration.

Block when accepted workflows cannot complete reliably with the supported key/focus model, essential state becomes invisible, resize/capability changes make the interface unusable without declared boundary, destructive shortcuts are unsafe, or terminal state can be left materially corrupted by normal exit/failure.

Do not enforce a universal `80×24` minimum; require an explicit support boundary and graceful behavior appropriate to the product.

## Scaling

Increase depth with pane/mode count, async updates, keybinding density, terminal capability variance, external-process integration, persistent state, and destructive actions.