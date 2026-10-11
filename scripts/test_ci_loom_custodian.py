"""Synthetic journal regressions, run only through the confined repository suite."""
import importlib.util
import sys
import os
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
sys.path.pop(0)


class JournalTests(unittest.TestCase):
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
