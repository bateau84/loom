# browser-runtime Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer verifies browser-facing implementation against real Web API semantics:

- event handlers distinguish propagation from default action, narrow event targets safely, and remove listeners or observers with a reliable ownership mechanism;
- fetch code treats HTTP 4xx and 5xx according to response.ok or status rather than assuming catch handles them, and handles empty or one-shot bodies correctly;
- decoded network and storage payloads receive runtime validation before being treated as trusted TypeScript domain values;
- AbortSignal is propagated where supported and superseded requests cannot commit stale results after cancellation or replacement;
- pushState, replaceState, and popstate behavior is implemented correctly without assuming pushState fires popstate or back and forward equal a full reload;
- localStorage and sessionStorage scope, string serialization, exceptions, and cross-tab storage-event semantics match the code's coordination assumptions;
- important persistence or cleanup does not rely on beforeunload or unload always firing;
- browser globals are not accessed at import time in modules that can execute under SSR, build, test, or other non-window environments;
- listeners, observers, timers, channels, object URLs, and requests do not accumulate across repeated lifecycle starts and stops;
- browser-shim tests are not presented as proof of browser behavior the shim does not implement.
