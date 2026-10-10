"""Pure policy grammar tests; no host substrate/syscall invocation."""
import unittest
import inner_policy
import engine_custody
from podman_witness import Refusal


class InnerPolicyTests(unittest.TestCase):
    def test_missing_policy_result_cannot_hide_child_start_or_wrong_exit(self):
        class Exit:
            status = 78
            def wait(self, timeout):
                return self.status
        fixture = engine_custody.InnerRefusal.__new__(engine_custody.InnerRefusal)
        fixture.process = Exit()
        fixture.events = [{"event": "inner-policy-refused", "missingPolicy": True,
                           "beforeBwrapChild": True, "productImports": False}]
        self.assertTrue(fixture.proof()["beforeBwrapChild"])
        fixture.events[0]["beforeBwrapChild"] = False
        with self.assertRaises(Refusal):
            fixture.proof()
        fixture.events[0]["beforeBwrapChild"] = True
        fixture.process.status = 0
        with self.assertRaises(Refusal):
            fixture.proof()
    def test_fixed_empty_root_and_filter_cannot_be_omitted(self):
        args = inner_policy.arguments(9, "nonce", "/synthetic/state")
        self.assertIn("--seccomp", args)
        self.assertEqual(args[args.index("--seccomp") + 1], "9")
        self.assertIn("--clearenv", args)
        self.assertIn("--new-session", args)
        self.assertEqual(args[args.index("--tmpfs") + 1], "/")
        self.assertEqual(args[-1], "/workspace/scripts/loom-isolation/inner_gate.py")
        self.assertIn("unshare", inner_policy.DENY)
        self.assertIn("setns", inner_policy.DENY)
        self.assertIn("ptrace", inner_policy.DENY)
        with self.assertRaises(ValueError):
            inner_policy.arguments(-1, "nonce", "/synthetic/state")


if __name__ == "__main__":
    unittest.main()
