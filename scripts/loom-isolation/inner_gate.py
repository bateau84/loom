"""Trusted stdlib-only inner gate; no product imports or default runner CLI."""
import errno
import json
import os
import time
import ctypes
import signal
from pathlib import Path


def probes(phase, target):
    rows = []
    for kind, path in (("direct", target), ("link", "/probes/outside"), ("ambient", target)):
        before = dict(os.environ)
        try:
            if kind == "ambient":
                os.environ.update(HOME=str(Path(target).parent), XDG_STATE_HOME=str(Path(target).parent), OPENCODE_DB=target)
                path = str(Path(os.environ["XDG_STATE_HOME"]) / "state")
            for operation, flags in (("read", os.O_RDONLY), ("write", os.O_WRONLY)):
                try:
                    fd = os.open(path, flags)
                except OSError as error:
                    if error.errno not in {1, 2, 13, 20}:
                        raise
                    rows.append({"phase": phase, "kind": kind, "operation": operation,
                                 "errno": error.errno, "ambientMisdirected": kind == "ambient"})
                else:
                    os.close(fd)
                    raise RuntimeError("protected synthetic target accessible")
        finally:
            os.environ.clear()
            os.environ.update(before)
    return rows


def main():
    nonce, target = os.environ["LOOM_CONTAINER_NONCE"], os.environ["LOOM_CONTAINER_SENTINEL"]
    def emit(event, **data):
        print(json.dumps({"event": event, "nonce": nonce, **data}), flush=True)
    status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
    if (os.getuid() != 1000 or status["NoNewPrivs"].strip() != "1" or status["Seccomp"].strip() != "2"
            or int(status["Seccomp_filters"].strip()) < 2 or any(int(status[key].strip(), 16) for key in
                ("CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"))):
        raise RuntimeError("inner kernel restriction mismatch")
    fds = []
    for name in os.listdir("/proc/self/fd"):
        try:
            os.readlink("/proc/self/fd/" + name)
            fds.append(int(name))
        except FileNotFoundError:
            pass
    if sorted(fds) != [0, 1, 2] or any(os.isatty(fd) for fd in fds):
        raise RuntimeError("inner inherited handle mismatch")
    libc = ctypes.CDLL(None, use_errno=True)
    seccomp_checks = []
    for name, args in (("unshare", (0x10000000,)), ("setns", (-1, 0)), ("ptrace", (0, 0, 0, 0)),
                       ("ioctl", (0, 0x5412, 0))):
        ctypes.set_errno(0)
        result = getattr(libc, name)(*args)
        error = ctypes.get_errno()
        if result != -1 or error != errno.EPERM:
            raise RuntimeError("explicit syscall filter denial missing: " + name)
        seccomp_checks.append({"syscall": name, "errno": error})
    read_fd, write_fd = os.pipe()
    standby_child = os.fork()
    if standby_child == 0:
        os.close(read_fd)
        standby_grandchild = os.fork()
        if standby_grandchild:
            os.write(write_fd, str(standby_grandchild).encode())
        os.close(write_fd)
        while True:
            time.sleep(0.1)
    os.close(write_fd)
    standby_grandchild = int(os.read(read_fd, 64))
    os.close(read_fd)
    emit("inner-ready", namespacePid=os.getpid(), namespaces={name: os.readlink("/proc/self/ns/" + name)
         for name in ("user", "mnt", "pid", "ipc", "net")}, beforeImportDenials=probes("before-import", target),
         explicitSyscallDenials=seccomp_checks, standbyNamespacePids=[standby_child, standby_grandchild])
    deadline = time.monotonic() + 20
    release = Path("/control/inner-release")
    while not release.exists():
        if time.monotonic() > deadline:
            raise RuntimeError("no independent inner release")
        time.sleep(0.02)
    if release.is_symlink() or release.read_text() != nonce:
        raise RuntimeError("wrong inner release")
    for part in ("home", "config", "data", "state", "cache", "runtime"):
        Path("/tmp/loom", part).mkdir(parents=True, mode=0o700)
    emit("inner-setup", denials=probes("setup", target))
    child = os.fork()
    if child == 0:
        try:
            emit("inner-descendant", denials=probes("descendant", target))
            os._exit(0)
        except BaseException:
            os._exit(78)
    if os.waitpid(child, 0)[1]:
        raise RuntimeError("inner descendant denial failed")
    for pid in (standby_child, standby_grandchild):
        os.kill(pid, signal.SIGKILL)
    os.waitpid(standby_child, 0)
    emit("inner-proof-done", productImports=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
