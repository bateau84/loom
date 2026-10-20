# OpenCode 2.1.1 compatibility and native feature audit

Scope: Loom's Action-based plugin, migrating from the qualified OpenCode 2.0.32
host to exact SDK/CLI **2.1.1**. This is a candidate until installed-host
qualification passes; a dependency update alone is not acceptance.

## Version-specific changes

- `@opencode/plugin`, source lockfile, and the two installed CLI workflows now
  pin 2.1.1. The Code Mode search fixture remains separately pinned to 2.0.29
  and is **not** host compatibility evidence.
- OpenCode renamed provider replay/compaction data (`providerState`,
  `providerResultState` and `recent`) to `native` and `metadata.keepID`;
  the transitional `session.compacted` event is removed. Loom's current
  core does not directly consume those old fields/events; nevertheless,
  compaction and context injection are acceptance targets.
- The Promise `ctx.tool.hook("execute.before"/"execute.after")`,
  `ctx.session.hook("context")`, `ctx.session.synthetic()`,
  `ctx.skill.transform()` and tool registration surfaces used by Loom are
  retained in the tagged 2.1.1 interfaces. Old stored OpenCode sessions remain
  readable via upstream compatibility decoders; **downgrading OpenCode after
  creating 2.1 compactions is not supported**.
- Native `ctx.session.list()` is now available through the Promise plugin
  interface, with pagination and native archive filtering. It does not grant
  cross-location or cross-process access.

## Read-only native Session inventory

Use the existing `loom_action` tool, not a sixth tool:

```json
{"operation":"sessions","action_id":"ACTION_ID","limit":20}
```

`action_id` is optional. With it, a native Session appears when its current
selection points to that Action **or** it has authored a ledger record for
that Action. That association is not assignment, authorization, processing,
successful delivery, or completion.

The plugin requests an exact project/directory-scoped native page and then
checks each Session against the plugin's canonical project, workspace and
directory. `sessions` reports native IDs, optional title/parent, archive state,
optional persisted selection and an Action-specific activity hint. `scanned`
and `matched` describe only the current native page. Supply `next_cursor`
as `cursor` until null, including through empty matched pages. An optional
`archived` Boolean is passed to the native listing API. No native prompt,
permission, Session update, archive action or task selection is sent.

**Archive integration:** Loom only reads the native archive state. Use
OpenCode's own archive/unarchive UI or SDK to change it. Loom Action
`completed`/`cancelled` does not automatically archive native Sessions.
Native archives and Loom's preserved ledger are different lifecycles.

## Experimental TODO evaluation

OpenCode 2.1.1 restores `todowrite` with the optional host setting:

```json
{"experimental":{"todo":true}}
```

The list is an agent's short-lived execution checklist and appears in the
native TUI. Loom Plan nodes are long-lived, versioned intent with dependency,
evidence and Assessment/QA semantics. **Do not mirror or synchronize TODOs
automatically**: that would create two authors of progress and reintroduce a
scheduler. Evaluate visual usefulness separately; the plugin does not alter
OpenCode's `experimental.todo` setting or register a competing TODO tool.

## Qualification and limits

`tests/installed_host_smoke.py` still proves only boot, restart/removal,
native roster and empty-ledger integrity. The packed artifact must be tested
with the **unmodified 2.1.1** CLI and 2.1.1 SDK.

`tests/installed_questions.py` adds to existing E1–E3:

- **E4**: actual `loom_action sessions` against the native list with Action
  selection, followed by a real *native* archive/unarchive and read-only
  confirmation of archive state through Loom.
- **E5**: context before and after a native compaction, exercising an actual
  installed model request, plus paired host tool-observation records. Only
  the external model is replaced by a deterministic local fixture; a real
  production provider and external MCP are not qualified.
- A tagged 2.1.1 source-only exception for selective `session.get` read denial
  is `NOT APPLICABLE` with `executed:false`, not PASS or a dispatch grant.

Run the pinned CI, typecheck, native/core/Python suites and installed E1–E5
before declaring 2.1.1 supported. Do not promote historical PR #182 2.0.32
results as new evidence. Never change a user's active OpenCode installation
while running the isolated qualification.

## Explicit non-goals

No question routing/recipient dispatch, background retry, cross-instance
dashboard, native Session archiving automation, permission engine, new
scheduler, or replacement of Loom's evidence ledger. These need independent
decisions and their own test boundaries.

Upstream reference: [OpenCode v2.1.1 CHANGELOG](https://github.com/anomalyco/opencode/blob/v2.1.1/CHANGELOG.md),
[Promise plugin session API](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/plugin/src/promise/session.ts).
