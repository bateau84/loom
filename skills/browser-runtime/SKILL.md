---
name: browser-runtime
description: "Browser Web API implementation semantics: DOM events, fetch/Response behavior, AbortController, URL and History APIs, storage and multi-tab behavior, page lifecycle, listeners, and browser-vs-server execution boundaries. Use when implementing or reviewing code that directly depends on browser APIs. Not for web interaction design, UI realization from a Design Spec, or accessibility implementation."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

> **House skill.** This is an implementation/runtime skill. web-ui-design owns browser-aware UX decisions; design-implementation owns realizing accepted UI design; accessibility owns accessible code. This skill answers what the browser APIs actually do.

## When to load

Load when code directly uses window, document, DOM events, fetch and Response, AbortController, URL or URLSearchParams, History, localStorage or sessionStorage, BroadcastChannel, page lifecycle events, browser globals, or APIs whose browser semantics are material.

Do not load for pure rendering or business logic that happens to run in a frontend bundle.

## DOM events

Understand three separate concepts:

- propagation through capture, target, and bubble phases;
- default browser action;
- listener registration and lifetime.

stopPropagation controls propagation. preventDefault controls a cancelable default action. They are not interchangeable.

Event delegation relies on propagation and a stable ancestor. When inspecting event targets, account for the difference between target and currentTarget and narrow the target before using element-specific APIs.

Remove listeners with the same event type and listener plus a matching `capture` setting. The options object itself does not need the same identity, and options such as `passive` or `once` are not part of removal matching. AbortSignal-based listener ownership is often simpler where supported.

Avoid anonymous listener registration when later cleanup is required and no signal owns it.

## Fetch and Response

fetch normally resolves when an HTTP response arrives, including 4xx and 5xx responses. It rejects for network-layer failures, aborts, and some policy errors.

Therefore:

- inspect response.ok or status when HTTP error status is failure for the application;
- do not put all error handling only in catch;
- response bodies are streams and are ordinarily consumable once;
- 204 or empty bodies need handling when code otherwise assumes JSON;
- validate untrusted decoded payloads before trusting their TypeScript type.

Credentials, cache, redirect, mode, and headers have browser security semantics; preserve the existing accepted policy rather than changing them casually.

## Request cancellation and stale responses

AbortController and AbortSignal are the standard ownership mechanism for cancellable fetch and many modern Web APIs.

When a request is superseded:

- abort the old request if cancellation is appropriate;
- pass the signal to the underlying API;
- treat expected abort distinctly from a real request failure;
- still guard result commit if a non-cancellable async stage can finish late;
- clean up controllers and listeners on unmount, dispose, or replacement.

A UI spinner disappearing does not mean network work stopped.

## URL and History

Use URL and URLSearchParams rather than manual string concatenation or parsing.

History mechanics:

- pushState adds a history entry but does not itself fire popstate;
- replaceState changes the current entry;
- popstate is observed on relevant history traversal;
- the URL, history state object, and application state are separate sources that need an explicit ownership rule.

web-ui-design decides which state belongs in the URL. browser-runtime implements that decision correctly.

Do not assume back or forward navigation re-runs initialization exactly like a full page load.

## Storage and multiple tabs

localStorage:

- stores strings;
- is synchronous;
- is scoped by origin;
- is visible to multiple same-origin tabs and windows;
- can throw in restricted, quota, or privacy scenarios.

The storage event is delivered to other relevant documents when storage changes; code should not rely on the same document receiving its own storage event as its local update signal.

sessionStorage is partitioned by origin and top-level browsing context: same-origin documents within the same tab can share the relevant page-session storage, while another tab has a separate page session.

For structured values:

- serialize explicitly;
- version and validate persisted shapes where compatibility matters;
- handle parse failures;
- keep secrets and sensitive tokens out of browser storage unless accepted security architecture explicitly says otherwise.

Use BroadcastChannel or another explicit mechanism when cross-tab coordination needs richer messaging than storage invalidation.

## Page and document lifecycle

Browser pages can be hidden, frozen, navigated away, restored from back-forward cache, or terminated without every preferred callback running.

- visibilitychange is useful for visibility transitions.
- pagehide and pageshow are relevant to navigation and back-forward cache lifecycles.
- beforeunload is unreliable as a general persistence or cleanup mechanism and can harm browser behavior; use it only for the narrow user-warning case it supports.
- unload-style last-second network writes are not durable guarantees.
- keepalive and sendBeacon can help some telemetry-like final sends but have size and policy limits and are not transactional persistence.

Persist important state before terminal lifecycle moments rather than betting correctness on shutdown callbacks.

## Browser versus server and test environments

Code may be imported in Node or Bun tests, SSR, prerendering, workers, or build-time tooling even if its main consumer is a browser.

Do not touch window or document at module evaluation time when the module can be loaded outside a browser. Put browser access behind the actual lifecycle boundary or an explicit environment guard.

A DOM shim is not a complete browser. Use a real browser test when actual navigation, focus integration, cross-tab storage, layout, permission or security policy, or browser lifecycle is the behavior being claimed.

## Resource cleanup

Browser leaks are often lifetime bugs:

- event listeners;
- observers;
- intervals and timeouts;
- in-flight requests;
- object URLs;
- subscriptions and channels.

Tie cleanup to the owner that created the resource. Repeated mount or start calls should not accumulate duplicate listeners or work.

## Completion check

1. Are event propagation and default-action behavior used correctly?
2. Are HTTP error statuses handled separately from network rejection?
3. Can superseded requests commit stale results?
4. Is cancellation propagated and cleaned up?
5. Do URL and history operations match actual push, replace, and pop semantics?
6. Are storage parse, version, and multi-tab semantics correct?
7. Is important correctness independent of unreliable page-termination callbacks?
8. Can the module load safely in every environment that actually imports it?
9. Are listeners, observers, timers, channels, object URLs, and requests owned and released?
