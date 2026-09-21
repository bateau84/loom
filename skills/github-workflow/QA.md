# github-workflow Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Attack the workflow as a chain of trust transitions rather than isolated YAML statements.

- **Pwn-request chain:** try every way untrusted pull-request code can enter a privileged run: alternate checkout refs, `git fetch`, `gh pr checkout`, downloaded patches, generated archives, submodules, artifacts, reusable workflows, or scripts copied from the PR.
- **Event laundering:** look for a low-trust event whose outputs are treated as trusted after `workflow_run`, `issue_comment`, manual approval, label/comment gating, or another workflow hop. Human approval of a run is not proof that its bytes are safe.
- **Expression-to-code injection:** attacker-control branch names, PR titles/bodies, labels, issue/comment text, commit metadata, filenames, matrix values, workflow inputs, artifact names, and outputs; try to reach shell, PowerShell, JavaScript, template, path, query, or command-string contexts.
- **Permission drift:** compute effective authority through workflow/job `permissions`, reusable-workflow calls, inherited secrets, environments, GitHub App/PAT credentials, and OIDC. Look for one privileged helper job that can be steered by data from an untrusted job.
- **Reusable-workflow confused deputy:** invoke the workflow with hostile but schema-valid inputs, unexpected refs/repositories/environments, broader caller permissions, or secret inheritance. Test whether the callee performs a privileged action on behalf of an insufficiently trusted caller.
- **Cache poisoning:** attempt to write executable/tool/cache state from low-trust contexts and restore it in a later privileged run through exact keys, restore prefixes, shared scopes, package-manager caches, compiler caches, or custom cache directories.
- **Artifact substitution:** replace expected build outputs with scripts/binaries/symlinks/path-confusing files, manipulate artifact names or provenance, and see whether a privileged workflow executes/publishes them without binding them to the intended source commit.
- **Runner persistence:** on self-hosted runners, assume a hostile job leaves files, processes, credentials, containers, sockets, PATH entries, tool configuration, git config, or poisoned workspaces for a later privileged job. Verify isolation/ephemerality actually breaks the chain.
- **Supply-chain pivot:** compromise or retarget a mutable action/reusable-workflow reference, then determine the authority exposed to that dependency. Include nested actions and install/download steps inside trusted actions.
- **Release/deploy target injection:** attempt to redirect publication to another registry/package/release/environment/cloud role, publish from an unintended ref, bypass environment protection through alternate jobs, or reuse credentials outside the intended audience.
- **Failure-path privilege:** force cancellation, partial failure, retry, skipped dependencies, `always()`, `continue-on-error`, or cleanup paths and check whether stale credentials/state/artifacts are published or privileged actions still run.
- **Concurrency/race attack:** overlap reruns, pushes, releases, or deployments to test stale-ref publication, TOCTOU between verification and use, environment races, and mutable tag/ref movement.
- **Secret exfiltration without direct echo:** try process arguments, debug tracing, generated files, artifact uploads, cache contents, test reports, URLs, exception messages, child processes, or network calls.
- **Trust-by-name mistakes:** change branch/tag/artifact/cache names to trusted-looking values. Confidence must bind to immutable identity/content, not naming conventions.

Treat any demonstrated path from attacker-influenced data/code to privileged execution, secret disclosure, repository write, signing/publishing authority, production deployment, or persistent runner compromise as a blocking security failure.

## QA depth

Escalate aggressively when a workflow combines untrusted input with any of:

- secrets or write-capable tokens;
- privileged/chained triggers;
- reusable workflows with inherited authority;
- caches/artifacts crossing runs;
- self-hosted runners;
- package publishing, signing, releases, or deployment.

Do not spend equivalent effort inventing exotic attacks against a read-only, ephemeral, no-secret lint job.
