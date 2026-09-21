# github-workflow Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Build the workflow's effective trust/authority map before reviewing style.

- **Trigger correctness:** event type, filters, event actions, refs, and manual/reusable inputs match the accepted behavior without unintended privileged execution.
- **Code/ref provenance:** every checkout/fetch/download path identifies what repository/ref/content is executed and whether that producer is trusted for the credentials present in the job.
- **Privilege separation:** `GITHUB_TOKEN`, secrets, OIDC, environments, signing/publish/deploy credentials, and write permissions are available only where needed; untrusted build/test paths cannot reach them. Review effective job permissions even when no token is explicitly passed, because actions can access the generated token through `github.token`.
- **Privileged-event safety:** `pull_request_target`, `workflow_run`, `issue_comment`, or equivalent event chains do not fetch or execute attacker-controlled code/artifacts under elevated trust.
- **Command/data separation:** attacker-influenced contexts and inputs are not embedded into shell/program source; quoting, argument/env boundaries, path validation, and log redaction are appropriate.
- **Dependency integrity:** third-party actions/reusable workflows use an intentional integrity policy with reviewed full-length commit SHAs as the secure default where the reference form supports it; mutable tags/branches are explicit, justified trust exceptions; nested executable dependencies are understood.
- **Runner boundary:** runner labels, hosted/self-hosted choice, persistence, network reach, and container usage fit the trust level of executed code.
- **Cache/artifact boundary:** low-trust producers cannot poison executable caches or smuggle executable artifacts into privileged jobs; artifact scope/retention/content are intentional.
- **Workflow structure:** jobs have clear responsibilities, `needs` expresses real dependencies, privilege is not concentrated in convenience jobs, matrices are bounded, timeouts/concurrency are appropriate, and failure/cleanup semantics are explicit.
- **Reusable-workflow contract:** inputs, outputs, secrets, caller assumptions, and required permissions are explicit and do not create a confused-deputy path.
- **Deployment/release safety:** production publishing/deploy/signing operates only on verified refs/content with narrow credentials and required environment/repository protections.
- **Evidence quality:** tests or dry runs exercise the meaningful trigger/permission paths; a green YAML parser or one happy-path run is not sufficient security evidence.

## Review depth

Increase review depth for workflows that:

- receive fork or public-user input;
- use privileged triggers or chained workflows;
- have write tokens, secrets, OIDC, signing, publishing, or deployment authority;
- use self-hosted runners;
- pass artifacts/caches across trust boundaries;
- invoke reusable workflows with inherited secrets or broad permissions.

A small workflow with powerful credentials can require more review than a large test matrix.
