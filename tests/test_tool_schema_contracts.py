"""Full JSON Schema/public callback agreement using disposable registered Loom.

Requires Bun on PATH and test-only jsonschema==4.26.0. The CI installation lives
outside plugin dependencies; this validator never participates in production.
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from jsonschema import Draft202012Validator


class ToolSchemaContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        bun = shutil.which("bun")
        if not bun:
            raise RuntimeError("Bun is required for the registered Loom schema/callback regression")
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix="loom-tool-schema-") as temporary:
            output = Path(temporary) / "cases.json"
            subprocess.run(
                [bun, "tests/helpers/tool-schema-cases.ts", str(output)],
                cwd=root, check=True, capture_output=True, text=True, timeout=60,
            )
            cls.report = json.loads(output.read_text())

    def test_all_registered_schemas_are_valid_draft_2020_12(self):
        self.assertEqual(self.report["format"], "loom-tool-schema-contracts/v1")
        self.assertEqual(set(self.report["schemas"]), {
            "agents", "action", "assessment", "context", "history", "insights", "objective",
            "plan", "qa", "record", "review", "trace", "trends", "tweak",
        })
        for name, schema in self.report["schemas"].items():
            with self.subTest(tool=name):
                Draft202012Validator.check_schema(schema)

    def test_representative_requests_match_schema_and_callback_contracts(self):
        # Do not mistake schema validity or operation presence for exhaustive
        # runtime agreement. These are the explicit cases in the helper.
        self.assertGreaterEqual(len(self.report["cases"]), 80)
        for index, case in enumerate(self.report["cases"]):
            with self.subTest(case=index, tool=case["tool"], input=case["input"]):
                validator = Draft202012Validator(self.report["schemas"][case["tool"]])
                errors = list(validator.iter_errors(case["input"]))
                self.assertEqual(not errors, case["expected"],
                                 "; ".join(error.message for error in errors))
                self.assertEqual(case["runtime_ok"], case["expected"], case.get("error"))

    def test_schema_exercises_never_dispatch_native_work(self):
        self.assertEqual(self.report["native_effects"], {"creates": 0, "prompts": 0, "notices": 0})


if __name__ == "__main__":
    unittest.main()
