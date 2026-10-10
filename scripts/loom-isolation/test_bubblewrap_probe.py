"""Pure precondition-witness parsing units; no host bwrap/proc/cgroup access."""
import unittest
import bubblewrap_probe


class ProbeTests(unittest.TestCase):
    def test_concrete_proc_denial_and_target_only_topology_projection(self):
        self.assertEqual(bubblewrap_probe.setup_result(1, "bwrap: Can't mount proc on /newroot/proc: Operation not permitted"),
                         "proc-mount-denied-in-this-fixture")
        data = "1 2 0:1 /hidden /proc/kcore ro,nosuid - tmpfs /private rw"
        projected = bubblewrap_probe.proc_topology(data)
        self.assertEqual(projected, [{"target": "/proc/kcore", "filesystem": "tmpfs", "options": ["nosuid", "ro"]}])
        self.assertNotIn("hidden", str(projected))
        self.assertNotIn("private", str(projected))
    def test_namespace_denial_is_not_success_or_whole_host_infeasibility(self):
        result = bubblewrap_probe.setup_result(1, "bwrap: Creating new namespace failed: Operation not permitted")
        self.assertEqual(result, "namespace-setup-denied-in-this-fixture")
        self.assertNotEqual(result, "payload-ready")

    def test_missing_target_after_setup_is_only_partial_prerequisite_evidence(self):
        result = bubblewrap_probe.setup_result(1, "bwrap: execvp /__loom_never_payload__: No such file or directory")
        self.assertEqual(result, "namespace-setup-reached-no-payload")

    def test_specific_private_cgroup_mount_readonly_observation(self):
        self.assertTrue(bubblewrap_probe.cgroup_readonly(
            "1 2 0:1 / /sys/fs/cgroup ro,nosuid - cgroup2 cgroup rw"))
        self.assertFalse(bubblewrap_probe.cgroup_readonly(
            "1 2 0:1 / /sys/fs/cgroup rw,nosuid - cgroup2 cgroup rw"))


if __name__ == "__main__":
    unittest.main()
