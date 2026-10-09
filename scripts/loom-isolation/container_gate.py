"""Trusted stdlib-only gate. It imports no Loom code before external release."""
import errno
import json
import os
import sqlite3
import subprocess
import time
import hashlib
from pathlib import Path


def git_inputs(root: Path) -> list[str]:
    candidates = ("package.json", "bun.lock", "tsconfig.json", "README.md", ".gitignore",
                  "plugins", "scripts", "dashboard", "agents", "skills", "commands", "docs", "evals", ".github")
    return [name for name in candidates if (root / name).exists()]


def release_ready(control: Path, nonce: str) -> bool:
    release = control / "release"
    if not release.exists():
        return False
    if release.is_symlink() or release.read_bytes() != nonce.encode("ascii"):
        raise RuntimeError("wrong or incomplete launch release")
    return True


def main():
    nonce = os.environ.get("LOOM_CONTAINER_NONCE")
    target = os.environ.get("LOOM_CONTAINER_SENTINEL")
    phase = "kernel-preimport"

    def emit(event, **fields):
        print("LOOM_CONTAINER_EVENT " + json.dumps({"event": event, "nonce": nonce, **fields}), flush=True)

    def probes(phase):
        result = []
        for kind, path in (("direct", target), ("link", "/probes/outside"),
                           ("ambient", str(Path(target).parent / "state"))):
            saved = {key: os.environ.get(key) for key in ("HOME", "XDG_STATE_HOME", "OPENCODE_DB")}
            try:
                if kind == "ambient":
                    # Real misdirection contrast, not merely a third name for
                    # the direct probe. Physical exclusion must still deny it.
                    os.environ.update(HOME=str(Path(target).parent),
                                      XDG_STATE_HOME=str(Path(target).parent), OPENCODE_DB=target)
                    path = str(Path(os.environ["XDG_STATE_HOME"]) / "state")
                for operation, flags in (("read", os.O_RDONLY), ("write", os.O_WRONLY)):
                    try:
                        fd = os.open(path, flags)
                    except OSError as error:
                        if error.errno not in {errno.ENOENT, errno.EPERM, errno.EACCES, errno.ENOTDIR}:
                            raise RuntimeError("unexpected protected-path denial")
                        result.append({"phase": phase, "kind": kind, "operation": operation, "errno": error.errno,
                                       "ambientMisdirected": kind == "ambient"})
                    else:
                        os.close(fd)
                        raise RuntimeError("synthetic protected path accessible")
            finally:
                for key, value in saved.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value
        return result

    try:
        if not nonce or not target or not Path("/control").is_dir():
            raise RuntimeError("run through the external driver")
        status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
        if (os.getpid() != 1 or os.getuid() != 1000 or status["NoNewPrivs"].strip() != "1"
                or status["Seccomp"].strip() != "2" or any(int(status[key].strip(), 16) for key in
                ("CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"))):
            raise RuntimeError("kernel restriction mismatch")
        mounts = {}
        for line in Path("/proc/self/mountinfo").read_text().splitlines():
            fields = line.split(" - ", 1)[0].split()
            mounts[fields[4]] = fields[5].split(",")
        if any("ro" not in mounts.get(path, []) for path in ("/control", "/probes")):
            raise RuntimeError("control/probe binds are not read-only")
        descriptor_targets = {}
        for name in os.listdir("/proc/self/fd"):
            try:
                descriptor_targets[int(name)] = os.readlink("/proc/self/fd/" + name)
            except FileNotFoundError:
                pass
        descriptors = sorted(descriptor_targets)
        if sorted(descriptors) != [0, 1, 2] or any(os.isatty(fd) for fd in descriptors):
            raise RuntimeError("unexpected inherited descriptor/terminal")
        if (descriptor_targets[0] != "/dev/null"
                or any(not descriptor_targets[fd].startswith("pipe:") for fd in (1, 2))):
            raise RuntimeError("unexpected stdio handle type")
        namespaces = {kind: os.readlink("/proc/self/ns/" + kind) for kind in ("user", "mnt", "pid", "ipc", "net")}
        before = probes("before-import")
        emit("ready", restricted=True, uid=1000, namespacePid=1, namespaces=namespaces,
             gateSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
             capabilities="zero", seccomp=2, noNewPrivileges=True, inheritedFDs=descriptors,
             stdioTypes={"0": "null", "1": "pipe", "2": "pipe"},
             beforeImportDenials=before)
        phase = "supervisor-release"
        deadline = time.monotonic() + 40
        while not release_ready(Path("/control"), nonce):
            if time.monotonic() > deadline:
                raise RuntimeError("no independent supervisor release")
            time.sleep(0.1)
        phase = "fresh-state-setup"
        for part in ("home", "config", "data", "state", "cache", "runtime", "tmp"):
            path = Path("/tmp/loom", part)
            path.mkdir(parents=True, mode=0o700)
            if list(path.iterdir()):
                raise RuntimeError("state root was not fresh")
        with sqlite3.connect("/tmp/loom/data/opencode.db") as db:
            db.execute("CREATE TABLE synthetic_origin(id TEXT)")
        setup = probes("setup")
        phase = "descendant-probe"
        child = os.fork()
        if child == 0:
            try:
                emit("descendant", denials=probes("descendant"))
                os._exit(0)
            except BaseException:
                os._exit(78)
        if os.waitpid(child, 0)[1] != 0:
            raise RuntimeError("descendant probe failed")
        # Synthetic repository, never the linked host .git or original history.
        phase = "synthetic-git"
        env = {key: value for key, value in os.environ.items() if not key.startswith("LOOM_CONTAINER_")}
        for command in (["git", "init", "-q", "/workspace"],
                        ["git", "add", "--", *git_inputs(Path("/workspace"))],
                        ["git", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Synthetic Test Fixture",
                         "-c", "user.email=fixture@invalid", "commit", "-qm", "Synthetic image baseline"]):
            subprocess.run(command, cwd="/workspace", env=env, check=True, timeout=30)
        phase = "bun-test"
        completed = subprocess.run(["bun", "run", "test"], cwd="/workspace", env=env,
                                   stdin=subprocess.DEVNULL, close_fds=True, timeout=1700)
        emit("done", testExit=completed.returncode, setupDenials=setup, freshState=True,
             syntheticGit=True, command="bun run test")
        return completed.returncode
    except BaseException as error:
        emit("refusal", phase=phase, errorClass=type(error).__name__, productTestCompletion="unproven")
        return 78


if __name__ == "__main__":
    raise SystemExit(main())
