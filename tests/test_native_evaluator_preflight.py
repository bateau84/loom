"""Component tests for source-export preflight, never native Evaluator proof."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'tools/native_evaluator_preflight.py'
spec = importlib.util.spec_from_file_location('native_evaluator_preflight', SCRIPT)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


def export(session_id, parent=None, project='project-real', directory='/repo/loom', messages=True):
    info = {'id': session_id, 'projectID': project, 'location': {'directory': directory}}
    if parent:
        info['parentID'] = parent
    return {'data': {'info': info, 'messages': [
        {'type': 'user', 'id': 'msg-' + session_id, 'text': 'Actual private source', 'time': {'created': 1}},
        {'type': 'assistant', 'id': 'reply-' + session_id, 'text': 'No claim', 'time': {'created': 2}},
    ] if messages else []}}


class NativeEvidencePreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def saved(self, name, data):
        path = self.root / name
        path.write_text(json.dumps(data), encoding='utf-8')
        return path

    def test_real_export_shape_and_direct_child_prepares_without_false_pass(self):
        parent = self.saved('parent.json', export('ses_parent'))
        child = self.saved('child.json', export('ses_child', parent='ses_parent'))
        result = preflight.inspect_sources(parent, [child])
        self.assertTrue(result['source_shape_eligible'])
        self.assertEqual(result['native_evaluator'], 'UNPROVEN')
        self.assertEqual(result['child_sessions'], ['ses_child'])
        self.assertEqual(result['source_sessions'], 2)
        self.assertNotIn('Actual private source', json.dumps(result))
        self.assertTrue(all(len(e['sha256']) == 64 for e in result['exports']))

    def test_requires_real_relevant_child(self):
        parent = self.saved('parent.json', export('ses_parent'))
        result = preflight.inspect_sources(parent, [])
        self.assertFalse(result['source_shape_eligible'])
        self.assertIn('no-child-export', result['blockers'])

    def test_rejects_ambiguous_or_unrelated_ancestry(self):
        parent = self.saved('parent.json', export('ses_parent'))
        child = self.saved('child.json', export('ses_child', parent='ses_other'))
        result = preflight.inspect_sources(parent, [child])
        self.assertFalse(result['source_shape_eligible'])
        self.assertIn('unlinked-session:ses_child', result['blockers'])

    def test_rejects_cross_project_export(self):
        parent = self.saved('parent.json', export('ses_parent'))
        child = self.saved('child.json', export('ses_child', parent='ses_parent', project='foreign'))
        result = preflight.inspect_sources(parent, [child])
        self.assertFalse(result['source_shape_eligible'])
        self.assertIn('project-mismatch:ses_child', result['blockers'])

    def test_rejects_explicit_different_location(self):
        parent = self.saved('parent.json', export('ses_parent'))
        child = self.saved('child.json', export('ses_child', parent='ses_parent', directory='/elsewhere'))
        result = preflight.inspect_sources(parent, [child])
        self.assertFalse(result['source_shape_eligible'])
        self.assertIn('directory-mismatch:ses_child', result['blockers'])

    def test_sanitized_location_is_unknown_not_verified(self):
        parent = self.saved('parent.json', export('ses_parent', directory='/[redacted:session-directory:ses_parent]'))
        child = self.saved('child.json', export('ses_child', parent='ses_parent',
                                               directory='/[redacted:session-directory:ses_child]'))
        result = preflight.inspect_sources(parent, [child])
        self.assertTrue(result['source_shape_eligible'])
        self.assertEqual(result['directory_identity'], 'unverified-sanitized')

    def test_no_user_request_is_not_eligible(self):
        parent = self.saved('parent.json', export('ses_parent', messages=False))
        child = self.saved('child.json', export('ses_child', parent='ses_parent'))
        result = preflight.inspect_sources(parent, [child])
        self.assertFalse(result['source_shape_eligible'])
        self.assertIn('missing-user-request:ses_parent', result['blockers'])

    def test_symlink_export_rejected_even_under_size_limit(self):
        parent = self.saved('parent.json', export('ses_parent'))
        child = self.saved('child.json', export('ses_child', parent='ses_parent'))
        link = self.root / 'link.json'
        link.symlink_to(child)
        with self.assertRaisesRegex(ValueError, 'regular non-symlink'):
            preflight.inspect_sources(parent, [link])

    def test_grandchild_is_one_objective_when_ancestry_is_explicit(self):
        parent = self.saved('parent.json', export('ses_parent'))
        child = self.saved('child.json', export('ses_child', parent='ses_parent'))
        grandchild = self.saved('grandchild.json', export('ses_grand', parent='ses_child'))
        result = preflight.inspect_sources(parent, [child, grandchild])
        self.assertTrue(result['source_shape_eligible'])
        self.assertEqual(result['source_sessions'], 3)

    def test_duplicate_session_identity_is_rejected(self):
        parent = self.saved('parent.json', export('ses_parent'))
        duplicate = self.saved('same.json', export('ses_parent'))
        result = preflight.inspect_sources(parent, [duplicate])
        self.assertFalse(result['source_shape_eligible'])
        self.assertIn('duplicate-session-identity', result['blockers'])

    def test_cli_preflight_writes_private_redacted_report_without_model_call(self):
        parent = self.saved('parent.json', export('ses_parent'))
        child = self.saved('child.json', export('ses_child', parent='ses_parent'))
        report = self.root / 'report.json'
        code = preflight.main(['--parent-export', str(parent), '--child-export', str(child),
                               '--report', str(report)])
        self.assertEqual(code, 0)
        data = report.read_text()
        self.assertNotIn('Actual private source', data)
        self.assertEqual(json.loads(data)['native_evaluator'], 'UNPROVEN')
        self.assertEqual(report.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(SystemExit):
            preflight.main(['--parent-export', str(parent), '--child-export', str(child),
                            '--report', str(report)])

    def test_only_source_hashes_not_raw_content_retained(self):
        parent = self.saved('parent.json', export('ses_parent'))
        child = self.saved('child.json', export('ses_child', parent='ses_parent'))
        result = preflight.inspect_sources(parent, [child])
        self.assertEqual(sorted(result), sorted({
            'source_shape_eligible', 'native_evaluator', 'project_id', 'parent_session',
            'child_sessions', 'source_sessions', 'blockers', 'directory_identity',
            'exports', 'coverage_limit'}))


if __name__ == '__main__':
    unittest.main()
