"""Standalone, synthetic-only tests. No plugin, product runner or host discovery."""
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import supervisor


class RefusalTests(unittest.TestCase):
    def test_missing_custody_refuses_before_any_executable_or_host_read(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"format": 1}))
            with self.assertRaisesRegex(supervisor.Refusal, "custody"):
                supervisor.load_manifest(manifest)
            self.assertEqual(list(root.iterdir()), [manifest])

    def test_boolean_format_is_not_an_approved_manifest_version(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps(valid_manifest(format=True)))
            with self.assertRaisesRegex(supervisor.Refusal, "format"):
                supervisor.load_manifest(manifest)

    def test_duplicate_approval_field_is_rejected_not_last_value_wins(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            manifest = Path(directory) / "manifest.json"
            data = json.dumps(valid_manifest())
            manifest.write_text(data[:-1] + ', "syntheticOnly": true}')
            with self.assertRaisesRegex(supervisor.Refusal, "duplicate"):
                supervisor.load_manifest(manifest)

    def test_manifest_parse_is_immutable_configuration_not_host_attestation(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            manifest = Path(directory) / "manifest.json"
            manifest.write_text(json.dumps(valid_manifest()))
            result = supervisor.load_manifest(manifest)
            self.assertEqual(result.custody, "/explicitly-admitted/empty-cgroup-leaf")
            self.assertEqual(result.bubblewrap_version, "0.12.0")
            self.assertIsInstance(result.files, tuple)

    def test_shared_git_traversal_and_non_synthetic_inputs_refuse(self):
        variants = [valid_manifest(syntheticOnly=False),
                    valid_manifest(image={"path": "/copied", "files": {"source/.git/config": "a" * 64}}),
                    valid_manifest(image={"path": "/copied", "files": {"source/../../outside": "a" * 64}}),
                    valid_manifest(custody="/"), valid_manifest(custody="//"),
                    valid_manifest(custody="//host/path"), valid_manifest(custody="/a/../b")]
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            manifest = Path(directory) / "manifest.json"
            for value in variants:
                with self.subTest(value=value):
                    manifest.write_text(json.dumps(value))
                    with self.assertRaises(supervisor.Refusal):
                        supervisor.load_manifest(manifest)

    def test_even_well_formed_configuration_cannot_emit_isolation_pass(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            manifest = Path(directory) / "manifest.json"
            manifest.write_text(json.dumps(valid_manifest()))
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                status = supervisor.main(["--manifest", str(manifest)])
            self.assertEqual(status, 78)
            event = json.loads(output.getvalue())
            self.assertEqual(event["event"], "prelaunch-refusal")
            self.assertFalse(event["payloadStarted"])
            self.assertEqual(event["isolation"], "unproven")


def valid_manifest(**changes):
    value = {"format": 1, "syntheticOnly": True,
             "custody": "/explicitly-admitted/empty-cgroup-leaf",
             "bubblewrap": {"path": "/explicitly-admitted/bwrap", "version": "0.12.0",
                            "sha256": "a" * 64},
             "image": {"path": "/approved-copied-image",
                       "files": {"usr/bin/python3": "b" * 64,
                                 "gate/gate.py": "c" * 64}},
             "policySha256": "d" * 64}
    value.update(changes)
    return value


if __name__ == "__main__":
    unittest.main()
