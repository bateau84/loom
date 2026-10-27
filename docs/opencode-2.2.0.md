# OpenCode 2.2.0 host migration

This draft moves Loom's pinned Promise plugin SDK and **isolated test host**
from 2.1.1 to **2.2.0**. It does not update a developer's installed CLI,
enable model routing, or qualify production provider accounts. Prior 2.1.1
results remain historical; the test reports must be newly produced on 2.2.0.

## Relevant upstream changes

- The Promise plugin entrypoint (`@opencode/plugin`) still exposes Loom's
  tool registration, session hooks, synthetic input, Session list/get and
  skill transform APIs in the tagged 2.2.0 source. Typecheck and real installed
  execution must still be verified.
- `@opencode/ai` changed root exports from Effect to Promise; Loom does not
  import that package directly, so no application import migration is needed.
- OpenTUI 0.7.0 is now an optional peer of `@opencode/plugin`. Loom has no TUI
  renderable or `@opencode/plugin/tui` import. External TUI extensions must be
  qualified separately.
- The OpenCode GitHub Action is no longer published. Loom's workflows invoke
  `@opencode/cli` directly; they do not depend on that removed Action.
- Keyed session instructions, configurable prompt-cache TTL, Desktop GUI
  plugins and image/decision APIs are new upstream capabilities, **not features
  automatically adopted by Loom**.
- The 2.2.0 release adjusts session compaction, plugin reload, and OAuth
  behavior. Recheck Session/compaction evidence under a real installed host.

Upstream: [v2.2.0 release notes](https://github.com/anomalyco/opencode/blob/v2.2.0/CHANGELOG.md),
[tagged Promise Session adapter](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/plugin/src/promise/adapter.ts).

## Selective Session read: exact source-only exception

The 2.2.0 Promise adapter's `ctx.session.get` delegates to the host
`session.get`, which delegates through `sessions.forSession(sessionID).get()`
to `Session.get`. That method reads from `store.get` and returns
`Session.NotFoundError` for an absent Session. There is no selective per-Session
read permission check in this path. Thus the prior
`E2-selective-session-read-policy-denial` remains **NOT APPLICABLE**
(`executed:false`), **not PASS**. This exception must be revisited on the
next host/API change and gives no permission to dispatch synthetic input.

Source boundaries:
- [Promise adapter](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/plugin/src/promise/adapter.ts)
- [Session service](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session.ts)
- [Session.get](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/session.ts)

## Required qualification

1. With Bun 1.4.2, regenerate `bun.lock` from `package.json` and commit the
   resolver output. Use frozen installs afterward; review transitive drift.
2. Run `bun run typecheck`, `bun run test:core`, `bun run test:native`,
   `bun run test:python` and build the production module.
3. Pack Loom and install it separately from an unmodified `@opencode/cli@2.2.0`;
   run the installed-host boot-only, removal and restart scenario.
4. Run installed question E1–E5, compaction and duplicate-input control against
   the **same exact 2.2.0 SDK and CLI**, with the real Loom registration and a
   deterministic local model only. Mark failures FAIL and missing evidence UNPROVEN.
5. Run separate installed routing and shared-quota acceptance for draft
   [PR #190](https://github.com/bateau84/loom/pull/190) **when integrated**;
   that separate branch was qualified on CLI 2.1.4 / SDK 2.1.1 and is not
   authorized for deployment here.

## Rollback and safety

Neither CI workflow touches the user's OpenCode installation or personal
state. Retain the previous installed plugin and host version for rollback;
do not assume 2.2.0-created host Session/compaction data are readable by 2.1.1
without a tested rollback. Back up non-disposable host state before any
real-world downgrade. Native host acceptance with fixture providers is not
proof of live-provider, external MCP, or subscription-billing compatibility.
