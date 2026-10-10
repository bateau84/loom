# golang-testing Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic seeks material false positives: vary order/timing, use race or stress testing when concurrency matters, and inspect hand-injected state or mocked boundaries when they could conceal the claimed behavior. Ask what **credible accepted-behavior defect** survives the cited tests, not what test technique is missing.

Block when tests cited for a mandatory verification claim do not exercise that behavior or can systematically false-pass. Missing optional Go test technique, extra scenario, or coverage target is non-blocking when existing evidence suffices.

## QA depth

Increase depth with concurrency/races, persistence/network/process boundaries, integration/product-acceptance claims, global state, timing sensitivity, and consequence of false-green evidence.
