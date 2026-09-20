# golang-testing Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic seeks false positives: reverse test order, run repeatedly/parallel/race, remove hand-injected state, make timing slower/faster, and swap mocks for the real boundary where the claim requires it. Ask what defect could exist while every cited test still passes.

Block when tests cited for a mandatory verification claim do not exercise that behavior or can systematically false-pass. Missing optional unit-test style preference is non-blocking if stronger evidence exists.

## QA depth

Increase depth with concurrency/races, persistence/network/process boundaries, integration/product-acceptance claims, global state, timing sensitivity, and consequence of false-green evidence.
