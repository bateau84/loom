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
import subprocess
import selectors
import json
import struct
import select
import time
from pathlib import Path
from podman_witness import PODMAN, Refusal, capture_command, error_class, one_record, engine_environment


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


def session_id(value: str) -> int:
    return int(value.rsplit(")", 1)[1].split()[3])


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


class TreeStream:
    """Own one fixed helper exec and bounded read-only counter pipes."""
    script = "custody_payload.py"
    extra_args = ()

    def ready(self):
        return len(self.counts) == 3

    def done(self):
        return False

    def __init__(self, identity: str, nonce: str):
        self.nonce, self.counts, self.pending, self.total = nonce, {}, bytearray(), 0
        self.process = subprocess.Popen([PODMAN, "--remote=false", "exec", identity,
            "python3", "-I", "-S", "-B", "/workspace/scripts/loom-isolation/" + self.script, *self.extra_args],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=engine_environment(), close_fds=True, start_new_session=True)
        self.selector = selectors.DefaultSelector()
        for pipe, kind in ((self.process.stdout, "counter"), (self.process.stderr, "error")):
            os.set_blocking(pipe.fileno(), False)
            self.selector.register(pipe, selectors.EVENT_READ, kind)
        try:
            deadline = time.monotonic() + 3
            while not self.ready() and time.monotonic() < deadline:
                self.drain(0.05)
            if not self.ready():
                raise Refusal("custody-counter-stream-not-ready")
        except BaseException:
            self.close()
            raise

    def accept(self, data: bytes) -> None:
        value = json.loads(data)
        if (set(value) != {"nonce", "pid", "count"} or value["nonce"] != self.nonce
                or type(value["pid"]) is not int or value["pid"] <= 1
                or type(value["count"]) is not int or value["count"] <= self.counts.get(value["pid"], 0)
                or (value["pid"] not in self.counts and len(self.counts) >= 3)):
            raise Refusal("custody-counter-stream-identity-or-progress")
        self.counts[value["pid"]] = value["count"]

    def drain(self, interval: float) -> None:
        deadline = time.monotonic() + interval
        while time.monotonic() < deadline:
            for key, _ in self.selector.select(max(0, deadline - time.monotonic())):
                data = os.read(key.fileobj.fileno(), 4096)
                if not data:
                    if self.done():
                        return
                    raise Refusal("custody-counter-stream-closed")
                self.total += len(data)
                if self.total > 1048576:
                    raise Refusal("custody-counter-stream-bound")
                if key.data == "error":
                    raise Refusal("custody-counter-stream-error:" + error_class(data))
                self.pending.extend(data)
                if len(self.pending) > 16384:
                    raise Refusal("custody-counter-record-bound")
                while b"\n" in self.pending:
                    line, _, tail = self.pending.partition(b"\n")
                    self.pending = bytearray(tail)
                    self.accept(line)

    def progress(self, observer, stage: str, frozen: bool) -> None:
        # Drain bounded transport backlog after kernel-completed freeze. This
        # cannot thaw or query the paused workload; only already-owned pipes.
        self.drain(0.2)
        before = dict(self.counts)
        if frozen and observer.kernel_events() != {"populated": 1, "frozen": 1}:
            raise Refusal("custody-counter-freeze-drift")
        self.drain(0.1)
        after = dict(self.counts)
        if (before.keys() != after.keys() or (frozen and before != after)
                or (not frozen and any(after[pid] <= before[pid] for pid in before))):
            raise Refusal("custody-counter-transition-unproven-" + stage)
        if frozen and observer.kernel_events() != {"populated": 1, "frozen": 1}:
            raise Refusal("custody-counter-freeze-drift")
        observer.observations.append({"phase": stage + "-synthetic-stream-counter",
            "before": before, "after": after, "frozen": frozen, "containerId": observer.identity})

    def close(self):
        try:
            self.process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            self.process.terminate()  # Only this owned local frontend, not payload proof.
            try:
                self.process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=1)
        finally:
            self.selector.close()
            self.process.stdout.close()
            self.process.stderr.close()


class InnerStream(TreeStream):
    script = "inner_policy.py"

    def __init__(self, identity, nonce):
        self.events = []
        super().__init__(identity, nonce)

    def accept(self, data):
        value = json.loads(data)
        if value.get("nonce") != self.nonce or value.get("event") not in {
                "inner-policy-prepared", "inner-ready", "inner-setup", "inner-descendant", "inner-proof-done",
                "inner-policy-refused"}:
            raise Refusal("inner-protocol-identity-or-event")
        self.events.append(value)

    def ready(self):
        return any(value["event"] == "inner-ready" for value in self.events)

    def done(self):
        return any(value["event"] == "inner-proof-done" for value in self.events)

    def inspect_gate(self, identity, outer_namespaces, scope, outer_filter_count, outer_session):
        ready = next(value for value in self.events if value["event"] == "inner-ready")
        rows = capture_command([PODMAN, "--remote=false", "top", identity, "hpid"])
        if rows["status"]:
            raise Refusal("inner-process-observation-unavailable:" + error_class(rows["stderr"]))
        candidates = []
        for line in rows["stdout"].decode().splitlines()[1:]:
            pid = int(line.strip())
            base = Path(f"/proc/{pid}")
            status = dict(row.split(":", 1) for row in (base / "status").read_text().splitlines() if ":" in row)
            if int(status["NSpid"].split()[-1]) != ready["namespacePid"]:
                continue
            namespaces = {kind: os.readlink(base / "ns" / kind) for kind in outer_namespaces}
            if namespaces != ready["namespaces"]:
                continue
            ticks, membership = process_identity(pid)
            if (any(namespaces[kind] == outer_namespaces[kind] for kind in namespaces)
                    or not in_scope(membership, scope) or status["NoNewPrivs"].strip() != "1"
                    or status["Seccomp"].strip() != "2" or int(status["Seccomp_filters"].strip()) <= outer_filter_count
                    or any(int(uid) != os.geteuid() for uid in status["Uid"].split())
                    or any(int(status[key].strip(), 16) for key in ("CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"))):
                raise Refusal("inner-independent-kernel-policy-mismatch")
            fds = sorted(int(name) for name in os.listdir(base / "fd"))
            if fds != [0, 1, 2]:
                raise Refusal("inner-independent-fd-allowlist")
            fd_targets = {fd: os.readlink(base / "fd" / str(fd)) for fd in fds}
            if fd_targets[0] != "/dev/null" or any(not fd_targets[fd].startswith("pipe:") for fd in (1, 2)):
                raise Refusal("inner-independent-stdio-types")
            session = session_id((base / "stat").read_text())
            if session == outer_session:
                raise Refusal("inner-independent-session-separation")
            mounts = {}
            root_filesystem = None
            for row in (base / "mountinfo").read_text().splitlines():
                fields = row.split(" - ", 1)[0].split()
                target = fields[4]
                if target not in {"/", "/proc", "/tmp", "/usr", "/workspace", "/control", "/probes", "/dev"} and not target.startswith("/dev/"):
                    raise Refusal("inner-independent-mount-allowlist")
                mounts[target] = fields[5].split(",")
                if target == "/":
                    root_filesystem = row.split(" - ", 1)[1].split()[0]
            if any("ro" not in mounts.get(target, []) for target in ("/usr", "/workspace", "/control", "/probes")):
                raise Refusal("inner-independent-readonly-inputs")
            if root_filesystem != "tmpfs":
                raise Refusal("inner-independent-empty-root")
            candidates.append({"hostPid": pid, "startTicks": ticks, "namespaces": namespaces,
                "inheritedFDs": fds, "mounts": mounts, "rootFilesystem": root_filesystem,
                "stdioTypes": {"0": "null", "1": "pipe", "2": "pipe"},
                "outerSession": outer_session, "session": session,
                "outerSeccompFilters": outer_filter_count, "seccompFilters": int(status["Seccomp_filters"].strip())})
        if len(candidates) != 1:
            raise Refusal("inner-independent-gate-identity-ambiguous")
        return candidates[0]

    def finish(self):
        deadline = time.monotonic() + 5
        while not any(value["event"] == "inner-proof-done" for value in self.events):
            if time.monotonic() > deadline:
                raise Refusal("inner-proof-timeout")
            self.drain(0.05)
        if self.process.wait(timeout=2) != 0:
            raise Refusal("inner-proof-process-failed")
        return self.events

    def bind_namespace_lifetime(self, identity):
        ready = next(value for value in self.events if value["event"] == "inner-ready")
        result = capture_command([PODMAN, "--remote=false", "top", identity, "hpid"])
        if result["status"]:
            raise Refusal("inner-peer-lifetime-observation-unavailable")
        peers = []
        try:
            for row in result["stdout"].decode().splitlines()[1:]:
                pid = int(row.strip())
                if os.readlink(f"/proc/{pid}/ns/pid") != ready["namespaces"]["pid"]:
                    continue
                ticks, _ = process_identity(pid)
                fd = os.pidfd_open(pid, 0)
                peers.append({"pid": pid, "startTicks": ticks, "fd": fd})
                if process_identity(pid)[0] != ticks:
                    raise Refusal("inner-peer-birth-drift")
            if len(peers) < len(ready["standbyNamespacePids"]) + 2:
                raise Refusal("inner-pid-namespace-peers-unproven")
            return peers
        except BaseException:
            for peer in peers:
                os.close(peer["fd"])
            raise

    def parent_loss(self, peers):
        deadline = time.monotonic() + 3
        waiting = {peer["fd"] for peer in peers}
        try:
            while waiting and time.monotonic() < deadline:
                exited, _, _ = select.select(list(waiting), [], [], max(0, deadline - time.monotonic()))
                waiting.difference_update(exited)
            if waiting or self.process.wait(timeout=1) != 88:
                raise Refusal("inner-parent-loss-exit-unproven")
            if any(value["event"] in {"inner-setup", "inner-descendant", "inner-proof-done"} for value in self.events):
                raise Refusal("inner-parent-loss-released-setup")
            return {"source": "kernel-pidfd-exit-readiness", "policyParentExit": 88,
                    "namespacePeers": [{"pid": peer["pid"], "startTicks": peer["startTicks"]} for peer in peers],
                    "innerReleasePublished": False}
        finally:
            for peer in peers:
                os.close(peer["fd"])


class InnerRefusal(InnerStream):
    extra_args = ("--missing-policy",)

    def ready(self):
        return any(value["event"] == "inner-policy-refused" for value in self.events)

    def done(self):
        return self.ready()

    def proof(self):
        if self.process.wait(timeout=2) != 78 or len(self.events) != 1:
            raise Refusal("inner-missing-policy-refusal-unproven")
        value = self.events[0]
        if value.get("beforeBwrapChild") is not True or value.get("missingPolicy") is not True or value.get("productImports") is not False:
            raise Refusal("inner-missing-policy-refusal-boundary")
        return value


def retirement_events(data: bytes, descriptor: int) -> bool:
    deleted = False
    while data:
        if len(data) < 16:
            raise Refusal("custody-lifetime-event-truncated")
        wd, mask, cookie, length = struct.unpack("iIII", data[:16])
        if (wd != descriptor or cookie or length or mask & (0x2000 | 0x4000)
                or mask & ~(0x400 | 0x8000 | 0x40000000)):
            raise Refusal("custody-lifetime-event-unbound-or-loss")
        deleted |= bool(mask & 0x400)  # IN_DELETE_SELF on the DIRECTORY, not its events file.
        data = data[16 + length:]
    if not deleted:
        raise Refusal("custody-domain-retirement-unobserved")
    return True


class DirectoryLifetime:
    """Read-only inotify watch on the already-held directory object."""
    def __init__(self, directory: int):
        self.bound = os.fstat(directory)
        libc = ctypes.CDLL(None, use_errno=True)
        libc.inotify_init1.argtypes, libc.inotify_init1.restype = [ctypes.c_int], ctypes.c_int
        libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
        libc.inotify_add_watch.restype = ctypes.c_int
        self.fd = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
        if self.fd < 0:
            raise OSError(ctypes.get_errno(), "custody-directory-notification-unavailable")
        try:
            # This is a descriptor alias of our pinned object, not a process
            # root or reopened same-named domain. Owner never closes/reuses it
            # until the observation ends.
            self.wd = libc.inotify_add_watch(self.fd, f"/proc/self/fd/{directory}".encode(), 0x400 | 0x2000)
            if self.wd < 0:
                raise OSError(ctypes.get_errno(), "custody-directory-notification-unavailable")
            after = os.fstat(directory)
            if (after.st_dev, after.st_ino) != (self.bound.st_dev, self.bound.st_ino):
                raise Refusal("custody-directory-watch-identity-drift")
        except BaseException:
            self.close()
            raise

    def observed(self) -> dict:
        if not select.select([self.fd], [], [], 2)[0]:
            raise Refusal("custody-domain-retirement-unobserved")
        data = os.read(self.fd, 4096)
        retirement_events(data, self.wd)
        return {"directoryDeleteSelf": True, "source": "kernel-inotify-pinned-directory",
                "device": self.bound.st_dev, "inode": self.bound.st_ino, "watchDescriptor": self.wd}

    def close(self):
        if self.fd != -1:
            os.close(self.fd)
            self.fd = -1


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
        # The exact kernel domain is authoritative, not psgo's optional HPID
        # translation (which need not provide a numeric mapping for every row).
        # No row is silently skipped: sample all current recursive kernel members.
        self.frozen_members(require_frozen=False)

    def frozen_members(self, require_frozen=True) -> None:
        def frozen():
            if parse_events(os.pread(self.events_fd, 4096, 0).decode("ascii")) != {"populated": 1, "frozen": int(require_frozen)}:
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
        if not require_frozen:
            first = set(pids)
            pids.clear()
            nodes = 0
            walk(self.directory)
            if pids != first:
                raise Refusal("custody-running-membership-changed-during-observation")
        frozen()
        self.observations.append({"phase": "current-frozen-recursive-membership" if require_frozen else "current-running-recursive-membership", "hostPids": sorted(pids),
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
        lifetime = DirectoryLifetime(self.directory)
        stop, ready = threading.Event(), threading.Event()
        result = {}
        def run():
            result.update(watch_zero(self.kernel_events, stop, ready))
        watcher = threading.Thread(target=run, name="bound-cgroup-zero-observer")
        watcher.start()
        try:
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
                self.observations.append({"phase": "bound-directory-retirement-observed",
                    "containerId": self.identity, "observation": lifetime.observed(),
                    "meaning": "directory lifetime evidence; full coverage/source applicability still required"})
        finally:
            lifetime.close()

    def close(self) -> None:
        for fd in (self.events_fd, self.directory):
            if fd != -1:
                os.close(fd)
        self.events_fd = self.directory = -1
