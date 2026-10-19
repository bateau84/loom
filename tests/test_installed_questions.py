"""Harness-oracle tests, NOT installed production/native qualification."""
import glob
import json
import shlex
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from installed_questions import (
    READ_DENIAL_APPLICABILITY,
    REQUIRED_INSTALLED_CHECKS,
    Scenario,
    fixture_snapshot,
    no_contact,
    qualification_status,
    restore_fixture,
    synthetic_events,
    target_requests,
    unchanged_rows,
    verify_provider_inputs,
    verify_single_admission,
)


class QuestionHarnessTest(unittest.TestCase):
    def test_plan4_applicability_is_neither_an_executed_pass_nor_a_general_waiver(self):
        checks = [{'name': name, 'status': 'PASS'} for name in REQUIRED_INSTALLED_CHECKS] + [dict(READ_DENIAL_APPLICABILITY)]
        self.assertEqual(qualification_status(checks, '2.0.29'), 'PASS')
        self.assertEqual(checks[-1]['status'], 'NOT APPLICABLE')
        self.assertFalse(checks[-1]['executed'])
        self.assertEqual(qualification_status(checks, '2.0.30'), 'UNPROVEN')
        self.assertEqual(qualification_status(checks[1:], '2.0.29'), 'UNPROVEN')
        for replacement in [{'name': READ_DENIAL_APPLICABILITY['name'], 'status': 'PASS'},
                            {**READ_DENIAL_APPLICABILITY, 'executed': True},
                            {**READ_DENIAL_APPLICABILITY, 'sources': []}]:
            self.assertEqual(qualification_status(checks[:-1] + [replacement], '2.0.29'), 'UNPROVEN')

    def test_finishing_a_command_does_not_count_another_running_sessions_tool(self):
        # Supporting driver test only. The external native idle query is not
        # part of this trace-selection unit; real-host barriers are rehearsed.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            trace = [
                {'type': 'tool-after', 'data': {'sessionID': 'target', 'tool': 'execute', 'status': 'completed'}},
                {'type': 'tool-after', 'data': {'sessionID': 'respondent', 'tool': 'loom_record', 'status': 'completed',
                                              'result': {'content': json.dumps({'result': {'id': 'answer'}})}}},
                {'type': 'tool-after', 'data': {'sessionID': 'respondent', 'tool': 'execute', 'status': 'completed'}},
            ]
            (root / 'audit.ndjson').write_text('\n'.join(json.dumps(e) for e in trace))
            with patch('installed_questions.idle'):
                self.assertEqual(Scenario(None, root).finish('respondent', 'job', 0, 'record'), {'id': 'answer'})

    def test_package_script_collects_every_current_native_and_preservation_suite(self):
        repo = Path(__file__).resolve().parents[1]
        command = shlex.split(json.loads((repo / 'package.json').read_text())['scripts']['test:native'])
        collected = {Path(p).resolve() for pattern in command[2:] for p in glob.glob(str(repo / pattern))}
        expected = set((repo / 'tests').glob('*.test.ts')) - {repo / 'tests/tool-search-codemode.test.ts'}
        expected.update((repo / 'tests/fixtures/baseline-c9ffcfa').glob('*.test.ts'))
        expected.update((repo / 'tests/question-host').glob('*.test.ts'))
        self.assertEqual(collected, expected)

    def test_retirement_inventory_names_missing_obsolete_contracts_not_equivalent_passes(self):
        repo = Path(__file__).resolve().parents[1]
        inventory = json.loads((repo / 'tests/question-host/coverage.json').read_text())
        self.assertEqual(sum(item.get('tests', 0) for item in inventory['retired']), 30)
        for item in inventory['retired']:
            for name in item['files']:
                self.assertFalse((repo / name).exists(), name)
        self.assertEqual(inventory['selective_read_denial']['status'], 'NOT APPLICABLE')

    def test_raw_provider_oracle_accepts_repeated_history_but_rejects_two_inputs_in_one_request(self):
        event = {'type': 'provider-inputs', 'data': {'notices': [{'question': 'q', 'answer': 'a'}]}}
        verify_provider_inputs([event, event])
        with self.assertRaisesRegex(RuntimeError, 'Duplicate actionable notice'):
            verify_provider_inputs([{'type': 'provider-inputs', 'data': {'notices': event['data']['notices'] * 2}}])

    def test_exact_native_admission_rejects_duplicate_retarget_or_changed_notice(self):
        good = {'data': {'sessionID': 'asker', 'item': {'payload': {'metadata': {'answer_id': 'answer'}}, 'delivery': 'steer'}}}
        verify_single_admission([good], 'asker', 'answer')
        for inputs, target, answer in [([], 'asker', 'answer'), ([good, good], 'asker', 'answer'), ([good], 'other', 'answer'), ([good], 'asker', 'other')]:
            with self.subTest(inputs=inputs, target=target, answer=answer), self.assertRaises(RuntimeError):
                verify_single_admission(inputs, target, answer)

    def test_no_contact_checks_native_permission_and_recipient_requests(self):
        no_contact([{'type': 'model-request', 'data': {'agent': 'question-asker'}}])
        for event in [
            {'type': 'model-request', 'data': {'agent': 'question-respondent'}},
            {'type': 'tool-before', 'data': {'tool': 'subagent'}},
            {'type': 'native-event', 'data': {'type': 'permission.asked'}},
            {'type': 'native-event', 'data': {'type': 'session.inbox.enqueued', 'data': {'item': {'type': 'synthetic'}}}},
            {'type': 'provider-inputs', 'data': {'notices': [{'answer': 'a'}]}},
        ]:
            with self.subTest(event=event), self.assertRaises(RuntimeError):
                no_contact([event])

    def test_raw_request_and_admission_counts_ignore_scripted_write_guards(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            admission = {'type': 'native-event', 'data': {'type': 'session.inbox.enqueued', 'data': {'sessionID': 'asker', 'item': {'type': 'synthetic'}}}}
            request = {'type': 'model-request', 'data': {'sessionID': 'asker'}}
            (root / 'audit.ndjson').write_text('\n'.join(json.dumps(e) for e in [admission, request, admission, request]))
            self.assertEqual(len(synthetic_events(root)), 2)
            self.assertEqual(len(target_requests(root, 'asker')), 2)
            self.assertEqual(len(target_requests(root, 'other')), 0)

    def test_frozen_old_prerequisite_hydrates_and_detects_changed_raw_bytes(self):
        saved = fixture_snapshot(Path(__file__).resolve().parents[1])
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'ledger.sqlite'
            path.touch()
            restore_fixture(path, saved)
            unchanged_rows(path, saved)
            with closing(sqlite3.connect(path)) as db, db:
                db.execute("UPDATE ledger SET data='{}' WHERE seq=(SELECT MIN(seq) FROM ledger)")
            with self.assertRaisesRegex(RuntimeError, 'Historical raw row changed'):
                unchanged_rows(path, saved)


if __name__ == '__main__':
    unittest.main()
