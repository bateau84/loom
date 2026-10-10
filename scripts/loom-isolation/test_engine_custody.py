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
