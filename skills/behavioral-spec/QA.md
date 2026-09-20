# behavioral-spec Quality Assurance

Critic-only adversarial contract. Assume competent production and Reviewer conformance have already occurred; attack residual false confidence without creating new authority.

## QA criteria

- Construct ambiguous combinations where two individually reasonable requirements produce incompatible outcomes.
- Search for unspecified defaults that implementation teams could resolve differently while each claims conformance.
- Attack terms such as "final", "successful", "retry", "cancel", "available", or "atomic" for hidden semantic latitude.
- Ask whether every passing implementation could still violate the user's accepted outcome through an uncovered sequence or failure mode.
- Look for requirements that accidentally encode one architecture and therefore hide alternative realizations or missing semantics.

## QA depth

Increase QA depth where a shared wrong assumption could survive both competent production and normal review.
