"""Synthetic journal regressions, run only through the confined repository suite."""
import importlib.util
import sys
import os
import io
import json
import tarfile
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path


MODULE = Path(__file__).parent / "loom-custodian" / "journal.py"
spec = importlib.util.spec_from_file_location("loom_custodian_journal", MODULE)
journal = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = journal
spec.loader.exec_module(journal)

# Pure source-selector navigation is not product launch. This code is itself
# imported only after the suite's independently observed confinement boundary.
sys.path.insert(0, str(Path(__file__).parent / "loom-isolation"))
import container_driver
import stock_probe
sys.path.pop(0)


class StockArtifactTests(unittest.TestCase):
    def test_actual_stock_v2_version_form_is_exact_and_near_misses_refuse(self):
        self.assertEqual(stock_probe.checked_version(b"opencode v2.0.18\n"), "2.0.18")
        for variant in (b"opencode v1.0.18", b"opencode v2.0.18-extra", b"2.0.18"):
            with self.assertRaisesRegex(RuntimeError, "identity mismatch"):
                stock_probe.checked_version(variant)

    def test_stock_is_a_fixed_readonly_policy_purpose_not_arbitrary_command_input(self):
        policy = container_driver.inner_policy
        args = policy.arguments(7, "synthetic-nonce", "/synthetic/protected", "custody-stock")
        position = args.index("/opt/loom-stock")
        self.assertEqual(args[position - 1:position + 2], ["--ro-bind", "/opt/loom-stock", "/opt/loom-stock"])
        self.assertIn("--unshare-net", args)
        self.assertIn("--cap-drop", args)
        self.assertIn("--seccomp", args)
        self.assertNotIn("/opt/loom-stock", policy.arguments(7, "synthetic-nonce", "/synthetic/protected"))
        with self.assertRaises(ValueError):
            policy.arguments(7, "synthetic-nonce", "/synthetic/protected", "arbitrary")

    def test_stock_incoherent_flags_refuse_before_engine_or_receipt(self):
        with self.assertRaisesRegex(container_driver.Refusal, "flags-incoherent"):
            container_driver.run_tests("unused", Path("unused"), prerequisites=True, stock=True)
        with self.assertRaisesRegex(container_driver.Refusal, "flags-incoherent"):
            container_driver.run_tests("unused", Path("unused"), prerequisites=True, custody=True,
                                       inner=True, unit_tests=True, stock=True)

    def archive(self, *, name="package/bin/opencode", linked=False, scripts=None):
        stock = container_driver.image_binding.stock_artifact
        metadata = {"name": stock.PACKAGE, "version": stock.VERSION}
        if scripts is not None:
            metadata["scripts"] = scripts
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w:gz") as archive:
            for path, value in (("package/package.json", json.dumps(metadata).encode()),
                                (name, b"\x7fELFsynthetic-parser-fixture-not-executable")):
                member = tarfile.TarInfo(path)
                member.size = len(value)
                if linked and path == name:
                    member.type = tarfile.SYMTYPE
                    member.linkname = "/outside/synthetic-protected"
                archive.addfile(member, io.BytesIO(value))
        return stream.getvalue()

    def test_package_parser_is_not_a_download_execution_or_integrity_bypass(self):
        stock = container_driver.image_binding.stock_artifact
        data = self.archive()
        self.assertTrue(stock.archive_contents(data).startswith(b"\x7fELF"))
        with self.assertRaisesRegex(stock.ArtifactRefusal, "pinned-integrity"):
            stock.verified_contents(data)

    def test_stock_tar_traversal_and_links_are_refused_without_extraction(self):
        stock = container_driver.image_binding.stock_artifact
        for variant in (self.archive(name="../escape"), self.archive(linked=True)):
            with self.assertRaisesRegex(stock.ArtifactRefusal, "archive-entry"):
                stock.archive_contents(variant)

    def test_stock_package_cannot_add_lifecycle_or_extra_dependencies(self):
        stock = container_driver.image_binding.stock_artifact
        with self.assertRaisesRegex(stock.ArtifactRefusal, "extra-dependency"):
            stock.archive_contents(self.archive(scripts={"postinstall": "unreviewed"}))

    def test_stopped_image_binary_and_manifest_cannot_drift_from_original_receipt(self):
        stock = container_driver.image_binding.stock_artifact
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bin").mkdir()
            binary = root / "bin/opencode"
            original = stock.archive_contents(self.archive())
            binary.write_bytes(original)
            binary.chmod(0o555)
            metadata = stock.manifest(original)
            (root / "manifest.json").write_text(json.dumps(metadata))
            actual = {"stockArtifact": stock.inspect(root)}
            receipt = {"imageFileBinding": actual}
            container_driver.image_binding.verify_stock_binding(actual, receipt)
            # The synthetic fixture owner replaces a file through its private
            # directory; do not mistake 0555 file-mode denial for a tested
            # stopped-image digest mismatch or relax the artifact mode.
            binary.unlink()
            binary.write_bytes(original + b"different")
            binary.chmod(0o555)
            with self.assertRaisesRegex(stock.ArtifactRefusal, "manifest-or-bytes"):
                stock.inspect(root)
            changed = {"stockArtifact": stock.manifest(binary.read_bytes())}
            with self.assertRaisesRegex(container_driver.Refusal, "artifact-bytes-mismatch"):
                container_driver.image_binding.verify_stock_binding(changed, receipt)


class JournalTests(unittest.TestCase):
    def test_stale_selection_and_changed_generation_identity_preserve_original_pair(self):
        with tempfile.TemporaryDirectory() as root:
            with journal.Journal(Path(root), "installation-a", create=True) as custody:
                initial = custody.selection()
                pair = journal.Generation("generation-a", "code-a", "data-a", "c" * 64, "d" * 64)
                selected = custody._select_generation(initial, pair, "synthetic-decision-a")
                with self.assertRaisesRegex(journal.IdentityConflict, "selection-changed"):
                    custody._select_generation(initial, pair, "synthetic-stale-decision")
                with self.assertRaisesRegex(journal.IdentityConflict, "identity-conflict"):
                    custody._select_generation(selected, replace(pair, data_digest="e" * 64), "synthetic-conflict")
                self.assertEqual(custody.selection(), selected)
                newer = journal.Generation("generation-b", "code-b", "data-b", "a" * 64, "b" * 64)
                switched = custody._select_generation(selected, newer, "synthetic-decision-b")
                self.assertEqual(switched.token, selected.token + 1)
                self.assertEqual(switched.generation, newer)
                self.assertFalse(switched.admissions_open)

    def test_lost_selection_response_keeps_intake_receipt_and_one_committed_pair(self):
        with tempfile.TemporaryDirectory() as root:
            event = journal.Event("installation-a", "source-a", "event-a", "operation-a",
                                  "attempt-a", 3, "terminal", b"acknowledged original")
            with journal.Journal(Path(root), "installation-a", create=True) as custody:
                receipt = custody.receive(event)
            pid = os.fork()
            if pid == 0:
                custody = journal.Journal(Path(root), "installation-a")
                pair = journal.Generation("generation-a", "code-a", "data-a", "c" * 64, "d" * 64)
                custody._select_generation(custody.selection(), pair, "synthetic-decision-a")
                os._exit(86)
            _, status = os.waitpid(pid, 0)
            self.assertEqual(os.waitstatus_to_exitcode(status), 86)
            with journal.Journal(Path(root), "installation-a") as custody:
                selected = custody.selection()
                self.assertEqual(selected.token, 1)
                self.assertEqual(selected.generation.id, "generation-a")
                self.assertFalse(selected.admissions_open)
                self.assertEqual(custody.receive(event), receipt)
                self.assertEqual(custody.read(receipt.sequence), event)

    def test_generation_descriptor_and_token_types_do_not_fake_validated_bytes_or_fencing(self):
        with self.assertRaisesRegex(journal.JournalError, "invalid-generation-digest"):
            journal.Generation("generation-a", "code-a", "data-a", "unknown", "d" * 64)
        with self.assertRaises(journal.JournalError):
            journal.Selection(None, True, False)
        with self.assertRaises(journal.JournalError):
            journal.Selection(None, 0, True)

    def test_paired_generation_and_fencing_token_commit_together_with_admissions_closed(self):
        with tempfile.TemporaryDirectory() as root:
            with journal.Journal(Path(root), "installation-a", create=True) as custody:
                before = custody.selection()
                self.assertIsNone(before.generation)
                self.assertEqual(before.token, 0)
                self.assertFalse(before.admissions_open)
                pair = journal.Generation("generation-a", "code-a", "data-a", "c" * 64, "d" * 64)
                selected = custody._select_generation(before, pair, "synthetic-decision-a")
                self.assertEqual(selected.generation, pair)
                self.assertEqual(selected.token, 1)
                self.assertFalse(selected.admissions_open)
            with journal.Journal(Path(root), "installation-a") as custody:
                self.assertEqual(custody.selection(), selected)

    def test_build_selects_only_the_exact_new_source_files_not_private_journal_state(self):
        for name in ("scripts/loom-custodian/journal.py", "scripts/test_ci_loom_custodian.py"):
            self.assertIn(name, container_driver.OWNED)
            self.assertTrue(container_driver.source_input(name))
        self.assertNotIn("scripts/loom-custodian/arbitrary.py", container_driver.OWNED)
        for name in ("scripts/loom-custodian/journal.sqlite3", "scripts/loom-custodian/auth.json",
                     "scripts/loom-custodian/.private/fixture.json", "scripts/loom-custodian/runtime.db"):
            self.assertFalse(container_driver.source_input(name))

    def test_conflicting_identity_preserves_original_and_quarantines_contradiction(self):
        with tempfile.TemporaryDirectory() as root:
            event = journal.Event("installation-a", "source-a", "event-a", "operation-a",
                                  "attempt-a", 3, "terminal", b"original")
            contradiction = replace(event, payload=b"contradiction")
            with journal.Journal(Path(root), "installation-a", create=True) as custody:
                receipt = custody.receive(event)
                with self.assertRaises(journal.IdentityConflict):
                    custody.receive(contradiction)
                self.assertEqual(custody.read(receipt.sequence), event)
                self.assertEqual(custody.inspect().get("conflictCount", 0), 1)
                self.assertEqual(custody.conflicts(receipt.sequence), (contradiction,))
                with self.assertRaises(journal.IdentityConflict):
                    custody.receive(contradiction)
                self.assertEqual(custody.inspect()["conflictCount"], 1)
            with journal.Journal(Path(root), "installation-a") as custody:
                self.assertEqual(custody.conflicts(receipt.sequence), (contradiction,))
                self.assertEqual(custody.receive(event), receipt)

    def test_acknowledged_payload_and_context_survive_reopen_and_lost_ack(self):
        with tempfile.TemporaryDirectory() as root:
            event = journal.Event("installation-a", "source-a", "event-a", "operation-a",
                                  "attempt-a", 3, "terminal", b"original bytes", 2, ("event-before",))
            with journal.Journal(Path(root), "installation-a", create=True) as custody:
                receipt = custody.receive(event)
                self.assertEqual(receipt.digest, event.digest)
                self.assertEqual(custody.read(receipt.sequence), event)
            with journal.Journal(Path(root), "installation-a") as custody:
                self.assertEqual(custody.receive(event), receipt)
                self.assertEqual(custody.read(receipt.sequence), event)
                self.assertEqual(custody.inspect()["ingressCount"], 1)

    def test_original_identity_includes_source_and_conflicting_context_is_not_relabelled(self):
        with tempfile.TemporaryDirectory() as root:
            event = journal.Event("installation-a", "source-a", "event-a", "operation-a",
                                  "attempt-a", 3, "terminal", b"original")
            with journal.Journal(Path(root), "installation-a", create=True) as custody:
                first = custody.receive(event)
                second = custody.receive(replace(event, source="source-b"))
                self.assertNotEqual(first.sequence, second.sequence)
                altered = replace(event, attempt="another-attempt")
                with self.assertRaises(journal.IdentityConflict):
                    custody.receive(altered)
                self.assertEqual(custody.conflicts(first.sequence), (altered,))
                self.assertEqual(custody.read(first.sequence), event)

    def test_two_custodian_owners_refuse_without_claiming_product_fencing(self):
        with tempfile.TemporaryDirectory() as root:
            with journal.Journal(Path(root), "installation-a", create=True):
                with self.assertRaisesRegex(journal.JournalError, "already-owned"):
                    journal.Journal(Path(root), "installation-a")
            with self.assertRaisesRegex(journal.JournalError, "mismatch"):
                journal.Journal(Path(root), "installation-b")
            with journal.Journal(Path(root), "installation-a") as custody:
                self.assertEqual(custody.inspect()["ingressCount"], 0)

    def test_real_sqlite_full_never_acknowledges_or_removes_original(self):
        with tempfile.TemporaryDirectory() as root:
            event = journal.Event("installation-a", "source-a", "event-a", "operation-a",
                                  "attempt-a", 3, "terminal", b"original")
            with journal.Journal(Path(root), "installation-a", create=True) as custody:
                receipt = custody.receive(event)
                # Synthetic SQLite capacity fault only; no row/state fabrication
                # and no driver mock bypasses actual transaction/COMMIT behavior.
                pages = custody._db.execute("PRAGMA page_count").fetchone()[0]
                custody._db.execute(f"PRAGMA max_page_count={pages}")
                with self.assertRaises(journal.StorageUnavailable):
                    custody.receive(replace(event, event_id="too-large", payload=b"x" * 1024 * 1024))
                self.assertEqual(custody.read(receipt.sequence), event)
                self.assertEqual(custody.inspect()["ingressCount"], 1)
                self.assertFalse(custody.inspect()["writeHealthy"])
                with self.assertRaises(journal.StorageUnavailable):
                    custody.receive(event)
            with journal.Journal(Path(root), "installation-a") as custody:
                self.assertEqual(custody.receive(event), receipt)

    def test_process_loss_after_full_commit_keeps_acknowledged_original_in_wal(self):
        with tempfile.TemporaryDirectory() as root:
            event = journal.Event("installation-a", "source-a", "event-a", "operation-a",
                                  "attempt-a", 3, "terminal", b"original")
            with journal.Journal(Path(root), "installation-a", create=True):
                pass
            pid = os.fork()
            if pid == 0:
                custody = journal.Journal(Path(root), "installation-a")
                receipt = custody.receive(event)
                os._exit(82 if receipt.sequence == 1 else 83)
            _, status = os.waitpid(pid, 0)
            self.assertEqual(os.waitstatus_to_exitcode(status), 82)
            with journal.Journal(Path(root), "installation-a") as custody:
                self.assertEqual(custody.read(1), event)
                self.assertEqual(custody.receive(event).sequence, 1)

    def test_process_loss_before_commit_preserves_original_and_has_no_success_ack(self):
        with tempfile.TemporaryDirectory() as root:
            event = journal.Event("installation-a", "source-a", "event-a", "operation-a",
                                  "attempt-a", 3, "terminal", b"original")
            with journal.Journal(Path(root), "installation-a", create=True) as custody:
                receipt = custody.receive(event)
            pid = os.fork()
            if pid == 0:
                custody = journal.Journal(Path(root), "installation-a")

                def die_before_commit(action, argument, *_):
                    if action == journal.sqlite3.SQLITE_TRANSACTION and argument == "COMMIT":
                        os._exit(84)
                    return journal.sqlite3.SQLITE_OK

                custody._db.set_authorizer(die_before_commit)
                custody.receive(replace(event, event_id="unacknowledged"))
                os._exit(85)
            _, status = os.waitpid(pid, 0)
            self.assertEqual(os.waitstatus_to_exitcode(status), 84)
            with journal.Journal(Path(root), "installation-a") as custody:
                self.assertEqual(custody.inspect()["ingressCount"], 1)
                self.assertEqual(custody.receive(event), receipt)

    def test_paths_modes_and_context_near_misses_are_refused(self):
        with tempfile.TemporaryDirectory() as root:
            private = Path(root) / "private"
            private.mkdir(mode=0o700)
            linked = Path(root) / "linked"
            linked.symlink_to(private)
            with self.assertRaisesRegex(journal.JournalError, "symlink"):
                journal.Journal(linked, "installation-a", create=True)
            private.chmod(0o755)
            with self.assertRaisesRegex(journal.JournalError, "private-owned"):
                journal.Journal(private, "installation-a", create=True)
            self.assertFalse((private / "journal.sqlite3").exists())
        with self.assertRaises(journal.JournalError):
            journal.Event("installation-a", "source-a", "event-a", "operation-a",
                          "attempt-a", True, "terminal", b"original")


if __name__ == "__main__":
    unittest.main()
