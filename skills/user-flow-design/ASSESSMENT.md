# user-flow-design Assessment Contract

## Review criteria

Reviewer treats each flow as a **closed path through preconditions, decisions, state transitions, and exits**:

1. **Entry contract** — actor, trigger, known state, permissions/context, and prerequisites actually exist rather than being assumed.
2. **Decision closure** — every materially distinct branch has a destination, including invalid input, denial, cancellation, timeout, and changed-state cases where relevant.
3. **Recovery/rejoin** — recoverable failures return to a valid state without losing required work or creating loops/dead ends.
4. **Exit semantics** — success, abandonment, cancellation, and unrecoverable failure are explicit enough to know the resulting system/user state.
5. **Progress/no cycles** — loops have a progress/termination condition; retries cannot become infinite ceremony.
6. **Cross-surface/role handoff** — ownership and carried state survive handoffs; one flow does not assume another surface magically knows hidden context.
7. **Granularity coherence** — the flow stays at task/decision level and delegates interaction details to the appropriate design layer.
8. **Surface semantics** — CLI pipelines/exit behavior, TUI focus/modes, browser history, etc. appear only where they materially affect flow completion.
9. **Capability authority** — every step stays inside accepted product capability; a flow diagram does not invent a backend or recovery mechanism.

## Adjudication criteria

Critic starts from awkward but plausible states: missing permission, stale state, invalid input after partial progress, cancellation between steps, repeated retry, role/surface handoff, and failure during recovery. Search for orphan states, cycles without progress, dead-end errors, and implicit jumps.

Block when a required scenario has no complete realizable path, an error/recovery branch cannot reach a valid exit/rejoin, entry assumptions are unsupported and load-bearing, or completion depends on undefined product semantics/capability.

Do not block merely for absent branches that cannot occur in the accepted system.

## Scaling

Increase depth with branch/state count, asynchronous steps, retries, role/surface handoffs, persistence across time, destructive consequence, and uncertainty of entry conditions.