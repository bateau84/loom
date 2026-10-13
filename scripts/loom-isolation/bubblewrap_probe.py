"""Trusted, provider-free original-Task prerequisite witness INSIDE the OCI fixture.

Never run on the host as a bwrap/proc permission workaround. This does not launch
product code, claim a complete policy, allocate cgroups, or substitute OCI for
the accepted bubblewrap supervisor. A concrete refusal blocks that launch.
"""
import hashlib
import json
import os
import stat
import subprocess
from pathlib import Path


TARGET = "/__loom_never_payload__"


def setup_result(status: int, error: str) -> str:
    if status == 0:
        return "unproven-setup-outcome"
    if "Can't mount proc" in error and "Operation not permitted" in error:
        return "proc-mount-denied-in-this-fixture"
    if "namespace" in error.lower() and ("Operation not permitted" in error or "Permission denied" in error):
        return "namespace-setup-denied-in-this-fixture"
    if TARGET in error and "execvp" in error and "No such file or directory" in error:
        return "namespace-setup-reached-no-payload"
    if "Unknown option" in error or "unknown option" in error:
        return "unsupported-substrate-option"
    return "unproven-setup-outcome"


def cgroup_readonly(mountinfo: str) -> bool | None:
    for line in mountinfo.splitlines():
        fields = line.split(" - ", 1)[0].split()
        if len(fields) > 5 and fields[4] == "/sys/fs/cgroup":
            return "ro" in fields[5].split(",")
    return None


def proc_topology(mountinfo: str) -> list[dict]:
    """Contained mount targets/types/options only; no host backing-path export."""
    result = []
    for line in mountinfo.splitlines():
        before, after = line.split(" - ", 1)
        fields, filesystem = before.split(), after.split()[0]
        if fields[4] == "/proc" or fields[4].startswith("/proc/"):
            result.append({"target": fields[4], "filesystem": filesystem,
                           "options": sorted(fields[5].split(","))})
    return sorted(result, key=lambda entry: entry["target"])


def main() -> int:
    report = {"schema": "loom-bubblewrap-prerequisites/v1", "scope": "inside-reviewed-OCI-fixture-only",
              "productPayloadStarted": False, "fullTask": "unproven", "delegatedLeafSupplied": False}
    try:
        if (not os.environ.get("LOOM_CONTAINER_NONCE") or not Path("/control").is_dir()
                or Path("/control/release").exists()):
            raise RuntimeError("use the verified driver with its outer gate unreleased")
        if os.getuid() == 0:
            raise RuntimeError("rootful probe forbidden")
        binary = Path("/usr/bin/bwrap")
        metadata = binary.stat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & (stat.S_ISUID | stat.S_ISGID):
            raise RuntimeError("setuid/setgid substrate forbidden")
        report["substrate"] = {"path": str(binary), "sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
                               "mode": stat.S_IMODE(metadata.st_mode), "uid": metadata.st_uid,
                               "gid": metadata.st_gid, "size": metadata.st_size}
        env = {"PATH": "/usr/bin:/bin", "HOME": "/tmp/loom/home", "LC_ALL": "C"}
        version = subprocess.run([str(binary), "--version"], env=env, stdin=subprocess.DEVNULL,
                                 capture_output=True, close_fds=True, timeout=5)
        if version.returncode != 0 or len(version.stdout) > 256:
            raise RuntimeError("substrate version unavailable")
        report["substrate"]["version"] = version.stdout.decode("ascii").strip()
        # The intentionally absent target prevents ANY product/helper payload
        # execution, even if setup succeeds. Empty root: no host/image binds.
        command = [str(binary), "--unshare-user", "--unshare-pid", "--unshare-net", "--unshare-ipc",
                   "--unshare-uts", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
                   "--clearenv", "--tmpfs", "/", "--proc", "/proc", "--", TARGET]
        attempted = subprocess.run(command, env=env, stdin=subprocess.DEVNULL, capture_output=True,
                                   close_fds=True, timeout=10)
        if len(attempted.stdout) + len(attempted.stderr) > 4096:
            raise RuntimeError("setup diagnostic exceeds bound")
        error = attempted.stderr.decode("utf-8", errors="replace")
        report.update(setupCommand=command, setupExit=attempted.returncode,
                      setupObservation=setup_result(attempted.returncode, error), setupStderr=error)
        # Only the fixture's own narrow kernel observations; never host proc/sys.
        status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
        report["outerRestrictions"] = {key: status[key].strip() for key in ("NoNewPrivs", "Seccomp", "CapEff")}
        mountinfo = Path("/proc/self/mountinfo").read_text()
        report["procTopology"] = proc_topology(mountinfo)
        report["fixtureCgroup"] = {"mountReadOnly": cgroup_readonly(mountinfo),
                                   "membership": Path("/proc/self/cgroup").read_text().strip(),
                                   "controlWritesAttempted": False, "allocationAttempted": False,
                                   "custodyProof": "not-supplied"}
        report["event"] = "original-task-prerequisite-refusal"
        report["reason"] = "positive-namespace-policy-and-parent-custody-not-proven"
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        report.update(event="original-task-prerequisite-refusal", errorClass=type(error).__name__,
                      reason=str(error) if isinstance(error, RuntimeError) else "substrate-or-fixture-observation-unavailable")
    print(json.dumps(report, sort_keys=True), flush=True)
    return 78


if __name__ == "__main__":
    raise SystemExit(main())
