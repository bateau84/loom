# github-action Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Review the exact executable package consumers will run, not only source files.

- **Public contract:** `action.yml` inputs, outputs, defaults, descriptions, runtime, pre/post behavior, required secrets, and documented minimum permissions match implementation behavior.
- **Runtime choice:** JavaScript, Docker, composite, or delegated script/binary packaging fits supported runners and does not hide an undeclared execution/install path.
- **Input handling:** caller/event/workspace values are parsed as data, validated semantically, and kept out of generated shell/code/unsafe paths.
- **Process execution:** commands use argument boundaries rather than attacker-influenced shell strings; executable resolution/cwd/PATH assumptions are safe.
- **JavaScript package integrity:** supported runtime, lockfile, bundled dependencies, generated `dist`, and release artifact correspond to reviewed source; tests execute the packaged artifact.
- **Container integrity:** repository-Dockerfile and `docker://...` image sources have intentional provenance/integrity; base image/dependencies are maintained; secrets are absent from layers; entrypoint/args do not create command injection; the Dockerfile does not set `USER` because GitHub Docker actions require the default root user for `GITHUB_WORKSPACE`; and the resulting root-plus-mounted-workspace exposure is explicitly bounded.
- **Container lifecycle:** `pre-entrypoint` / main `entrypoint` / `post-entrypoint` are reviewed as separate container executions. Any state crossing phases uses only intentional shared channels (workspace, `HOME`, or `STATE_*`) with validation, and failure/cancellation conditions cannot turn cleanup/setup into a privilege or persistence path.
- **Composite integrity:** shells are explicit, nested actions follow the dependency pinning policy, `GITHUB_ACTION_PATH`/working-directory behavior is correct, and steps do not leak caller authority through hidden state mutation.
- **Bundled/downloaded executables:** binaries/scripts have reviewable provenance/integrity; archive extraction, platform selection, and fallback downloads cannot redirect execution to attacker-controlled content.
- **Credential discipline:** action documentation states minimum caller permissions; tokens/secrets/OIDC credentials are narrowly used and absent from URLs, args, outputs, logs, artifacts, caches, and persistent config.
- **Filesystem safety:** workspace paths, temporary files, symlinks, archive paths, deletion, permissions, and cleanup cannot escape the documented scope.
- **Output/log safety:** outputs are data rather than executable snippets; multiline/workflow command handling uses supported APIs; sensitive values are prevented from reaching logs.
- **Side effects and cleanup:** repository/API/filesystem/network changes are documented, bounded, idempotent where appropriate, and correctly cleaned up on failure/cancellation/post execution.
- **Release integrity:** action tags/releases map to reviewed immutable commits; generated artifacts are synchronized; the publishing workflow does not let untrusted code replace released action bytes.
- **Evidence quality:** tests cover the actual consumer-visible package and hostile inputs, not only internal functions or a happy-path example workflow.

## Review depth

Increase review depth when the action:

- accepts arbitrary commands, paths, URLs, refs, repositories, or environment names;
- receives tokens/secrets or uses write-capable GitHub APIs;
- downloads or executes tools;
- runs as root or writes broadly in the workspace;
- has `pre`/`post` behavior;
- is intended for use in privileged workflows;
- publishes/signs/deploys;
- ships generated bundles or binary/container artifacts that can diverge from source.
