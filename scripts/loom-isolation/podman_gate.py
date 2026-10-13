"""Fixed trusted pre-payload OCI witness; stdlib only, no runner/plugin imports."""
import errno
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path


def restrictions():
    status = {}
    for line in Path("/proc/self/status").read_text().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            status[key] = value.strip()
    if (os.getuid() != 1000 or os.getgid() != 1000 or status.get("NoNewPrivs") != "1"
            or status.get("Seccomp") != "2" or any(int(status.get(key, "1"), 16) != 0 for key in
            ("CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"))):
        raise RuntimeError("kernel-policy")
    mounts = {}
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        fields = line.split(" - ", 1)[0].split()
        mounts[fields[4]] = fields[5].split(",")
    if any("ro" not in mounts.get(target, []) for target in ("/", "/input", "/gate", "/control")):
        raise RuntimeError("readonly-policy")
    descriptors = {}
    for name in os.listdir("/proc/self/fd"):
        try:
            descriptors[name] = os.readlink("/proc/self/fd/" + name)
        except FileNotFoundError:
            pass  # listdir's own transient directory descriptor is already closed.
    if set(descriptors) != {"0", "1", "2"} or any(os.isatty(fd) for fd in (0, 1, 2)):
        raise RuntimeError("inherited-descriptor-or-terminal")
    if descriptors["0"] != "/dev/null" or any(not descriptors[str(fd)].startswith("pipe:") for fd in (1, 2)):
        raise RuntimeError("stdio-policy")
    namespaces = {name: os.readlink("/proc/self/ns/" + name) for name in ("user", "mnt", "pid", "ipc", "net")}
    return {"kernelRestricted": True, "uid": os.getuid(), "gid": os.getgid(),
            "noNewPrivileges": True, "seccomp": 2, "capabilities": "zero", "fds": [0, 1, 2],
            "namespacePid": os.getpid(), "namespaces": namespaces, "readonlyInputs": True}


def denials(target, phase):
    paths = {"direct": target, "link": "/input/outside-link",
             "ambient": str(Path(target).parent / "state")}
    result = []
    for kind, path in paths.items():
        for operation, flags in (("read", os.O_RDONLY), ("write", os.O_WRONLY)):
            try:
                fd = os.open(path, flags)
            except OSError as error:
                if error.errno not in {errno.ENOENT, errno.EACCES, errno.EPERM, errno.ENOTDIR}:
                    raise RuntimeError("unexpected-denial")
                result.append({"phase": phase, "kind": kind, "operation": operation, "errno": error.errno})
            else:
                os.close(fd)
                raise RuntimeError("protected-access-allowed")
    return result


def main():
    nonce, target = sys.argv[1:]

    def emit(event, **values):
        print(json.dumps({"event": event, "nonce": nonce, **values}, sort_keys=True), flush=True)

    try:
        observed = restrictions()
        if os.getpid() != 1:
            raise RuntimeError("not-private-pid-one")
        emit("gate-ready", **observed)
        # Directory is mounted read-only; only the external supervisor can issue
        # this one-launch release. Product code does not exist in this process yet.
        deadline = time.monotonic() + 35
        while True:
            release = Path("/control/release")
            if release.exists():
                if release.read_text() != nonce:
                    raise RuntimeError("wrong-launch-release")
                break
            if time.monotonic() > deadline:
                raise RuntimeError("release-timeout")
            time.sleep(0.1)
        probes = denials(target, "before-import")
        for name in ("home", "config", "data", "cache", "state", "runtime", "tmp"):
            Path("/scratch", name).mkdir(mode=0o700)
        db_path = Path("/scratch/data/opencode.db")
        with sqlite3.connect(db_path) as db:
            db.execute("CREATE TABLE credential(id TEXT PRIMARY KEY)")
            db.execute("CREATE TABLE session(id TEXT PRIMARY KEY)")
            if db.execute("SELECT COUNT(*) FROM credential").fetchone()[0] != 0:
                raise RuntimeError("not-empty-synthetic-db")
        positive = Path("/scratch/state/allowed")
        positive.write_bytes(b"synthetic-positive-control")
        if positive.read_bytes() != b"synthetic-positive-control":
            raise RuntimeError("allowed-scratch-failed")
        probes += denials(target, "setup")
        read_fd, write_fd = os.pipe()
        child = os.fork()
        if child == 0:
            os.close(read_fd)
            try:
                data = json.dumps(denials(target, "descendant")).encode()
                os.write(write_fd, data)
                os._exit(0)
            except BaseException:
                os._exit(1)
        os.close(write_fd)
        data = bytearray()
        while True:
            part = os.read(read_fd, 4096)
            if not part:
                break
            data.extend(part)
            if len(data) > 16384:
                raise RuntimeError("descendant-output-limit")
        os.close(read_fd)
        _, exit_status = os.waitpid(child, 0)
        if exit_status != 0:
            raise RuntimeError("descendant-probe-failed")
        probes += json.loads(data)
        if len(probes) != 18:
            raise RuntimeError("probe-coverage-incomplete")
        # Only now materialize/import the two approved test files. No auth,
        # production database or eval runner default discovery is reachable.
        shutil.copytree("/input", "/scratch/work", symlinks=True)
        env = {key: os.environ[key] for key in ("HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
               "XDG_CACHE_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "OPENCODE_DB")}
        env["PATH"] = "/usr/local/bin:/usr/bin:/bin"
        completed = subprocess.run([sys.executable, "-S", "-B", "/scratch/work/test_supervisor.py"],
                                   env=env, stdin=subprocess.DEVNULL, capture_output=True,
                                   close_fds=True, timeout=20)
        if completed.returncode != 0:
            raise RuntimeError("copied-preflight-tests-failed")
        emit("synthetic-complete", probes=probes, positiveScratch=True, freshDatabase=True,
             copiedTestsExit=0, descendantExitObserved=True)
        return 0
    except BaseException:
        # No raw payload/output/exception sink, even on startup/test failure.
        emit("gate-refusal", payloadCompletion="unproven")
        return 78


if __name__ == "__main__":
    raise SystemExit(main())
