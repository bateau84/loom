import unittest

from installed_review_persistence import REQUIRED_CHECKS, qualification_status


class PersistenceQualificationStatusTests(unittest.TestCase):
    def checks(self):
        return [{"name": name, "status": "PASS"} for name in sorted(REQUIRED_CHECKS)]

    def test_all_required_mechanics_are_needed(self):
        checks = self.checks()
        self.assertEqual(qualification_status(checks), "PASS")
        self.assertEqual(qualification_status([]), "UNQUALIFIED")
        for index in range(len(checks)):
            self.assertEqual(qualification_status(checks[:index] + checks[index + 1:]), "UNQUALIFIED")

    def test_failed_duplicate_and_unknown_checks_cannot_produce_pass(self):
        checks = self.checks()
        for status in ["FAIL", "UNQUALIFIED", "NOT APPLICABLE"]:
            self.assertEqual(qualification_status([{**checks[0], "status": status}, *checks[1:]]), "UNQUALIFIED")
        self.assertEqual(qualification_status([*checks, checks[0]]), "UNQUALIFIED")
        self.assertEqual(qualification_status([*checks, {"name": "unreviewed-extra", "status": "PASS"}]), "UNQUALIFIED")


if __name__ == "__main__":
    unittest.main()
