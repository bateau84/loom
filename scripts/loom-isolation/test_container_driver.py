"""Pure build-context policy checks; never build, import product, or run Podman."""
import unittest
import container_driver
import podman_witness
from pathlib import Path
import sys
import tempfile
import container_gate


class ContextTests(unittest.TestCase):
    def test_ambient_witness_requires_actual_misdirection_not_a_duplicate_label(self):
        probes = [{"phase": "before-import", "kind": kind, "operation": operation,
                   "errno": 2, "ambientMisdirected": kind == "ambient"}
                  for kind in ("direct", "link", "ambient") for operation in ("read", "write")]
        container_driver.validate_probes(probes, "before-import")
        probes[-1]["ambientMisdirected"] = False
        with self.assertRaises(podman_witness.Refusal):
            container_driver.validate_probes(probes, "before-import")

    def test_repository_zsh_source_is_not_dropped_when_image_installs_zsh(self):
        self.assertTrue(container_driver.source_input("scripts/ocw.zsh"))

    def test_required_source_owned_eval_fixtures_are_included_not_runtime_results(self):
        self.assertTrue(container_driver.source_input("evals/intent-and-routing.json"))
        self.assertTrue(container_driver.source_input("evals/conversation.json"))
        self.assertFalse(container_driver.source_input("evals/results/session.json"))

    def test_next_run_diagnostic_capture_keeps_stream_identity(self):
        result = podman_witness.capture_command(
            [sys.executable, "-S", str(Path(__file__).resolve()), "--stream-fixture"])
        self.assertEqual(result["status"], 0)
        self.assertEqual(result["stdout"].strip(), b"synthetic stdout")
        self.assertEqual(result["stderr"].strip(), b"synthetic stderr")

    def test_synthetic_git_stages_only_source_paths_that_survived_context_copy(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            (root / "package.json").write_text("{}")
            (root / "scripts").mkdir()
            self.assertEqual(container_gate.git_inputs(root), ["package.json", "scripts"])

    def test_owned_container_diagnostic_capture_retains_both_streams(self):
        data = podman_witness.call([sys.executable, "-S", str(Path(__file__).resolve()), "--stream-fixture"],
                                   include_stderr=True)
        self.assertIn(b"synthetic stdout", data)
        self.assertIn(b"synthetic stderr", data)
    def test_podman_inspect_reports_private_userns_not_the_cli_keep_id_selector(self):
        image = "sha256:" + "a" * 64
        record = {"Image": image, "Config": {"User": "1000:1000"}, "State": {},
                  "HostConfig": {"Privileged": False, "NetworkMode": "none", "PidMode": "private",
                                 "IpcMode": "private", "CgroupMode": "private", "UsernsMode": "private",
                                 "SecurityOpt": ["no-new-privileges"]},
                  "Mounts": [{"Type": "bind", "RW": False, "Destination": "/" + name,
                              "Source": "/synthetic/" + name} for name in ("control", "probes")]}
        container_driver.validate(record, image, Path("/synthetic"), running=False)
        record["HostConfig"]["UsernsMode"] = "host"
        with self.assertRaises(podman_witness.Refusal):
            container_driver.validate(record, image, Path("/synthetic"), running=False)

    def test_package_build_capabilities_are_namespace_local_not_runtime_privileged(self):
        args = container_driver.build_command(Path("/synthetic"), Path("/synthetic/context"))
        added = [args[i + 1] for i, arg in enumerate(args) if arg == "--cap-add"]
        self.assertEqual(added, ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"])
        self.assertEqual(args[args.index("--cap-drop") + 1], "ALL")
        self.assertNotIn("--privileged", args)
        self.assertNotIn("SYS_ADMIN", added)

    def test_podman_go_template_uses_actual_hostinfo_field_not_json_key(self):
        self.assertEqual(podman_witness.ENGINE_INFO_FORMAT,
                         "{{.Host.Security.Rootless}} {{.Host.CgroupsVersion}}")

    def test_error_projection_classifies_without_retaining_raw_secret_or_path(self):
        for raw, expected in ((b"can't evaluate field CgroupVersion; secret=DO-NOT-ECHO", "template-field-error"),
                              (b"permission denied /private/DO-NOT-ECHO", "engine-permission-denied"),
                              (b"unrecognized DO-NOT-ECHO", "unclassified-engine-error")):
            self.assertEqual(podman_witness.error_class(raw), expected)

    def test_source_context_excludes_runtime_auth_and_linked_git(self):
        for path in (".git", "opencode.json", ".env", "node_modules/x.js",
                     "scripts/auth.json", "scripts/x.db", "docs/reports/secret.md",
                     "scripts/.podman-witness-a/data.json", "scripts/__pycache__/a.pyc"):
            with self.subTest(path=path):
                self.assertFalse(container_driver.source_input(path))
        for path in ("package.json", "bun.lock", "plugins/loom/state.ts",
                     "scripts/run-unit-tests.py", "skills/git/SKILL.md"):
            self.assertTrue(container_driver.source_input(path))


if __name__ == "__main__":
    if sys.argv[1:] == ["--stream-fixture"]:
        print("synthetic stdout")
        print("synthetic stderr", file=sys.stderr)
    else:
        unittest.main()
