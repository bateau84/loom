"""Adversarial checks of installed-source oracles; not installed qualification."""
from copy import deepcopy
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

from installed_original_sources import (
    GH_ARGUMENTS, PREFIX, assert_original_fragments, assert_original_value,
    install_source_owner, source_owner_fixture,
)
from installed_retrospective_populations import encoded


def original_fixture():
    value = {"original": "Exact permitted 🧵 source, not a summary.", "run_attempt": 1}
    digest = hashlib.sha256(encoded(value).encode()).hexdigest()
    member = {"key": "source-member", "source_store_id": "github-source", "permitted_view": "github-original/v1",
              "source": {"kind": "external-ref", "id": "exact-identity", "revision": "attempt:1", "sha256": digest}}
    frozen = {"population_id": "frozen", "manifest_sha256": "a" * 64}
    result = {**frozen, "member_key": member["key"], "source_store_id": member["source_store_id"],
              "permitted_view": member["permitted_view"], "source": deepcopy(member["source"]),
              "status": "available", "representation": "original-owner-view", "value": value,
              "coverage": {"whole_original_returned": True, "original_sha256": digest}}
    return value, member, frozen, result


def fragments():
    value, member, frozen, result = original_fixture()
    serialized = encoded(value)
    split = serialized.index("source")
    parts = [serialized[:split], serialized[split:]]
    total = len(serialized.encode("utf-16-le")) // 2
    pages, offset = [], 0
    for index, text in enumerate(parts):
        end = offset + len(text.encode("utf-16-le")) // 2
        page = {key: deepcopy(item) for key, item in result.items() if key not in ("value", "coverage")}
        page.update(representation="original-owner-view-fragment", content_json=text,
                    coverage={"from": offset, "to": end, "total_characters": total,
                              "total_utf8_bytes": len(serialized.encode()), "original_sha256": member["source"]["sha256"]},
                    navigation={"next": {"source_offset": end} if index == 0 else None})
        pages.append(page)
        offset = end
    return value, member, pages


class ExactOriginalOracleTest(unittest.TestCase):
    def test_complete_original_must_match_exact_namespace_version_view_and_bytes(self):
        value, member, frozen, result = original_fixture()
        self.assertEqual(assert_original_value(result, member, frozen), value)
        for key, changed in (("source_store_id", "other-owner"), ("permitted_view", "metadata-only"),
                             ("population_id", "other-population"), ("manifest_sha256", "b" * 64),
                             ("member_key", "other-member"), ("representation", "original-owner-view-fragment")):
            wrong = deepcopy(result)
            wrong[key] = changed
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, "identity, view, namespace or complete coverage"):
                assert_original_value(wrong, member, frozen)

    def test_later_attempt_cannot_be_accepted_under_original_version(self):
        _, member, frozen, result = original_fixture()
        result["value"]["run_attempt"] = 2
        with self.assertRaisesRegex(RuntimeError, "pinned view digest"):
            assert_original_value(result, member, frozen)

    def test_unknown_coverage_cannot_claim_complete_original(self):
        _, member, frozen, result = original_fixture()
        result["coverage"]["whole_original_returned"] = False
        with self.assertRaisesRegex(RuntimeError, "complete coverage"):
            assert_original_value(result, member, frozen)


class CompleteSourceReadbackOracleTest(unittest.TestCase):
    def test_complete_utf16_fragments_reconstruct_the_exact_unicode_original(self):
        value, member, pages = fragments()
        result = assert_original_fragments(pages, member, value)
        self.assertEqual(result["pages"], 2)
        self.assertTrue(result["frozen_digest_verified"])

    def test_missing_tail_cannot_become_complete_by_removing_cursor(self):
        value, member, pages = fragments()
        pages[0]["navigation"]["next"] = None
        with self.assertRaisesRegex(RuntimeError, "omitted or substituted"):
            assert_original_fragments(pages[:1], member, value)

    def test_duplicate_gap_and_reordered_fragments_fail(self):
        value, member, pages = fragments()
        for invalid in ([pages[0], pages[0], pages[1]], list(reversed(pages))):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(RuntimeError, "contiguous coverage"):
                assert_original_fragments(invalid, member, value)
        pages[1]["coverage"]["from"] += 1
        with self.assertRaisesRegex(RuntimeError, "contiguous coverage"):
            assert_original_fragments(pages, member, value)

    def test_valid_shape_and_coverage_with_substituted_content_fails_digest(self):
        value, member, pages = fragments()
        pages[0]["content_json"] = pages[0]["content_json"].replace("Exact", "Wrong")
        with self.assertRaisesRegex(RuntimeError, "omitted or substituted"):
            assert_original_fragments(pages, member, value)

    def test_fragment_cannot_switch_population_namespace_or_permitted_view(self):
        value, member, pages = fragments()
        for key, changed in (("population_id", "other"), ("manifest_sha256", "b" * 64),
                             ("source_store_id", "other"), ("permitted_view", "full-transcript")):
            wrong = deepcopy(pages)
            wrong[-1][key] = changed
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, "identity, digest or contiguous coverage"):
                assert_original_fragments(wrong, member, value)


class ControlledSourceOwnerTest(unittest.TestCase):
    def test_fixture_keeps_failure_rerun_correction_and_race_evidence_distinct(self):
        fixture = source_owner_fixture()
        failure, rerun = fixture["logs"]["failure"], fixture["logs"]["rerun"]
        self.assertEqual(failure[0], rerun[0])
        self.assertEqual(failure[3], rerun[3])
        self.assertNotEqual(failure[1], rerun[1])
        self.assertNotEqual(failure[4], rerun[4])
        self.assertNotEqual(rerun[3], fixture["logs"]["corrected"][3])
        self.assertNotIn("--- PASS:", fixture["logs"]["race"][5])

    def test_actual_disposable_executable_accepts_only_fixed_read_arguments(self):
        with tempfile.TemporaryDirectory(prefix="loom-original-owner-oracle-") as directory:
            root, env = Path(directory), {}
            fixture = install_source_owner(root, env)
            executable = str(root / "original-source-owner" / "gh")
            valid = subprocess.run([executable, *GH_ARGUMENTS, PREFIX], capture_output=True, text=True, check=True)
            self.assertIn('"full_name": "loom-fixture/originals"', valid.stdout)
            wrong = subprocess.run([executable, "api", "--method", "POST", PREFIX], capture_output=True, text=True)
            self.assertNotEqual(wrong.returncode, 0)
            self.assertEqual(wrong.stdout, "")
            unknown = subprocess.run([executable, *GH_ARGUMENTS, "/unselected"], capture_output=True, text=True)
            self.assertNotEqual(unknown.returncode, 0)
            self.assertIn("HTTP 404", unknown.stderr)
            self.assertEqual(unknown.stdout, "")
            self.assertEqual(len(fixture["audit"].read_text().splitlines()), 2)


if __name__ == "__main__":
    unittest.main()
