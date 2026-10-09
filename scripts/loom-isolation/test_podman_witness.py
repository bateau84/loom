"""Pure driver policy tests, not an OCI execution or confinement attestation."""
import unittest
from pathlib import Path

import podman_witness


class PolicyTests(unittest.TestCase):
    def test_fixed_command_has_no_ambient_auth_network_or_host_namespace(self):
        command = podman_witness.create_command("sha256:" + "a" * 64, "loom-proof-unit",
                                               Path("/synthetic/copy"), "nonce")
        for option, value in [("--pull", "never"), ("--network", "none"),
                              ("--pid", "private"), ("--ipc", "private"),
                              ("--cgroupns", "private"), ("--cap-drop", "ALL"),
                              ("--entrypoint", "/usr/local/bin/python3")]:
            self.assertEqual(command[command.index(option) + 1], value)
        self.assertIn("--read-only", command)
        self.assertNotIn("--privileged", command)
        mounts = [command[i + 1] for i, arg in enumerate(command) if arg == "--volume"]
        self.assertEqual(mounts, ["/synthetic/copy/input:/input:ro", "/synthetic/copy/gate:/gate:ro",
                                  "/synthetic/copy/control:/control:ro"])

    def test_unknown_image_environment_is_a_refusal_not_secret_passthrough(self):
        image = {"Id": "sha256:" + "a" * 64,
                 "Config": {"User": "1000:1000", "Entrypoint":
                            ["python3", "/opt/opencode-eval-runner/container/invoke.py"],
                            "Env": ["PATH=/usr/local/bin:/usr/bin:/bin", "UNREVIEWED_TOKEN=synthetic"]}}
        with self.assertRaisesRegex(podman_witness.Refusal, "environment"):
            podman_witness.image_identity(image)
        image["Config"]["Env"] = ["PATH=/usr/local/bin:/usr/bin:/bin"]
        self.assertEqual(podman_witness.image_identity(image), "sha256:" + "a" * 64)

    def test_empty_engine_result_cannot_be_confused_with_an_observation(self):
        for value in (b"[]", b"{}", b"[{}, {}]"):
            with self.subTest(value=value):
                with self.assertRaises(podman_witness.Refusal):
                    podman_witness.one_record(value)


if __name__ == "__main__":
    unittest.main()
