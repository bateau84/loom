---
name: github-workflow
description: GitHub Actions workflow design, implementation, maintenance, and hardening for .github/workflows, reusable workflows, CI/CD triggers, jobs, permissions, runners, secrets, caches, artifacts, and deployments. Use for workflow YAML and workflow-level trust boundaries. Not for implementing a custom action itself; use github-action.
---

# GitHub Workflow

Design workflows as executable security boundaries, not only automation YAML.

A workflow decides **when code runs, whose code/data is trusted, what credentials exist, where execution happens, and what later workflows may consume**. Treat those decisions as part of the implementation.

## Start with the trust map

Before editing YAML, identify:

- trigger and initiating actor;
- whether the event can be influenced by forks, external contributors, issue/comment text, branch names, tags, artifacts, or other workflows;
- which repository/ref is checked out and whether that code is trusted at execution time;
- effective `GITHUB_TOKEN` permissions and any additional credentials;
- environment secrets, approvals, deployment targets, and OIDC identities;
- runner type and what network/filesystem state it can reach;
- caches, artifacts, outputs, and reusable workflows crossing into later jobs or runs.

Do not infer trust from where a workflow file lives. Trust follows the event, ref, data, credentials, and execution path.

## Trigger design

Choose the narrowest event that matches the job.

- Prefer `pull_request` for building/testing untrusted pull-request code.
- Treat `pull_request_target`, `workflow_run`, `issue_comment`, and other privileged/event-chaining patterns as high-risk when attacker-influenced code or artifacts can enter the run.
- A privileged workflow must not fetch, check out, restore, download, or execute untrusted pull-request code merely because the fetch happens outside `actions/checkout`.
- Treat artifacts from lower-trust workflows as untrusted input.
- Restrict branches, paths, tags, event actions, and reusable-workflow callers where that reduces unintended execution.
- For scheduled or manually dispatched workflows, make inputs explicit and validate values before using them.

## Permissions and credentials

Declare explicit least privilege.

- Set `permissions` at workflow or job scope; prefer job scope when jobs need different authority.
- Treat effective job permissions as the real `GITHUB_TOKEN` boundary. An action can access the automatically generated token through `github.token` during job steps even when the workflow does not explicitly pass `GITHUB_TOKEN` through `with` or `env`.
- Grant write permissions only to jobs that perform writes.
- Do not pass repository write tokens or secrets into build/test jobs that execute untrusted code.
- Prefer short-lived OIDC credentials over long-lived cloud credentials when the provider supports it.
- Bind OIDC trust to the intended repository, ref/environment, workflow, and audience as narrowly as practical.
- Use GitHub environments for deployment approval/protection when human or policy approval is required.
- Document why elevated permissions are needed.

A reusable workflow must document and constrain the permissions/secrets it expects; callers must not silently expand its authority.

## Untrusted data and command execution

Assume event fields and workflow inputs can contain attacker-controlled strings.

- Never interpolate untrusted expressions directly into shell source.
- Pass untrusted values through environment variables or argument boundaries, then quote them in the receiving shell/program.
- Prefer checked-in scripts over complex inline shell.
- Use explicit shells and strict error handling appropriate to the shell.
- Avoid `eval`, generated shell source, command strings, and dynamic executable paths from untrusted input.
- Validate paths before filesystem operations and account for traversal and symlink behavior.
- Keep logs free of secrets and credentials; do not rely on masking as the primary control.

## Third-party actions and reusable workflows

Every `uses:` entry is executable supply-chain code.

- Prefer well-maintained actions with a clear owner and narrow purpose.
- Pin third-party actions and third-party reusable workflows to a reviewed full-length commit SHA by default when the reference form supports it; this is the immutable reference boundary for action code. Record the human-readable release in a comment or dependency tool configuration if useful.
- Treat mutable tags and branches as an explicit trust/risk exception, not the secure default. If one is intentionally used, document why the publisher is trusted and what update risk is being accepted.
- Review nested dependencies of composite actions and reusable workflows where they are security-relevant.
- Keep action updates deliberate and review the changed code/release notes, not only the version label.
- Apply organization/repository allow-list and SHA-pinning policy where available.

Local actions and reusable workflows are still code: review the exact ref that the run will execute.

## Jobs, structure, and failure behavior

Make the workflow easy to reason about.

- Give workflows, jobs, and important steps meaningful names.
- Keep jobs cohesive; separate low-trust build/test from privileged publish/deploy work.
- Use explicit dependencies with `needs`; avoid accidental privilege inheritance through large all-purpose jobs.
- Set reasonable `timeout-minutes` on jobs that can hang or consume scarce runners.
- Use `concurrency` for deploy/release/state-changing workflows where overlapping runs could corrupt state.
- Bound matrix size and dynamic matrices derived from external data.
- Prefer reusable workflows or checked-in scripts when duplication is substantial, but do not hide security-critical behavior behind unnecessary indirection.
- Use `continue-on-error` only when failure is intentionally non-blocking and the downstream effect is understood.
- Make cleanup/finalization explicit with correct `if:` semantics.

## Runners

Runner choice is a security decision.

- Prefer GitHub-hosted or isolated ephemeral runners for untrusted code.
- Treat long-lived self-hosted runners as persistent machines that may retain files, credentials, processes, sockets, tool state, and network reach across jobs.
- Do not run fork-controlled/untrusted code on a reusable privileged self-hosted runner without strong isolation.
- Restrict runner network access and credentials to what the job needs.
- Avoid labels that let untrusted workflows select unexpectedly privileged runners.
- For containerized jobs/services, remember the runner remains part of the trust boundary.

## Caches and artifacts

Caches and artifacts are data crossing trust levels.

- Cache only reproducible dependency/build data; never secrets.
- Do not let a low-trust run poison a cache that a privileged run later executes or trusts.
- Treat restored caches as untrusted unless their producer and key namespace are trusted.
- Use content-specific keys and appropriate restore behavior; do not use broad fallback keys for executable/security-sensitive content.
- Upload only intended files and set suitable retention.
- Treat downloaded artifacts as untrusted until provenance and content are validated.
- Do not execute binaries/scripts from another workflow merely because they are GitHub artifacts.

## Deployments, releases, and publishing

Privileged publication paths need a stronger boundary than ordinary CI.

- Build untrusted code without production credentials.
- Move signing, publishing, release creation, and deployment into jobs/runs that consume verified inputs and have narrowly scoped credentials.
- Prefer immutable provenance/attestation and digest-based references where supported.
- Ensure a pull request cannot choose the package name, registry destination, release ref, environment, cloud role, or signing target without validation.
- Protect production environments and release branches/tags according to repository policy.

## Reusable workflows

For `workflow_call`:

- declare inputs/secrets explicitly;
- validate caller-controlled values;
- document required permissions;
- avoid assuming the caller is trusted merely because it can invoke the workflow;
- use outputs as data, not as trusted commands;
- keep privileged reusable workflows narrow and difficult to misuse.

## Verification

At minimum:

1. validate workflow syntax and referenced files/actions;
2. inspect effective triggers and permissions, not only declared intent;
3. exercise trusted and untrusted event paths where both exist;
4. test failure/cancellation/cleanup behavior for state-changing workflows;
5. verify secrets are unavailable to untrusted execution paths;
6. verify the exact ref/action versions executed;
7. inspect cache/artifact boundaries and runner selection;
8. test reusable workflows from realistic callers.

Use GitHub's current workflow/security documentation for version-sensitive behavior.
