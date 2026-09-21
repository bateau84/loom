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

Start the external read-only dashboard:

```bash
bun run dashboard
```

It listens on `127.0.0.1:4318` by default and aggregates the bounded Loom snapshots published by active OpenCode+Loom processes. See `docs/user/dashboard.md` for status and safety semantics.
