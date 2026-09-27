# browser-runtime Quality Assurance

Critic-only adversarial contract. Assume competent implementation and normal review have already occurred; attack browser-policy, lifecycle, and multi-context false confidence.

## QA criteria

Critic probes browser behaviors most likely to differ from a happy-path unit test:

- return 404 and 500 responses that fetch resolves successfully and verify the application still treats them correctly;
- return 204, invalid JSON, slow streaming bodies, network rejection, and abort at different points;
- issue two requests and complete the older one last to test stale-result suppression;
- navigate with push and replace, then real back and forward traversal and back-forward-cache-like lifecycle where relevant;
- open a second same-origin tab or context and mutate localStorage, verifying which document receives storage events;
- deny or quota-fail storage and parse older or corrupt persisted values;
- mount or start and dispose repeatedly while counting listeners, observers, timers, channels, and requests;
- import the module under the non-browser environments that actually consume, build, or test it;
- promote the check to a real browser when DOM shims cannot prove the claimed navigation, lifecycle, focus, layout, storage, or security behavior.

Block when shipped browser behavior depends on an API assumption contradicted by actual browser semantics. Do not turn pure application logic into browser E2E without a browser-specific claim.

## QA depth

Increase depth for navigation and state restoration, cross-tab coordination, request supersession, offline and error handling, browser persistence, lifecycle cleanup, SSR or prerendered modules, and code that uses browser policy or security-sensitive APIs.
