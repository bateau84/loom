# web-ui-design Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer checks browser-native behavior and failure modes, conditioned on what the accepted web product actually supports:

1. **Navigation/history/deep links** — route/back/forward/refresh/share/bookmark semantics are explicit for state users reasonably expect to navigate or share; not every transient UI state belongs in the URL.
2. **Async truth** — loading, stale, empty, error, retry, optimistic update/rollback, cancellation, and duplicate submission behavior match real product state.
3. **Forms** — labels/instructions, validation timing, server/client disagreement, preserved input, errors, multi-step state, and resubmission are designed where forms exist.
4. **Responsive input** — pointer/touch/keyboard behavior, hover alternatives, viewport/zoom/reflow, and orientation changes preserve core tasks.
5. **SPA/dynamic focus** — route/modal/dynamic-content changes preserve meaningful focus, announcements, scroll restoration, and back behavior when applicable.
6. **Session/network reality** — auth expiry, offline/slow network, reconnect, stale tabs, and cross-tab state are considered where they can invalidate a journey.
7. **Browser semantics** — links vs buttons, native controls, file/download/upload, autofill, copy/paste, and progressive enhancement are used intentionally.
8. **Capability truth** — UI never assumes backend/product behavior absent from accepted semantics/architecture.
