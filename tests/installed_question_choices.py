"""Structured OQs through the real packed plugin, native delegation and Code Mode.

The isolated local provider selects a deterministic option. This qualifies the
mechanics, not Evaluator judgment, human approval or spontaneous OQ usage.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import time
from contextlib import closing
from pathlib import Path

from installed_host_smoke import PrivateHost, installed_plugin_inventory, isolated_environment, require
from installed_questions import Scenario, events, idle, request, assert_rejected


def ledger_snapshot(root):
    paths = list((root / 'state/loom/actions-v1').glob('*/ledger.sqlite'))
    require(len(paths) == 1, 'Expected one production-created question ledger')
    with closing(sqlite3.connect(paths[0].as_uri() + '?mode=ro', uri=True)) as db:
        return db.execute('SELECT seq,id,data FROM ledger ORDER BY seq').fetchall()


def peer_notices(observed, question=None):
    return [e for e in observed if e['type'] == 'native-event'
        and e['data']['type'] == 'session.inbox.enqueued'
        and e['data']['data']['item']['type'] == 'synthetic'
        and e['data']['data']['item']['payload'].get('metadata', {}).get('format') == 'loom-question-notice/v1'
        and (question is None or e['data']['data']['item']['payload']['metadata'].get('question_id') == question)]


def run(args):
    output = args.report_directory.resolve()
    output.mkdir(parents=True, exist_ok=False)
    repo, plugin, artifact = args.repository.resolve(), args.plugin.resolve(), args.artifact.resolve()
    report = {'status': 'UNPROVEN',
        'status_scope': 'Required Loom delivery authorization, persistence and answer-ownership checks; host control-flow observations are separate.',
        'checks': [], 'host_observations': [], 'limits': [
        'Local scripted provider only; not model reasoning, human consent or spontaneous tool use.',
        'Native permission behavior retested on OpenCode 2.3.0; operator replies are scripted.',
        'Native admission is not processing or resolution. No automatic delivery retry is promised.']}
    host = None
    scratch = None
    root = None
    try:
        report['candidate'] = installed_plugin_inventory(artifact, plugin, '2.0.0-alpha.1', '2.3.0')
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
        require(report['host_version'] in ('2.3.0', 'opencode v2.3.0'), 'Requires pinned host 2.3.0')
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
        asker, reader, denied_reader = s.session('asker'), s.session('reader'), s.session('reader')
        choices = [{'id': 'A', 'answer': 'Keep JSON'}, {'id': 'B', 'answer': 'SQLite — original label'}]

        # Same-project unrelated native root Sessions, without creating a child
        # or changing the question's actual author. The shared Action belongs
        # to the target; the caller's selection must not be changed.
        peer_action = s.invoke(reader, 'action', {'operation': 'create',
            'title': 'Peer action', 'goal': 'Native peer Session question'})
        peer_request = {'operation': 'ask', 'question': 'Which peer alternative?', 'session_id': reader,
            'action_id': peer_action['id'], 'answer_type': 'multi-choice',
            'choices': choices, 'blocking': False}

        # Qualify the actual operating default, not the unmatched-rule fallback.
        # An inherited broad native grant authorizes this exact-target request.
        native_agents = json.loads(host.get('/api/agent', 'agents'))['data']
        caller_agent = next(agent for agent in native_agents if agent['id'] == 'question-asker')
        inherited_allow = {'action': '*', 'resource': '*', 'effect': 'allow'}
        require(inherited_allow in caller_agent['permissions']
                and not request(host, 'GET', f'/api/session/{asker}').get('permissions'),
                'Stock native wildcard-grant precondition changed')
        default_reader = s.session('reader')
        default_start = len(events(root))
        default_peer = s.invoke(asker, 'record', {**peer_request, 'session_id': default_reader,
            'question': 'Native wildcard grant control?'})
        idle(host, [asker, default_reader])
        default_notices = peer_notices(events(root)[default_start:], default_peer['id'])
        require(default_peer['dispatch']['status'] == 'admission-observed'
                and len(default_notices) == 1
                and default_notices[0]['data']['data']['sessionID'] == default_reader
                and request(host, 'GET', f'/api/session/{asker}/permission') == [],
                'Native wildcard grant did not admit exactly one peer notice')
        report['checks'].append({'name': 'native-peer-default-wildcard-grant', 'status': 'PASS',
            'caller_session': asker, 'caller_agent': caller_agent['id'], 'target_session': default_reader,
            'native_agent_rule': inherited_allow, 'question': default_peer['id'], 'native_notices': 1,
            'qualification': 'Native effective policy authorizes delivery; no per-target approval prompt or target-owner consent is claimed'})

        # OpenCode's default agents inherit wildcard ALLOW. Establish explicit
        # ASK through its real Session policy, inspect the caller/tool binding,
        # reject through the public reply API, and prove that waiting has
        # neither stored a question nor woken B. This is not a default-deny claim.
        ask_rules = [{'action': 'loom.question.deliver', 'resource': 'session:' + reader, 'effect': 'ask'}]
        request(host, 'PATCH', f'/api/session/{asker}', {'permissions': ask_rules})
        require(request(host, 'GET', f'/api/session/{asker}').get('permissions') == ask_rules,
                'Explicit caller Session ASK rule was not applied')
        untouched = ledger_snapshot(root)
        rejected_code = ('let rejected=false;try{await tools.loom.record(' + json.dumps(peer_request) +
            ')}catch(error){rejected=true}if(!rejected)throw new Error("Unapproved peer delivery succeeded");return true')
        pending_job, pending_start = s.begin(asker, rejected_code)
        asked = s.await_event(lambda e: e['type'] == 'native-event'
            and e['data']['type'] == 'permission.asked'
            and e['data']['data'].get('action') == 'loom.question.deliver'
            and e['data']['data'].get('sessionID') == asker)
        pending = request(host, 'GET', f'/api/session/{asker}/permission')
        require(len(pending) == 1, 'Expected one native peer-delivery permission request')
        gate = pending[0]
        require(gate['sessionID'] == asker and gate['action'] == 'loom.question.deliver'
                and gate['resources'] == ['session:' + reader]
                and gate.get('metadata') == {'destination_session_id': reader}
                and 'save' not in gate,
                'Peer delivery permission did not preserve exact destination/caller or offered a saved grant')
        native_calls = [e['data'] for e in events(root)[pending_start:] if e['type'] == 'tool-before'
            and e['data']['tool'] in ('loom_record', 'loom.record')]
        require(len(native_calls) == 1 and native_calls[0]['sessionID'] == asker
                and native_calls[0]['agent'] == 'question-asker'
                and gate.get('source') == {'type': 'tool', 'messageID': native_calls[0]['messageID'],
                                          'id': native_calls[0]['id']},
                'Permission source did not bind the actual native calling Session, agent and tool')
        require(asked['data']['data']['resources'] == gate['resources'], 'Permission event disagrees with pending request')
        require(ledger_snapshot(root) == untouched and not peer_notices(events(root)[pending_start:]),
                'Pending ASK stored or delivered a peer question before authorization')
        request(host, 'POST', f'/api/session/{asker}/permission/{gate["id"]}/reply',
                {'decision': 'reject', 'message': 'Reject this isolated qualification request'})
        s.finish(asker, pending_job, pending_start)
        require(request(host, 'GET', f'/api/session/{asker}/permission') == [], 'Rejected permission remained pending')
        require(ledger_snapshot(root) == untouched and not peer_notices(events(root)[pending_start:]),
                'Rejected native permission stored or delivered a peer question')
        report['checks'].append({'name': 'native-peer-explicit-ask-rejected', 'status': 'PASS',
            'caller_session': asker, 'caller_agent': native_calls[0]['agent'], 'target_session': reader,
            'action': gate['action'], 'resources': gate['resources'], 'source': gate['source'],
            'rules': ask_rules, 'saved_grant_offered': False, 'ledger_unchanged': True, 'native_notices': 0,
            'qualification': 'Real native pending request and scripted operator rejection; no claim of human consent'})

        # Measure no-feedback rejection separately from delivery denial. The
        # native host owns caller-step control; do not infer it from an SDK
        # promise rejection or add a Loom interruption workaround.
        plain_asker = s.session('asker')
        request(host, 'PATCH', f'/api/session/{plain_asker}', {'permissions': ask_rules})
        plain_job, plain_start = s.begin(plain_asker, 'return await tools.loom.record(' + json.dumps(peer_request) + ')')
        s.await_event(lambda e: e['type'] == 'native-event'
            and e['data']['type'] == 'permission.asked'
            and e['data']['data'].get('action') == 'loom.question.deliver'
            and e['data']['data'].get('sessionID') == plain_asker)
        plain_pending = request(host, 'GET', f'/api/session/{plain_asker}/permission')
        require(len(plain_pending) == 1 and plain_pending[0]['resources'] == ['session:' + reader],
                'Plain rejection did not reach the native exact-target permission boundary')
        request(host, 'POST', f'/api/session/{plain_asker}/permission/{plain_pending[0]["id"]}/reply',
                {'decision': 'reject'})
        idle(host, [plain_asker])
        plain_events = events(root)[plain_start:]
        plain_requests = [e for e in plain_events if e['type'] == 'model-request'
                          and e['data']['sessionID'] == plain_asker]
        plain_rejections = [e for e in plain_events if e['type'] == 'tool-after'
            and e['data']['sessionID'] == plain_asker and e['data']['tool'] in ('loom_record', 'loom.record')
            and e['data']['status'] == 'error'
            and e['data']['error'].get('error', {}).get('_tag') == 'Permission.DeclinedError']
        require(len(plain_rejections) == 1, 'Plain rejection did not escape the production Loom tool boundary')
        require(ledger_snapshot(root) == untouched and not peer_notices(plain_events),
                'Plain native rejection stored or delivered a peer question')
        require(request(host, 'GET', f'/api/session/{plain_asker}/permission') == [],
                'Plain native rejection remained pending')
        report['checks'].append({'name': 'native-peer-plain-reject-no-delivery', 'status': 'PASS',
            'caller_session': plain_asker, 'target_session': reader,
            'caller_model_requests': len(plain_requests), 'ledger_unchanged': True, 'native_notices': 0,
            'rejection_propagated': True,
            'qualification': 'No write or peer input; caller-step termination is measured separately below'})

        ordinary_caller = s.session('asker')
        ordinary_action, ordinary_resource = 'opencode_list_mcp_resources', 'qualification-denied-server'
        request(host, 'PATCH', f'/api/session/{ordinary_caller}', {'permissions': [
            {'action': ordinary_action, 'resource': ordinary_resource, 'effect': 'ask'}]})
        ordinary_code = 'return await tools.opencode.list_mcp_resources({server:' + json.dumps(ordinary_resource) + '})'
        ordinary_job, ordinary_start = s.begin(ordinary_caller, ordinary_code)
        s.await_event(lambda e: e['type'] == 'native-event'
            and e['data']['type'] == 'permission.asked'
            and e['data']['data'].get('action') == ordinary_action
            and e['data']['data'].get('sessionID') == ordinary_caller)
        ordinary_pending = request(host, 'GET', f'/api/session/{ordinary_caller}/permission')
        require(len(ordinary_pending) == 1 and ordinary_pending[0]['resources'] == [ordinary_resource],
                'Ordinary native tool did not reach its own permission boundary through Code Mode')
        ordinary_calls = [e['data'] for e in events(root)[ordinary_start:] if e['type'] == 'tool-before'
            and e['data']['tool'] == ordinary_action and e['data']['sessionID'] == ordinary_caller]
        require(len(ordinary_calls) == 1 and ordinary_pending[0]['source'] == {
            'type': 'tool', 'messageID': ordinary_calls[0]['messageID'], 'id': ordinary_calls[0]['id']},
            'Ordinary baseline permission source did not match the actual native tool')
        request(host, 'POST', f'/api/session/{ordinary_caller}/permission/{ordinary_pending[0]["id"]}/reply',
                {'decision': 'reject'})
        idle(host, [ordinary_caller])
        ordinary_events = events(root)[ordinary_start:]
        ordinary_requests = [e for e in ordinary_events if e['type'] == 'model-request'
                             and e['data']['sessionID'] == ordinary_caller]
        require(len(plain_requests) >= 1 and len(ordinary_requests) == len(plain_requests),
                'Loom plain-rejection continuation diverged from the same-host native Code Mode control')
        require(not any(e['type'] == 'tool-after' and e['data']['tool'] == ordinary_action
                and e['data']['status'] == 'completed' for e in ordinary_events),
                'Rejected ordinary native resource tool returned successfully')
        require(ledger_snapshot(root) == untouched and not peer_notices(ordinary_events),
                'Ordinary native permission baseline changed Loom history or contacted a peer')
        report['checks'].append({'name': 'native-ordinary-plain-reject-control', 'status': 'PASS',
            'native_tool': ordinary_action, 'code_mode_call': ordinary_code,
            'caller_session': ordinary_caller, 'permission': ordinary_pending[0],
            'caller_model_requests': len(ordinary_requests),
            'same_step_behavior_as_peer': len(ordinary_requests) == len(plain_requests),
            'native_tool_completed': False,
            'qualification': 'Unmodified native Effect tool; real permission assertion precedes MCP lookup; no MCP server configured or contacted'})
        report['host_observations'].append({'name': 'plain-rejection-stops-caller-step',
            'status': 'PASS' if len(plain_requests) == len(ordinary_requests) == 1 else 'FAIL',
            'loom_caller_model_requests': len(plain_requests),
            'ordinary_native_caller_model_requests': len(ordinary_requests),
            'ordinary_native_tool': ordinary_action,
            'same_observed_behavior': len(ordinary_requests) == len(plain_requests),
            'qualification': 'Native-owned caller-step termination is outside the required delivery gate; never infer it from denied input. No forced caller interruption was added.'})
        if len(plain_requests) != 1 or len(ordinary_requests) != 1:
            report['limits'].append('Plain no-feedback rejection through OpenCode 2.2.6 Code Mode does not guarantee caller-step termination; the native baseline and Loom both deny the requested operation but can continue the caller model.')

        rules = [{'action': 'loom.question.deliver', 'resource': 'session:' + reader, 'effect': 'allow'},
                 {'action': 'loom.question.deliver', 'resource': 'session:' + denied_reader, 'effect': 'deny'}]
        request(host, 'PATCH', f'/api/session/{asker}', {'permissions': rules})
        require(request(host, 'GET', f'/api/session/{asker}').get('permissions') == rules,
                'Explicit caller Session delivery rules were not applied')
        denied_start = len(events(root))
        assert_rejected(s, asker, [{**peer_request, 'session_id': denied_reader}])
        require(ledger_snapshot(root) == untouched and not peer_notices(events(root)[denied_start:]),
                'Exact-target denial stored or delivered a peer question')
        require(request(host, 'GET', f'/api/session/{asker}/permission') == [],
                'Explicit native deny unexpectedly asked for approval')
        report['checks'].append({'name': 'native-peer-exact-target-deny', 'status': 'PASS',
            'caller_session': asker, 'allowed_target': reader, 'denied_target': denied_reader,
            'rules': rules, 'ledger_unchanged': True, 'native_notices': 0})

        before_peer = len(events(root))
        peer = s.invoke(asker, 'record', peer_request)
        require(peer['session_id'] == asker and peer['action_id'] == peer_action['id']
                and peer['data']['expected_session'] == reader and
                peer['dispatch']['target_session_id'] == reader and
                peer['dispatch']['status'] == 'admission-observed',
                'Native peer Session notification was not admitted: ' + str(peer.get('dispatch')))
        idle(host, [asker, reader])
        notices = peer_notices(events(root)[before_peer:], peer['id'])
        require(len(notices) == 1 and notices[0]['data']['data']['sessionID'] == reader,
                'No verified exact native peer Session notice')
        require(peer['dispatch']['reason'] == 'native-peer-notice-admitted', 'Peer dispatch history used a parent-specific reason')
        saved_peer = next(row for row in ledger_snapshot(root) if row[1] == peer['id'])
        restart_start = len(events(root))
        host.close()
        host = start('peer-reopened')
        s = Scenario(host, root)
        require(not peer_notices(events(root)[restart_start:]), 'Native host restart replayed a peer notice')
        inbox = s.invoke(reader, 'record', {'operation': 'query', 'view': 'inbox'})
        require([q['question_id'] for q in inbox['items']] == [peer['id']],
                'Native peer inbox omitted its persisted Action-linked question after restart')
        require(next(row for row in ledger_snapshot(root) if row[1] == peer['id']) == saved_peer,
                'Restart changed the original peer question')
        assert_rejected(s, asker, [{'operation': 'answer', 'question_id': peer['id'], 'choice_id': 'B'}])
        peer_answer = s.invoke(reader, 'record', {'operation': 'answer',
            'question_id': peer['id'], 'choice_id': 'B'})
        require(peer_answer['session_id'] == reader and
                peer_answer['data']['answer'] == choices[1]['answer'] and
                'resume' not in peer_answer, 'Wrong peer choice authorization or answer semantics')
        require(s.invoke(reader, 'record', {'operation': 'query', 'view': 'inbox'})['items'] == [],
                'Answered native peer question remains open')
        peer_thread = s.invoke(asker, 'record', {'operation': 'query',
            'view': 'thread', 'question_id': peer['id']})
        require(len(peer_thread['answers']) == 1 and
                peer_thread['answers'][0]['id'] == peer_answer['id'],
                'Peer answer not visible from original question')
        require(not peer_notices(events(root)[restart_start:]), 'Peer discovery/answer replayed question delivery')
        report['checks'].append({'name': 'native-peer-session-question', 'status': 'PASS',
            'question': peer['id'], 'answer': peer_answer['id'],
            'target_session': reader, 'source_session': asker, 'native_notices': len(notices),
            'permission_rule': rules[0], 'restart_before_discovery_and_answer': True,
            'question_unchanged_across_restart': True, 'replayed_notices': 0,
            'qualification': 'Unmodified OpenCode 2.3.0, real process restart, local scripted model; no human approval claim'})

        choice_start = len(events(root))
        q = s.invoke(asker, 'record', {'operation': 'ask', 'question': 'Which store?',
            'answer_type': 'multi-choice', 'choices': choices,
            'recipient': {'kind': 'role', 'id': 'research'}, 'blocking': True})
        dispatch = q['dispatch']
        require(dispatch['status'] == 'admission-observed' and dispatch['native_status'] == 'running',
                'Native background dispatch was not admitted: ' + str(dispatch))
        child = dispatch['target_session_id']
        # OpenCode 2.3.0 returns a background child handle, not the answer.
        # Require the real specialist write and one host-owned synthetic
        # completion notice before claiming the selected choice was delivered.
        s.await_event(lambda e: e['type'] == 'tool-after'
            and e['data'].get('sessionID') == child
            and e['data'].get('tool') in ('loom_record', 'loom.record')
            and e['data'].get('input', {}).get('operation') == 'answer'
            and e['data']['input'].get('question_id') == q['id']
            and e['data'].get('status') == 'completed')
        s.await_event(lambda e: e['type'] == 'native-event'
            and e['data'].get('type') == 'session.inbox.enqueued'
            and e['data']['data'].get('sessionID') == asker
            and e['data']['data'].get('item', {}).get('type') == 'synthetic'
            and e['data']['data']['item'].get('payload', {}).get('metadata', {}).get('source') == 'subagent'
            and e['data']['data']['item']['payload']['metadata'].get('childID') == child)
        deadline = time.monotonic() + 20
        while True:
            current = events(root)[choice_start:]
            notices = [i for i, e in enumerate(current) if e['type'] == 'native-event'
                and e['data'].get('type') == 'session.inbox.enqueued'
                and e['data']['data'].get('sessionID') == asker
                and e['data']['data'].get('item', {}).get('type') == 'synthetic'
                and e['data']['data']['item'].get('payload', {}).get('metadata', {}).get('source') == 'subagent'
                and e['data']['data']['item']['payload']['metadata'].get('childID') == child]
            require(len(notices) <= 1, 'Duplicate native specialist completion notice')
            settled = len(notices) == 1 and any(i > notices[0]
                and e['type'] == 'native-event'
                and e['data'].get('type') == 'session.execution.succeeded'
                and e['data']['data'].get('sessionID') == asker
                for i, e in enumerate(current))
            if settled and not any(sid in request(host, 'GET', '/api/session/active')
                                   for sid in (asker, child)):
                break
            if time.monotonic() >= deadline:
                raise RuntimeError('Native specialist completion did not settle with its parent')
            time.sleep(.05)
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
             'choices': [choices[0], choices[0]], 'recipient': {'kind': 'role', 'id': 'research'}, 'blocking': True},
            {'operation': 'ask', 'question': 'Legacy must reject new choices', 'answer_type': 'multi-choice',
             'choices': choices, 'to_agent': 'question-specialist', 'blocking': True},
            {'operation': 'ask', 'question': 'Blank choice', 'answer_type': 'multi-choice',
             'choices': [{'id': 'A', 'answer': '\u00a0\ufeff'}, choices[1]], 'recipient': {'kind': 'user'}, 'blocking': False}]
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
        s.command(asker, '''
          const label="😀".repeat(4000), reason="😀".repeat(8000);
          const input={operation:"ask",question:"Unicode boundary?",recipient:{kind:"user"},blocking:false,
            answer_type:"multi-choice",choices:[{id:"A",answer:label},{id:"B",answer:"Other"}]};
          const q=JSON.parse(await tools.loom.record(input)).result;
          const a=JSON.parse(await tools.loom.record({operation:"answer",question_id:q.id,choice_id:"A",reason})).result;
          const b=JSON.parse(await tools.loom.record({operation:"answer",question_id:q.id,status:"cannot-select",reason})).result;
          const invalid=await Promise.allSettled([
            tools.loom.record({...input,choices:[{id:"A",answer:label+"x"},{id:"B",answer:"Other"}]}),
            tools.loom.record({operation:"answer",question_id:q.id,choice_id:"A",reason:reason+"x"}),
            tools.loom.record({operation:"answer",question_id:q.id,status:"cannot-select",reason:" \\n "})
          ]);
          const t=JSON.parse(await tools.loom.record({operation:"query",view:"thread",question_id:q.id})).result;
          if(a.data.answer!==label || a.data.reason!==reason || b.data.reason!==reason ||
            t.question.data.choices[0].answer!==label || t.answers.length!==2 ||
            invalid.some(r=>r.status!=="rejected")) throw new Error("Unicode contract mismatch");
          return {unicode:true};
        ''')
        report['checks'].append({'name': 'native-unicode-boundaries', 'status': 'PASS'})
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
        report['status'] = 'PASS' if all(check['status'] == 'PASS' for check in report['checks']) else 'FAIL'
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
