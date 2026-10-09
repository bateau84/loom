# Credential-free repository test image

`Containerfile.test` uses pinned Node 24 (Debian bookworm), installs Bun **1.4.2**
(the repository CI version), Python 3, Git, jq and zsh, copies filtered source, and runs
`bun install --frozen-lockfile --ignore-scripts` inside the image. No host Bun,
global package installation, authentication, eval-runner CLI or model execution
is used. Existing Python unittest discovery imports the
eval-runner **Python API** through `scripts/loom_eval_profile`; that library-only
source dependency is fetched inside the image at CI's exact revision
`1262ac8c2eebbd10af572e3e3560318f6113233b`. The trusted pre-import gate ignores
PYTHONPATH (`-I -S`); the API is imported only by tests after external release.
Dependency build networking is separate from test runtime networking.
The rootless build uses only the namespace-local CHOWN/DAC_OVERRIDE/FOWNER/
SETGID/SETUID capabilities needed by apt/dpkg, plus no-new-privileges. It has no
SYS_ADMIN, privileged mode or host bind mounts. Runtime tests drop **all** caps.

From the repository root, the standalone driver has two operations (in Loom, obtain an exact command grant
before each non-routine operation):

```text
python3 scripts/loom-isolation/container_driver.py build
python3 scripts/loom-isolation/container_driver.py run --image sha256:<ID printed by build>
```

The build takes a finite snapshot of tracked, regular source files plus the
explicitly authored image/driver files. Unreviewed dirty source refuses the
snapshot. `.containerignore` is an additional allowlist/exclusion layer. Neither
linked `.git`, host OpenCode configuration (`opencode.json`), auth/model caches,
databases, environment files, node_modules, logs nor execution reports enter the
context. A test requiring an excluded host configuration/input can fail; the
driver does not fabricate that input or weaken the test. Dependencies are
installed without project/dependency lifecycle hooks; a dependency requiring
such a hook may need a separately reviewed image-contained setup step.
Source-owned `evals` case definitions are copied because the Python CI tests
parse their selectors; this does not run model evaluations. Actual eval results
and artifacts remain excluded.

The runtime uses rootless Podman, private namespaces, no network, dropped
capabilities, no-new-privileges and default enforced seccomp. Source/dependencies
are image contents; writable workspace changes are private container layers,
not host workspace mounts. Only two read-only **synthetic** control/probe binds
are admitted. The parent inspects the actual engine configuration and process
identity and the trusted stdlib-only gate's kernel observations before releasing
`bun run test`. Direct/link/ambient synthetic path denials are attempted before
imports, at setup and in a descendant. HOME/XDG/DB are fresh container-local
paths. Git metadata is a new synthetic baseline, not copied host history.

Failures refuse before release where possible; the unique owned container is
force-removed in cleanup and has an engine execution timeout. Cleanup failure
remains a failure, not proof all descendants exited. Images remain cached for
reuse; the driver does not prune unrelated images/engine state.
New provider-free run diagnostics are captured under
`scripts/loom-isolation/.container-results/<runId>.json` (private permissions,
1 MiB combined stream limit, separate stdout/stderr, explicit loss/ordering and
cleanup fields). These files are synthetic execution artifacts: do not commit
them. Hidden result directories are excluded from both snapshot and build.

**Observed verification:** the final image
`sha256:34e3893c735bc9589a3836067aeb68be4bf99b8b0642d2337221f8e90866cd8c`
ran the unmodified `bun run test` successfully: **138 Python tests OK**, then
**603 Bun tests across 36 files, 0 failed**. The parent/engine and trusted gate
observed restrictions before release, read/write denials across all three
timings (including actual ambient-variable misdirection), unchanged own outer
sentinel and successful owned-container removal. Complete bounded diagnostics
are indexed by run ID `d4e120c5e0584dceae6567633031da03` in the private result
directory; stream interleaving remains unproven. Source/pure tests alone are not
this evidence. This OCI test transport does not
replace or complete the accepted bubblewrap/cgroup supervisor, native guard
publication repair, or either whole-Objective acceptance gate. Earlier
`supervisor.py` and eval-image `podman_witness.py` checkpoints retain their own
explicit unproven limits and are not used to claim full isolation delivery.

Historical refusals remain original observations. An initial metadata query
used `CgroupVersion` instead of Podman's actual Go field `CgroupsVersion` and
exited 125 before build. That authored defect was corrected and rootless/v2
was subsequently observed by the driver. Missing jq, eval fixtures, zsh source
and the Python API dependency were image/context defects, not grounds to skip
tests or grant production access; the final run above includes their corrections.
