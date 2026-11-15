"""Harness-oracle tests, NOT installed production/native qualification."""
import glob
import hashlib
import json
import shlex
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock, patch

from installed_questions import (
    READ_DENIAL_APPLICABILITY,
    REQUIRED_INSTALLED_CHECKS,
    Scenario,
    audit_session,
    events,
    final_events,
    fixture_snapshot,
    no_contact,
    qualification_status,
    restore_fixture,
    run,
    synthetic_events,
    target_requests,
    unchanged_rows,
    verify_provider_inputs,
    verify_single_admission,
)


class AuditSessionTest(unittest.TestCase):
    def test_finalize_retains_parses_and_hashes_one_captured_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'audit.ndjson'
            destination = root / 'retained.ndjson'
            raw = b'{"type":"ready"}\n{"type":"tool-after"}'
            later = b'{"type":"different"}\n'
            path.write_bytes(raw)
            read_bytes = Path.read_bytes
            source_reads = []

            def changing_source(file):
                captured = read_bytes(file)
                if file == path:
                    source_reads.append(captured)
                    path.write_bytes(later)
                return captured

            with audit_session(root) as owner, patch.object(Path, 'read_bytes', changing_source):
                result = owner.finalize(destination)

            self.assertEqual(source_reads, [raw])
            self.assertEqual(destination.read_bytes(), raw)
            self.assertEqual(result.events, [{'type': 'ready'}, {'type': 'tool-after'}])
            self.assertEqual(result.sha256, hashlib.sha256(raw).hexdigest())
            self.assertEqual(result.byte_count, len(raw))
            self.assertEqual(path.read_bytes(), later)

    def test_managed_reader_rejects_loss_of_a_valid_observed_prefix(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'audit.ndjson'
            prefix = b'{"type":"ready"}\n'
            path.write_bytes(prefix + b'{"type":"tool-before"}\n')
            with audit_session(root) as owner:
                self.assertEqual(len(events(root)), 2)
                self.assertEqual(len(final_events(root)), 2)
                path.write_bytes(prefix)
                with self.assertRaisesRegex(RuntimeError, 'prefix'):
                    owner.finalize(root / 'retained.ndjson')
                self.assertEqual((root / 'retained.ndjson').read_bytes(), prefix)

    def test_missing_is_allowed_only_until_a_file_has_been_observed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'audit.ndjson'
            with audit_session(root):
                self.assertEqual(events(root), [])
                path.write_bytes(b'')
                self.assertEqual(events(root), [])
                path.unlink()
                with self.assertRaisesRegex(RuntimeError, 'missing'):
                    events(root)

    def test_caught_integrity_failure_remains_failed_after_exact_restoration(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'audit.ndjson'
            destination = root / 'retained.ndjson'
            raw = b'{"type":"ready"}\n'
            path.write_bytes(raw)
            with audit_session(root) as owner:
                events(root)
                path.write_bytes(b'{"type":"other"}\n')
                with self.assertRaisesRegex(RuntimeError, 'prefix'):
                    events(root)
                path.write_bytes(raw)

                with self.assertRaisesRegex(RuntimeError, 'prefix'):
                    events(root)
                with self.assertRaisesRegex(RuntimeError, 'prefix'):
                    final_events(root)
                with self.assertRaisesRegex(RuntimeError, 'prefix'):
                    owner.finalize(destination)
                self.assertEqual(destination.read_bytes(), raw)

    def test_final_validation_requires_an_active_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'audit.ndjson').write_bytes(b'{"type":"ready"}\n')
            with self.assertRaisesRegex(RuntimeError, 'active.*scope'):
                final_events(root)
            with audit_session(root) as owner:
                self.assertEqual(final_events(root), [{'type': 'ready'}])
            destination = root / 'retained.ndjson'
            with self.assertRaisesRegex(RuntimeError, 'active.*scope'):
                owner.finalize(destination)
            self.assertFalse(destination.exists())

    def test_final_validation_rejects_missing_or_empty_without_a_prior_read(self):
        for raw, diagnostic in [(None, 'Final audit file is missing'), (b'', 'Final audit is empty')]:
            for method in ('read', 'retain'):
                with self.subTest(raw=raw, method=method), tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    path = root / 'audit.ndjson'
                    destination = root / 'retained.ndjson'
                    if raw is not None:
                        path.write_bytes(raw)
                    with audit_session(root) as owner:
                        if method == 'retain':
                            destination.write_bytes(b'stale artifact')
                        with self.assertRaisesRegex(RuntimeError, diagnostic):
                            if method == 'read':
                                final_events(root)
                            else:
                                owner.finalize(destination)
                    if method == 'retain' and raw is not None:
                        self.assertEqual(destination.read_bytes(), raw)
                    else:
                        self.assertFalse(destination.exists())

    def test_active_scope_rejects_a_different_root_even_with_identical_bytes(self):
        for reader in (events, final_events):
            with self.subTest(reader=reader.__name__), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                other = root / 'other'
                other.mkdir()
                for directory in (root, other):
                    (directory / 'audit.ndjson').write_bytes(b'{"type":"ready"}\n')
                with audit_session(root):
                    events(root)
                    with self.assertRaisesRegex(RuntimeError, 'audit root'):
                        reader(other)

    def test_nested_scope_cannot_replace_the_active_owner(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with audit_session(root):
                with self.assertRaisesRegex(RuntimeError, 'Nested audit'):
                    with audit_session(root):
                        self.fail('Nested scope was entered')

    def test_closed_scope_cannot_be_reentered(self):
        with tempfile.TemporaryDirectory() as temp:
            scope = audit_session(Path(temp))
            with scope:
                pass
            with self.assertRaisesRegex(RuntimeError, 're-entered'):
                with scope:
                    self.fail('Closed scope was entered again')

    def test_finalize_io_failure_stays_latched_after_io_recovers(self):
        for operation in ('read_bytes', 'write_bytes', 'chmod'):
            with self.subTest(operation=operation), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                destination = root / 'retained.ndjson'
                raw = b'{"type":"ready"}\n'
                (root / 'audit.ndjson').write_bytes(raw)
                with audit_session(root) as owner:
                    with patch.object(Path, operation, side_effect=PermissionError('audit IO denied')):
                        with self.assertRaisesRegex(PermissionError, 'audit IO denied'):
                            owner.finalize(destination)
                    with self.assertRaisesRegex(PermissionError, 'audit IO denied'):
                        owner.finalize(destination)
                    self.assertEqual(destination.read_bytes(), raw)

    def test_same_count_and_longer_mutated_prefixes_are_rejected(self):
        raw = b'{"type":"ready"}\n'
        replacements = [b'{"type":"other"}\n', b'{"type":"changed-label"}\n',
                        b'{"type":"other"}\n{"type":"tool-before"}\n']
        for replacement in replacements:
            with self.subTest(replacement=replacement), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                path = root / 'audit.ndjson'
                path.write_bytes(raw)
                with audit_session(root):
                    events(root)
                    path.write_bytes(replacement)
                    with self.assertRaisesRegex(RuntimeError, 'prefix'):
                        events(root)

    def test_deferred_json_and_utf8_tails_are_part_of_the_observed_prefix(self):
        for tail in (b'{"type":"provider-request","data":"unfinished', b'{"type":"text","data":"\xc3'):
            with self.subTest(tail=tail), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                path = root / 'audit.ndjson'
                prefix = b'{"type":"ready"}\n'
                path.write_bytes(prefix + tail)
                with audit_session(root):
                    self.assertEqual(events(root), [{'type': 'ready'}])
                    path.write_bytes(prefix)
                    with self.assertRaisesRegex(RuntimeError, 'prefix'):
                        events(root)

    def test_appends_and_identical_replacement_preserve_one_scope_across_restart_markers(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'audit.ndjson'
            destination = root / 'retained.ndjson'
            first = b'{"type":"ready","data":{"process":1}}\n'
            appended = b'{"type":"tool-after"}\n{"type":"ready","data":{"process":2}}\n{"type":"text"}'
            with audit_session(root) as owner:
                self.assertEqual(events(root), [])
                path.write_bytes(first)
                self.assertEqual(len(events(root)), 1)
                replacement = root / 'replacement.ndjson'
                replacement.write_bytes(first)
                replacement.replace(path)
                self.assertEqual(len(events(root)), 1)
                with path.open('ab') as stream:
                    stream.write(appended)
                self.assertEqual(len(final_events(root)), 4)
                result = owner.finalize(destination)
            self.assertEqual(len(result.events), 4)
            self.assertEqual(destination.read_bytes(), first + appended)
            self.assertEqual(result.sha256, hashlib.sha256(first + appended).hexdigest())
            self.assertEqual(result.byte_count, len(first + appended))

    def test_finalize_retains_invalid_bytes_and_latches_validation_failure(self):
        cases = [(b'{"type":}\n', json.JSONDecodeError),
                 (b'{"type":"unfinished', json.JSONDecodeError),
                 (b'{"type":"\xc3', UnicodeDecodeError),
                 (b'{"type":"observer-failure"}\n', RuntimeError)]
        restored = b'{"type":"ready"}\n'
        for raw, error in cases:
            with self.subTest(raw=raw), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                path = root / 'audit.ndjson'
                destination = root / 'retained.ndjson'
                path.write_bytes(raw)
                with audit_session(root) as owner:
                    with self.assertRaises(error) as first_failure:
                        owner.finalize(destination)
                    self.assertEqual(destination.read_bytes(), raw)
                    path.write_bytes(restored)
                    with self.assertRaises(error) as after_restoration:
                        owner.finalize(destination)
                    self.assertIs(after_restoration.exception, first_failure.exception)
                    self.assertEqual(destination.read_bytes(), restored)

    def test_scope_exit_releases_ownership_without_implicit_finalization(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'audit.ndjson'
            with self.assertRaisesRegex(ValueError, 'scenario failed'):
                with audit_session(root):
                    self.assertEqual(events(root), [])
                    raise ValueError('scenario failed')
            self.assertEqual(events(root), [])
            path.write_bytes(b'{"type":"ready"}\n')
            self.assertEqual(events(root), [{'type': 'ready'}])
            path.write_bytes(b'{"type":"other"}\n')
            self.assertEqual(events(root), [{'type': 'other'}])
            with audit_session(root):
                self.assertEqual(final_events(root), [{'type': 'other'}])


class QuestionHarnessTest(unittest.TestCase):
    def test_live_audit_defers_partial_tail_and_reads_it_after_append_finishes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'audit.ndjson'
            first = {'type': 'ready', 'data': {}}
            second = {'type': 'provider-request', 'data': {'prompt': 'x' * 65536}}
            prefix = json.dumps(first).encode() + b'\n'
            pending = json.dumps(second).encode() + b'\n'
            partial = prefix + pending[:20000]
            path.write_bytes(partial)

            self.assertEqual(events(root), [first])
            self.assertEqual(path.read_bytes(), partial)
            with path.open('ab') as stream:
                stream.write(pending[20000:])
            self.assertEqual(events(root), [first, second])
            self.assertEqual(path.read_bytes(), prefix + pending)

    def test_final_audit_rejects_an_unfinished_json_tail(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'audit.ndjson'
            raw = b'{"type":"ready","data":{}}\n{"type":"provider-request","data":"unfinished'
            path.write_bytes(raw)

            with self.assertRaises(json.JSONDecodeError):
                events(root, final=True)
            self.assertEqual(path.read_bytes(), raw)

    def test_live_audit_defers_a_partial_utf8_character_only_in_the_tail(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'audit.ndjson'
            first = {'type': 'ready', 'data': {}}
            second = {'type': 'context', 'data': 'évidence'}
            prefix = json.dumps(first).encode() + b'\n'
            pending = json.dumps(second, ensure_ascii=False).encode('utf-8') + b'\n'
            cut = pending.index('é'.encode('utf-8')) + 1
            path.write_bytes(prefix + pending[:cut])

            self.assertEqual(events(root), [first])
            with self.assertRaises(UnicodeDecodeError):
                events(root, final=True)
            with path.open('ab') as stream:
                stream.write(pending[cut:])
            self.assertEqual(events(root, final=True), [first, second])
            self.assertEqual(path.read_bytes(), prefix + pending)

    def test_complete_malformed_audit_rows_are_fatal_during_live_and_final_reads(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'audit.ndjson'
            for invalid, error in [(b'{"type":}\n', json.JSONDecodeError),
                                   (b'{"type":"\xc3"}\n', UnicodeDecodeError),
                                   (b'\n', json.JSONDecodeError)]:
                for final in (False, True):
                    with self.subTest(invalid=invalid, final=final):
                        raw = b'{"type":"ready"}\n' + invalid + b'{"type":"unfinished'
                        path.write_bytes(raw)
                        with self.assertRaises(error):
                            events(root, final=final)
                        self.assertEqual(path.read_bytes(), raw)

    def test_complete_final_json_without_a_newline_remains_compatible(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            expected = [{'type': 'ready'}, {'type': 'tool-after', 'data': {'status': 'completed'}}]
            (root / 'audit.ndjson').write_text('\n'.join(json.dumps(e) for e in expected))
            self.assertEqual(events(root), expected)
            self.assertEqual(events(root, final=True), expected)
            with audit_session(root):
                self.assertEqual(final_events(root), expected)

    def test_final_audit_rejects_observer_failure_completed_after_live_check(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'audit.ndjson'
            ready = {'type': 'ready', 'data': {}}
            failure = {'type': 'observer-failure', 'data': {'error': 'late subscription failure'}}
            prefix = json.dumps(ready).encode() + b'\n'
            pending = json.dumps(failure).encode() + b'\n'
            path.write_bytes(prefix + pending[:-3])
            with audit_session(root):
                self.assertEqual(events(root), [ready])
                with path.open('ab') as stream:
                    stream.write(pending[-3:])
                with self.assertRaisesRegex(RuntimeError, 'Passive native observer failed'):
                    final_events(root)
            self.assertEqual(events(root, final=True), [ready, failure])
            self.assertEqual(path.read_bytes(), prefix + pending)

    def test_question_run_retains_raw_audit_and_report_when_final_audit_is_invalid(self):
        repo = Path(__file__).resolve().parents[1]
        cases = [
            (b'{"type":"provider-request","data":"unfinished', 'JSONDecodeError'),
            (b'{"type":"observer-failure","data":{"error":"late subscription failure"}}\n',
             'RuntimeError: Passive native observer failed'),
        ]
        for tail, audit_error in cases:
            with self.subTest(audit_error=audit_error), tempfile.TemporaryDirectory() as temp:
                raw = b'{"type":"ready","data":{}}\n' + tail
                host = Mock()
                host.url = 'http://127.0.0.1:1'
                host.proc.pid = 1234
                host.proc.poll.return_value = None
                host.get.side_effect = RuntimeError('fixture startup failure')

                def start(executable, project, env, output, label):
                    def close():
                        (Path(env['LOOM_QUESTION_FIXTURE']) / 'audit.ndjson').write_bytes(raw)
                        host.proc.poll.return_value = 0
                    host.close.side_effect = close
                    return host

                root = Path(temp)
                output = root / 'report'
                with patch('installed_questions.installed_plugin_inventory', return_value={'sdk_version': '2.2.6'}), \
                        patch('installed_questions.subprocess.check_output', return_value='2.2.6'), \
                        patch('installed_questions.PrivateHost', side_effect=start):
                    report = run('/unused-host', repo, output, root / 'artifact.tgz', root / 'plugin', '2.0.0-alpha.1')

                self.assertEqual(report['status'], 'FAIL')
                self.assertEqual(report['error'], 'RuntimeError: fixture startup failure')
                self.assertIn(audit_error, report['audit_error'])
                self.assertNotIn('activity', report)
                self.assertEqual((output / 'audit.ndjson').read_bytes(), raw)
                self.assertEqual(json.loads((output / 'report.json').read_text()), report)
                self.assertTrue(report['private_root_removed'])
                self.assertTrue(all(owned['process_dead'] for owned in report['owned_hosts']))

    def test_candidate_artifact_mismatch_is_reported_before_any_host_is_started(self):
        repo = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root / 'report'
            with self.assertRaisesRegex(RuntimeError, 'Candidate package artifact is missing'):
                run('/unused-host', repo, output, root / 'missing.tgz', root / 'missing-plugin', '2.0.0-alpha.1')
            report = json.loads((output / 'report.json').read_text())
            self.assertEqual(report['status'], 'FAIL')
            self.assertIn('Candidate package artifact is missing', report['error'])

    def test_plan4_applicability_is_neither_an_executed_pass_nor_a_general_waiver(self):
        checks = [{'name': name, 'status': 'PASS'} for name in REQUIRED_INSTALLED_CHECKS] + [dict(READ_DENIAL_APPLICABILITY)]
        self.assertEqual(qualification_status(checks, '2.2.6'), 'PASS')
        self.assertEqual(checks[-1]['status'], 'NOT APPLICABLE')
        self.assertFalse(checks[-1]['executed'])
        self.assertEqual(qualification_status(checks, '2.0.29'), 'UNPROVEN')
        self.assertEqual(qualification_status(checks, '2.0.33'), 'UNPROVEN')
        self.assertEqual(qualification_status(checks[1:], '2.2.6'), 'UNPROVEN')
        for replacement in [{'name': READ_DENIAL_APPLICABILITY['name'], 'status': 'PASS'},
                            {**READ_DENIAL_APPLICABILITY, 'executed': True},
                            {**READ_DENIAL_APPLICABILITY, 'sources': []},
                            {**READ_DENIAL_APPLICABILITY, 'rationale': 'permission.assert enforces session reads'}]:
            self.assertEqual(qualification_status(checks[:-1] + [replacement], '2.2.6'), 'UNPROVEN')
        self.assertEqual(READ_DENIAL_APPLICABILITY['host_version'], '2.2.6')
        self.assertIn('packages/core/src/session/session.ts', READ_DENIAL_APPLICABILITY['sources'][-1])

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

    def test_scripted_code_mode_error_does_not_pass_on_outer_completed_status(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            log = [
                {'type': 'tool-after', 'data': {
                    'sessionID': 'target', 'tool': 'execute', 'status': 'completed',
                    'result': {'metadata': {'error': True, 'toolCalls': []},
                               'content': [{'type': 'text', 'text': 'PRIVATE_EXCEPTION'}]}}}
            ]
            (root / 'audit.ndjson').write_text('\\n'.join(json.dumps(e) for e in log))
            with patch('installed_questions.idle'):
                with self.assertRaisesRegex(RuntimeError, 'scripted qualification|Scripted Code Mode'):
                    Scenario(None, root).finish('target', 'job', 0)
            self.assertNotIn('PRIVATE_EXCEPTION', (root / 'missing').name)

    def test_package_script_collects_every_current_native_and_preservation_suite(self):
        repo = Path(__file__).resolve().parents[1]
        command = shlex.split(json.loads((repo / 'package.json').read_text())['scripts']['test:native'])
        collected = {Path(p).resolve() for pattern in command[2:] for p in glob.glob(str(repo / pattern))}
        expected = set((repo / 'tests').glob('*.test.ts')) - {repo / 'tests/tool-search-codemode.test.ts'}
        expected.update((repo / 'tests/fixtures/baseline-c9ffcfa').glob('*.test.ts'))
        expected.update((repo / 'tests/question-host').glob('*.test.ts'))
        expected.update((repo / 'tests/retrospective-source').glob('*.test.ts'))
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
