# Credential-free repository test image

`Containerfile.test` uses pinned Node 24 (Debian bookworm), installs Bun **1.4.2**
(the repository CI version), Python 3, Git, jq, zsh and image-contained bubblewrap,
copies filtered source, and runs
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
python3 scripts/loom-isolation/container_driver.py run --image sha256:<ID printed by build> --receipt scripts/loom-isolation/.container-builds/<buildId>/receipt.json
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

Builds now preserve a complete selected-input manifest (path, content SHA-256,
size and copied mode), informational Git HEAD/owned dirty paths, actual image
configuration and image-ID receipt in the private ignored `.container-builds`
directory. Image labels bind the selected-input and gate digests. Before any
image code executes, a stopped, no-network container is used to copy out the
selected source roots and gate; their actual bytes/modes are compared to the
manifest. The inspected gate copy is retained with the build receipt.

Runs require that receipt, not just an arbitrary image hash. The driver checks
the current selected source bytes/closure (HEAD alone is never a validity
oracle), actual image entrypoint/command/workdir/principal/environment/labels,
and copies/checks selected image files and gate again while stopped. The run
diagnostic links the exact receipt digest, full manifest and observed image/gate
identity. A later publication-only HEAD change with identical selected bytes is
recorded as such; changed input bytes refuse. Receipts are inspectable producer
evidence for the known reviewed image, not signing or hostile-image authority.

The runtime uses rootless Podman, private namespaces, no network, dropped
capabilities, no-new-privileges and default enforced seccomp. Source/dependencies
are image contents; writable workspace changes are private container layers,
not host workspace mounts. Only two read-only **synthetic** control/probe binds
are admitted. The parent inspects the actual engine configuration and process
identity and the trusted stdlib-only gate's kernel observations before releasing
`bun run test`. Direct/link/ambient synthetic path denials are attempted before
imports, at setup and in a descendant. HOME/XDG/DB are fresh container-local
paths. Git metadata is a new synthetic baseline, not copied host history.
Release writes go to a private unique pending token and are atomically renamed;
the gate never sees an empty/partial final file. Empty/wrong visible tokens still
refuse. A deterministic partial-write regression checks this visibility boundary.

## Original bubblewrap Task prerequisite witness

`container_driver.py probe --image sha256:<built-ID> --receipt <build-receipt>`
uses the same source/image/gate binding and independently observed OCI boundary,
but **never releases its outer gate or starts Bun/Loom**. It executes only the
fixed stdlib-only `bubblewrap_probe.py` inside that fixture. The witness attests
the image's non-setuid bubblewrap version/digest, attempts namespace setup with
an empty root and an intentionally nonexistent target (no product payload), and
observes only the fixture's narrow private cgroup mount/membership. It does not
allocate/write cgroups or weaken the OCI policy to make nesting work.

Namespace denial there describes that exact fixture, not global host/kernel
infeasibility. Even successful setup is only a partial precondition; a separately
allocated parent-owned delegated custody boundary and the complete pinned policy
must still be supplied/proven. Refusal blocks the original product launch and
does not satisfy its positive `a3b81985` requirement. No denied host bwrap/proc/hash
operation is licensed by this image-side witness.

## Approved scoped proc comparison

`container_driver.py compare-proc --image sha256:<built-ID> --receipt <build-receipt>`
runs the identical fixed no-payload witness twice using the same image, receipt,
source, toolchain, bwrap command and principal. The ONLY requested policy change
is the per-container literal `--security-opt unmask=/proc/*` in the second case.
This mode does not release the outer gate or run Bun/Loom tests. Normal `run`
never enables proc unmask. No ALL/unconfined/privileged/rootful/SYS_ADMIN or
additional security contrast is supported.

"Default" here means the existing reviewed fixture, not all stock Podman
defaults: per-container `label=disable` was already present and is held fixed in
BOTH cases. Host SELinux enabled is not a claim of container label separation.
The result records actual inspected security/namespace/principal/resource state
and contained proc target/type/options (without host backing paths). It rejects
extra effective-policy changes, missing proc-mount delta, product release or
failed cleanup. New bounded run records and linked comparison summaries are
private ignored artifacts under `.container-results`/`.container-comparisons`;
they do not replace the old refusal or imply a global kernel/LSM cause.

Expected exec-ENOENT of the deliberately absent target after setup is partial
proc/namespace progress only. The original full policy, delegated parent cgroup
custody and positive P6 proof remain separate obligations even if the contrast
improves that setup stage. No production oracle or host control allocation is used.
`compare-proc` exits 0 when the authorised paired experiment and invariant checks
complete, even if its `procSetupImproved` result is false. Each underlying witness
still exits 78 because no positive full-Task/custody claim is made. Admission,
missing evidence, extra-variable or cleanup failure makes the comparison refuse
(78); it never silently proceeds with weaker settings.

## Parent engine custody prerequisite

`container_driver.py custody --image sha256:<built-ID> --receipt <build-receipt>`
keeps the product gate held and exercises only its own freshly created workload.
The parent binds full container ID, creation/start generation, host PID/start
ticks and engine-resolved `libpod-<full-ID>.scope` domain. It rejects restart,
competing exec, identity/path/inode drift and gate membership outside the domain.
All engine commands explicitly force local mode; no remote context fallback.
Podman Top is Running-only and its HPID translation is not the recursive
membership authority. Running and frozen rechecks read current `cgroup.procs` in the
held exact workload directory and its bounded descendants with no-symlink,
read-only descriptors; each current member's PID birth/membership is checked.
Kernel frozen state is verified before and after this traversal. Running
membership refuses when its before/after snapshots differ. Missing/drifted
observation refuses; the old running member list is not frozen proof. Command
stage, exit and fixed safe error signatures distinguish engine errors without
dumping arbitrary engine stderr or private-store metadata.

Through exact-ID Podman pause/unpause/kill operations, it requires recursive
`cgroup.events` populated/frozen observations via held read-only inode-bound
descriptors. It reads only the engine-derived scope and its gate PID's stat/cgroup,
never writes host cgroups, allocates another delegation or scans unrelated scopes.
Main-process SIGKILL return/removal is NOT empty-subtree proof: missing/deleted
kernel observation is unknown/refusal. Existing engine/systemd remains sole
cgroup writer; raw writable delegation is not transferred to the child/Worker.

This prerequisite operation does not yet prove hostile escape resistance,
exercise inner pinned bubblewrap policy or prove release races/parent loss. Even
if held-gate transitions are observed, it returns78/fullTask unproven; further
positive coverage and independent verification are required before product release.

The current custody witness adds a fixed stdlib synthetic parent/child/grandchild
exec with nonce-bound, monotonic counters on an owned read-only pipe. Its single exact exec identity is bound before
closing admissions; no arbitrary exec or product release is exposed. The parent
checks running/thawed counter progress and frozen counter stability, plus current
kernel membership. Paused observation does not call Podman cp/exec, reopen process
roots or thaw the workload; it drains bounded transport backlog and checks the
owned stream while the same kernel domain remains fully frozen. A bounded reader is armed on the same core-events handle
BEFORE kill, and requires an actual recursive `populated=0` sample. A missed sample,
ENODEV/EIO/EACCES/EBADF or unbound observation remains unknown/refusal; this mode
does not infer retirement from errno. A second read-only inotify observer is armed
on the held DIRECTORY descriptor alias before termination: only matching
directory-self deletion can produce domain-lifetime evidence. File-only deletion,
unmount, queue loss, unrelated watch, ignored-only notification and missing event
refuse. This evidence still needs locally applicable kernel/runtime destruction
semantics and complete lifetime coverage/fencing before it qualifies as full
workload retirement. Cgroup2 filesystem magic, device/inode/event identities,
loaded kernel release/build, rootless principal and installed engine/runtime
version/executable hashes accompany the new observations.

Relevant matched source inspection: Linux `v7.2.9` `cgroup_destroy_locked`
rejects remaining tasks and online children under the cgroup mutex, then offlines
the domain to prevent migration/child creation before kernfs removal. Kernfs
`dir.c` documents VFS directory-removal fsnotify delivery and distinguishes
file-only removal. crun `1.28` systemd cleanup calls `cgroup_killall_path`, exact
scope StopUnit/job reconciliation and `destroy_cgroup_path`; unified destruction
uses rmdir/recursive rmdir and repeated kill, not survivor migration out of the
domain. These public source observations plus applicable Fedora source/build
provenance support qualification, not a claim that source alone proves a runtime
transition, no-escape lifetime coverage, or full P6. Original unreadable/missed
samples and failed paused-copy runs remain unknown historical observations.

## Pinned inner synthetic proof

`container_driver.py inner --image sha256:<ID> --receipt <receipt>` additionally
uses only the approved scoped proc-unmask fixture and launches fixed
`inner_policy.py`/`inner_gate.py`. The launcher attests non-setuid bwrap bytes and
canonical policy/BPF digests; libseccomp generates required EPERM rules for
mount/namespace/ptrace/privilege and terminal-injection operations, including
namespace-bearing clone flags. Missing rules/export refuse, never silently skip.
The inner root is fresh tmpfs with private proc/dev/tmp, read-only image-copied
`/usr` toolchain and approved `/workspace`, read-only synthetic probe/control
inputs, fresh HOME/XDG/DB locators and no ambient environment. No host roots,
production state, cgroup controls, shared Git metadata or sockets are passed.

Before the separate atomic `inner-release`, the external parent observes actual
inner host PID/start identity, all fresh namespace identities, capability/NNP
state, inherited FD allowlist, empty root and mount allowlist, added seccomp
filter count and workload membership, plus physical prerelease freeze/thaw.
The original outer `release` is NEVER written by this mode. Fixed trusted probes
record protected synthetic direct/link/ambient denials before import, after
private state setup and in a forked descendant; no product imports occur.
This is an implementation/proof surface, not automatically full Task completion:
hostile escape, parent-loss, lost-response and release-race coverage and the
independent requirement verdict remain separate obligations.

`inner-parent-loss` attests the same held inner gate and binds read-only pidfds
for its actual namespace reaper/gate/standby child/grandchild before publishing
a nonce-bound test marker. The trusted policy parent deliberately exits88
without explicitly killing its child; all bound peer pidfds must become readable
through the real bwrap die-with-parent/PID-namespace path, with no inner release.
`inner-refusal` supplies a missing required filter descriptor to the real fixed
argument preflight and requires exit78 before bwrap child creation; no unconfined
fallback is provided. These are bounded synthetic fault scenarios, not production
parent control, kernel availability claims or retroactive success for old runs.

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

The run above is historical producer evidence from before the receipt/release
correction. It is not retroactively assigned the new build binding. Corrected
image/receipt/run evidence must be observed and assessed independently; the
original successful and failed diagnostics remain unchanged.

Historical refusals remain original observations. An initial metadata query
used `CgroupVersion` instead of Podman's actual Go field `CgroupsVersion` and
exited 125 before build. That authored defect was corrected and rootless/v2
was subsequently observed by the driver. Missing jq, eval fixtures, zsh source
and the Python API dependency were image/context defects, not grounds to skip
tests or grant production access; the final run above includes their corrections.
