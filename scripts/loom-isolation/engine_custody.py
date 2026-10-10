"""Parent-only, exact-object custody observations. Never writes host cgroups.

Only the existing local rootless engine controls its newly created workload.
Kernel reads are narrowly derived from that object's inspected scope/PID, not
host discovery. Missing recursive observation is refusal, never status proof.
"""
import os
import re
import stat
import threading
import ctypes
import time
from pathlib import Path
from podman_witness import PODMAN, Refusal, capture_command, error_class, one_record


def scope_path(value: str, identity: str) -> Path:
    # Podman State.CgroupPath is a hierarchy-absolute path, not a host
    # filesystem path. Both representations resolve only under this mount.
    if value.startswith("/user.slice/"):
        value = "/sys/fs/cgroup" + value
    path = Path(value)
    if (not re.fullmatch(r"[0-9a-f]{64}", identity) or not path.is_absolute()
            or ".." in path.parts or not value.startswith("/sys/fs/cgroup/")
            or f"libpod-{identity}.scope" not in path.parts):
        raise Refusal("custody-exact-engine-scope-required")
    return path


def parse_events(value: str) -> dict:
    result = {}
    for line in value.splitlines():
        key, number = line.split()
        if key in result or number not in {"0", "1"}:
            raise Refusal("custody-invalid-kernel-events")
        result[key] = int(number)
    if set(result) != {"populated", "frozen"}:
        raise Refusal("custody-recursive-events-unavailable")
    return result


def start_ticks(value: str) -> int:
    # comm may contain whitespace and ')'; fields after its final ')' start at3.
    return int(value.rsplit(")", 1)[1].split()[19])


def in_scope(value: str, relative: str) -> bool:
    lines = value.splitlines()
    return len(lines) == 1 and (lines[0] == "0::" + relative or lines[0].startswith("0::" + relative + "/"))


def workload_relative(membership: str, engine_relative: str) -> str:
    # The OCI runtime may put workload in /container and its monitor in the
    # enclosing libpod scope. Observing that monitor parent as the workload
    # would falsely require monitor freeze/exit. No arbitrary subtree guessing.
    for candidate in (engine_relative, engine_relative + "/container"):
        if membership.strip() == "0::" + candidate:
            return candidate
    raise Refusal("custody-unrecognised-workload-subtree")


def process_identity(pid: int) -> tuple[int, str]:
    if pid <= 1:
        raise Refusal("custody-invalid-member-pid")
    base = Path(f"/proc/{pid}")
    before = start_ticks((base / "stat").read_text())
    membership = (base / "cgroup").read_text()
    if before != start_ticks((base / "stat").read_text()):
        raise Refusal("custody-member-pid-reused")
    return before, membership


def watch_zero(read, stop, ready) -> dict:
    """A missed transition/error is unknown, never inferred retirement."""
    deadline = time.monotonic() + 6
    samples = 0
    try:
        while not stop.is_set() and time.monotonic() < deadline:
            state = read()
            samples += 1
            ready.set()
            if state["populated"] == 0:
                return {"recursiveZero": True, "kernelEvents": state, "samples": samples}
            stop.wait(0.0005)
        return {"outcome": "unknown", "samples": samples}
    except OSError as error:
        return {"outcome": "unknown", "errno": error.errno, "samples": samples}
    except Exception as error:
        return {"outcome": "unknown", "errorClass": type(error).__name__, "samples": samples}
    finally:
        ready.set()


def cgroup_filesystem(fd: int) -> int:
    # Linux statfs starts with native-long f_type; sufficiently large buffer
    # permits the kernel/libc to fill its complete structure without guessing
    # trailing field layout. This is metadata only, no cgroup write/control.
    libc = ctypes.CDLL(None, use_errno=True)
    libc.fstatfs.argtypes = [ctypes.c_int, ctypes.c_void_p]
    libc.fstatfs.restype = ctypes.c_int
    buffer = ctypes.create_string_buffer(256)
    if libc.fstatfs(fd, buffer) != 0:
        raise OSError(ctypes.get_errno(), "cgroup filesystem metadata unavailable")
    value = ctypes.c_long.from_buffer(buffer).value
    if value != 0x63677270:
        raise Refusal("custody-not-cgroup2-filesystem")
    return value


class Custody:
    """One held-gate owner, no release or arbitrary exec interface."""
    def __init__(self, record: dict, observations: list):
        self.identity = record["Id"]
        self.created = record["Created"]
        self.started = record["State"]["StartedAt"]
        self.pid = record["State"]["Pid"]
        self.scope = scope_path(record["State"].get("CgroupPath", ""), self.identity)
        self.engine_scope = record["State"]["CgroupPath"]
        engine_relative = str(self.scope).removeprefix("/sys/fs/cgroup")
        if (record["HostConfig"].get("RestartPolicy", {}).get("Name") != "no"
                or record.get("RestartCount") != 0 or record.get("ExecIDs")):
            raise Refusal("custody-restart-or-competing-exec")
        self.observations = observations
        self.directory = self.events_fd = -1
        self.closed = False
        self.trusted_exec = set()
        self.phase = "enrollment"
        self.ticks = start_ticks(self.proc("stat"))
        membership = self.proc("cgroup")
        if not in_scope(membership, engine_relative):
            raise Refusal("custody-gate-outside-exact-domain")
        self.relative = workload_relative(membership, engine_relative)
        self.scope = Path("/sys/fs/cgroup" + self.relative)
        self.observations.append({"phase": "workload-domain-bound", "engineScope": self.engine_scope,
                                  "workloadScope": self.relative, "gateMembership": membership.strip(),
                                  "containerId": self.identity, "hostPid": self.pid, "startTicks": self.ticks})
        # Walk only the exact inspected path, reject symlinks, hold inode-bound
        # descriptors before termination. No writable control FD is obtained.
        fd = os.open("/sys/fs/cgroup", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            for part in self.scope.parts[4:]:
                next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                os.close(fd)
                fd = next_fd
            self.directory = fd
            fd = -1
            self.events_fd = os.open("cgroup.events", os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                                     dir_fd=self.directory)
            self.inode = os.fstat(self.directory).st_ino
            self.device = os.fstat(self.directory).st_dev
            self.filesystem = cgroup_filesystem(self.directory)
            self.event_identity = (os.fstat(self.events_fd).st_dev, os.fstat(self.events_fd).st_ino)
        except BaseException:
            self.close()
            raise
        finally:
            if fd != -1:
                os.close(fd)
        try:
            self.observe("enrolled", populated=1, frozen=0)
        except BaseException:
            self.close()
            raise

    def proc(self, name: str) -> str:
        if self.pid <= 1 or name not in {"stat", "cgroup"}:
            raise Refusal("custody-invalid-process-observation")
        return Path(f"/proc/{self.pid}/{name}").read_text()

    def command(self, operation: str, *arguments: str) -> bytes:
        try:
            result = capture_command([PODMAN, "--remote=false", operation, self.identity, *arguments])
        except Refusal:
            self.observations.append({"phase": self.phase, "operation": operation,
                                      "containerId": self.identity, "outcome": "unknown"})
            raise
        entry = {"phase": self.phase, "operation": operation, "containerId": self.identity,
                 "exit": result["status"], "errorClass": error_class(result["stderr"]) if result["status"] else None}
        self.observations.append(entry)
        if result["status"]:
            if self.events_fd != -1:
                entry["sameHeldKernelEvents"] = parse_events(os.pread(self.events_fd, 4096, 0).decode("ascii"))
            raise Refusal(f"custody-{self.phase}-{operation}-exit-{result['status']}:{entry['errorClass']}")
        return result["stdout"]

    def current(self) -> None:
        record = one_record(self.command("inspect"))
        self.observations.append({"phase": self.phase + "-inspected-state", "containerId": self.identity,
                                  "running": record["State"].get("Running"), "paused": record["State"].get("Paused")})
        if (record["Id"] != self.identity or record["Created"] != self.created
                or record["State"]["StartedAt"] != self.started or record["State"]["Pid"] != self.pid
                or record["State"]["CgroupPath"] != self.engine_scope or record.get("RestartCount") != 0
                or set(record.get("ExecIDs", [])) != getattr(self, "trusted_exec", set())
                or start_ticks(self.proc("stat")) != self.ticks
                or not in_scope(self.proc("cgroup"), self.relative)
                or self.scope.stat().st_ino != self.inode):
            raise Refusal("custody-object-process-or-scope-drift")
        if self.phase == "post-freeze":
            if record["State"].get("Paused") is not True or record["State"].get("Running") is not False:
                raise Refusal("custody-frozen-engine-state-drift")
            self.frozen_members()
            return
        if record["State"].get("Running") is not True or record["State"].get("Paused") is not False:
            raise Refusal("custody-running-engine-state-drift")
        # Kernel membership of every engine-reported workload PID must match the
        # observed recursive subtree. No host process enumeration or extra exec.
        rows = self.command("top", "hpid").decode().splitlines()
        if not rows or rows[0].strip() != "HPID" or len(rows) > 513:
            raise Refusal("custody-bounded-workload-membership-unavailable")
        pids = [int(row.strip()) for row in rows[1:]]
        if self.pid not in pids:
            raise Refusal("custody-gate-not-in-engine-workload")
        for pid in pids:
            if pid <= 1 or not in_scope(Path(f"/proc/{pid}/cgroup").read_text(), self.relative):
                raise Refusal("custody-workload-outside-recursive-domain")
        self.observations.append({"phase": "all-reported-workload-membership", "hostPids": pids,
                                  "containerId": self.identity, "scopeInode": self.inode})

    def frozen_members(self) -> None:
        def frozen():
            if parse_events(os.pread(self.events_fd, 4096, 0).decode("ascii")) != {"populated": 1, "frozen": 1}:
                raise Refusal("custody-frozen-kernel-state-drift")
        frozen()
        pids, nodes = set(), 0
        def walk(directory):
            nonlocal nodes
            nodes += 1
            if nodes > 64:
                raise Refusal("custody-subtree-bound")
            fd = os.open("cgroup.procs", os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
            try:
                data = os.read(fd, 8193)
                if len(data) > 8192:
                    raise Refusal("custody-membership-output-bound")
                pids.update(int(value) for value in data.decode("ascii").splitlines())
                if len(pids) > 512:
                    raise Refusal("custody-member-bound")
            finally:
                os.close(fd)
            for name in os.listdir(directory):
                mode = os.stat(name, dir_fd=directory, follow_symlinks=False).st_mode
                if stat.S_ISLNK(mode):
                    raise Refusal("custody-subtree-symlink")
                if stat.S_ISDIR(mode):
                    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
                    try:
                        walk(child)
                    finally:
                        os.close(child)
        walk(self.directory)
        if self.pid not in pids:
            raise Refusal("custody-frozen-gate-missing")
        members = []
        for pid in sorted(pids):
            ticks, membership = process_identity(pid)
            if not in_scope(membership, self.relative) or (pid == self.pid and ticks != self.ticks):
                raise Refusal("custody-frozen-member-drift")
            members.append({"pid": pid, "startTicks": ticks})
        frozen()
        self.observations.append({"phase": "current-frozen-recursive-membership", "hostPids": sorted(pids),
                                  "members": members, "groups": nodes, "containerId": self.identity,
                                  "scopeInode": self.inode})

    def observe(self, phase: str, *, populated: int, frozen: int | None = None) -> dict:
        deadline = time.monotonic() + 3
        while True:
            state = parse_events(os.pread(self.events_fd, 4096, 0).decode("ascii"))
            if state["populated"] == populated and (frozen is None or state["frozen"] == frozen):
                observation = {"phase": phase, "events": state, "scopeInode": self.inode,
                               "containerId": self.identity, "hostPid": self.pid, "startTicks": self.ticks}
                self.observations.append(observation)
                return observation
            if time.monotonic() >= deadline:
                self.observations.append({"phase": phase + "-unobserved", "lastKernelEvents": state,
                                          "containerId": self.identity, "scopeInode": self.inode})
                raise Refusal("custody-recursive-transition-unobserved-" + phase)
            time.sleep(0.01)

    def kernel_events(self) -> dict:
        directory = os.fstat(self.directory)
        event = os.fstat(self.events_fd)
        if ((directory.st_dev, directory.st_ino) != (self.device, self.inode)
                or (event.st_dev, event.st_ino) != self.event_identity):
            raise Refusal("custody-held-object-drift")
        return parse_events(os.pread(self.events_fd, 4096, 0).decode("ascii"))

    def exercise(self, progress=None) -> None:
        # No product admission exists in this prerequisite operation; all control
        # transitions occur serially under this one owner's held release gate.
        self.current()
        if progress:
            progress("running", False)
        self.command("pause")
        self.observe("frozen", populated=1, frozen=1)
        self.phase = "post-freeze"
        self.current()
        if progress:
            progress("frozen", True)
        self.command("unpause")
        self.observe("thawed", populated=1, frozen=0)
        self.phase = "post-thaw"
        self.current()
        if progress:
            progress("thawed", False)
        self.closed = True
        self.phase = "termination"
        if self.kernel_events() != {"populated": 1, "frozen": 0}:
            raise Refusal("custody-pre-termination-state-drift")
        stop, ready = threading.Event(), threading.Event()
        result = {}
        def run():
            result.update(watch_zero(self.kernel_events, stop, ready))
        watcher = threading.Thread(target=run, name="bound-cgroup-zero-observer")
        watcher.start()
        try:
            if not ready.wait(1) or result:
                raise Refusal("custody-zero-observer-not-armed")
            self.command("kill", "--signal", "KILL")
            watcher.join(6.2)
        finally:
            stop.set()
            watcher.join()
            self.observations.append({"phase": "prearmed-recursive-zero-result", "containerId": self.identity,
                                      "scopeInode": self.inode, "scopeDevice": self.device,
                                      "filesystemMagic": self.filesystem, "eventIdentity": self.event_identity,
                                      "result": result})
        if result.get("recursiveZero") is not True:
            raise Refusal("custody-recursive-zero-not-observed")

    def close(self) -> None:
        for fd in (self.events_fd, self.directory):
            if fd != -1:
                os.close(fd)
        self.events_fd = self.directory = -1
