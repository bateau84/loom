"""Consumer finalization controls; mocked host I/O never qualifies a native host."""
from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import Mock, patch

import installed_evaluator_observer as evaluator
import installed_model_routing as routing
import installed_objectives as objectives
import installed_questions as questions


class HostIO:
    """Only the subprocess/HTTP boundary is replaced; audit decisions stay real."""

    def __init__(self, *, damage=None, phase=None, scenario_error=False, omit_ready=False):
        self.damage, self.phase = damage, phase
        self.scenario_error, self.omit_ready = scenario_error, omit_ready
        self.hosts = []
        self.retained = None

    @staticmethod
    def append(host, kind, **data):
        with (host.root / 'audit.ndjson').open('ab') as stream:
            stream.write(json.dumps({'type': kind, 'data': data}).encode() + b'\n')

    def start(self, executable, project, env, output, label):
        host = Mock()
        host.root = Path(env['LOOM_QUESTION_FIXTURE'])
        host.label, host.closed = label, False
        host.proc.pid = 1000 + len(self.hosts)
        host.proc.poll.side_effect = lambda: 0 if host.closed else None
        host.get.return_value = json.dumps({'version': '2.2.6'})
        host.wait_roster.return_value = ([], 0)
        self.hosts.append(host)
        if not (self.omit_ready is True or self.omit_ready == label):
            self.append(host, 'ready', phase=label)

        def close():
            if host.closed:
                return
            host.closed = True
            path = host.root / 'audit.ndjson'
            if self.phase is None or self.phase == label:
                if self.damage == 'missing':
                    path.unlink(missing_ok=True)
                elif self.damage == 'empty':
                    path.write_bytes(b'')
                elif self.damage == 'truncated':
                    path.write_bytes(b'\n'.join(path.read_bytes().splitlines()[:-1]) + b'\n')
                elif self.damage == 'malformed':
                    with path.open('ab') as stream:
                        stream.write(b'{"type":}\n')
                elif self.damage == 'observer-failure':
                    self.append(host, 'observer-failure', error='late fixture subscription failure')
                elif self.damage == 'late-provider':
                    self.append(host, 'provider-request', role='reader')
            self.retained = path.read_bytes() if path.exists() else None

        host.close.side_effect = close
        return host

    def request(self, host, method, path, body=None):
        if method == 'POST' and path == '/api/session':
            if self.scenario_error:
                self.append(host, 'model-request', model={'providerID': 'question-fixture'})
                raise RuntimeError('scenario request failed')
            return {'id': 'session-' + host.label}
        if method == 'POST' and path.endswith('/prompt'):
            self.append(host, 'model-request', model={'providerID': 'question-fixture'})
            if host.label == 'routing-disabled':
                self.append(host, 'provider-request', role='reader')
            return {'type': 'user'}
        if method == 'GET' and path == '/api/session/active':
            return []
        if method == 'GET' and path.startswith('/api/session/'):
            return {'outcome': 'failed' if host.label == 'routing-enabled' else 'succeeded'}
        raise AssertionError((method, path))


class EvaluatorPrepareIO(HostIO):
    """Reach the first real run() restart boundary using only fixture HTTP I/O."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.sessions = 0

    def request(self, host, method, path, body=None):
        if host.label != 'prepare':
            raise RuntimeError('Unexpected restart after incomplete prepare evidence')
        if method == 'POST' and path == '/api/session':
            self.sessions += 1
            return {'id': 'prepare-session-' + str(self.sessions)}
        if method == 'POST' and path.endswith('/prompt'):
            session = path.split('/')[3]
            self.append(host, 'model-request', sessionID=session,
                        model={'providerID': 'question-fixture'})
            self.append(host, 'tool-after', sessionID=session, tool='execute',
                        status='completed', result={'metadata': {}})
            return {'type': 'user'}
        if method == 'GET' and path.startswith('/api/experimental/session/'):
            return {'sessionID': path.split('/')[4]}
        return super().request(host, method, path, body)


class InstalledAuditConsumerTest(unittest.TestCase):
    def execute(self, module, io, directory):
        """Run the actual consumer with real temporary files and finalizers."""
        output = directory / 'report'
        repo = Path(__file__).resolve().parents[1]
        args = argparse.Namespace(repository=repo, report_directory=output,
            artifact=directory / 'fixture.tgz', plugin=directory / 'plugin',
            opencode=directory / 'opencode', expect_plugin_version='2.0.0-alpha.1',
            disable_filewatcher=False)
        with ExitStack() as patches:
            patches.enter_context(patch.object(module, 'PrivateHost', side_effect=io.start))
            patches.enter_context(patch.object(module, 'request', side_effect=io.request))
            patches.enter_context(patch.object(questions, 'request', side_effect=io.request))
            patches.enter_context(patch.object(module, 'installed_plugin_inventory',
                                               return_value={'sdk_version': '2.2.6'}))
            patches.enter_context(patch.object(module.subprocess, 'check_output', return_value='2.2.6'))
            caught = None
            try:
                if module is routing:
                    returned = module.run(args.opencode, repo, args.plugin, args.artifact,
                                          output, args.expect_plugin_version)
                else:
                    returned = module.run(args)
            except Exception as error:
                caught, returned = error, None
        report = json.loads((output / 'report.json').read_text())
        self.assertTrue(all(host.closed for host in io.hosts))
        self.assertTrue(all(not host.root.exists() for host in io.hosts))
        if module is objectives:
            self.assertIsNone(caught)
            self.assertEqual(returned, report)
        elif report['status'] == 'FAIL':
            self.assertIsNotNone(caught)
        else:
            self.assertIsNone(caught)
            self.assertEqual(returned, report)
        return report, output

    def assert_retained(self, io, output):
        audit = output / 'audit.ndjson'
        if io.retained is None:
            self.assertFalse(audit.exists(), 'Missing evidence must not become an invented empty file')
        else:
            self.assertEqual(audit.read_bytes(), io.retained)

    def test_routing_healthy_modes_keep_one_audit_across_both_hosts(self):
        with tempfile.TemporaryDirectory() as temporary:
            io = HostIO()
            report, output = self.execute(routing, io, Path(temporary))
            self.assertEqual(report['status'], 'PASS')
            self.assertEqual([row['provider_requests'] for row in report['checks']], [0, 1])
            self.assertEqual([host.label for host in io.hosts], ['routing-enabled', 'routing-disabled'])
            self.assert_retained(io, output)
            self.assertEqual(report['audit_sha256'], hashlib.sha256(io.retained).hexdigest())
            self.assertEqual(report['audit_receipts'], 5)
            self.assertEqual(report['audit_bytes'], len(io.retained))

    def test_routing_rejects_missing_empty_or_validly_truncated_audit_in_either_mode(self):
        for phase in ('routing-enabled', 'routing-disabled'):
            for damage in ('missing', 'empty', 'truncated'):
                with self.subTest(phase=phase, damage=damage), tempfile.TemporaryDirectory() as temporary:
                    io = HostIO(damage=damage, phase=phase)
                    report, output = self.execute(routing, io, Path(temporary))
                    self.assertEqual(report['status'], 'FAIL')
                    self.assertIn('audit_error', report)
                    self.assertNotIn('audit_sha256', report)
                    self.assertEqual(len(report['checks']), int(phase == 'routing-disabled'))
                    self.assert_retained(io, output)

    def test_routing_counts_late_provider_receipt_from_finalized_mode(self):
        for phase, error in (
            ('routing-enabled', 'Unknown-billing request reached the provider'),
            ('routing-disabled', 'Disabling routing must restore exactly one native request'),
        ):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as temporary:
                io = HostIO(damage='late-provider', phase=phase)
                report, output = self.execute(routing, io, Path(temporary))
                self.assertEqual(report['status'], 'FAIL')
                self.assertIn(error, report['error'])
                self.assertEqual(len(report['checks']), int(phase == 'routing-disabled'))
                self.assertNotIn('audit_error', report)
                self.assert_retained(io, output)

    def test_routing_requires_fresh_readiness_before_zero_provider_claim(self):
        for phase in ('routing-enabled', 'routing-disabled'):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as temporary:
                io = HostIO(omit_ready=phase)
                report, output = self.execute(routing, io, Path(temporary))
                self.assertEqual(report['status'], 'FAIL')
                self.assertIn('ready', report['error'].lower())
                self.assertEqual(len(report['checks']), int(phase == 'routing-disabled'))
                self.assert_retained(io, output)

    def test_consumers_retain_audit_failure_without_losing_scenario_error(self):
        for module in (routing, evaluator, objectives):
            for damage in ('missing', 'empty', 'observer-failure', 'malformed'):
                with self.subTest(consumer=module.__name__, damage=damage), tempfile.TemporaryDirectory() as temporary:
                    io = HostIO(damage=damage, scenario_error=True)
                    report, output = self.execute(module, io, Path(temporary))
                    self.assertEqual(report['status'], 'FAIL')
                    self.assertIn('scenario request failed', report['error'])
                    self.assertIn('audit_error', report)
                    self.assertNotIn('audit_sha256', report)
                    self.assert_retained(io, output)

    def test_consumers_preserve_healthy_audit_and_original_scenario_failure(self):
        for module in (routing, evaluator, objectives):
            with self.subTest(consumer=module.__name__), tempfile.TemporaryDirectory() as temporary:
                io = HostIO(scenario_error=True)
                report, output = self.execute(module, io, Path(temporary))
                self.assertEqual(report['status'], 'FAIL')
                self.assertIn('scenario request failed', report['error'])
                self.assertNotIn('audit_error', report)
                self.assertEqual(report['audit_sha256'], hashlib.sha256(io.retained).hexdigest())
                self.assertEqual(report['audit_receipts'], 2)
                self.assertEqual(report['audit_bytes'], len(io.retained))
                self.assert_retained(io, output)

    def test_evaluator_rejects_incomplete_preparation_before_starting_next_host(self):
        for damage in ('missing', 'empty', 'truncated', 'observer-failure'):
            with self.subTest(damage=damage), tempfile.TemporaryDirectory() as temporary:
                io = EvaluatorPrepareIO(damage=damage, phase='prepare')
                report, output = self.execute(evaluator, io, Path(temporary))
                self.assertEqual(report['status'], 'FAIL')
                self.assertIn('audit_error', report)
                self.assertNotIn('audit_sha256', report)
                self.assertEqual([host.label for host in io.hosts], ['prepare'])
                self.assert_retained(io, output)

    def test_routing_rejects_finalized_observer_failure_even_without_scenario_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            io = HostIO(damage='observer-failure', phase='routing-disabled')
            report, output = self.execute(routing, io, Path(temporary))
            self.assertEqual(report['status'], 'FAIL')
            self.assertIn('observer', report['audit_error'].lower())
            self.assertEqual(len(report['checks']), 1)
            self.assert_retained(io, output)


if __name__ == '__main__':
    unittest.main()
