# typescript-testing Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer verifies the suite cannot go green for TypeScript or JavaScript-specific mechanical reasons while behavior is broken:

- async tests await or return the operation and await rejection/resolution assertions so failures cannot occur after test completion;
- test doubles stop at real external boundaries rather than mocking away the parser, state machine, service, or component behavior being claimed;
- fake timers are scoped, advanced according to runner semantics, account for microtasks when needed, and are restored reliably;
- module mocks, spies, patched globals, process.env, singleton state, caches, and listeners are restored so tests pass alone and independent of order;
- the configured environment (Node, Bun, jsdom, happy-dom, browser) is capable of proving the browser/runtime behavior asserted;
- type-level API claims use an actual compile or type-test mechanism instead of runtime assertions, while runtime validation is not mistaken for type proof;
- regression tests reproduce the defining failure before relying on the fix when practical; rejection, failure, or cancellation paths are covered when material, not as a checklist quota;
- parameterized tests remain diagnosable and snapshots are small and stable enough to review meaningfully;
- final evidence includes focused or containing tests and applicable repository typecheck and lint verification.
