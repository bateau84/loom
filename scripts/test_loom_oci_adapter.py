"""Synthetic adapter-core tests; execute only inside the admitted private container.

Source-only checkpoint: these tests have NOT been executed or credited as proof.
They do not establish engine isolation, startup safety or native Task composition.
"""
from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "loom_oci_adapter", Path(__file__).with_name("loom-oci-test-adapter.py")
)
assert SPEC is not None and SPEC.loader is not None
adapter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(adapter)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="oci-core-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.stage = self.root / "stage"
        self.source.mkdir(mode=0o700)
        self.stage.mkdir(mode=0o700)
        (self.source / "scripts").mkdir()
        (self.source / "scripts/example.py").write_bytes(b"print('synthetic')\n")

    def test_copy_identity_is_known_canonical_tuple_digest(self):
        identity = adapter.snapshot(self.source, self.stage, ["scripts"])
        import hashlib

        expected = [["scripts/example.py", "regular", 19,
                     hashlib.sha256(b"print('synthetic')\n").hexdigest()]]
        canonical = json.dumps(expected, ensure_ascii=False, separators=(",", ":")).encode()
        self.assertEqual(identity["files"], expected)
        self.assertEqual(identity["inputDigest"], hashlib.sha256(canonical).hexdigest())
        self.assertEqual((self.stage / "scripts/example.py").read_bytes(), b"print('synthetic')\n")
        adapter.recheck_source(self.source, ["scripts"], identity)

    def test_changed_removed_and_added_source_each_invalidate_identity(self):
        identity = adapter.snapshot(self.source, self.stage, ["scripts"])
        path = self.source / "scripts/example.py"
        path.write_bytes(b"changed")
        with self.assertRaises(adapter.AdapterError):
            adapter.recheck_source(self.source, ["scripts"], identity)
        path.unlink()
        with self.assertRaises(adapter.AdapterError):
            adapter.recheck_source(self.source, ["scripts"], identity)
        path.write_bytes(b"print('synthetic')\n")
        (self.source / "scripts/new.py").write_bytes(b"added")
        with self.assertRaises(adapter.AdapterError):
            adapter.recheck_source(self.source, ["scripts"], identity)

    def test_symlink_file_or_directory_never_follows_external_input(self):
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "canary").write_bytes(b"must not be read")
        for target in (outside, outside / "canary"):
            link = self.source / "scripts/link"
            link.symlink_to(target)
            with self.assertRaises(adapter.AdapterError):
                adapter.inspect_inputs(self.source, ["scripts"])
            link.unlink()

    def test_hardlink_special_file_and_sensitive_input_rejected(self):
        original = self.source / "scripts/example.py"
        os.link(original, self.source / "scripts/hardlink")
        with self.assertRaises(adapter.AdapterError):
            adapter.inspect_inputs(self.source, ["scripts"])
        (self.source / "scripts/hardlink").unlink()
        os.mkfifo(self.source / "scripts/fifo")
        with self.assertRaises(adapter.AdapterError):
            adapter.inspect_inputs(self.source, ["scripts"])
        (self.source / "scripts/fifo").unlink()
        (self.source / "scripts/.env").write_bytes(b"synthetic secret")
        with self.assertRaises(adapter.AdapterError):
            adapter.inspect_inputs(self.source, ["scripts"])

    def test_escaping_duplicate_overlapping_or_unapproved_roots_rejected(self):
        for roots in (["../scripts"], ["/scripts"], ["scripts/../scripts"],
                      ["scripts", "scripts"], ["scripts", "scripts/example.py"],
                      ["."], ["opencode.json"], ["node_modules"], ["scripts/"], [["scripts"]]):
            with self.subTest(roots=roots), self.assertRaises(adapter.AdapterError):
                adapter.inspect_inputs(self.source, roots)

    def test_executable_mode_and_empty_directory_are_rechecked(self):
        path = self.source / "scripts/example.py"
        path.chmod(0o755)
        (self.source / "scripts/empty").mkdir()
        identity = adapter.snapshot(self.source, self.stage, ["scripts"])
        self.assertEqual(identity["files"][0][1], "executable")
        self.assertEqual(identity["emptyDirectories"], ["scripts/empty"])
        path.chmod(0o644)
        with self.assertRaises(adapter.AdapterError):
            adapter.recheck_source(self.source, ["scripts"], identity)
        path.chmod(0o755)
        (self.source / "scripts/empty").rmdir()
        with self.assertRaises(adapter.AdapterError):
            adapter.recheck_source(self.source, ["scripts"], identity)

    def test_missing_source_and_nonprivate_or_nonempty_staging_rejected(self):
        with self.assertRaises(adapter.AdapterError):
            adapter.snapshot(self.source, self.stage, ["scripts/missing.py"])
        self.stage.chmod(0o755)
        with self.assertRaises(adapter.AdapterError):
            adapter.snapshot(self.source, self.stage, ["scripts"])
        self.stage.chmod(0o700)
        (self.stage / "unrelated").write_bytes(b"preserve")
        with self.assertRaises(adapter.AdapterError):
            adapter.snapshot(self.source, self.stage, ["scripts"])
        self.assertEqual((self.stage / "unrelated").read_bytes(), b"preserve")


class ExecutionBoundaryTests(unittest.TestCase):
    def test_only_exact_finite_selector_argv_is_accepted(self):
        for suite in adapter.SELECTIONS:
            self.assertEqual(adapter.parse_selection(["--suite", suite]), suite)
        for argv in ([], ["--suite", "other"], ["--suite", "all", "--suite", "native"],
                     ["--suite=all"], ["--suite", "native", "--image", "other"]):
            with self.subTest(argv=argv), self.assertRaises(adapter.AdapterError):
                adapter.parse_selection(argv)

    def test_unresolved_engine_readiness_always_blocks_execution(self):
        with self.assertRaisesRegex(adapter.AdapterError, "engine readiness unavailable"):
            adapter.require_engine_readiness()


if __name__ == "__main__":
    unittest.main()
