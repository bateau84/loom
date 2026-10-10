"""Trusted stdlib-only inner gate; no product imports or default runner CLI."""
import errno
import json
import os
import time
import ctypes
import signal
import shutil
import subprocess
import selectors
import base64
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


def unit_workload(emit):
    """Only the accepted finite repository command, after external release."""
    work = Path("/tmp/loom/work")
    shutil.copytree("/workspace", work, ignore=shutil.ignore_patterns("node_modules"))
    (work / "node_modules").symlink_to("/workspace/node_modules", target_is_directory=True)
    env = {key: value for key, value in os.environ.items() if not key.startswith("LOOM_")}
    inputs = [name for name in ("package.json", "bun.lock", "tsconfig.json", "README.md", ".gitignore",
              "plugins", "scripts", "dashboard", "agents", "skills", "commands", "docs", "evals", ".github")
              if (work / name).exists()]
    total, sequence = 0, 0
    def stream(channel, data):
        nonlocal total, sequence
        total += len(data)
        if total > 4 * 1048576:
            raise RuntimeError("approved workload output bound; loss unknown")
        for start in range(0, len(data), 1024):
            sequence += 1
            emit("inner-workload-stream", channel=channel, sequence=sequence,
                 base64=base64.b64encode(data[start:start + 1024]).decode("ascii"))
    for command in (["git", "init", "-q", str(work)], ["git", "add", "--", *inputs],
                    ["git", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Synthetic Test Fixture",
                     "-c", "user.email=fixture@invalid", "commit", "-qm", "Synthetic inner baseline"]):
        setup = subprocess.run(command, cwd=work, env=env, capture_output=True, timeout=30, close_fds=True)
        if len(setup.stdout) + len(setup.stderr) > 65536:
            raise RuntimeError("synthetic Git setup output bound")
        stream("stdout", setup.stdout)
        stream("stderr", setup.stderr)
        if setup.returncode:
            raise RuntimeError("synthetic Git setup refused before runner")
    process = subprocess.Popen(["bun", "run", "test"], cwd=work, env=env, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True)
    deadline = time.monotonic() + 1700
    try:
        with selectors.DefaultSelector() as selector:
            for pipe, channel in ((process.stdout, "stdout"), (process.stderr, "stderr")):
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, channel)
            while selector.get_map():
                if time.monotonic() > deadline:
                    raise RuntimeError("approved workload timeout; outcome unproven")
                for key, _ in selector.select(0.2):
                    data = os.read(key.fileobj.fileno(), 1024)
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    stream(key.data, data)
        status = process.wait(timeout=2)
        emit("inner-workload-done", command=["bun", "run", "test"], testExit=status,
             capturedBytes=total, interleaving="unproven", privateGit=True)
        return status
    finally:
        if process.poll() is None:
            process.kill()  # Not a descendant-empty claim; outer custody remains authoritative.
            process.wait(timeout=2)
        process.stdout.close()
        process.stderr.close()


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
    numbers = ctypes.CDLL("libseccomp.so.2")
    numbers.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    clone_number = numbers.seccomp_syscall_resolve_name(b"clone")
    if clone_number < 0:
        raise RuntimeError("clone namespace negative unavailable")
    libc.syscall.restype = ctypes.c_long
    ctypes.set_errno(0)
    cloned = libc.syscall(clone_number, ctypes.c_ulong(0x10000000 | signal.SIGCHLD),
                         ctypes.c_void_p(), ctypes.c_void_p(), ctypes.c_void_p(), ctypes.c_ulong())
    if cloned == 0:
        os._exit(78)
    if cloned != -1 or ctypes.get_errno() != errno.EPERM:
        raise RuntimeError("namespace-bearing clone was not denied")
    seccomp_checks.append({"syscall": "clone-CLONE_NEWUSER", "errno": errno.EPERM})
    clone3_number = numbers.seccomp_syscall_resolve_name(b"clone3")
    ctypes.set_errno(0)
    if clone3_number < 0 or libc.syscall(clone3_number, ctypes.c_void_p(), ctypes.c_ulong()) != -1 or ctypes.get_errno() != errno.ENOSYS:
        raise RuntimeError("clone3 unconditional denial missing")
    seccomp_checks.append({"syscall": "clone3", "errno": errno.ENOSYS})
    authority_denials = []
    for path, flags in (("/control/forged-release", os.O_WRONLY | os.O_CREAT),
                        ("/sys/fs/cgroup/cgroup.procs", os.O_WRONLY),
                        ("/run/user/1000/podman/podman.sock", os.O_RDONLY),
                        ("/run/dbus/system_bus_socket", os.O_RDONLY)):
        try:
            fd = os.open(path, flags, 0o600)
        except OSError as error:
            if error.errno not in {errno.EROFS, errno.ENOENT, errno.EPERM, errno.EACCES}:
                raise
            authority_denials.append({"path": path, "errno": error.errno})
        else:
            os.close(fd)
            raise RuntimeError("forbidden authority handle available")
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
         explicitSyscallDenials=seccomp_checks, authorityHandleDenials=authority_denials,
         standbyNamespacePids=[standby_child, standby_grandchild])
    deadline = time.monotonic() + 20
    release = Path("/control/inner-release")
    while not release.exists():
        if time.monotonic() > deadline:
            raise RuntimeError("no independent inner release")
        time.sleep(0.02)
    if release.is_symlink() or release.read_text() != nonce:
        raise RuntimeError("wrong inner release")
    for part in ("home", "config", "data", "state", "cache", "runtime", "tmp"):
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
    workload = os.environ.get("LOOM_INNER_WORKLOAD", "synthetic")
    status = unit_workload(emit) if workload == "unit-tests" else 0
    emit("inner-proof-done", productImports=workload == "unit-tests", testExit=status)
    return status


if __name__ == "__main__":
    raise SystemExit(main())
