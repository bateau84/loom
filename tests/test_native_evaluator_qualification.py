"""Synthetic receipts test consistency/rejection, never Evaluator effectiveness."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import sys
import unittest

TOOLS = Path(__file__).resolve().parents[1] / 'tools'
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('native_evaluator_qualification', TOOLS / 'native_evaluator_qualification.py')
qualification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualification)


def source(session, parent=None):
    return {'info': {'id': session, 'projectID': 'project_1', 'location': {'directory': '/private/project'},
                     **({'parentID': parent} if parent else {})},
            'messages': [{'type': 'user', 'id': 'message_' + session, 'text': 'PRIVATE original source'}]}


def rows(instance, recovery=None):
    return [{'format': qualification.FORMAT, 'instance': instance, 'sequence': 1, 'type': 'ready',
             'data': {'audit_session_id': 'general_1', 'recovery_session_id': recovery,
                      'host_version': '2.2.6', 'bun_version': '1.4.2', 'scope': 'one-audit-and-recovery'}}]


def event(log, kind, data):
    log.append({'format': qualification.FORMAT, 'instance': log[0]['instance'],
                'sequence': len(log) + 1, 'type': kind, 'data': data})


def tool(log, kind, session='evaluator_1', agent='evaluator', **fields):
    event(log, 'tool', {'session_id': session, 'agent': agent,
                       'parent_session_id': 'general_1' if session == 'evaluator_1' else None,
                       'call_id': 'call_' + str(len(log)), 'message_id': 'message_' + str(len(log)),
                       'kind': kind, **fields})


RECORD = {'record_id': 'record_1', 'action_id': 'action_1', 'writer_session_id': 'evaluator_1',
          'writer_agent': 'evaluator', 'record_sha256': 'a' * 64,
          'source_refs_sha256': 'b' * 64, 'source_ref_count': 2}


def consistent_receipts():
    audit = rows('instance_a', 'reader_1')
    for session, agent in (('general_1', 'general'), ('evaluator_1', 'evaluator')):
        event(audit, 'model-request', {'session_id': session, 'agent': agent,
                                      'parent_session_id': 'general_1' if agent == 'evaluator' else None,
                                      'provider_id': 'example-provider', 'model_id': 'example-model'})
    tool(audit, 'skill', skill='agent-run-audit', delivered_result_sha256='c' * 64)
    for sid in ('source_parent', 'source_child'):
        tool(audit, 'trace', source_session_id=sid, source='provided-export', event_count=2,
             cursor_sha256=None, next_cursor_sha256=None)
    tool(audit, 'record-write', **RECORD)
    tool(audit, 'record-read', **RECORD)
    tool(audit, 'delegation', session='general_1', agent='general', child_session_id='evaluator_1')
    event(audit, 'closed', {})
    recovery = rows('instance_b', 'reader_1')
    tool(recovery, 'record-read', session='reader_1', agent='general', **RECORD)
    event(recovery, 'closed', {})
    return audit, recovery


class EvaluatorQualificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.parent = self.save('parent.json', source('source_parent'))
        self.child = self.save('child.json', source('source_child', 'source_parent'))
        self.agent = self.root / 'evaluator.md'
        self.skill = self.root / 'SKILL.md'
        self.agent.write_text('PRIVATE installed Evaluator')
        self.skill.write_text('PRIVATE installed skill')

    def save(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value))
        return path

    def logs(self, audit, recovery):
        paths = []
        for name, content in (('audit.ndjson', audit), ('recovery.ndjson', recovery)):
            path = self.root / name
            path.write_text(''.join(json.dumps(row) + '\n' for row in content))
            paths.append(path)
        return paths

    def collect(self, audit=None, recovery=None):
        if audit is None:
            audit, recovery = consistent_receipts()
        return qualification.collect(self.logs(audit, recovery), self.parent, [self.child], self.agent, self.skill, 'record_1')

    def test_consistent_receipts_never_certify_authenticity_reasoning_or_restart(self):
        report = self.collect()
        self.assertEqual(report['receipt_consistency'], 'COMPLETE')
        self.assertEqual(report['native_evaluator'], 'UNPROVEN')
        self.assertIn('receipt-authenticity', report['unproven'])
        self.assertIn('full-host-restart', report['unproven'])
        self.assertNotIn('PRIVATE', json.dumps(report))
        self.assertTrue(all(report['observations'].values()))

    def test_forged_model_pass_summary_cannot_replace_observed_receipts(self):
        path = self.save('pass.json', {'status': 'PASS', 'native_evaluator': 'PASS', 'human_approved': True})
        with self.assertRaises(ValueError):
            qualification.read_log(path)

    def test_scripted_provider_may_prove_mechanics_but_not_real_evaluator(self):
        audit, recovery = consistent_receipts()
        audit[2]['data']['provider_id'] = 'question-fixture'
        report = self.collect(audit, recovery)
        self.assertTrue(report['observations']['public_record_match'])
        self.assertEqual(report['native_evaluator'], 'UNPROVEN')
        self.assertEqual(report['receipt_consistency'], 'INCOMPLETE')
        self.assertIn('scripted-provider-not-real-evaluator', report['blockers'])

    def test_changed_record_or_author_fails_exact_readback(self):
        for field, value in (('record_sha256', 'd' * 64), ('writer_agent', 'coder'),
                             ('writer_session_id', 'other'), ('source_refs_sha256', 'd' * 64),
                             ('action_id', 'other_action')):
            with self.subTest(field=field):
                audit, recovery = consistent_receipts()
                recovery[1]['data'][field] = value
                report = self.collect(audit, recovery)
                self.assertFalse(report['observations']['public_record_match'])
                self.assertIn('public-record-content-or-attribution-mismatch', report['blockers'])

    def test_restarted_observer_without_public_read_is_not_recovery(self):
        audit, recovery = consistent_receipts()
        report = self.collect(audit, recovery[:1])
        self.assertFalse(report['observations']['different_observer_instance'])
        self.assertFalse(report['observations']['public_record_match'])

    def test_wrong_session_read_does_not_satisfy_recovery(self):
        audit, recovery = consistent_receipts()
        recovery[1]['data']['session_id'] = 'unrelated'
        self.assertFalse(self.collect(audit, recovery)['observations']['public_record_match'])

    def test_parent_authored_result_cannot_impersonate_evaluator(self):
        audit, recovery = consistent_receipts()
        audit[6]['data']['session_id'] = 'general_1'
        report = self.collect(audit, recovery)
        self.assertIn('unqualified-writer-or-empty-sources', report['blockers'])

    def test_missing_trace_page_is_not_complete_source_inspection(self):
        audit, recovery = consistent_receipts()
        audit[4]['data']['next_cursor_sha256'] = 'd' * 64
        self.assertFalse(self.collect(audit, recovery)['observations']['source_trace_pages_complete'])

    def test_missing_native_child_dispatch_or_skill_is_visible(self):
        for target, flag in (('delegation', 'native_delegation_receipt'), ('skill', 'skill_result_observed')):
            with self.subTest(target=target):
                audit, recovery = consistent_receipts()
                audit = [row for row in audit if row['data'].get('kind') != target]
                for number, row in enumerate(audit, 1):
                    row['sequence'] = number
                self.assertFalse(self.collect(audit, recovery)['observations'][flag])

    def test_gap_limit_and_unsupported_host_remain_incomplete(self):
        for kind in ('limit', 'observation-gap'):
            with self.subTest(kind=kind):
                audit, recovery = consistent_receipts()
                recovery.pop()  # The limit is terminal; a gap may later close.
                event(recovery, kind, {})
                if kind == 'observation-gap':
                    event(recovery, 'closed', {})
                self.assertIn('observer-coverage-gap', self.collect(audit, recovery)['blockers'])
        audit, recovery = consistent_receipts()
        recovery[0]['data']['host_version'] = 'new-unqualified-host'
        self.assertIn('unsupported-host-version', self.collect(audit, recovery)['blockers'])

    def test_replayed_file_or_receipt_sequence_is_rejected(self):
        audit, recovery = consistent_receipts()
        with self.assertRaisesRegex(ValueError, 'Replayed observer'):
            self.collect(audit, copy.deepcopy(audit))
        audit, recovery = consistent_receipts()
        audit[5]['sequence'] = audit[4]['sequence']
        with self.assertRaisesRegex(ValueError, 'Invalid receipt envelope'):
            self.collect(audit, recovery)

    def test_missing_terminal_close_is_incomplete_even_when_selected_receipts_match(self):
        for index in (0, 1):
            with self.subTest(instance=index):
                pair = list(consistent_receipts())
                pair[index].pop()
                report = self.collect(*pair)
                self.assertEqual(report['receipt_consistency'], 'INCOMPLETE')
                self.assertIn('observer-closure-missing', report['blockers'])

    def test_events_after_close_or_limit_are_rejected(self):
        for terminal in ('closed', 'limit'):
            with self.subTest(terminal=terminal):
                audit, recovery = consistent_receipts()
                recovery[-1]['type'] = terminal
                event(recovery, 'observation-gap', {})
                with self.assertRaisesRegex(ValueError, 'after terminal'):
                    self.collect(audit, recovery)

    def test_native_tool_replay_across_instances_is_rejected(self):
        audit, recovery = consistent_receipts()
        replay = copy.deepcopy(audit[7]['data'])
        recovery.pop()
        event(recovery, 'tool', replay)
        event(recovery, 'closed', {})
        with self.assertRaisesRegex(ValueError, 'across observer instances'):
            self.collect(audit, recovery)

    def test_provider_call_id_can_repeat_for_a_distinct_native_message_or_session(self):
        audit, recovery = consistent_receipts()
        audit[5]['data']['call_id'] = audit[4]['data']['call_id']
        recovery[1]['data']['call_id'] = audit[4]['data']['call_id']
        recovery[1]['data']['message_id'] = audit[4]['data']['message_id']
        self.assertEqual(self.collect(audit, recovery)['receipt_consistency'], 'COMPLETE')

    def test_code_mode_batch_can_share_one_native_tuple_across_nested_tools(self):
        audit, recovery = consistent_receipts()
        for row in audit:
            if row['type'] == 'tool' and row['data']['session_id'] == 'evaluator_1':
                row['data']['call_id'] = 'one_execute_call'
                row['data']['message_id'] = 'one_native_message'
        self.assertEqual(self.collect(audit, recovery)['receipt_consistency'], 'COMPLETE')

    def test_changed_recovery_scope_cannot_complete_another_audit(self):
        for field, value in (('audit_session_id', 'unrelated_audit'), ('recovery_session_id', 'unrelated_reader')):
            with self.subTest(field=field):
                audit, recovery = consistent_receipts()
                recovery[0]['data'][field] = value
                report = self.collect(audit, recovery)
                self.assertEqual(report['receipt_consistency'], 'INCOMPLETE')
                self.assertIn('observer-scope-mismatch', report['blockers'])
                self.assertFalse(report['observations']['public_record_match'])

    def test_evaluator_model_skill_and_trace_must_share_the_native_parent(self):
        for index in (2, 3, 4, 5):
            with self.subTest(receipt=index):
                audit, recovery = consistent_receipts()
                audit[index]['data']['parent_session_id'] = 'foreign_parent'
                report = self.collect(audit, recovery)
                self.assertEqual(report['receipt_consistency'], 'INCOMPLETE')
                self.assertIn('native-session-attribution-mismatch', report['blockers'])

    def test_recovery_reader_must_keep_its_native_general_role(self):
        audit, recovery = consistent_receipts()
        recovery[1]['data']['agent'] = 'coder'
        report = self.collect(audit, recovery)
        self.assertEqual(report['receipt_consistency'], 'INCOMPLETE')
        self.assertIn('native-session-attribution-mismatch', report['blockers'])
        self.assertFalse(report['observations']['public_record_match'])

    def test_unexpected_raw_fields_are_rejected(self):
        audit, recovery = consistent_receipts()
        audit[6]['data']['statement'] = 'PRIVATE unfiltered result'
        with self.assertRaisesRegex(ValueError, 'privacy projection'):
            self.collect(audit, recovery)

    def test_truncated_log_and_symlink_are_rejected(self):
        audit, recovery = consistent_receipts()
        path = self.logs(audit, recovery)[0]
        path.write_bytes(path.read_bytes()[:-1])
        with self.assertRaisesRegex(ValueError, 'Incomplete receipt'):
            qualification.read_log(path)
        link = self.root / 'link'
        link.symlink_to(path)
        with self.assertRaises(OSError):
            qualification.read_log(link)

    def test_cli_writes_only_private_new_report_without_inference(self):
        paths = self.logs(*consistent_receipts())
        report = self.root / 'report.json'
        args = ['--observer-log', str(paths[0]), '--observer-log', str(paths[1]),
                '--parent-export', str(self.parent), '--child-export', str(self.child),
                '--agent-file', str(self.agent), '--skill-file', str(self.skill),
                '--record-id', 'record_1', '--report', str(report)]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(qualification.main(args), 0)
            self.assertEqual(qualification.main(args), 2)
        self.assertEqual(report.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(report.read_text())['native_evaluator'], 'UNPROVEN')


if __name__ == '__main__':
    unittest.main()
