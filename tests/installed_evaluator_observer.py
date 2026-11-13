"""Actual OpenCode/packed Loom observer mechanics with a local scripted provider.

This is NOT a real General-to-Evaluator audit or original-work qualification.
It exercises public record receipts, actual process restart, opt-out and scope.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile

from installed_host_smoke import PrivateHost, installed_plugin_inventory, isolated_environment, require
from installed_questions import Scenario, events, idle, request, result_value

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from native_evaluator_qualification import collect


def run(args):
    repo, output = args.repository.resolve(), args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    report = {'status': 'UNPROVEN', 'native_evaluator': 'UNPROVEN', 'checks': [],
              'qualification': 'Actual native General-to-Evaluator delegation, skill/trace/public-record/restart observer mechanics with a local scripted provider and fixture source history. No real-model reasoning or original-work audit.'}
    host = None
    report['candidate'] = installed_plugin_inventory(args.artifact.resolve(), args.plugin.resolve(), args.expect_plugin_version, '2.2.6')
    report['observer_sha256'] = hashlib.sha256((repo / 'tools/evaluator-observer/server.ts').read_bytes()).hexdigest()
    try:
        with tempfile.TemporaryDirectory(prefix='loom-evaluator-observer-installed-') as temporary:
            root = Path(temporary).resolve()
            project = root / 'project'
            project.mkdir()
            receipts = root / 'receipts'
            receipts.mkdir(mode=0o700)
            env = isolated_environment(root)
            env['LOOM_QUESTION_FIXTURE'] = str(root)
            if args.disable_filewatcher:
                env['OPENCODE_FILEWATCHER_DISABLE'] = '1'
                report['filewatcher'] = 'Disabled only on owned disposable host; watcher behavior not qualified'
            report['versions'] = {name: subprocess.check_output(command, text=True, env=env, timeout=15).strip()
                                  for name, command in [('host', [str(args.opencode.resolve()), '--version']), ('bun', ['bun', '--version'])]}
            require(report['versions']['host'] in ('2.2.6', 'opencode v2.2.6'), 'Exact host 2.2.6 required')
            subprocess.run(['git', 'init', '-q', str(project)], check=True, env=env, timeout=10)
            config = {'plugins': ['*', str(args.plugin.resolve()), str(repo / 'tests/question-host'), str(repo / 'tools/evaluator-observer')],
                      'agents': {agent: {'description': 'observer fixture', 'mode': mode, 'model': 'question-fixture/reader',
                                         'system': 'Follow the local deterministic fixture script.'}
                                 for agent, mode in [('general', 'primary'), ('evaluator', 'subagent'), ('question-reader', 'primary')]},
                      'model': 'question-fixture/reader', 'update': 'disable', 'share': 'disabled'}
            # Mechanical fixture policies, never evidence of interactive human
            # approval. The native default General excludes subagent dispatch.
            config['agents']['general']['permissions'] = [{'action': 'subagent', 'resource': 'evaluator', 'effect': 'allow'}]
            config['agents']['evaluator']['permissions'] = [{'action': 'skill', 'resource': 'agent-run-audit', 'effect': 'allow'}]
            (Path(env['OPENCODE_CONFIG_DIR']) / 'opencode.json').write_text(json.dumps(config))
            (root / 'jobs.json').write_text('{}')
            (project / '.loom.yaml').write_text('instructions: {enabled: false}\nledger: {capture: automatic}\n')
            skill = project / '.agents/skills/agent-run-audit/SKILL.md'
            skill.parent.mkdir(parents=True)
            skill.write_text('---\nname: agent-run-audit\ndescription: Disposable observer mechanics fixture.\n---\nPRIVATE_NATIVE_SKILL_SENTINEL: This fixture does not evaluate real work.\n')

            def start(label):
                owned = PrivateHost(str(args.opencode.resolve()), project, env, output, label)
                try:
                    owned.wait_roster('/api/plugin', 'plugins', lambda plugins: all(any(plugin['id'] == name and plugin.get('state', {}).get('status') == 'active' for plugin in plugins) for name in ('loom', 'loom.question.fixture', 'loom.evaluator.qualification.observer')))
                    return owned
                except Exception:
                    owned.close()
                    raise

            host = start('prepare')

            def session(agent, parent=None):
                return request(host, 'POST', '/api/session', {'agent': agent, 'title': 'observer mechanics',
                    'model': {'providerID': 'question-fixture', 'id': 'reader'}, 'location': {'directory': str(project)},
                    **({'parentID': parent} if parent else {})})['id']

            general, reader, ordinary = session('general'), session('general'), session('question-reader')
            source_parent = session('general')
            source_child = session('evaluator', source_parent)
            preparing = Scenario(host, root)
            preparing.command(source_parent, 'return "fixture parent source"')
            preparing.command(source_child, 'return "fixture child source"')
            for name, sid in [('parent', source_parent), ('child', source_child)]:
                data = request(host, 'GET', f'/api/experimental/session/{sid}/export?sanitize=true')
                (project / ('source-' + name + '.json')).write_text(json.dumps({'data': data}))
            host.close(); host = None
            settings = root / 'observer.json'
            settings.write_text(json.dumps({'format': 'loom-evaluator-observer/v1', 'project_directory': str(project),
                                           'receipt_directory': str(receipts), 'audit_session_id': general,
                                           'recovery_session_id': reader}))
            settings.chmod(0o600)
            env['LOOM_EVALUATOR_OBSERVER'] = str(settings)
            host = start('audit')
            scenario = Scenario(host, root)
            # Only the external model is scripted. Native subagent/skill tools,
            # Session ancestry, export read ACL, all Loom tools and stores are real.
            parent_job, child_job = secrets.token_hex(8), secrets.token_hex(8)
            sources = [{'session_id': source_parent, 'export_path': 'source-parent.json'},
                       {'session_id': source_child, 'export_path': 'source-child.json'}]
            child_code = 'const sources=' + json.dumps(sources) + ';' + '''
for (const source of sources) {
  let cursor;
  do {
    const page = JSON.parse(await tools.loom.trace({operation:"timeline",...source,include_text:false,limit:1,...(cursor?{cursor}:{})})).result;
    cursor=page.next_cursor;
  } while(cursor);
}
const action=JSON.parse(await tools.loom.action({operation:"create",title:"Observer mechanics",goal:"Verify public receipt identity"})).result;
const result=JSON.parse(await tools.loom.record({operation:"add",action_id:action.id,kind:"result",statement:"PRIVATE_NATIVE_SENTINEL: scripted mechanics, not original-work evaluation",artifact_refs:["fixture://scripted-observer-mechanics"]})).result;
await tools.loom.record({operation:"query",action_id:action.id,record_id:result.id});
return result.id;
'''
            scenario.jobs = {parent_job: {'nativeSubagent': {'agent': 'evaluator', 'prompt': 'LOOM_HARNESS_JOB:' + child_job}},
                             child_job: {'nativeSkill': True, 'followupCode': child_code}}
            (root / 'jobs.json').write_text(json.dumps(scenario.jobs))
            start_offset = len(events(root))
            request(host, 'POST', f'/api/session/{general}/prompt', {'text': 'LOOM_HARNESS_JOB:' + parent_job})
            scenario.await_event(lambda event: event['type'] == 'model-request' and event['data']['sessionID'] == general)
            idle(host, [general])
            observed_calls = [event for event in events(root)[start_offset:] if event['type'] == 'tool-after']
            report['fixture_tool_statuses'] = [{'tool': event['data']['tool'], 'status': event['data']['status']} for event in observed_calls]
            delegations = [event['data'] for event in observed_calls if event['data']['sessionID'] == general and event['data']['tool'] == 'subagent']
            require(len(delegations) == 1 and delegations[0]['status'] == 'completed', 'Native General-to-Evaluator dispatch did not complete')
            child = delegations[0]['result']['output']['sessionID']
            writes = [event for event in observed_calls if event['data']['sessionID'] == child and event['data']['tool'] in ('loom_record', 'loom.record') and event['data'].get('input', {}).get('operation') == 'add' and event['data']['status'] == 'completed']
            require(len(writes) == 1, 'Native Evaluator did not write exactly one public result')
            result = result_value(writes[0])
            query = {'operation': 'query', 'action_id': result['action_id'], 'record_id': result['id']}
            initial = scenario.invoke(child, 'record', query)['items']
            require(len(initial) == 1 and {key: value for key, value in initial[0].items() if key != 'sequence'} == result, 'Initial public read changed immutable record')
            audit_file = next(receipts.glob('*.ndjson'))
            observed = audit_file.read_text()
            require('PRIVATE_NATIVE_SENTINEL' not in observed and 'PRIVATE_NATIVE_SKILL_SENTINEL' not in observed and 'fixture://' not in observed, 'Observer leaked source, skill or statement')
            scenario.invoke(ordinary, 'record', query)
            require(audit_file.read_text() == observed, 'Unrelated ordinary Session was observed')
            report['checks'].append({'name': 'native-scoped-private-public-record-receipt', 'status': 'PASS'})
            (project / '.loom.yaml').write_text('instructions: {enabled: false}\nledger: {capture: off}\n')
            scenario.invoke(child, 'record', query)
            require(audit_file.read_text() == observed, 'Capture opt-out did not suppress native receipts')
            report['checks'].append({'name': 'native-capture-opt-out', 'status': 'PASS'})
            (project / '.loom.yaml').write_text('instructions: {enabled: false}\nledger: {capture: automatic}\n')
            prior_pid = host.proc.pid
            host.close(); host = None
            host = start('recovery')
            require(host.proc.pid != prior_pid, 'A new host process was not started')
            scenario = Scenario(host, root)
            require(scenario.invoke(reader, 'record', query)['items'] == initial, 'Recovered public record changed exact content, sequence or attribution')
            host.close(); host = None
            events(root, final=True)
            logs = sorted(receipts.glob('*.ndjson'))
            require(len(logs) == 2, 'Expected one audit and one recovery observer instance')
            # File identities are deliberately fixture identities; their hashes
            # cannot certify a real installed Evaluator or skill.
            agent = root / 'agent.md'
            agent.write_text('Scripted fixture; not real installed Evaluator')
            collected = collect(logs, project / 'source-parent.json', [project / 'source-child.json'], agent, skill, result['id'])
            require(all(collected['observations'].values()), 'Collector missed a native required receipt: ' + json.dumps(collected['observations']))
            require(collected['source_preflight']['source_shape_eligible'], 'Native fixture source export preflight failed')
            require(collected['native_evaluator'] == 'UNPROVEN' and collected['known_scripted_provider'] and collected['receipt_consistency'] == 'INCOMPLETE', 'Scripted native mechanics fabricated Evaluator qualification')
            require(collected['blockers'] == ['scripted-provider-not-real-evaluator'],
                    'An unexpected mechanical qualification gap was hidden by the scripted-provider limitation')
            report['checks'].append({'name': 'native-process-restart-exact-record-and-scripted-negative', 'status': 'PASS'})
            report['checks'].append({'name': 'native-general-evaluator-skill-and-trace-receipts', 'status': 'PASS'})
            (output / 'qualification.json').write_text(json.dumps(collected, indent=2) + '\n')
            for path in logs:
                shutil.copyfile(path, output / path.name)
                (output / path.name).chmod(0o600)
            report['status'] = 'PASS'
    except Exception as error:
        report['status'] = 'FAIL'
        report['error'] = type(error).__name__
        raise
    finally:
        if host:
            host.close()
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--opencode', type=Path, required=True)
    parser.add_argument('--repository', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--artifact', type=Path, required=True)
    parser.add_argument('--plugin', type=Path, required=True)
    parser.add_argument('--expect-plugin-version', required=True)
    parser.add_argument('--report-directory', type=Path, required=True)
    parser.add_argument('--disable-filewatcher', action='store_true')
    print(json.dumps(run(parser.parse_args()), indent=2))


if __name__ == '__main__':
    main()
