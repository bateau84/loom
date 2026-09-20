# interaction-design Assessment Contract

## Review criteria

Reviewer models each material interaction as a state transition rather than counting generic UI states:

1. **Action → response** — trigger, immediate feedback, eventual outcome, and resulting state are explicit.
2. **Applicable-state completeness** — every state the control/flow can meaningfully enter is designed; do not require hover/loading/error/success on controls for which those states are nonsensical.
3. **Competing/repeated actions** — double activation, rapid input, concurrent background change, stale state, and repeated submission have deterministic behavior where plausible.
4. **Interruption/cancel/retry** — users can back out, recover, retry, or resume without hidden corruption or mode confusion when the task permits it.
5. **Error prevention/reversibility** — destructive/high-cost actions expose target/consequence, guard accidental activation, and provide undo/confirmation appropriate to risk.
6. **Focus/input modality** — keyboard, pointer, touch, assistive input, focus movement, and mode changes preserve equivalent task semantics.
7. **Feedback latency/truth** — feedback matches actual system state; delayed operations expose enough progress/uncertainty without falsely declaring completion.
8. **Affordance/discoverability** — users can tell what is actionable and what state/mode they are in without relying on hidden conventions.
9. **Boundary discipline** — interaction semantics remain human-facing and do not prescribe visual tokens or technical implementation without need.

## Adjudication criteria

Critic attacks the state machine: repeat an action before the previous response, fail halfway, cancel during work, change context while loading, lose/recover focus, use keyboard only, and attempt recovery from every material error.

Block when a required scenario has an ambiguous/impossible transition, a destructive action is unsafe, the UI can signal success while work failed, users can become trapped in a mode/state, or recovery cannot reach a valid state. Do not block for missing irrelevant generic states or aesthetic treatment owned by visual design.

## Scaling

Increase depth with state-transition count, asynchronous/concurrent events, destructive consequence, modal/mode behavior, input modalities, long latency, and cross-surface handoffs.