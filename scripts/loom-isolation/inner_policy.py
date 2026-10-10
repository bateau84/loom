"""Pinned fixed synthetic inner policy. Execute ONLY inside verified fixture."""
import ctypes
import hashlib
import json
import os
import stat
import subprocess
import time
import sys
from pathlib import Path

DENY = ("mount", "umount2", "pivot_root", "unshare", "setns", "ptrace",
        "open_tree", "move_mount", "fsopen", "fsmount", "fspick", "mount_setattr",
        "process_vm_readv", "process_vm_writev", "bpf", "perf_event_open", "keyctl",
        "add_key", "request_key", "kexec_load", "reboot", "mknod", "mknodat", "clone3",
        "setuid", "setgid", "setreuid", "setregid", "setresuid", "setresgid", "setgroups")
NAMESPACE_FLAGS = (0x20000, 0x2000000, 0x4000000, 0x8000000, 0x10000000, 0x20000000, 0x40000000)
POLICY = {"schema": "loom-inner-policy/v1", "denySyscalls": DENY,
          "denyCloneNamespaceFlags": NAMESPACE_FLAGS, "denyIoctlRequest": 0x5412,
          "default": "allow-native-architecture-only", "denial": "EPERM", "clone3Denial": "ENOSYS"}


def denial_action(name):
    # glibc falls back to clone only on ENOSYS. clone3 is STILL never executed;
    # legacy clone separately denies every namespace-bearing flag.
    return 0x50000 | (38 if name == "clone3" else 1)


def arguments(fd: int, nonce: str, target: str, workload: str = "synthetic") -> list[str]:
    if fd < 0 or not nonce or not target.startswith("/") or workload not in {"synthetic", "unit-tests"}:
        raise ValueError("fixed policy/filter/identity required")
    args = ["/usr/bin/bwrap", "--unshare-user", "--unshare-pid", "--unshare-net", "--unshare-ipc",
            "--unshare-uts", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv",
            "--tmpfs", "/", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
            "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin",
            "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
            "--ro-bind", "/workspace", "/workspace", "--ro-bind", "/control", "/control",
            "--ro-bind", "/probes", "/probes", "--chdir", "/workspace", "--seccomp", str(fd)]
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/tmp/loom/home",
           "XDG_CONFIG_HOME": "/tmp/loom/config", "XDG_DATA_HOME": "/tmp/loom/data",
           "XDG_STATE_HOME": "/tmp/loom/state", "XDG_CACHE_HOME": "/tmp/loom/cache",
           "XDG_RUNTIME_DIR": "/tmp/loom/runtime", "OPENCODE_DB": "/tmp/loom/data/opencode.db",
           "LOOM_CONTAINER_NONCE": nonce, "LOOM_CONTAINER_SENTINEL": target}
    if workload == "unit-tests":
        args += ["--ro-bind", "/opt/loom-test-deps", "/opt/loom-test-deps"]
        # Debian's /usr/bin/awk points through /etc/alternatives. Recreate only
        # the finite image toolchain link, never expose host/image /etc config.
        args += ["--dir", "/etc", "--dir", "/etc/alternatives", "--symlink", "/usr/bin/mawk", "/etc/alternatives/awk"]
        env.update(LOOM_INNER_WORKLOAD="unit-tests", PYTHONPATH="/opt/loom-test-deps/eval-runner",
                   OPENCODE_DISABLE_AUTOUPDATE="1", TMPDIR="/tmp/loom/tmp")
    for key, value in env.items():
        args += ["--setenv", key, value]
    return args + ["--", "/usr/bin/python3", "-I", "-S", "-B", "/workspace/scripts/loom-isolation/inner_gate.py"]


def filter_fd() -> int:
    library = ctypes.CDLL("libseccomp.so.2")
    class Comparison(ctypes.Structure):
        _fields_ = [("arg", ctypes.c_uint), ("op", ctypes.c_int), ("a", ctypes.c_uint64), ("b", ctypes.c_uint64)]
    library.seccomp_init.argtypes, library.seccomp_init.restype = [ctypes.c_uint32], ctypes.c_void_p
    library.seccomp_release.argtypes = [ctypes.c_void_p]
    library.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    library.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int,
                                             ctypes.c_uint, ctypes.POINTER(Comparison)]
    library.seccomp_export_bpf.argtypes = [ctypes.c_void_p, ctypes.c_int]
    context = library.seccomp_init(0x7fff0000)
    if not context:
        raise RuntimeError("seccomp initialization unavailable")
    fd = os.memfd_create("loom-pinned-policy", os.MFD_CLOEXEC)
    try:
        def rule(name, comparison=None):
            number = library.seccomp_syscall_resolve_name(name.encode())
            if number < 0:
                raise RuntimeError("required seccomp syscall unavailable: " + name)
            value = library.seccomp_rule_add_array(context, denial_action(name), number, 1 if comparison else 0,
                                                   ctypes.byref(comparison) if comparison else None)
            if value:
                raise RuntimeError("required seccomp rule unavailable: " + name)
        for name in DENY:
            rule(name)
        for flag in NAMESPACE_FLAGS:
            rule("clone", Comparison(0, 7, flag, flag))
        rule("ioctl", Comparison(1, 4, 0x5412, 0))
        if library.seccomp_export_bpf(context, fd):
            raise RuntimeError("seccomp export unavailable")
        os.lseek(fd, 0, os.SEEK_SET)
        return fd
    except BaseException:
        os.close(fd)
        raise
    finally:
        library.seccomp_release(context)


def main():
    nonce, target = os.environ.get("LOOM_CONTAINER_NONCE"), os.environ.get("LOOM_CONTAINER_SENTINEL")
    if not nonce or not target or not Path("/control").is_dir() or Path("/control/release").exists():
        raise RuntimeError("verified held outer fixture required")
    binary = Path("/usr/bin/bwrap")
    mode = binary.stat().st_mode
    if not stat.S_ISREG(mode) or mode & (stat.S_ISUID | stat.S_ISGID) or os.getuid() == 0:
        raise RuntimeError("non-setuid rootless substrate required")
    workload = "unit-tests" if sys.argv[1:] == ["--unit-tests"] else "synthetic"
    if workload == "unit-tests" and Path("/usr/bin/awk").resolve(strict=True) != Path("/usr/bin/mawk"):
        raise RuntimeError("unverified image awk toolchain closure")
    if sys.argv[1:] and workload != "unit-tests":
        if sys.argv[1:] != ["--missing-policy"]:
            raise RuntimeError("unsupported fixed proof input")
        try:
            arguments(-1, nonce, target)
        except ValueError:
            print(json.dumps({"event": "inner-policy-refused", "nonce": nonce,
                              "missingPolicy": True, "beforeBwrapChild": True, "productImports": False}), flush=True)
            return 78
        raise RuntimeError("missing policy was not refused")
    fd = filter_fd()
    try:
        version = subprocess.run([str(binary), "--version"], stdin=subprocess.DEVNULL,
                                 capture_output=True, close_fds=True, timeout=2)
        if version.returncode or version.stderr or len(version.stdout) > 256:
            raise RuntimeError("substrate version attestation unavailable")
        bpf = os.pread(fd, 65536, 0)
        print(json.dumps({"event": "inner-policy-prepared", "nonce": nonce,
            "policySha256": hashlib.sha256(json.dumps(POLICY, sort_keys=True).encode()).hexdigest(),
            "workload": workload,
            "filterSha256": hashlib.sha256(bpf).hexdigest(), "filterBytes": len(bpf),
            "bwrapSha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
            "bwrapVersion": version.stdout.decode("ascii").strip()}), flush=True)
        process = subprocess.Popen(arguments(fd, nonce, target, workload), pass_fds=(fd,), close_fds=True)
        marker = Path("/control/inner-parent-loss")
        while process.poll() is None:
            if marker.exists():
                if marker.is_symlink() or marker.read_text() != nonce:
                    raise RuntimeError("wrong parent-loss test binding")
                # Deliberate loss of this trusted policy parent. bwrap's real
                # die-with-parent/PID-namespace teardown must stop its children;
                # do not substitute explicit child kill or a fabricated exit.
                os._exit(88)
            time.sleep(0.02)
        return process.returncode
    finally:
        os.close(fd)


if __name__ == "__main__":
    raise SystemExit(main())
