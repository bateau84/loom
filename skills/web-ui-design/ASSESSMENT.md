# web-ui-design Assessment Contract

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

## Adjudication criteria

Critic uses browser-specific adversarial paths: back/forward/refresh mid-task, two tabs, slow/failing/repeated requests, touch/no-hover, keyboard-only, expired session, narrow/zoomed viewport, and resubmit after uncertain response.

Block when accepted web journeys lose/corrupt state, falsely report success, become inaccessible under supported input/viewport conditions, violate expected navigation/session semantics, or depend on nonexistent product capability.

Do not universally require URL state, JSON-like output, SPA conventions, or mobile behavior when the accepted product does not support those use cases.

## Scaling

Increase depth with route/state complexity, forms, auth/session boundaries, optimistic/asynchronous work, offline/reconnect behavior, responsive/input-mode breadth, browser compatibility, and cross-tab persistence.