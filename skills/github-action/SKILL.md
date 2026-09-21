---
name: github-action
description: GitHub custom action design, implementation, packaging, maintenance, release, and hardening for JavaScript, Docker container, composite, and actions that invoke bundled scripts/binaries. Use for action.yml/action.yaml and the executable implementation behind an action. Not for workflow orchestration; use github-workflow.
---

# GitHub Action

A GitHub Action is a reusable executable dependency. Design it like a small public API plus a supply-chain package.

The security boundary includes `action.yml`, its runtime, bundled/generated files, nested actions, scripts/binaries, dependencies, release tags, and the privileges supplied by the consuming workflow.

## Define the action contract first

Specify:

- supported action type/runtime;
- inputs, outputs, defaults, and validation;
- required secrets or credentials;
- minimum `GITHUB_TOKEN` permissions expected from callers;
- network/filesystem/process side effects;
- supported runner operating systems/architectures;
- behavior on failure, cancellation, and cleanup;
- files generated or modified in the caller workspace.

Do not make hidden credential or permission assumptions. An action cannot make a broad caller token safe by documenting it after the fact.

## Metadata

Keep `action.yml` as the clear public contract.

- Use explicit names/descriptions for inputs and outputs.
- Mark required inputs correctly; safe defaults must not broaden behavior.
- Never put secrets in defaults or metadata.
- Keep output meaning stable and document encoding/format.
- Declare `runs` accurately and include `pre`/`post` behavior in the threat model.
- Avoid surprising global environment mutation.
- If the action requires permissions/secrets that metadata cannot enforce, document them prominently and fail safely when missing.

## Treat every input as untrusted

Inputs, event context, environment variables, workspace files, git metadata, tool output, and caller-provided paths may be attacker controlled.

- Parse and validate values according to their semantic type.
- Use argument arrays/APIs rather than shell command construction.
- If a shell is required, pass data via env/arguments and quote it; do not splice expressions into shell source.
- Reject path traversal or unsafe absolute paths when paths are meant to remain inside a workspace.
- Account for symlinks when reading, writing, deleting, archiving, or publishing files.
- Never use `eval` or equivalent dynamic code execution on caller input.
- Bound input sizes and recursive/file enumeration when attacker-controlled repositories are processed.

## JavaScript actions

For `runs.using: node*`:

- use a GitHub-supported Node runtime;
- keep a lockfile and review dependency updates;
- package runtime dependencies into the committed distribution artifact when required by the action model; do not depend on an implicit install step on the caller;
- ensure the committed `dist`/bundle is reproducibly traceable to reviewed source and dependencies;
- use GitHub Actions toolkit APIs/environment files for outputs, state, summaries, masking, and annotations rather than hand-built workflow-command strings;
- use `execFile`/argument arrays or toolkit process APIs instead of shell strings when launching programs;
- avoid unsafe reliance on caller-controlled `PATH`, cwd, git config, npm config, or executable files in the workspace;
- ensure `pre` and `post` scripts have the same input/secret discipline as `main`.

Test the packaged artifact, not only TypeScript/source code.

## Docker container actions

For `runs.using: docker`:

- account for both supported image sources: a repository Dockerfile and a public registry image referenced with `docker://...`; both are executable supply-chain dependencies;
- for registry images, prefer immutable digest/provenance binding where supported by the release process and treat mutable tags as mutable code references;
- use a minimal maintained base image, keep the Dockerfile reproducible and dependencies versioned, and use multi-stage builds when they reduce runtime contents;
- avoid baking tokens, credentials, build secrets, private registry state, or unnecessary tooling into layers;
- **do not set Dockerfile `USER` for a GitHub Docker action**. GitHub requires the default Docker user (`root`) so the action can access `GITHUB_WORKSPACE`. Because root execution is part of the platform contract, reduce risk through a minimal image, narrow behavior, careful workspace handling, and no unnecessary host/runtime access rather than pretending a non-root action is supported;
- use exec-form `ENTRYPOINT`/arguments where possible; avoid `sh -c` around untrusted input and remember that metadata `entrypoint` overrides the Dockerfile `ENTRYPOINT`;
- validate `args` exactly as other untrusted action inputs;
- treat `pre-entrypoint` and `post-entrypoint` as separate container executions using the same base image, not as one persistent container. State that must cross phases belongs only in intentional shared channels such as the workspace, `HOME`, or `STATE_*` values, and those channels must be validated as untrusted/persistent data;
- apply the same credential, input, logging, and cleanup discipline to pre/main/post entrypoints; reason about `pre-if` and `post-if` failure/cancellation behavior explicitly;
- know what host/workspace paths and environment variables GitHub mounts into the container;
- keep runtime network access to what the action actually needs;
- scan/review the final image contents and base-image updates;
- document that Docker container actions require a Linux runner with Docker support.

A container is packaging/isolation, not proof that caller secrets or mounted files are safe from the action. Docker actions run as root inside their containers by GitHub platform design, so the mounted workspace and any persisted state deserve extra scrutiny.

## Composite actions

For `runs.using: composite`:

- keep steps small and explicit;
- declare `shell` for every `run` step;
- do not interpolate untrusted `${{ inputs.* }}` or event fields directly into shell source;
- pin nested third-party `uses:` dependencies with the same integrity policy expected from workflows;
- resolve local scripts relative to `GITHUB_ACTION_PATH`, not caller cwd assumptions;
- avoid hidden mutation of caller environment, PATH, git config, credentials, or workspace state;
- make cleanup and outputs deterministic across shells/platforms you claim to support.

Composite actions inherit the trust and credentials of the caller; they do not form a security sandbox.

## Bundled scripts and native binaries

An action may delegate to shell/Python/Go/Rust binaries or other packaged code even when its declared action type is JavaScript or composite.

Treat those executables as part of the action release:

- include source/provenance and a reproducible build path where practical;
- verify platform/architecture selection cannot be steered to an attacker URL/path;
- checksum or otherwise bind downloaded binaries to an expected release identity;
- do not curl-and-execute mutable remote code;
- validate archive extraction against traversal/symlink attacks;
- ensure fallback download/install logic does not bypass normal integrity checks.

## GitHub token, API, and credentials

Request only the capability the action needs.

- Document the minimum caller `permissions`.
- Prefer the caller-provided `GITHUB_TOKEN` when suitable rather than demanding PATs.
- Do not silently broaden scope through alternate credentials.
- Treat tokens as secrets even when GitHub masks common forms.
- Do not place tokens in URLs, process arguments, generated config committed/uploaded by the action, outputs, summaries, artifacts, or caches.
- For OIDC-enabled actions, validate/provider-bind audience and claims; do not make arbitrary cloud role selection attacker-controlled.

## Filesystem and workspace safety

The caller workspace may be hostile.

- Avoid following unexpected symlinks across trust boundaries.
- Use safe temporary directories and restrictive permissions for secret material.
- Do not recursively delete based on unchecked caller paths.
- Preserve caller files unless mutation is part of the documented contract.
- Be cautious with executable discovery from cwd/`PATH`.
- When archiving/extracting, validate paths and link behavior.
- Clean up temporary credentials/processes/files in failure paths where needed.

## Outputs, logs, and workflow commands

Outputs can influence later privileged steps.

- Keep outputs data-only and document their format.
- Do not emit command snippets intended for later shell evaluation.
- Encode multiline values using supported environment-file/toolkit mechanisms.
- Masking is defense-in-depth; prevent secret values from being logged in the first place.
- Disable or avoid debug traces that expose inputs, headers, tokens, command lines, or generated credentials.

## Dependencies and release integrity

Consumers execute the released ref, not your source-tree intentions.

- Keep dependencies minimal and locked.
- Review transitive dependency and build-tool changes.
- Keep generated/bundled release files synchronized with source; CI should detect stale bundles.
- Protect the release workflow and action tags.
- Prefer immutable release commits; treat moving major-version tags as a compatibility convenience that must point only to reviewed release commits.
- Publish provenance/attestation where it materially improves consumer verification.
- Document recommended consumer pinning.

## Testing

Test at three levels:

1. **contract tests** for input/output/default/error behavior;
2. **runtime/package tests** against the actual bundled JS, Docker image, composite steps, scripts, or binaries;
3. **hostile-input tests** for shell/path/workflow-command/log/credential/file attacks.

Also test:

- missing/insufficient token permissions;
- fork/untrusted-repository content when the action is intended for PR use;
- supported runner OS/architecture combinations;
- cancellation/failure and `post` cleanup;
- repeated/idempotent execution where relevant;
- release artifact/source consistency.

Use GitHub's current action metadata and secure-use documentation for version-sensitive runtime behavior.
