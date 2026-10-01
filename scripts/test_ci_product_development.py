"""Zero-inference checks of the governed eval's product-proof fixture.

These execute the supplied conformance test against known implementations, not
Loom agents. Passing here does not establish role handoff or live eval success.
The positive control stays in the harness repository, outside the target fixture.
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SUITE = ROOT / "evals" / "product-development-governed.json"

# A calibration implementation for fixture testing, never an agent result.
CONTROL = '''import argparse
import json
from pathlib import Path
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--store", required=True)
parser.add_argument("command", choices=["list", "add"])
parser.add_argument("text", nargs="?")
args = parser.parse_args()
store = Path(args.store)
try:
    try:
        notes = json.loads(store.read_text(encoding="utf-8"))
    except FileNotFoundError:
        notes = []
    if not isinstance(notes, list) or any(not isinstance(note, str) for note in notes):
        raise ValueError("invalid notes")
    if args.command == "add":
        if args.text is None:
            raise ValueError("missing text")
        notes.append(args.text)
        store.parent.mkdir(parents=True, exist_ok=True)
        store.write_text(json.dumps(notes), encoding="utf-8")
    else:
        print(json.dumps(notes))
except (OSError, ValueError):
    print("Cannot use the selected store", file=sys.stderr)
    sys.exit(2)
'''


class ProductDevelopmentFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        suite = json.loads(SUITE.read_text(encoding="utf-8"))
        cls.case = suite["cases"][0]
        cls.fixtures = {item["path"]: item["content"] for item in cls.case["fixture_files"]}

    def run_contract(self, implementation: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(prefix="loom-product-proof-") as temporary:
            root = Path(temporary)
            (root / "tests").mkdir()
            (root / "notes.py").write_text(implementation, encoding="utf-8")
            (root / "tests" / "test_notes_contract.py").write_text(
                self.fixtures["tests/test_notes_contract.py"], encoding="utf-8"
            )
            return subprocess.run(
                [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-p", "test_notes_contract.py"],
                cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=45,
            )

    def assert_rejected(self, implementation: str, failing_test: str):
        compile(implementation, "calibration-notes.py", "exec")
        result = self.run_contract(implementation)
        self.assertNotEqual(result.returncode, 0, "bad implementation escaped conformance checks")
        self.assertIn("FAIL: " + failing_test + " (", result.stderr)
        self.assertNotIn("\nERROR:", result.stderr, "calibration must fail a contract assertion, not crash")
        self.assertIn("Ran 5 tests", result.stderr)

    def test_positive_control_exercises_all_five_contract_tests(self):
        result = self.run_contract(CONTROL)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Ran 5 tests", result.stderr)

    def test_original_product_cannot_pass_by_listing_an_empty_store(self):
        self.assert_rejected(self.fixtures["notes.py"], "test_first_add_and_later_processes_preserve_exact_notes")

    def test_manual_parent_setup_is_not_first_use(self):
        broken = CONTROL.replace("        store.parent.mkdir(parents=True, exist_ok=True)\n", "")
        self.assert_rejected(broken, "test_first_add_and_later_processes_preserve_exact_notes")

    def test_corrupt_store_cannot_be_reclassified_as_empty(self):
        broken = CONTROL.replace("except FileNotFoundError:", "except (OSError, ValueError):")
        self.assert_rejected(broken, "test_invalid_store_fails_without_data_loss")

    def test_non_directory_is_not_an_absent_store(self):
        broken = CONTROL.replace("except FileNotFoundError:", "except OSError:")
        self.assert_rejected(broken, "test_non_directory_ancestor_is_not_an_absent_store")

    def test_success_without_persistence_is_rejected(self):
        broken = CONTROL.replace('        store.write_text(json.dumps(notes), encoding="utf-8")', "        pass")
        self.assert_rejected(broken, "test_first_add_and_later_processes_preserve_exact_notes")

    def test_overwriting_previous_notes_is_rejected(self):
        broken = CONTROL.replace("        notes.append(args.text)", "        notes = [args.text]")
        self.assert_rejected(broken, "test_first_add_and_later_processes_preserve_exact_notes")

    def test_read_that_rewrites_the_store_is_rejected(self):
        broken = CONTROL.replace("        print(json.dumps(notes))", '        print(json.dumps(notes))\n        if store.exists():\n            store.write_text(json.dumps(notes), encoding="utf-8")')
        self.assert_rejected(broken, "test_listing_existing_store_preserves_bytes")


    def test_reversed_output_is_rejected(self):
        broken = CONTROL.replace("print(json.dumps(notes))", "print(json.dumps(notes[::-1]))")
        self.assert_rejected(broken, "test_first_add_and_later_processes_preserve_exact_notes")

    def test_prepend_instead_of_append_is_rejected(self):
        broken = CONTROL.replace("notes.append(args.text)", "notes.insert(0, args.text)")
        self.assert_rejected(broken, "test_first_add_and_later_processes_preserve_exact_notes")

    def test_sorted_storage_is_not_insertion_order(self):
        broken = CONTROL.replace("notes.append(args.text)", "notes.append(args.text)\n        notes.sort()")
        self.assert_rejected(broken, "test_first_add_and_later_processes_preserve_exact_notes")

    def test_list_cannot_create_only_an_intermediate_directory(self):
        broken = CONTROL.replace(
            "    else:\n        print(json.dumps(notes))",
            "    else:\n        store.parent.parent.mkdir(parents=True, exist_ok=True)\n        print(json.dumps(notes))",
        )
        self.assert_rejected(broken, "test_first_list_without_manual_setup")


if __name__ == "__main__":
    unittest.main()
