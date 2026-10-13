"""Pure build-context policy checks; never build, import product, or run Podman."""
import unittest
import container_driver
import podman_witness
from pathlib import Path
import sys
import tempfile
import container_gate
import os
from unittest.mock import patch


class ContextTests(unittest.TestCase):
    def test_incoherent_workload_request_refuses_before_engine_or_receipt(self):
        with self.assertRaisesRegex(podman_witness.Refusal, "inner-workload-flags"):
            container_driver.run_tests("unused", Path("unused"), custody=True, unit_tests=True)
        with self.assertRaisesRegex(podman_witness.Refusal, "inner-workload-flags"):
            container_driver.run_tests("unused", Path("unused"), inner=True)
    def test_comparison_rejects_extra_security_delta_or_product_release(self):
        def sample(scoped):
            return {"image": "sha256:" + "a" * 64, "buildReceipt": {"sha256": "same"},
                    "selectedInputManifest": {"sha256": "same"}, "gateSha256": "same-gate",
                    "payloadReleased": False, "sentinelUnchanged": True, "cleanup": "owned-container-removed",
                    "effectivePolicy": {"hostConfig": {"SecurityOpt": ["no-new-privileges", "label=disable"] +
                                                      (["unmask=/proc/*"] if scoped else []),
                                                      "MaskedPaths": ["/sys/firmware"] + ([] if scoped else ["/proc/kcore"]),
                                                      "ReadonlyPaths": ["/sys/fs/cgroup"]}, "user": "1000:1000"},
                    "prerequisiteWitness": {"substrate": {"sha256": "same-binary"}, "setupCommand": ["fixed"],
                                            "outerRestrictions": {"Seccomp": "2", "NoNewPrivs": "1", "CapEff": "0"},
                                            "fixtureCgroup": {"mountReadOnly": True}, "productPayloadStarted": False,
                                            "procTopology": [{"target": "/proc"}] + ([] if scoped else [{"target": "/proc/kcore"}]),
                                            "setupObservation": "namespace-setup-reached-no-payload" if scoped else "proc-mount-denied-in-this-fixture"}}
        baseline, scoped = sample(False), sample(True)
        self.assertTrue(container_driver.compare_records(baseline, scoped)["procSetupImproved"])
        scoped["effectivePolicy"]["hostConfig"]["SecurityOpt"].append("seccomp=unconfined")
        with self.assertRaises(podman_witness.Refusal):
            container_driver.compare_records(baseline, scoped)
        scoped = sample(True)
        scoped["payloadReleased"] = True
        with self.assertRaises(podman_witness.Refusal):
            container_driver.compare_records(baseline, scoped)

    def test_scoped_proc_option_is_the_only_command_delta_and_probe_only(self):
        arguments = ("sha256:" + "a" * 64, "fixed-name", Path("/synthetic"), "fixed-nonce")
        baseline = container_driver.create_command(*arguments, prerequisites=True)
        scoped = container_driver.create_command(*arguments, prerequisites=True, scoped_proc=True)
        position = scoped.index("unmask=/proc/*")
        self.assertEqual(scoped[position - 1], "--security-opt")
        self.assertEqual(scoped[:position - 1] + scoped[position + 1:], baseline)
        for forbidden in ("unmask=ALL", "seccomp=unconfined", "--privileged", "SYS_ADMIN"):
            self.assertNotIn(forbidden, scoped)
        self.assertEqual(baseline.count("label=disable"), 1)
        self.assertEqual(scoped.count("label=disable"), 1)
        with self.assertRaises(podman_witness.Refusal):
            container_driver.create_command(*arguments, scoped_proc=True)

    def test_release_is_invisible_during_partial_writes_then_visible_complete(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            control = Path(directory)
            nonce = "synthetic-complete-launch-token"
            original_write = os.write
            observations = []

            def partial_write(fd, data):
                written = original_write(fd, data[:3])
                observations.append(container_gate.release_ready(control, nonce))
                return written

            with patch("container_driver.os.write", side_effect=partial_write):
                container_driver.publish_release(control, nonce)
            self.assertGreater(len(observations), 1)
            self.assertEqual(set(observations), {False})
            self.assertTrue(container_gate.release_ready(control, nonce))
            self.assertEqual(list(control.iterdir()), [control / "release"])

    def test_gate_still_refuses_empty_or_wrong_visible_release(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            control = Path(directory)
            self.assertFalse(container_gate.release_ready(control, "expected"))
            for value in ("", "expect", "other"):
                (control / "release").write_text(value)
                with self.assertRaises(RuntimeError):
                    container_gate.release_ready(control, "expected")

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
