# loom

## Live behavioral evals

Validate the corpus without model calls:

```bash
bun run eval:validate
```

List available cases:

```bash
bun run eval:list
```

Run one case:

```bash
bun run eval:live -- \
  --cases INTENT-01 \
  --model openai/gpt-5.5
```

Run the full behavioral system suite once. The current default suite contains 29 cases:

```bash
bun run eval:system -- \
  --model openai/gpt-5.5
```

Run repeated cases with bounded parallelism:

```bash
bun run eval:live -- \
  --all \
  --model openai/gpt-5.5 \
  --iterations 3 \
  --parallel 4
```

The shorthand stress command is equivalent to three iterations of every case with concurrency capped at four:

```bash
bun run eval:stress -- \
  --model openai/gpt-5.5
```

Use `--parallel` without a number to run the entire selected case × iteration matrix concurrently. Use `--parallel N` to cap concurrency. The default is sequential execution.

When `--iterations` is greater than one, artifacts are written separately as:

```text
.loom-evals/<CASE>.iteration-<N>.json
```

Runtime cases use isolated OpenCode target containers with Loom's plugin injected into the standalone runtime. Target and judge run in separate containers.


## Operational dashboard

Loom starts the external read-only dashboard automatically when its OpenCode plugin starts. The first active OpenCode process owns the local HTTP server; other OpenCode processes reuse the published endpoint and can take over after the owner's endpoint lease expires.

It listens on `127.0.0.1:54318` by default and aggregates the bounded Loom snapshots published by active OpenCode+Loom processes. No extra terminal is required. If you need the previous `4318` URL for an existing bookmark or script, set `LOOM_DASHBOARD_PORT=4318`; only do this when that port is not already used by OTLP/HTTP or another local service.

For explicit foreground/debug operation, do not start a second server on the same port while an auto-started owner is active. Start OpenCode with auto-start disabled, then run the dashboard separately:

```bash
LOOM_DASHBOARD_AUTOSTART=0 opencode
# in another terminal
bun run dashboard
```

Set `LOOM_DASHBOARD_AUTOSTART=0` on OpenCode to disable plugin-managed startup. See `docs/user/dashboard.md` for lifecycle, status and safety semantics.

### Interactive workflow status

The normal interactive status path is Loom's read-only dashboard. It does **not** depend on OpenCode Desktop or on the model copying a link into its reply.

1. Start OpenCode with Loom enabled. The dashboard starts with the plugin; no separate dashboard command is normally required.

2. Open:

   ```text
   http://127.0.0.1:54318
   ```

   Active/recent Loom workflows appear automatically and can be opened from Fleet.

3. In the OpenCode terminal client, Loom's sidebar also shows the active workflow's stable dashboard deep link:

   ```text
   http://127.0.0.1:54318/#/project/<project>/workflow/<workflow>
   ```

`loom_status` may additionally generate a per-status artifact URL under `/status/...`, but that is a convenience rather than the only route to interactive status.

The running dashboard publishes its effective endpoint into Loom's installation state. OpenCode/Loom processes read that shared endpoint when generating sidebar and status links, so a dashboard started with a non-default `LOOM_DASHBOARD_PORT` does not require restarting OpenCode.

Set `LOOM_DASHBOARD_URL` on the owning OpenCode/dashboard process when the browser reaches it through a tunnel or reverse proxy; that advertised URL is published through the same endpoint lease.

**Do not expose the dashboard directly to the public internet.** The dashboard is intentionally host-local and has no built-in authentication. Loopback is a host boundary, not same-user authentication: on a shared or untrusted multi-user host, disable auto-start or use OS/container isolation. For remote access, use a private tunnel or an authenticated/authorized reverse proxy.

OpenCode Desktop browser preview remains optional. TUI, web, CLI, SSH, container and CI workflows do not require it.
