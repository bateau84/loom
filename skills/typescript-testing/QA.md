# typescript-testing Quality Assurance

Critic-only adversarial contract. Assume competent test writing and normal review have already occurred; attack false greens and suite coupling.

## QA criteria

Critic tries to make the implementation wrong while leaving the test green:

- delay a Promise until after the test body would ordinarily return and confirm the assertion still owns it;
- reject the operation instead of resolving and look for un-awaited matchers or swallowed rejections;
- run tests individually, reversed or shuffled, and repeatedly to expose leaked module, global, timer, or singleton state;
- remove or alter behavior behind a heavily mocked collaborator and see whether the test still passes because the mock supplied the answer;
- change scheduler order with deferred Promises or fake time rather than real sleeps;
- run the test under the actual production-like browser or runtime when a shim may omit the behavior being claimed;
- mutate a public TypeScript signature in an invalid way and confirm type-level tests fail when such compatibility is part of the claim;
- inspect giant snapshots and loose matchers for changes the assertion would ignore.

Block when test evidence is materially false or cannot fail for the regression it claims to guard. Do not demand browser E2E for pure logic that a faster lower-level test proves completely.

## QA depth

Increase depth for async code, singleton/module state, global API mocking, fake timers, browser storage, navigation or focus, flaky suites, public type APIs, and security-sensitive parsing or validation.
