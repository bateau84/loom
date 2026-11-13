"""Structured OQs through the real packed plugin, native delegation and Code Mode.

The isolated local provider selects a deterministic option. This qualifies the
mechanics, not Evaluator judgment, human approval or spontaneous OQ usage.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

from installed_host_smoke import PrivateHost, installed_plugin_inventory, isolated_environment, require
from installed_questions import Scenario, events, idle, request


def run(args):
    output = args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False)
    repo, plugin, artifact = args.repository.resolve(), args.plugin.resolve(), args.artifact.resolve()
    report = {'status': 'UNPROVEN', 'checks': [], 'limits': [
        'Local scripted provider only; not model reasoning, human consent or spontaneous tool use.',
        'No new delivery, retry, resolution or permission guarantees.']}
    host = None
    scratch = None
    root = None
    try:
        report['candidate'] = installed_plugin_inventory(artifact, plugin, '2.0.0-alpha.1', '2.2.6')
        with tarfile.open(artifact) as archive:
            members = [m for m in archive.getmembers() if m.isfile()]
            for member in members:
                path = Path(member.name).relative_to('package')
                require(archive.extractfile(member).read() == (plugin / path).read_bytes(), f'Installed byte mismatch: {path}')
                require((repo / path).read_bytes() == (plugin / path).read_bytes(), f'Source byte mismatch: {path}')
            report['packaged_files_verified'] = len(members)
        report['inputs_sha256'] = {name: hashlib.sha256((repo / name).read_bytes()).hexdigest() for name in (
            'tests/installed_question_choices.py', 'tests/installed_questions.py',
            'tests/installed_host_smoke.py', 'tests/question-host/server.ts', 'tests/question-host/provider.mjs')}
        report['host_version'] = subprocess.check_output([args.opencode, '--version'], text=True, timeout=15).strip()
        require(report['host_version'] in ('2.2.6', 'opencode v2.2.6'), 'Requires pinned host 2.2.6')
        scratch = tempfile.TemporaryDirectory(prefix='loom-choice-proof-')
        root = Path(scratch.name).resolve()
        project = root / 'project'
        project.mkdir()
        env = isolated_environment(root)
        env['LOOM_QUESTION_FIXTURE'] = str(root)
        if args.disable_filewatcher:
            env['OPENCODE_FILEWATCHER_DISABLE'] = '1'
            report['limits'].append('Watcher disabled in this disposable local run.')
        subprocess.run(['git', 'init', '-q', str(project)], check=True, env=env)
        agents = {'question-' + role: {'description': 'Isolated ' + role, 'mode': 'primary',
            'model': 'question-fixture/' + role, 'system': 'Follow the deterministic local script.'}
            for role in ('asker', 'reader')}
        agents['question-specialist'] = {'description': 'Isolated choice respondent', 'mode': 'subagent',
            'model': 'question-fixture/respondent', 'system': 'Read the question and answer through Loom.'}
        config = {'plugins': ['*', str(plugin), str(repo / 'tests/question-host')], 'agents': agents,
            'model': 'question-fixture/asker', 'update': 'disable', 'share': 'disabled'}
        (Path(env['OPENCODE_CONFIG_DIR']) / 'opencode.json').write_text(json.dumps(config))
        (project / '.loom.yaml').write_text('agents: {question-specialist: {roles: [research]}}\ninstructions: {enabled: false}\nledger: {capture: off}\n')
        (root / 'jobs.json').write_text('{}')
        def start(label):
            current = PrivateHost(str(args.opencode), project, env, output, label)
            try:
                current.wait_roster('/api/plugin', 'plugins', lambda xs: all(any(
                    p['id'] == name and p.get('state', {}).get('status') == 'active' for p in xs)
                    for name in ('loom', 'loom.question.fixture')))
                return current
            except Exception:
                current.close()
                raise
        host = start('choices')
        s = Scenario(host, root)
        asker, reader = s.session('asker'), s.session('reader')
        choices = [{'id': 'A', 'answer': 'Keep JSON'}, {'id': 'B', 'answer': 'SQLite — original label'}]
        q = s.invoke(asker, 'record', {'operation': 'ask', 'question': 'Which store?',
            'answer_type': 'multi-choice', 'choices': choices,
            'recipient': {'kind': 'role', 'id': 'research'}, 'blocking': True})
        dispatch = q['dispatch']
        require(dispatch['status'] == 'admission-observed' and dispatch['native_status'] == 'completed', 'No native completed dispatch')
        child = dispatch['target_session_id']
        idle(host, [asker, child])
        native = request(host, 'GET', '/api/session/' + child)
        require(native['parentID'] == asker and native['agent'] == 'question-specialist', 'Wrong native child')
        thread = s.invoke(reader, 'record', {'operation': 'query', 'view': 'thread', 'question_id': q['id']})
        require(thread['question']['data']['choices'] == choices and len(thread['answers']) == 1, 'Wrong immutable question/answer')
        answer = thread['answers'][0]
        require(answer['session_id'] == child and answer['data']['choice_id'] == 'B'
                and answer['data']['answer'] == choices[1]['answer'], 'Selection lost original label or attribution')
        report['checks'].append({'name': 'native-choice-selection', 'status': 'PASS', 'question': q['id'], 'answer': answer['id'], 'child': child})
        # Real calls must reject an unrelated respondent and mixed/unknown payloads.
        invalid = [{'operation': 'answer', 'question_id': q['id'], 'choice_id': 'A'},
            {'operation': 'answer', 'question_id': q['id'], 'choice_id': 'B', 'answer': 'forged'},
            {'operation': 'ask', 'question': 'Invalid', 'answer_type': 'multi-choice',
             'choices': [choices[0], choices[0]], 'recipient': {'kind': 'role', 'id': 'research'}, 'blocking': True}]
        s.command(reader, 'const results=await Promise.allSettled(' + json.dumps(invalid) +
            '.map(input=>tools.loom.record(input))); if(results.some(r=>r.status!=="rejected")) throw new Error("Invalid operation accepted"); return results.map(r=>r.status)')
        unchanged = s.invoke(reader, 'record', {'operation': 'query', 'view': 'thread', 'question_id': q['id']})
        require(unchanged['answers'] == thread['answers'], 'Rejected answer changed history')
        report['checks'].append({'name': 'native-rejection-no-answer', 'status': 'PASS'})
        manual = s.invoke(asker, 'record', {'operation': 'ask', 'question': 'Need more evidence?',
            'answer_type': 'multi-choice', 'choices': choices, 'recipient': {'kind': 'user'}, 'blocking': False})
        abstain = s.invoke(asker, 'record', {'operation': 'answer', 'question_id': manual['id'],
            'status': 'cannot-select', 'reason': 'Missing evidence, not a user decision.'})
        selected = s.invoke(asker, 'record', {'operation': 'answer', 'question_id': manual['id'], 'choice_id': 'A'})
        conflict = s.invoke(asker, 'record', {'operation': 'answer', 'question_id': manual['id'], 'choice_id': 'B'})
        replies = s.invoke(reader, 'record', {'operation': 'query', 'view': 'thread', 'question_id': manual['id']})
        require([a['id'] for a in replies['answers']] == [abstain['id'], selected['id'], conflict['id']], 'Replies overwritten')
        require(replies['answers'][0]['data']['status'] == 'cannot-select', 'Abstention lost')
        report['checks'].append({'name': 'native-abstention-and-conflicts', 'status': 'PASS', 'question': manual['id']})
        host.close()
        host = start('reopened')
        reopened = Scenario(host, root).invoke(reader, 'record', {'operation': 'query', 'view': 'thread', 'question_id': manual['id']})
        require(reopened == replies, 'Thread changed across real host restart')
        report['checks'].append({'name': 'native-restart-readback', 'status': 'PASS'})
        host.close()
        host = None
        audit = root / 'audit.ndjson'
        report['audit_sha256'] = hashlib.sha256(audit.read_bytes()).hexdigest()
        report['audit_bytes'] = audit.stat().st_size
        requests = [e['data'] for e in events(root) if e['type'] == 'model-request']
        require(requests and all(r['model']['providerID'] == 'question-fixture' for r in requests), 'Non-fixture model request')
        report['model_requests'] = len(requests)
        shutil.copyfile(audit, output / 'audit.ndjson')
        report['status'] = 'PASS'
    except Exception as error:
        report['status'] = 'FAIL'
        report['error'] = f'{type(error).__name__}: {error}'
    finally:
        if host:
            host.close()
        if root and (root / 'audit.ndjson').exists():
            shutil.copyfile(root / 'audit.ndjson', output / 'audit.ndjson')
        if scratch:
            scratch.cleanup()
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--opencode', type=Path, required=True)
    parser.add_argument('--plugin', type=Path, required=True)
    parser.add_argument('--artifact', type=Path, required=True)
    parser.add_argument('--repository', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--report-directory', type=Path, required=True)
    parser.add_argument('--disable-filewatcher', action='store_true')
    result = run(parser.parse_args())
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['status'] == 'PASS' else 1)
