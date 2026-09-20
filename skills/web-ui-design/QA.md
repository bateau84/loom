# web-ui-design Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic uses browser-specific adversarial paths: back/forward/refresh mid-task, two tabs, slow/failing/repeated requests, touch/no-hover, keyboard-only, expired session, narrow/zoomed viewport, and resubmit after uncertain response.

Block when accepted web journeys lose/corrupt state, falsely report success, become inaccessible under supported input/viewport conditions, violate expected navigation/session semantics, or depend on nonexistent product capability.

Do not universally require URL state, JSON-like output, SPA conventions, or mobile behavior when the accepted product does not support those use cases.

## QA depth

Increase depth with route/state complexity, forms, auth/session boundaries, optimistic/asynchronous work, offline/reconnect behavior, responsive/input-mode breadth, browser compatibility, and cross-tab persistence.
