"""Isolated OpenCode 2.2.0 model-routing negative control.

Actual packed Loom plugin and unmodified native 2.2.0 host. A separate,
local-only provider script proves that unknown billing NEVER reaches doStream.
This does not prove real ChatGPT OAuth, real quotas, or live failover.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
import time
from pathlib import Path

from installed_host_smoke import PrivateHost, installed_plugin_inventory, isolated_environment, require
from installed_questions import request, idle, events


def run(cli: Path, repo: Path, plugin: Path, artifact: Path, output: Path, version: str) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    report = {'status': 'UNPROVEN', 'kind': 'installed-routing-negative', 'host': '2.2.0',
              'sdk': '2.2.0', 'checks': [], 'limits': [
                  'No live subscription or genuine billing attestation',
                  'No real same-model provider fallback or tool-side-effect replay acceptance',
                  'Only pre-dispatch host-unqualified rejection is tested',
              ]}
    try:
        report['candidate'] = installed_plugin_inventory(artifact, plugin, version, '2.2.0')
        with tempfile.TemporaryDirectory(prefix='loom-model-route-v214-') as temp:
            root = Path(temp).resolve()
            project = root / 'project'
            project.mkdir()
            env = isolated_environment(root)
            env['LOOM_QUESTION_FIXTURE'] = str(root)
            subprocess.run(['git', 'init', '-q', str(project)], env=env, check=True)
            observed = subprocess.check_output([str(cli), '--version'], env=env, text=True, timeout=20).strip()
            require(observed in ('2.2.0', 'opencode v2.2.0'), f'Wrong host version: {observed}')
            config = {'plugins': ['*', str(plugin), str(repo / 'tests/question-host')],
                      'agents': {'question-reader': {
                          'description': 'Native model routing fixture', 'mode': 'primary',
                          'system': 'Return HARNESS_IDLE.'}},
                      'model': 'question-fixture/reader', 'update': 'disable', 'share': 'disabled'}
            (Path(env['OPENCODE_CONFIG_DIR']) / 'opencode.json').write_text(json.dumps(config))
            (root / 'jobs.json').write_text('{}')
            for name, enabled in [('routing-enabled', True), ('routing-disabled', False)]:
                (project / '.loom.yaml').write_text(json.dumps({
                    'model-routing': {'enabled': enabled, 'default-class': 'strong',
                                      'default-reasoning': 'medium', 'paid-fallback': False},
                    'model-classes': {'strong': {'models': ['reader']}},
                    'agents': {'question-reader': {'roles': ['implementation']}},
                    'roles': {'implementation': {'model-class': 'strong', 'reasoning': 'medium'}},
                }))
                start = len(events(root))
                host = PrivateHost(str(cli), project, env, output, name)
                try:
                    require(json.loads(host.get('/api/info', 'info'))['version'] == '2.2.0',
                            'Private native host not 2.2.0')
                    host.wait_roster('/api/plugin', 'plugins',
                        lambda plugins: all(any(p['id'] == x and p.get('state', {}).get('status') == 'active'
                            for p in plugins) for x in ('loom', 'loom.question.fixture')))
                    session = request(host, 'POST', '/api/session', {
                        'agent': 'question-reader', 'title': name,
                        'location': {'directory': str(project)},
                    })['id']
                    request(host, 'POST', f'/api/session/{session}/prompt', {'text': 'Native routing qualification'})
                    deadline = time.monotonic() + 30
                    result = None
                    while time.monotonic() < deadline:
                        result = request(host, 'GET', f'/api/session/{session}')
                        if result.get('outcome') in ('succeeded', 'failed', 'interrupted'):
                            break
                        time.sleep(.1)
                    idle(host, [session])
                    produced = [e for e in events(root)[start:] if e['type'] == 'provider-request'
                                and e['data']['role'] == 'reader']
                    if enabled:
                        require(not produced, 'Unknown-billing request reached the provider')
                        require(result and result.get('outcome') == 'failed',
                                'Expected pre-dispatch rejected Session to fail')
                    else:
                        require(len(produced) == 1,
                                'Disabling routing must restore exactly one native request')
                        require(result and result.get('outcome') == 'succeeded',
                                'Native provider request did not complete with routing disabled')
                    report['checks'].append({'name': name, 'status': 'PASS',
                        'outcome': result.get('outcome') if result else None,
                        'provider_requests': len(produced)})
                finally:
                    host.close()
        report['status'] = 'PASS'
    except Exception as error:
        report['status'] = 'FAIL'
        report['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--opencode', type=Path, required=True)
    parser.add_argument('--repository', type=Path, required=True)
    parser.add_argument('--plugin', type=Path, required=True)
    parser.add_argument('--artifact', type=Path, required=True)
    parser.add_argument('--expect-plugin-version', required=True)
    parser.add_argument('--report-directory', type=Path, required=True)
    args = parser.parse_args()
    report = run(args.opencode.resolve(), args.repository.resolve(), args.plugin.resolve(),
                 args.artifact.resolve(), args.report_directory.resolve(), args.expect_plugin_version)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
