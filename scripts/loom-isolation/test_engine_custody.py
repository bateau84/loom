"""Pure custody identity/parser checks; no engine or host kernel reads."""
import unittest
import os
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
import engine_custody
from podman_witness import Refusal, error_class


class CustodyTests(unittest.TestCase):
    def test_authenticated_domain_offline_is_not_errno_or_path_absence(self):
        before = {"device": 30, "inode": 123, "links": 2, "directory": True, "filesystem": 0x63677270}
        after = {**before, "links": 0}
        self.assertTrue(engine_custody.authenticated_offline(before, after, 19, True))
        for changed in ({**after, "links": 2}, {**after, "inode": 124}, {**after, "directory": False},
                        {**after, "filesystem": 1}):
            with self.assertRaises(Refusal):
                engine_custody.authenticated_offline(before, changed, 19, True)
        for error in (5, 9, 13, None):
            with self.assertRaises(Refusal):
                engine_custody.authenticated_offline(before, after, error, True)
        with self.assertRaises(Refusal):
            engine_custody.authenticated_offline(before, after, 19, False)
    def test_admission_race_epoch_and_unknown_termination_never_release_or_retry(self):
        import threading
        gate = engine_custody.AdmissionGate(("object", "epoch"), [])
        entered, finish = threading.Event(), threading.Event()
        effects, failures = [], []
        def freeze():
            entered.set()
            finish.wait(1)
        thread = threading.Thread(target=lambda: gate.invoke(("object", "epoch"), "freeze", freeze))
        thread.start()
        self.assertTrue(entered.wait(1))
        def release():
            try:
                gate.invoke(("object", "epoch"), "release", lambda: effects.append("released"))
            except Refusal:
                failures.append("denied")
        contender = threading.Thread(target=release)
        contender.start()
        finish.set()
        thread.join()
        contender.join()
        self.assertEqual(effects, [])
        self.assertEqual(failures, ["denied"])
        with self.assertRaises(Refusal):
            gate.invoke(("object", "old-epoch"), "thaw", lambda: effects.append("wrong"))
        gate.invoke(("object", "epoch"), "thaw", lambda: None)
        def lost():
            effects.append("termination-issued")
            raise Refusal("response-lost")
        with self.assertRaises(Refusal):
            gate.invoke(("object", "epoch"), "terminate", lost)
        for operation in ("release", "exec", "restart", "terminate"):
            with self.assertRaises(Refusal):
                gate.invoke(("object", "epoch"), operation, lambda: effects.append("unsafe"))
        self.assertEqual(effects, ["termination-issued"])
    def test_directory_retirement_event_rejects_unbound_loss_or_file_only_events(self):
        import struct
        self.assertTrue(engine_custody.retirement_events(struct.pack("iIII", 7, 0x400, 0, 0), 7))
        for wd, mask in ((8, 0x400), (7, 0x8000), (7, 0x2000), (7, 0x4000), (7, 0x200)):
            with self.assertRaises(Refusal):
                engine_custody.retirement_events(struct.pack("iIII", wd, mask, 0, 0), 7)
    def test_counter_stream_requires_exact_nonce_and_monotonic_member_counts(self):
        stream = engine_custody.TreeStream.__new__(engine_custody.TreeStream)
        stream.nonce, stream.counts = "bound", {}
        stream.accept(b'{"nonce":"bound","pid":2,"count":1}')
        stream.accept(b'{"nonce":"bound","pid":2,"count":2}')
        self.assertEqual(stream.counts, {2: 2})
        for data in (b'{"nonce":"foreign","pid":2,"count":3}',
                     b'{"nonce":"bound","pid":2,"count":2}',
                     b'{"nonce":"bound","pid":1,"count":3}'):
            with self.assertRaises(Refusal):
                stream.accept(data)
    def test_zero_observer_never_turns_errno_or_missing_transition_into_success(self):
        import errno
        import threading
        done = threading.Event()
        ready = threading.Event()
        for code in (errno.ENODEV, errno.EIO, errno.EACCES, errno.EBADF):
            def failed():
                raise OSError(code, "synthetic")
            result = engine_custody.watch_zero(failed, done, ready)
            self.assertNotIn("recursiveZero", result)
            self.assertEqual(result["errno"], code)
        values = iter(({"populated": 1, "frozen": 0}, {"populated": 0, "frozen": 0}))
        result = engine_custody.watch_zero(lambda: next(values), done, ready)
        self.assertTrue(result["recursiveZero"])
        done.set()
        self.assertNotIn("recursiveZero", engine_custody.watch_zero(lambda: {"populated": 1, "frozen": 0}, done, ready))
    def test_paused_observer_uses_current_recursive_members_not_running_only_top(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as scratch:
            root = Path(scratch)
            (root / "cgroup.procs").write_text("42\n")
            (root / "nested").mkdir()
            (root / "nested/cgroup.procs").write_text("43\n")
            (root / "cgroup.events").write_text("populated 1\nfrozen 1\n")
            identity = "a" * 64
            record = {"Id": identity, "Created": "created", "RestartCount": 0, "ExecIDs": [],
                      "State": {"StartedAt": "started", "Pid": 42, "CgroupPath": "engine-scope",
                                "Running": False, "Paused": True}}
            calls = []
            class Fixture(engine_custody.Custody):
                def command(self, operation, *arguments):
                    calls.append(operation)
                    if operation == "top":
                        raise Refusal("top-requires-running")
                    return json.dumps([record]).encode()
                def proc(self, name):
                    return "0::/workload\n" if name == "cgroup" else "42 (gate) " + " ".join(["S"] + ["0"] * 18 + ["7"])
            observer = Fixture.__new__(Fixture)
            observer.identity, observer.created, observer.started = identity, "created", "started"
            observer.pid, observer.ticks = 42, 7
            observer.engine_scope, observer.relative, observer.scope = "engine-scope", "/workload", root
            observer.inode, observer.observations, observer.phase = root.stat().st_ino, [], "post-freeze"
            observer.directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            observer.events_fd = os.open(root / "cgroup.events", os.O_RDONLY)
            try:
                with patch.object(engine_custody, "process_identity", return_value=(7, "0::/workload/nested\n"), create=True):
                    observer.current()
                self.assertNotIn("top", calls)
                self.assertEqual(observer.observations[-1]["hostPids"], [42, 43])
                with patch.object(engine_custody, "process_identity", return_value=(7, "0::/foreign\n"), create=True):
                    with self.assertRaises(Refusal):
                        observer.current()
                (root / "cgroup.events").write_text("populated 1\nfrozen 0\n")
                with self.assertRaises(Refusal):
                    observer.current()
                record["State"].update(Running=True, Paused=False)
                observer.phase = "post-thaw"
                with patch.object(engine_custody, "process_identity", return_value=(7, "0::/workload/nested\n")):
                    observer.current()
                self.assertEqual(observer.observations[-1]["hostPids"], [42, 43])
                self.assertEqual(observer.observations[-1]["phase"], "current-running-recursive-membership")
                self.assertNotIn("top", calls)
            finally:
                observer.close()

    def test_paused_top_signature_is_safe_and_specific(self):
        self.assertEqual(error_class(b"Error: top can only be used on running containers\n"), "top-requires-running")
        self.assertEqual(error_class(b"private unknown storage path"), "unclassified-engine-error")
    def test_exact_scope_only_and_recursive_event_values(self):
        identity = "a" * 64
        target = f"/sys/fs/cgroup/user.slice/libpod-{identity}.scope/container"
        self.assertEqual(engine_custody.scope_path(target, identity), Path(target))
        self.assertEqual(engine_custody.scope_path(target.removeprefix("/sys/fs/cgroup"), identity), Path(target))
        for value in ("/sys/fs/cgroup", target.replace(identity, "b" * 64), target + "/../other"):
            with self.assertRaises(Refusal):
                engine_custody.scope_path(value, identity)
        self.assertEqual(engine_custody.parse_events("populated 1\nfrozen 0\n"),
                         {"populated": 1, "frozen": 0})
        for value in ("populated 0\n", "populated 2\nfrozen 0\n", "populated 0\nfrozen 0\nfrozen 1\n"):
            with self.assertRaises(Refusal):
                engine_custody.parse_events(value)

    def test_pid_start_identity_and_membership_are_not_pid_only(self):
        fields = ["S"] + ["0"] * 18 + ["12345"]
        self.assertEqual(engine_custody.start_ticks("42 (name with ) bracket) " + " ".join(fields)), 12345)
        fields[3] = "456"
        self.assertEqual(engine_custody.session_id("42 (name with ) bracket) " + " ".join(fields)), 456)
        self.assertTrue(engine_custody.in_scope("0::/user.slice/libpod-a.scope/container/child\n",
                                             "/user.slice/libpod-a.scope/container"))
        self.assertFalse(engine_custody.in_scope("0::/user.slice/libpod-a.scope/container-foreign\n",
                                              "/user.slice/libpod-a.scope/container"))

    def test_workload_subtree_is_not_monitor_parent_or_arbitrary_descendant(self):
        scope = "/user.slice/libpod-a.scope"
        self.assertEqual(engine_custody.workload_relative("0::" + scope + "/container\n", scope), scope + "/container")
        self.assertEqual(engine_custody.workload_relative("0::" + scope + "\n", scope), scope)
        for value in ("0::" + scope + "/other", "0::/foreign", "0::" + scope + "/container/../other"):
            with self.assertRaises(Refusal):
                engine_custody.workload_relative(value, scope)


if __name__ == "__main__":
    unittest.main()
