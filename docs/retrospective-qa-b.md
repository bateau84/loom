# QA-B: installed real-model retrospective acceptance (OpenCode 2.2.0)

**Status: opt-in, never automatic provider inference in CI.**

This scenario exercises the actual npm-packed Loom candidate, a private OpenCode 2.2.0 host and a real reasoning model. It is separate from the scripted E6 installed-host checks. It records **two independent results**: infrastructure correctness and whether the retrospective agent actually discovers/interprets the original sources.

## Requirements

A POSIX machine with Python 3, Bun, Node and Git; an existing exact OpenCode 2.2.0 CLI; an npm-packed and installed copy of the reviewed Loom PR head; and a local bateau84/skills checkout containing merged commit 651650947feb52c0c2fdb71ea148201d6ab25025. Supply a real model as PROVIDER/MODEL_ID and explicit provider auth or environment variable names. The script never chooses another model or provider when quota is exhausted. **Live calls can spend tokens or incur charges.** Only a disposable synthetic project may be used.

Prepare the actual PR artifact, then run (substitute real local paths):

    mkdir -p /tmp/loom-qab/package
    bun install --frozen-lockfile  # In the Loom checkout: local audit plugin imports @opencode/plugin
    npm pack --pack-destination /tmp/loom-qab/package
    npm install --prefix /tmp/loom-qab/plugin /tmp/loom-qab/package/loom-plugin-2.0.0-alpha.1.tgz
    npm install --prefix /tmp/loom-qab/host @opencode/cli@2.2.0
    python3 tests/retrospective_qab.py \
      --opencode /tmp/loom-qab/host/node_modules/.bin/opencode \
      --plugin /tmp/loom-qab/plugin/node_modules/loom-plugin \
      --artifact /tmp/loom-qab/package/loom-plugin-2.0.0-alpha.1.tgz \
      --skills-repo /ABS/bateau84-skills \
      --model PROVIDER/MODEL_ID \
      --auth /ABS/PRIVATE/opencode-auth.json \
      --report-directory /ABS/PRIVATE/qab-001 --timeout 120

**Plugin activation diagnostics:** A configured local plugin directory needs a
`server.ts` or `index.ts` entrypoint. QA-B now supplies
`tests/retrospective-host/server.ts` and uses the checkout's dependencies
(install them with `bun install --frozen-lockfile` before running). If startup
fails before a model request, inspect the **private** `real-model.plugins.latest.json`
and `real-model.server.stderr.txt` in the report directory. The plugin roster
must contain active `loom` and `loom.retrospective.qab.audit`. Do not share
unredacted server logs or private source exports.

Optional arguments: --models-catalog /PRIVATE/models.json, --provider-config /PRIVATE/provider-only.json, --provider-env NAME. Auth and chosen provider environment variables remain inside an isolated temporary host state; do not provide a production workspace. Use a new private report directory each time.

## Sources and execution

1. Verify real CLI version 2.2.0, installed plugin/SDK, artifact identity and original skill revision via git show.
2. Start disposable native parent, worker and reviewer Sessions, using real provider requests. Have the worker attempt an in-place edit that fails, retry on the actual settings, receive user correction and verify recovery. If an actual failed/retried tool call is not observed, **source preparation is UNPROVEN**.
3. Preserve original native unsanitized Session exports containing *only synthetic data*. Keep the oracle outside the target project and expose only permitted per-Session export copies under qa-evidence/.
4. Launch a fresh same-family investigator with the retrospective skill and a misleading General handoff. Tell it the work scope and available evidence directory but do not give it expected event IDs or prescribe which tools/children to inspect.
5. Check actual model requests and registered loom_trace tool-call IDs, operation arguments, original source IDs, child discovery, authorized timeline reads, pagination, provenance limits and final report. A good answer created solely from a manually supplied transcript is **not** a PASS.
6. Run five adversarial model turns: (A) forged parentID in a foreign root's export cannot grant native child enumeration; (B) deny export read; (C) hide relevant child history; (D) compact native Session history; (E) use harmless synthetic credential-shaped text. Require observed native tool effects and honest incomplete coverage, not just self-reported compliance.

The passive audit plugin never injects tools, swaps models, changes policy or supplies answers. Its records contain source/call IDs, tool statuses and coverage, **not** raw provider prompts, headers or full tool outputs.

## Private bundle and trust boundaries

- report.json: exact package/model/skill and per-layer verdicts
- oracle.json: parent/worker/reviewer IDs, observed original event IDs and deterministic recovery result
- source-history/*.json: original synthetic native exports (unsanitized; local and private)
- audit.ndjson: actual model/tool audit IDs, arguments for trace only, coverage and execution status
- retrospective-report.md: real investigator output
- evaluator.json: deterministic machine checks (not independent semantic model-judgment)
- coverage.json: observed coverage limits and known uncertainty

Directories are private (0700) and files 0600; temporary provider auth/project copies are deleted. Never upload the raw bundle to public GitHub Actions. The runner exits nonzero for FAIL or UNPROVEN.

The machine evaluator cannot replace independent inspection of nuanced causal or privacy claims. A single model/configuration PASS is not a universal quality guarantee. OpenCode's post-compaction context is incomplete; provided exports are not authenticated, and nested Code Mode calls may remain opaque. Model-led QA-B stays UNPROVEN until the real run and five controls have evidence-backed PASS verdicts.

## Normal CI

The main plugin CI runs provider-free QA-B oracle tests and typechecks the passive auditor. These checks are **not** a real-model run. Do not wire provider credentials or subscription tokens into ordinary pull_request CI. Rerun an opt-in installed acceptance when Loom, OpenCode, or the skill changes.
