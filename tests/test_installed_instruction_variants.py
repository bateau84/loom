"""Fail-closed qualification-oracle controls; no native host is mocked as a success."""
import unittest

from installed_instruction_variants import (
    HOST, sha, source_guard, verify_host_version, verify_receipt,
)

CANDIDATE = "harmless test variant"


def receipt(*, candidate=False):
    return {
        "effective_sha256": "1" * 64,
        "system_bytes": 60,
        "user_marker_seen": False,
        "entry_seen": candidate,
        "marker_seen": candidate,
        "candidate_sha256": sha(CANDIDATE) if candidate else None,
    }


class VariantOracleTest(unittest.TestCase):
    def test_distinct_control_and_candidate_pass_only_with_provider_receipts(self):
        self.assertTrue(verify_receipt(receipt(candidate=True), expected_candidate=True,
                                       candidate_sha=sha(CANDIDATE))["entry_seen"])
        self.assertFalse(verify_receipt(receipt(), expected_candidate=False,
                                        candidate_sha=sha(CANDIDATE))["entry_seen"])

    def test_assigned_but_no_provider_receipt_is_not_delivery(self):
        with self.assertRaisesRegex(RuntimeError, "RECEIPT_MISSING"):
            verify_receipt(None, expected_candidate=True, candidate_sha=sha(CANDIDATE))

    def test_partial_receipts_cannot_pass(self):
        for missing in ("effective_sha256", "system_bytes"):
            with self.subTest(missing=missing):
                observed = receipt(candidate=True)
                del observed[missing]
                with self.assertRaisesRegex(RuntimeError, "RECEIPT_INCOMPLETE"):
                    verify_receipt(observed, expected_candidate=True,
                                   candidate_sha=sha(CANDIDATE))

    def test_treatment_requires_exact_candidate_hash_at_native_provider_input(self):
        for mutation in (
            {"entry_seen": False},
            {"marker_seen": False},
            {"candidate_sha256": "f" * 64},
            {"candidate_sha256": None},
        ):
            with self.subTest(mutation=mutation):
                observed = {**receipt(candidate=True), **mutation}
                with self.assertRaisesRegex(RuntimeError, "EXPOSURE_UNVERIFIED"):
                    verify_receipt(observed, expected_candidate=True,
                                   candidate_sha=sha(CANDIDATE))

    def test_control_must_not_see_candidate_even_without_a_readback_entry(self):
        for mutation in (
            {"entry_seen": True},
            {"marker_seen": True},
            {"candidate_sha256": sha(CANDIDATE)},
        ):
            with self.subTest(mutation=mutation):
                observed = {**receipt(), **mutation}
                with self.assertRaisesRegex(RuntimeError, "CONTROL_CONTAMINATED"):
                    verify_receipt(observed, expected_candidate=False,
                                   candidate_sha=sha(CANDIDATE))

    def test_marker_in_user_message_is_not_an_instruction_receipt(self):
        observed = {**receipt(candidate=True), "user_marker_seen": True}
        with self.assertRaisesRegex(RuntimeError, "RECEIPT_AMBIGUOUS"):
            verify_receipt(observed, expected_candidate=True, candidate_sha=sha(CANDIDATE))

    def test_host_version_mismatch_fails_before_any_variant_write(self):
        verify_host_version("opencode v" + HOST)
        for version in ("2.2.5", "2.2.7", "", "unstable"):
            with self.subTest(version=version):
                with self.assertRaisesRegex(RuntimeError, "HOST_MISMATCH"):
                    verify_host_version(version)

    def test_source_and_registry_drift_cannot_be_a_clean_baseline(self):
        baseline = {"skill_file_sha256": "a" * 64, "agents": "b" * 64,
                    "skills": "c" * 64, "config_sha256": "d" * 64}
        source_guard(baseline, baseline.copy())
        for key in baseline:
            with self.subTest(key=key):
                changed = {**baseline, key: "e" * 64}
                with self.assertRaisesRegex(RuntimeError, "SOURCE_DRIFT"):
                    source_guard(baseline, changed)


if __name__ == "__main__":
    unittest.main()
