# javascript-runtime Quality Assurance

Critic-only adversarial contract. Assume competent implementation and normal review have already occurred; attack residual false confidence in runtime semantics.

## QA criteria

Critic perturbs the cases JavaScript makes easy to misread:

- alias nested objects across two apparently independent states and mutate through either reference;
- substitute valid falsy values, null, undefined, NaN, and a missing property at defaulting branches;
- delay callbacks until captured bindings have changed;
- reorder microtasks, timers, and externally completed Promises around the claimed ordering boundary;
- import modules through a cycle or a second consumer when module-level state or initialization order matters;
- force the primary operation and cleanup/finally path to fail at the same time and inspect which error escapes;
- exercise getters, mutating array methods, and non-plain objects when copying/serialization is part of the claim.

Block when correctness relies on a JavaScript semantic assumption contradicted by the runtime. Do not demand exotic language tricks when the disputed behavior is not load-bearing.

## QA depth

Increase depth around shared mutable singleton state, scheduler-sensitive control planes, caches, lifecycle hooks, serialization/copying, and code whose tests rely on module reset or import order.
