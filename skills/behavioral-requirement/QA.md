# behavioral-requirement Quality Assurance

## QA criteria

- Find an implementation that passes every literal criterion while violating the accepted user/system outcome.
- Attack all/any/never/eventual/final ordering and exception language for hidden alternate interpretations.
- Exercise edge sequences: duplicate action, interruption, stale state, retry, cancellation, concurrent change, and recovery where applicable.
- Search for an omitted actor/state whose behavior would be decided by implementation.
- Check that a structural mechanism has not been disguised as behavioral necessity.
- Attack verification semantics that can pass without exercising the actual trigger or observing the actual outcome.

## QA depth

Increase depth where a small wording ambiguity could authorize materially different behavior.
