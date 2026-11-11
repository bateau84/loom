"""Oracle controls only; these unit tests do not certify any host or human."""
import unittest
from urllib.error import HTTPError, URLError
from unittest.mock import patch

import installed_host_trust as probe


class HostTrustOracleTest(unittest.TestCase):
    def test_rejection_control_requires_the_exact_http_failure(self):
        def reply(status):
            raise HTTPError("http://127.0.0.1/fixture", status, "fixture", {}, None)

        probe.expect_http(404, lambda: reply(404))
        for status in (400, 401, 500):
            with self.subTest(status=status), self.assertRaisesRegex(RuntimeError, "status"):
                probe.expect_http(404, lambda: reply(status))

    def test_success_and_transport_failure_do_not_pass_rejection_control(self):
        with self.assertRaisesRegex(RuntimeError, "unexpectedly succeeded"):
            probe.expect_http(404, lambda: {})

        def unreachable():
            raise URLError("disposable host unavailable")

        with self.assertRaises(URLError):
            probe.expect_http(404, unreachable)

    def test_api_probe_never_resumes_a_prompt_even_for_claimed_human_metadata(self):
        native = {"id": "msg_test", "sessionID": "ses_test", "type": "user"}
        with patch.object(probe, "request", return_value=native) as request:
            self.assertEqual(probe.admit(object(), "ses_test", "msg_test", "approval",
                                         {"human": True}), native)
            payload = request.call_args.args[3]
            self.assertIs(payload["resume"], False)
            self.assertEqual(payload["metadata"], {"human": True})

    def test_foreign_or_mistyped_native_identity_cannot_pass_admission(self):
        valid = {"id": "msg_test", "sessionID": "ses_test", "type": "user"}
        for key, value in (("id", "msg_other"), ("sessionID", "ses_other"), ("type", "synthetic")):
            with self.subTest(key=key), patch.object(probe, "request", return_value={**valid, key: value}):
                with self.assertRaisesRegex(RuntimeError, "identity"):
                    probe.admit(object(), "ses_test", "msg_test", "probe")


if __name__ == "__main__":
    unittest.main()
