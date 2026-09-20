# design-specification Quality Assurance

Critic-only adversarial contract. Assume competent production and Reviewer conformance have already occurred; attack residual false confidence without creating new authority.

## QA criteria

- Walk adversarial user journeys: interruption, slow/failing dependency, accidental destructive action, stale state, accessibility tools, and recovery.
- Look for a flow that is understandable to its designer but relies on hidden system knowledge a user does not have.
- Attack cross-screen/state transitions where local designs are coherent but the end-to-end journey loses context or control.
- Search for irreversible actions with weak preview/confirmation/recovery semantics.
- Test whether accessibility accommodations change the interaction model rather than merely color/labels.

## QA depth

Increase QA depth where a shared wrong assumption could survive both competent production and normal review.
