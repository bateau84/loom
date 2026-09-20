# interaction-design Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic attacks the state machine: repeat an action before the previous response, fail halfway, cancel during work, change context while loading, lose/recover focus, use keyboard only, and attempt recovery from every material error.

Block when a required scenario has an ambiguous/impossible transition, a destructive action is unsafe, the UI can signal success while work failed, users can become trapped in a mode/state, or recovery cannot reach a valid state. Do not block for missing irrelevant generic states or aesthetic treatment owned by visual design.

## QA depth

Increase depth with state-transition count, asynchronous/concurrent events, destructive consequence, modal/mode behavior, input modalities, long latency, and cross-surface handoffs.
