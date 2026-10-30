"""Real packed OpenCode 2.2.0 candidate + local scripted model.

No replacement tool registration, ToolContext, permission identity, dispatch or
resume implementation. Final assembled-candidate acceptance is a separate run.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import secrets
import shutil
import sqlite3
import subprocess
import tempfile
import time
from contextlib import closing
from pathlib import Path
from urllib.request import Request

from installed_host_smoke import (
    PrivateHost,
    installed_plugin_inventory,
    isolated_environment,
    require,
    source_inventory,
)

READ_DENIAL_APPLICABILITY = {
    'name': 'E2-selective-session-read-policy-denial', 'status': 'NOT APPLICABLE',
    'qualification': 'NOT APPLICABLE ON PINNED HOST 2.2.0; reassess on host/API change',
    'host_version': '2.2.0', 'executed': False, 'evidence_kind': 'tagged source/version analysis, not installed execution',
    'sources': ['v2.2.0 packages/plugin/src/promise/adapter.ts: context2.session.get adapts host.session.get',
                'v2.2.0 packages/core/src/session.ts: get delegates to sessions.forSession(sessionID).get()',
                'v2.2.0 packages/core/src/session/session.ts: Session.get calls store.get and returns NotFoundError when absent'],
    'rationale': 'In tagged v2.2.0, session.get delegates to direct lookup by ID and returns an existing Session or not-found; that path has no selective session-read ACL. permission.assert is a separate API and is not evidence that session.get enforces a read policy. This says nothing about synthetic execution permission.',
    'authority': 'Tagged v2.2.0 source inspection for this upgrade; PR #182 only qualifies the historical 2.0.32 host. This is not installed execution or permission.assert evidence.',
}
REQUIRED_INSTALLED_CHECKS = {
    'E1-no-plan-manual-question', 'E1-storage-failure-zero-contact', 'E2-idle-switched-native-resume',
    'E2-later-legacy-missing-failed-first', 'E2-running', 'E2-preyield', 'E2-public-moved-target',
    'E3-new-unicode-relational-parts', 'E3-old-action-full-content-oracle',
    'E3-node-session-oracles-cursor-corrupt-no-advance', 'E3-populated-startup-raw-preservation',
    'E2-E3-restart-no-reconstruction',
    'E4-native-session-discovery', 'E4-native-archive-status',
    'E5-compaction-context-and-observation',
    'E6-native-trace-and-scope', 'E6-exported-child-history', 'E6-native-text-redaction',
    'E6-native-edit-permission-gate',
}


def qualification_status(checks, version):
    by_name = {row['name']: row for row in checks}
    if len(by_name) != len(checks) or not REQUIRED_INSTALLED_CHECKS.issubset(by_name):
        return 'UNPROVEN'
    if any(by_name[name]['status'] != 'PASS' for name in REQUIRED_INSTALLED_CHECKS):
        return 'UNPROVEN'
    applicability = by_name.get(READ_DENIAL_APPLICABILITY['name'])
    if version != '2.2.0' or applicability != READ_DENIAL_APPLICABILITY:
        return 'UNPROVEN'
    return 'PASS' if all(row['status'] == 'PASS' or row == applicability for row in checks) else 'UNPROVEN'


def request(host, method, path, body=None):
    allow_export = method == 'GET' and path.startswith('/api/experimental/session/') and path.endswith('/export?sanitize=true')
    require(path.startswith('/api/session') or allow_export,
            'Only owned private Session endpoints and sanitized export reads are permitted')
    token = base64.b64encode(f'opencode:{host.password}'.encode()).decode()
    req = Request(host.url + path, data=None if body is None else json.dumps(body).encode(), method=method,
                  headers={'Authorization': 'Basic ' + token, 'Content-Type': 'application/json'})
    with host.opener.open(req, timeout=30) as response:
        raw = response.read(8 * 1024 * 1024 + 1)
    require(len(raw) <= 8 * 1024 * 1024, 'Private response exceeded read budget')
    value = json.loads(raw) if raw else None
    return value.get('data', value) if isinstance(value, dict) else value


def events(root):
    path = root / 'audit.ndjson'
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def idle(host, sessions, timeout=30):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        active = request(host, 'GET', '/api/session/active')
        if not any(s in active for s in sessions):
            return
        time.sleep(.05)
    raise RuntimeError(f'Private Sessions did not become idle: {sessions}')


def result_value(event):
    result = event['data']['result']
    content = result['content']
    text = content if isinstance(content, str) else '\n'.join(p['text'] for p in content if p['type'] == 'text')
    return json.loads(text)['result']


def call(name, value):
    return f'return await tools.loom.{name}({json.dumps(value, ensure_ascii=False)})'


class Scenario:
    def __init__(self, host, root):
        self.host, self.root = host, root
        self.jobs = {}

    def session(self, role):
        return request(self.host, 'POST', '/api/session', {'agent': 'question-' + role, 'title': role,
            'model': {'providerID': 'question-fixture', 'id': role},
            'location': {'directory': str(self.root / 'project')}})['id']

    def begin(self, session, code, hold=None):
        job = secrets.token_hex(8)
        self.jobs[job] = {'code': code, 'hold': hold}
        (self.root / 'jobs.json').write_text(json.dumps(self.jobs))
        start = len(events(self.root))
        request(self.host, 'POST', f'/api/session/{session}/prompt', {'text': 'LOOM_HARNESS_JOB:' + job})
        return job, start

    def release(self, job):
        self.jobs[job]['hold'] = None
        (self.root / 'jobs.json').write_text(json.dumps(self.jobs))

    def await_event(self, predicate):
        end = time.monotonic() + 20
        while time.monotonic() < end:
            found = [e for e in events(self.root) if predicate(e)]
            if found:
                return found[-1]
            time.sleep(.05)
        raise RuntimeError('Expected native/provider barrier event not observed')

    def command(self, session, code, tool=None):
        job, start = self.begin(session, code)
        return self.finish(session, job, start, tool)

    def finish(self, session, job, start, tool=None):
        idle(self.host, [session])
        observed = events(self.root)[start:]
        own = [e for e in observed if e['type'] == 'tool-after' and e['data']['sessionID'] == session]
        finished = [e for e in own if e['data']['tool'] == 'execute']
        require(len(finished) == 1 and finished[0]['data']['status'] == 'completed',
                f'Expected one successful native execute for {job}: {finished}')
        if tool:
            nested = [e for e in own if e['data']['tool'] in ('loom_' + tool, 'loom.' + tool)]
            require(len(nested) == 1 and nested[0]['data']['status'] == 'completed', f'No real production {tool} result: {nested}')
            return result_value(nested[0])
        return observed

    def invoke(self, session, name, value):
        # Native history returns Markdown by default; this harness checks JSON fields.
        if name == 'record' and value.get('view') == 'full_thread':
            value = {**value, 'response_format': 'json'}
        return self.command(session, call(name, value), name)


def no_contact(observed):
    """Counterexample oracle: inspect native activity, not just ledger counts."""
    tools = [e['data']['tool'] for e in observed if e['type'] == 'tool-before']
    require(not any(t in ('subagent', 'question', 'prompt') for t in tools), 'Ask contacted a recipient/native executor')
    requests = [e['data'] for e in observed if e['type'] == 'model-request']
    require(all(e['agent'] == 'question-asker' for e in requests), 'Ask produced a recipient model request')
    require(not any(e['type'] == 'provider-inputs' and e['data']['notices'] for e in observed), 'Ask generated a resume input')
    require(not any(e['type'] == 'native-event' and (e['data']['type'] == 'session.synthetic' or e['data']['type'].startswith('permission.')
                    or e['data'].get('data', {}).get('item', {}).get('type') == 'synthetic') for e in observed),
            'Ask emitted native synthetic/permission activity')


def synthetic_events(root):
    # Count actual native inbox admission events, not session.synthetic aliases.
    # Count real input events before any provider terminal/write guard.
    return [e['data'] for e in events(root) if e['type'] == 'native-event' and e['data']['type'] == 'session.inbox.enqueued'
            and e['data']['data']['item']['type'] == 'synthetic']


def verify_single_admission(admitted, target, answer_id):
    require(len(admitted) == 1 and admitted[0]['data']['sessionID'] == target, 'Wrong/duplicate native synthetic target')
    require(admitted[0]['data']['item']['payload']['metadata']['answer_id'] == answer_id, 'Native notice lost exact saved answer')
    require(admitted[0]['data']['item']['delivery'] == 'steer', 'Native notice changed delivery semantics')


def verify_provider_inputs(observed):
    for event in observed:
        if event['type'] != 'provider-inputs':
            continue
        notices = event['data']['notices']
        keys = [(n['question'], n['answer']) for n in notices]
        require(len(keys) == len(set(keys)), 'Duplicate actionable notice in one raw model request')


def target_requests(root, session):
    return [e for e in events(root) if e['type'] == 'model-request' and e['data']['sessionID'] == session]


def assert_rejected(scenario, session, inputs):
    # Native Code Mode executes every real invalid call. Success is an explicit
    # failure; returning no rows or a scripted no-op is not a negative control.
    code = 'const cases=' + json.dumps(inputs) + ';for(const v of cases){let rejected=false;try{await tools.loom.record(v)}catch(e){rejected=true}if(!rejected)throw new Error("Accepted invalid input "+JSON.stringify(v))}return cases.length'
    scenario.command(session, code)


def decode_parts(pages):
    """Independent Markdown consumer; not the production representation helper."""
    records, pending, previous_end = [], '', 0
    pattern = re.compile(r'## Record (\S+) — [^\n]+\n\n(?:[^\n]+\n\n)*?Part (\d+)/(\d+); representation UTF-16 range \[(\d+), (\d+)\) of (\d+)\.[^\n]*\n\n((?:    [^\n]*\n)+)')
    for page in pages:
        for match in pattern.finditer(page['markdown']):
            ident, part, total, start, end, length, block = match.groups()
            piece = '\n'.join(line[4:] for line in block.rstrip('\n').split('\n'))
            require(int(start) == previous_end, 'Part boundary skipped or duplicated stored text')
            require(len(piece.encode('utf-16-le')) // 2 == int(end) - int(start), 'Incorrect UTF-16 continuation range')
            pending += piece
            previous_end = int(end)
            if int(part) == int(total):
                require(previous_end == int(length), 'Final part truncated')
                record = json.loads(pending)
                require(record['id'] == ident, 'Wrong part attribution')
                records.append(record)
                pending, previous_end = '', 0
    require(not pending, 'Traversal ended mid-record')
    require(len({r['id'] for r in records}) == len(records), 'Duplicate records')
    require([r['sequence'] for r in records] == sorted(r['sequence'] for r in records), 'Out-of-order records')
    return records


def traverse(scenario, reader, scope):
    pages, cursor = [], None
    for _ in range(200):
        page = scenario.invoke(reader, 'record', {'operation': 'query', 'view': 'full_thread', **scope,
                               **({'cursor': cursor} if cursor else {})})
        pages.append(page)
        cursor = page['next_cursor']
        if not cursor:
            return pages, decode_parts(pages)
    raise RuntimeError('Full history did not terminate within bounded traversal')


def fixture_snapshot(repo):
    root = repo / 'tests/fixtures/baseline-c9ffcfa'
    manifest = json.loads((root / 'manifest.json').read_text())
    for item in manifest['files']:
        require(hashlib.sha256((root / item['path']).read_bytes()).hexdigest() == item['sha256'], 'Frozen fixture hash changed')
    return json.loads((root / 'snapshot.json').read_text())


def restore_fixture(path, saved):
    """Static OLD-format prerequisite on stopped disposable writers, not product output."""
    path.unlink()
    for suffix in ('-wal', '-shm'):
        sidecar = Path(str(path) + suffix)
        if sidecar.exists():
            sidecar.unlink()
    with closing(sqlite3.connect(path)) as db, db:
        for row in saved['schema']:
            if row['type'] == 'table' and row['name'] != 'sqlite_sequence':
                db.execute(row['sql'])
        for name, rows in saved['tables'].items():
            db.execute('DELETE FROM "' + name + '"')
            for row in rows:
                columns = ','.join('"' + k + '"' for k in row)
                db.execute(f'INSERT INTO "{name}" ({columns}) VALUES ({",".join("?" for _ in row)})', list(row.values()))
        for row in saved['schema']:
            if row['type'] != 'table' and row['sql']:
                db.execute(row['sql'])
        db.execute('PRAGMA user_version=' + str(saved['user_version']))


def unchanged_rows(path, saved):
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        for table, rows in saved['tables'].items():
            if table == 'sqlite_sequence':
                continue  # Appends necessarily advance the native sequence.
            current = [dict(r) for r in db.execute('SELECT * FROM "' + table + '"')]
            for row in rows:
                require(row in current, f'Historical raw row changed: {table}: {row}')


def run(executable, repo, output, artifact, plugin, expected_plugin, expected_sdk='2.2.0',
        disable_watcher=False, duplicate_control=False):
    output.mkdir(parents=True, exist_ok=False)
    report = {'status': 'UNPROVEN', 'kind': 'installed-question-production-path', 'checks': [],
              'limits': ['Scripted external model, not live-provider compatibility.',
                         'Admission is not consumption, cancellation, or parent-generation handback.',
                         'Qualification of this harness input, not final task4.2 assembled acceptance.'],
              'source_oracle': source_inventory(repo)}
    try:
        report['candidate_artifact'] = installed_plugin_inventory(
            artifact, plugin, expected_plugin, expected_sdk)
    except Exception as error:
        report['status'] = 'FAIL'
        report['error'] = f'{type(error).__name__}: {error}'
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        raise
    report['harness_sha256'] = {name: hashlib.sha256((repo / name).read_bytes()).hexdigest()
                               for name in ['server.ts', 'tests/installed_questions.py', 'tests/installed_host_smoke.py',
                                            'tests/question-host/server.ts', 'tests/question-host/provider.mjs']}
    report['expected_versions'] = {'sdk': expected_sdk, 'host': '2.2.0'}
    report['observed_versions'] = {
        'sdk': report['candidate_artifact']['sdk_version'],
        'host': subprocess.check_output([executable, '--version'], text=True, timeout=15).strip(),
    }
    report['sdk_version'] = report['observed_versions']['sdk']
    host_ok = report['observed_versions']['host'] in ('2.2.0', 'opencode v2.2.0')
    if report['observed_versions']['sdk'] != report['expected_versions']['sdk'] or not host_ok:
        report['status'] = 'FAIL'
        report['error'] = ('Version profile mismatch: '
                           f"expected SDK {report['expected_versions']['sdk']} and host {report['expected_versions']['host']}; "
                           f"observed SDK {report['observed_versions']['sdk']} and host {report['observed_versions']['host']}")
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        raise RuntimeError(report['error'])
    report['bun_baseline'] = (repo / '.bun-version').read_text().strip()
    report['owned_hosts'] = []
    host = None
    owned_hosts = []
    with tempfile.TemporaryDirectory(prefix='loom-questions-') as temp:
        root = Path(temp).resolve()
        project = root / 'project'
        project.mkdir()
        env = isolated_environment(root)
        env['LOOM_QUESTION_FIXTURE'] = str(root)
        if disable_watcher:
            env['OPENCODE_FILEWATCHER_DISABLE'] = '1'
            report['limits'].append('Owned-host filewatcher disabled for local inotify exhaustion; watcher behavior UNPROVEN.')
        report['private_root'] = str(root)
        report['versions'] = {name: subprocess.check_output(cmd, env=env, text=True, timeout=15).strip()
                              for name, cmd in [('host', [executable, '--version']), ('bun', ['bun', '--version']), ('node', ['node', '--version'])]}
        require(report['versions']['host'] in ('2.2.0', 'opencode v2.2.0'), 'Requires exact unmodified host 2.2.0')
        subprocess.run(['git', 'init', '-q', str(project)], env=env, check=True)
        roles = ['asker', 'respondent', 'reader', 'switched']
        agents = {'question-' + role: {'description': role + ' fixture', 'mode': 'primary', 'model': 'question-fixture/' + role,
                  'system': 'Follow the deterministic local verification script.'} for role in roles}
        agents['question-switched']['permissions'] = [{'action': '*', 'resource': '*', 'effect': 'deny'}]
        config = {'plugins': ['*', str(plugin), str(repo / 'tests/question-host')], 'agents': agents,
                  'model': 'question-fixture/asker', 'update': 'disable', 'share': 'disabled'}
        (Path(env['OPENCODE_CONFIG_DIR']) / 'opencode.json').write_text(json.dumps(config))
        (project / '.loom.yaml').write_text('agents: {}\ninstructions: {enabled: false}\nledger: {capture: off}\n')
        (root / 'jobs.json').write_text('{}')
        report['configuration_sha256'] = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
        try:
            def start(label):
                owned = PrivateHost(executable, project, env, output, label)
                owned_hosts.append(owned)
                report['owned_hosts'].append({'pid': owned.proc.pid, 'label': label, 'url': owned.url})
                try:
                    require(json.loads(owned.get('/api/info', 'info'))['version'] == '2.2.0', 'Wrong actual server')
                    owned.wait_roster('/api/plugin', 'plugins', lambda xs: all(any(p['id'] == name and p.get('state', {}).get('status') == 'active' for p in xs)
                                     for name in ['loom', 'loom.question.fixture']))
                    return owned
                except Exception:
                    owned.close()
                    raise
            host = start('prepare')
            host.close(); host = None
            ledger = list((root / 'state/loom/actions-v1').glob('*/ledger.sqlite'))
            require(len(ledger) == 1, 'Expected one candidate-created disposable ledger')
            ledger = ledger[0]
            saved = fixture_snapshot(repo)
            restore_fixture(ledger, saved)
            report['fixture_snapshot_sha256'] = hashlib.sha256((repo / 'tests/fixtures/baseline-c9ffcfa/snapshot.json').read_bytes()).hexdigest()
            host = start('populated')
            unchanged_rows(ledger, saved)
            s = Scenario(host, root)
            asker, respondent, reader = [s.session(role) for role in roles[:3]]
            report['sessions'] = {'asker': asker, 'respondent': respondent, 'reader': reader}
            s.command(reader, 'const x=search({namespace:"loom",limit:10}); if(x.items.length!==5) throw new Error("Expected five tools"); return x')
            gate = s.session('reader')
            gate_file = project / 'permission-gate.txt'
            gate_file.write_text('mode=prototype\n')
            denied = [{'action': action, 'resource': '*', 'effect': 'deny'}
                      for action in ('edit', 'write', 'shell')]
            request(host, 'PATCH', f'/api/session/{gate}', {'permissions': denied})
            require(request(host, 'GET', f'/api/session/{gate}').get('permissions') == denied,
                    'Native edit denial did not persist in Session')
            before_denied = len(events(root))
            script = ('let rejected=false;try{await tools.edit({path:"permission-gate.txt",'
                      'oldString:"prototype",newString:"safe"})}catch(e){rejected=true}'
                      'if(!rejected)throw new Error("native edit escaped denied Session policy");'
                      'return rejected')
            s.command(gate, script)
            denied_calls = [e['data'] for e in events(root)[before_denied:]
                            if e['type'] == 'tool-after' and e['data'].get('sessionID') == gate
                            and e['data'].get('tool') == 'edit']
            require(len(denied_calls) == 1 and denied_calls[0]['status'] == 'error'
                    and gate_file.read_text() == 'mode=prototype\n',
                    'OpenCode native edit denial was not an authentic tool error')
            request(host, 'PATCH', f'/api/session/{gate}', {'permissions': []})
            require(request(host, 'GET', f'/api/session/{gate}').get('permissions') == [],
                    'Native worker Session edit policy failed to restore')
            before_allowed = len(events(root))
            s.command(gate, 'return await tools.edit({path:"permission-gate.txt",'
                     'oldString:"prototype",newString:"safe"})')
            allowed_calls = [e['data'] for e in events(root)[before_allowed:]
                             if e['type'] == 'tool-after' and e['data'].get('sessionID') == gate
                             and e['data'].get('tool') == 'edit']
            require(len(allowed_calls) == 1 and allowed_calls[0]['status'] == 'completed'
                    and gate_file.read_text() == 'mode=safe\n',
                    'OpenCode native edit did not recover after Session policy restoration')
            report['checks'].append({'name': 'E6-native-edit-permission-gate', 'status': 'PASS',
                                     'qualification': 'Scripted provider invoking real installed OpenCode 2.2.0 edit tool; real native deny and restore, not real-model QA-B acceptance',
                                     'session': gate, 'failed_tool_message': denied_calls[0]['messageID'],
                                     'recovered_tool_message': allowed_calls[0]['messageID']})
            # Execute the real installed plugin's trace against native host messages,
            # not a fabricated response or a component-only copy.
            own_trace = s.invoke(reader, 'trace', {'operation': 'timeline', 'limit': 50})
            require(own_trace['session_id'] == reader and own_trace['source'] == 'native-context'
                    and own_trace['coverage']['full_history'] is False
                    and own_trace['coverage']['delegation_complete'] is False,
                    'Native timeline returned an unqualified source or wrong Session')
            require(any(e['kind'] == 'user_prompt' for e in own_trace['events'])
                    and any(e['kind'] == 'opaque_tool' and e.get('tool') == 'execute'
                            for e in own_trace['events']),
                    'Installed OpenCode context did not expose a real user prompt and Code Mode wrapper')
            # The same project is not permission to read another Session's
            # native context; this must fail through the real plugin.
            refused = 'let denied=false;try{await tools.loom.trace({operation:"timeline",session_id:' + json.dumps(asker) + '})}catch(e){denied=true}if(!denied)throw new Error("cross-session native context escaped");return true'
            denied_events = s.command(reader, refused)
            require(any(e['type'] == 'tool-after' and e['data']['tool'] in ('loom_trace', 'loom.trace')
                        and e['data']['status'] == 'error' for e in denied_events),
                    'Cross-session rejection did not reach native trace authorization')
            report['checks'].append({'name': 'E6-native-trace-and-scope', 'status': 'PASS',
                                     'session': reader,
                                     'source_messages': own_trace['source_messages'],
                                     'observed_opaque': True,
                                     'qualification': 'Real native postcompaction context and negative same-project read, not full history'})
            child = request(host, 'POST', '/api/session', {'parentID': reader, 'agent': 'question-reader',
                'title': 'deep retro child', 'model': {'providerID': 'question-fixture', 'id': 'reader'},
                'location': {'directory': str(root / 'project')}})['id']
            s.command(child, 'return await tools.loom.agents({})')
            inventory = s.invoke(reader, 'trace', {'operation': 'children', 'session_id': reader, 'limit': 50})
            require(any(x['id'] == child and x['parent_id'] == reader for x in inventory['sessions']),
                    'Real native parent-child Session inventory did not include delegated child')
            # Read the child's *real* sanitized native export. The content must
            # traverse the actual host export API -> private file -> Loom read ACL -> trace.
            exported = request(host, 'GET', f'/api/experimental/session/{child}/export?sanitize=true')
            require(exported.get('info', {}).get('id') == child and isinstance(exported.get('messages'), list),
                    'Native sanitized Session export is unavailable or malformed')
            (root / 'project' / 'child-trace.json').write_text(json.dumps({'data': exported}))
            projected = s.invoke(reader, 'trace', {'operation': 'timeline', 'session_id': child,
                'export_path': 'child-trace.json', 'limit': 50})
            require(projected['source'] == 'provided-export' and projected['coverage']['full_history'] is None
                    and any(e['kind'] == 'user_prompt' for e in projected['events'])
                    and any(e['kind'] == 'opaque_tool' and e.get('tool') == 'execute'
                            for e in projected['events']),
                    'Loom did not project the installed child history through an authorized export')
            report['checks'].append({'name': 'E6-exported-child-history', 'status': 'PASS',
                                     'parent': reader, 'child': child,
                                     'source_messages': projected['source_messages'],
                                     'qualification': 'Actual OpenCode child export shape; no cryptographic completeness proof'})
            # A real native user message must be identified by its original ID
            # BEFORE tracing. An unrelated redaction marker cannot pass this oracle.
            marker = 'RETRO_TRACE_SENTINEL_SOURCE_20261029'
            sentinel = 'sk-proj-NOTAREALKEYLOCALRETRO123456789'
            aws_secret = 'SYNTHETIC_AWS_SECRET_VALUE_20261029'
            db_secret = 'SYNTHETIC_DB_PASSWORD_VALUE_20261029'
            uri_secret = 'SYNTHETIC_POSTGRES_PASSWORD_VALUE_20261029'
            credential_text = (
                f'{marker}: {sentinel} AWS_SECRET_ACCESS_KEY={aws_secret} '
                f'DB_PASSWORD={db_secret} postgres://audit:{uri_secret}@db.invalid/retro'
            )
            request(host, 'POST', f'/api/session/{reader}/prompt', {'text': credential_text})
            idle(host, [reader])
            raw_messages = request(host, 'GET', f'/api/session/{reader}/message?order=desc&limit=200')
            require(isinstance(raw_messages, list), 'Native source message listing is not an array')
            sources = [row for row in raw_messages if row.get('type') == 'user'
                       and marker in row.get('text', '')]
            require(len(sources) == 1 and isinstance(sources[0].get('id'), str),
                    'Source credential fixture was not uniquely found in native Session history')
            source_id = sources[0]['id']
            redaction_start = len(events(root))
            all_pages = []
            token_event = None
            cursor = None
            for _ in range(20):
                query = {'operation': 'timeline', 'limit': 50, 'include_text': True}
                if cursor is not None:
                    query['cursor'] = cursor
                page = s.invoke(reader, 'trace', query)
                all_pages.append(page)
                for secret in (sentinel, aws_secret, db_secret, uri_secret):
                    require(secret not in json.dumps(page),
                            'Native Session trace response leaked credential fixture bytes')
                matching = [entry for entry in page['events'] if entry['source_message_id'] == source_id]
                if matching:
                    require(len(matching) == 1 and matching[0]['kind'] == 'user_prompt',
                            'Found wrong source event for native credential message')
                    token_event = matching[0]
                    break
                cursor = page.get('next_cursor')
                if not cursor:
                    break
            require(token_event is not None, 'The credential fixture source message was not visited')
            excerpt = token_event.get('text_excerpt', '')
            require(marker in excerpt and excerpt.count('[REDACTED]') >= 4,
                    'The exact source message was not included with all four credentials masked')
            completed = [event for event in events(root)[redaction_start:]
                         if event['type'] == 'tool-after' and
                         event['data']['tool'] in ('loom_trace', 'loom.trace')]
            require(len(completed) == len(all_pages),
                    'Native trace result evidence missing for one or more inspected pages')
            stored_matches = []
            for completed_event in completed:
                actual = result_value(completed_event)
                for secret in (sentinel, aws_secret, db_secret, uri_secret):
                    require(secret not in json.dumps(actual),
                            'Native trace tool output persisted sensitive fixture bytes')
                stored_matches.extend(entry for entry in actual['events']
                                      if entry['source_message_id'] == source_id)
            require(len(stored_matches) == 1 and stored_matches[0].get('text_excerpt') == excerpt,
                    'Persisted native tool result did not contain the exact masked source event')
            report['checks'].append({'name': 'E6-native-text-redaction', 'status': 'PASS',
                                     'source_message': source_id,
                                     'source_events_matched': len(stored_matches),
                                     'patterns_checked': 4,
                                     'qualification': 'Real native user message and trace tool result, including common env credentials and connection URI. Synthetic values only; unknown secret formats remain unproven'})
            start_index = len(events(root))
            q = s.invoke(asker, 'record', {'operation': 'ask', 'question': '# <tag> Unicode 雪🙂 [not approval]',
                         'to_agent': 'question-respondent', 'blocking': False, 'context_attachments': ['fixture://question']})
            require(q['dispatch'] == {'status': 'not-attempted', 'reason': 'policy-capability-unavailable'}, 'Not exact fail-closed result')
            require(q['session_id'] == asker and not q.get('action_id'), 'No-selection question invented association/author')
            no_contact(events(root)[start_index:])
            a = s.invoke(respondent, 'record', {'operation': 'answer', 'question_id': q['id'], 'answer': 'Only this fixture; not permission',
                         'context_attachments': ['fixture://answer']})
            require(a['session_id'] == respondent and 'resume' not in a, 'False-blocking answer resumed or reauthored')
            page = s.invoke(reader, 'record', {'operation': 'query', 'view': 'full_thread', 'session_id': asker})
            require(all(x in page['markdown'] for x in [q['id'], a['id'], respondent, 'fixture://question', 'fixture://answer']), 'Incomplete relational read')
            require(not page['next_cursor'], 'Unexpected short-history continuation')
            report['checks'].append({'name': 'E1-no-plan-manual-question', 'status': 'PASS', 'question': q['id'], 'answer': a['id']})
            invalid = [dict(operation='ask', question='Invalid', to_agent='question-respondent', blocking=False, **extra)
                       for extra in [{'attachments': ['fixture://alias']}, {'attachments': [], 'context_attachments': []},
                                     {'reference': {'action_id': 'missing', 'kind': 'action', 'id': 'missing'}}, {'session_id': respondent}]]
            invalid += [dict(operation='answer', question_id=q['id'], answer='Invalid', **extra)
                        for extra in [{'attachments': []}, {'attachments': [], 'context_attachments': []}]]
            invalid += [{'operation': op} for op in ['assign', 'authorize-continuation', 'withdraw-continuation', 'retry-delivery']]
            invalid += [{'operation': 'query', 'view': view} for view in ['assignments', 'deliveries']]
            assert_rejected(s, reader, invalid)
            failure_asker = s.session('asker')
            failure_start = len(events(root))
            with closing(sqlite3.connect(ledger)) as db, db:
                db.execute("CREATE TRIGGER harness_refuse_question BEFORE INSERT ON ledger WHEN NEW.kind='question' BEGIN SELECT RAISE(ABORT,'explicit harness storage fault'); END")
            try:
                assert_rejected(s, failure_asker, [{'operation': 'ask', 'question': 'Storage must fail', 'to_agent': 'question-respondent', 'blocking': True}])
                failed_events = events(root)[failure_start:]
                require(any(e['type'] == 'tool-after' and 'explicit harness storage fault' in e['data'].get('error', {}).get('message', '')
                            for e in failed_events), 'Storage countercheck failed before reaching real SQLite write')
                no_contact(failed_events)
            finally:
                with closing(sqlite3.connect(ledger)) as db, db:
                    db.execute('DROP TRIGGER harness_refuse_question')
            report['checks'].append({'name': 'E1-storage-failure-zero-contact', 'status': 'PASS', 'qualification': 'Explicit disposable SQLite trigger fault; real installed write, not natural storage failure'})
            action = s.invoke(asker, 'action', {'operation': 'create', 'title': 'Installed new API', 'goal': 'Preserve historical association'})
            s.invoke(asker, 'plan', {'operation': 'save', 'action_id': action['id'], 'expected_revision': 0,
                     'nodes': [{'id': 'work', 'kind': 'task', 'title': 'Question scope'}]})
            s.invoke(asker, 'context', {'action_id': action['id'], 'node_id': 'work'})
            discovered = s.invoke(asker, 'action', {'operation': 'sessions', 'action_id': action['id'], 'limit': 50})
            matching = [row for row in discovered['sessions'] if row['id'] == asker]
            require(len(matching) == 1 and matching[0]['selection']['action_id'] == action['id'],
                    'Installed native Session inventory did not recover current Action selection')
            require(discovered['scanned'] <= 50 and
                    (discovered['next_cursor'] is None or isinstance(discovered['next_cursor'], str)),
                    'Invalid bounded native Session page')
            report['checks'].append({'name': 'E4-native-session-discovery', 'status': 'PASS',
                                     'match': matching[0]['id'], 'scanned': discovered['scanned']})
            request(host, 'PATCH', f'/api/session/{reader}', {'archived': True})
            try:
                archived = s.invoke(asker, 'action', {'operation': 'sessions', 'archived': True, 'limit': 50})
                require(any(row['id'] == reader and row['archived'] for row in archived['sessions']),
                        'Native archive flag was not presented by read-only Loom inventory')
                report['checks'].append({'name': 'E4-native-archive-status', 'status': 'PASS',
                                         'qualification': 'Host archive changed only through native API; Loom read only'})
            finally:
                request(host, 'PATCH', f'/api/session/{reader}', {'archived': False})
            ask_start = len(events(root))
            q2 = s.invoke(asker, 'record', {'operation': 'ask', 'question': 'Blocking question, manual handling arranged',
                          'to_agent': 'question-respondent', 'blocking': True, 'context_attachments': ['fixture://blocking']})
            require(q2['action_id'] == action['id'] and q2['node_id'] == 'work', 'Selection association lost')
            no_contact(events(root)[ask_start:])
            before = request(host, 'GET', f'/api/session/{asker}')
            # Genuine public agent/model switch BEFORE production resume; no
            # target-row edits or hand-injected permission identity.
            request(host, 'POST', f'/api/session/{asker}/agent', {'agent': 'question-switched'})
            request(host, 'POST', f'/api/session/{asker}/model', {'model': {'providerID': 'question-fixture', 'id': 'switched'}})
            switched = request(host, 'GET', f'/api/session/{asker}')
            native_before = len(synthetic_events(root))
            resumed = s.invoke(respondent, 'record', {'operation': 'answer', 'question_id': q2['id'], 'answer': 'First committed answer only'})
            idle(host, [asker, respondent])
            time.sleep(.2)
            require(resumed['resume']['status'] == 'admission-observed', 'Native idle target resume not acknowledged: ' + str(resumed.get('resume')))
            admitted = synthetic_events(root)[native_before:]
            verify_single_admission(admitted, asker, resumed['id'])
            after = request(host, 'GET', f'/api/session/{asker}')
            report['target_switch'] = {'before': before, 'switched': switched, 'after_resume': after}
            require(after['agent'] == switched['agent'] and after['model'] == switched['model'], 'Resume overrode native current agent/model')
            require(any(e['data']['agent'] == 'question-switched' for e in target_requests(root, asker)), 'No actual switched-agent model consumption observed')
            allowed_catalogs = [e['data'].get('tools', []) for e in events(root) if e['type'] == 'provider-request' and e['data']['role'] == 'asker']
            denied_requests = [e['data'] for e in events(root) if e['type'] == 'provider-request' and e['data']['role'] == 'switched']
            require(any(any(t['name'] == 'shell' for t in catalog) for catalog in allowed_catalogs), 'Countercheck used an unknown native tool')
            # OpenCode 2.2.0 keeps its built-in skill tool visible to a deny-all agent,
            # but it must still reject actual skill execution via Permission.assert.
            # Never treat mere visibility as permission, or relax the shell absence oracle.
            require(denied_requests and all({t['name'] for t in e.get('tools', [])} == {'skill'} for e in denied_requests),
                    'Native switched deny-all catalog exposed more than the separately guarded skill tool')
            def results_for(name):
                return [c.get('output', {}).get('value', '') for e in denied_requests for message in e['prompt']
                        if message['role'] == 'tool' for c in message['content'] if c.get('toolName') == name]
            require(any(json.loads(v).get('error', {}).get('message') == 'No tool named "shell" is currently available. Please use a tool from the available tool list.'
                        for v in results_for('shell')),
                    'No real native rejection of forbidden shell tool call observed')
            require(any(json.loads(v).get('error') == {'type': 'permission.rejected', 'message': 'Permission denied: skill'}
                        for v in results_for('skill')),
                    'Visible skill tool bypassed native deny-all permission or returned a non-permission error')
            report['native_policy_countercheck'] = {'status': 'PASS', 'meaning': 'Deny-all native agent omitted shell, rejected shell invocation, and denied visible skill execution through the real permission boundary'}
            report['checks'].append({'name': 'E2-idle-switched-native-resume', 'status': 'PASS', 'outcome': resumed['resume'],
                                     'native_admissions': len(admitted), 'consumption': 'Observed switched-agent model request, not comprehension/completion',
                                     'initial_agent': before['agent']})
            prior_requests = len(target_requests(root, asker))
            later = s.invoke(respondent, 'record', {'operation': 'answer', 'question_id': q2['id'], 'answer': 'Later answer cannot wake'})
            require('resume' not in later and len(synthetic_events(root)) == native_before + 1, 'Later answer repeated input')
            require(len(target_requests(root, asker)) == prior_requests, 'Later answer woke target without a new durable write')
            # Legacy and nonblocking answers: actual native admission and model
            # counters remain unchanged, not just successful-write counts.
            old_ids = json.loads((repo / 'tests/fixtures/baseline-c9ffcfa/ids.json').read_text())
            legacy = s.invoke(respondent, 'record', {'operation': 'answer', 'question_id': old_ids['question']['id'], 'answer': 'New answer to legacy question is stored only'})
            require('resume' not in legacy and len(synthetic_events(root)) == native_before + 1, 'Legacy answer gained current consent')
            missing_asker = s.session('asker')
            missing_q = s.invoke(missing_asker, 'record', {'operation': 'ask', 'question': 'Delete exact target through native API', 'to_agent': 'question-respondent', 'blocking': True})
            request(host, 'DELETE', f'/api/session/{missing_asker}')
            failed = s.invoke(respondent, 'record', {'operation': 'answer', 'question_id': missing_q['id'], 'answer': 'Durable despite missing target'})
            require(failed['resume']['status'] == 'not-attempted' and not failed['resume']['attempted'], 'Missing target did not fail without retarget')
            failed_later = s.invoke(respondent, 'record', {'operation': 'answer', 'question_id': missing_q['id'], 'answer': 'Never transfer failed firstness'})
            require('resume' not in failed_later and len(synthetic_events(root)) == native_before + 1, 'Failed firstness transferred/retried')
            report['checks'].append({'name': 'E2-later-legacy-missing-failed-first', 'status': 'PASS', 'failed_first_outcome': failed['resume']})
            for variant, hold in [('running', 'before'), ('preyield', 'after')]:
                target = s.session('asker')
                question_input = {'operation': 'ask', 'question': 'Real ' + variant + ' boundary', 'to_agent': 'question-respondent', 'blocking': True}
                if variant == 'running':
                    question = s.invoke(target, 'record', question_input)
                    job, _ = s.begin(target, 'return "Local provider running boundary"', hold)
                else:
                    job, offset = s.begin(target, call('record', question_input), hold)
                s.await_event(lambda e, job=job: e['type'] == 'provider-held' and e['data']['job'] == job)
                require(target in request(host, 'GET', '/api/session/active'), 'Target not genuinely running at ' + variant)
                if variant == 'preyield':
                    produced = [e for e in events(root)[offset:] if e['type'] == 'tool-after' and e['data']['tool'] == 'loom_record' and e['data']['status'] == 'completed']
                    require(len(produced) == 1, 'Preyield question was not really committed through native tool')
                    question = result_value(produced[0])
                count = len(synthetic_events(root))
                try:
                    answer_job, answer_start = s.begin(respondent, call('record', {'operation': 'answer', 'question_id': question['id'], 'answer': 'First at ' + variant}))
                    # Release the external provider barrier after the actual
                    # production answer callback returns, not after the native
                    # respondent's entire agent loop becomes idle. Waiting for
                    # the latter can deadlock the fixture's held target loop.
                    answered = s.await_event(lambda e, question=question: e['type'] == 'tool-after' and e['data']['sessionID'] == respondent
                                             and e['data']['tool'] == 'loom_record' and e['data']['input'].get('question_id') == question['id'])
                    require(answered['data']['status'] == 'completed', 'Native answer callback failed at ' + variant)
                finally:
                    s.release(job)
                answer = s.finish(respondent, answer_job, answer_start, 'record')
                idle(host, [target, respondent])
                require(answer['resume']['status'] == 'admission-observed', 'Unacknowledged ' + variant + ' admission')
                inputs = synthetic_events(root)[count:]
                require(len(inputs) == 1 and inputs[0]['data']['sessionID'] == target, 'Wrong/duplicate ' + variant + ' admission')
                require(any(e['type'] == 'provider-inputs' and e['data']['role'] == 'asker'
                            and any(n['answer'] == answer['id'] for n in e['data']['notices']) for e in events(root)), 'No real provider consumption at ' + variant)
                settled = len(target_requests(root, target))
                s.invoke(respondent, 'record', {'operation': 'answer', 'question_id': question['id'], 'answer': 'Later at ' + variant})
                require(len(synthetic_events(root)) == count + 1 and len(target_requests(root, target)) == settled, 'Later ' + variant + ' answer woke target')
                report['checks'].append({'name': 'E2-' + variant, 'status': 'PASS', 'native_admissions': 1,
                                         'target': target, 'outcome': answer['resume']})
            moved = s.session('asker')
            moved_q = s.invoke(moved, 'record', {'operation': 'ask', 'question': 'Publicly moved exact target', 'to_agent': 'question-respondent', 'blocking': True})
            moved_directory = root / 'moved-project'
            moved_directory.mkdir()
            subprocess.run(['git', 'init', '-q', str(moved_directory)], env=env, check=True)
            request(host, 'POST', f'/api/session/{moved}/move', {'directory': str(moved_directory)})
            count = len(synthetic_events(root))
            moved_answer = s.invoke(respondent, 'record', {'operation': 'answer', 'question_id': moved_q['id'], 'answer': 'Never retarget a moved asker'})
            require(moved_answer['resume']['status'] == 'not-attempted' and len(synthetic_events(root)) == count, 'Moved target retargeted/admitted')
            s.invoke(respondent, 'record', {'operation': 'answer', 'question_id': moved_q['id'], 'answer': 'No transfer after move failure'})
            require(len(synthetic_events(root)) == count, 'Moved failure later retried')
            report['checks'].append({'name': 'E2-public-moved-target', 'status': 'PASS', 'outcome': moved_answer['resume']})
            # Large new Unicode state is produced through the REAL installed ask
            # entrypoint, never by injecting already-rendered records.
            long_text = '😀漢字é # <tag> ``` \\ \t\r\n\u202e'
            large = s.invoke(reader, 'record', {'operation': 'ask', 'question': long_text * 100, 'to_agent': 'question-respondent', 'blocking': False,
                             'context_attachments': ['fixture://' + str(i) + '/' + '😀' * 740 for i in range(20)]})
            large_answer = s.invoke(respondent, 'record', {'operation': 'answer', 'question_id': large['id'], 'answer': 'Later direct answer'})
            pages, records = traverse(s, respondent, {'session_id': reader, 'limit': 1})
            require([r['id'] for r in records] == [large['id'], large_answer['id']], 'Session relation lost later author or invented recipient receipt')
            require(records[0]['data']['question'] == long_text * 100 and records[0]['data']['context_attachments'] == large['data']['context_attachments'], 'Escaped parts lost stored Unicode/text')
            require(len(pages) > 2, 'Large continuation not exercised')
            assert_rejected(s, respondent, [{'operation': 'query', 'view': 'full_thread', 'session_id': asker, 'cursor': pages[0]['next_cursor']},
                            {'operation': 'query', 'view': 'full_thread', 'session_id': reader, 'cursor': 'invalid'}])
            report['checks'].append({'name': 'E3-new-unicode-relational-parts', 'status': 'PASS', 'pages': len(pages), 'records': len(records)})
            old_pages, old_records = traverse(s, reader, {'action_id': old_ids['action']['id'], 'limit': 20})
            expected = [json.loads(r['data']) for r in saved['tables']['ledger'] if r['action_id'] == old_ids['action']['id']]
            require([r['id'] for r in old_records] == [r['id'] for r in expected] + [legacy['id']], 'Independent frozen Action membership oracle differs')
            for stored, rendered in zip(expected, old_records):
                require(all(rendered.get(k) == v for k, v in stored.items()), 'Historical content/provenance changed in installed rendering')
            report['checks'].append({'name': 'E3-old-action-full-content-oracle', 'status': 'PASS', 'pages': len(old_pages), 'records': len(old_records)})
            frozen = [json.loads(r['data']) for r in saved['tables']['ledger']]
            authored = [r for r in frozen if r['session_id'] == 'synthetic-worker']
            asked = {r['id'] for r in authored if r['kind'] == 'question'}
            related = [r for r in frozen if r in authored or (r['kind'] == 'answer' and r['data']['question_id'] in asked)]
            _, worker_records = traverse(s, reader, {'session_id': 'synthetic-worker'})
            require([r['id'] for r in worker_records] == [r['id'] for r in related] + [legacy['id']], 'Independent authored/asked/direct-later-answer Session oracle differs')
            node_expected = [r for r in expected if r.get('node_id') == 'work']
            _, node_records = traverse(s, reader, {'action_id': old_ids['action']['id'], 'node_id': 'work'})
            require([r['id'] for r in node_records] == [r['id'] for r in node_expected] + [legacy['id']], 'Independent historical node membership oracle differs')
            first_cursor = pages[0]['next_cursor']
            cursor_data = json.loads(base64.urlsafe_b64decode(first_cursor + '=' * (-len(first_cursor) % 4)))
            cursor_data['version'] = 'unsupported-harness-version'
            bad_version = base64.urlsafe_b64encode(json.dumps(cursor_data).encode()).decode().rstrip('=')
            assert_rejected(s, reader, [{'operation': 'query', 'view': 'full_thread', 'session_id': reader, 'cursor': bad_version}])
            # Explicit corruption fault, then restore exact bytes. It is NOT an
            # upstream-produced history value or a preservation prerequisite.
            with closing(sqlite3.connect(ledger)) as db, db:
                original = db.execute('SELECT data FROM ledger WHERE id=?', (large['id'],)).fetchone()[0]
                db.execute("UPDATE ledger SET data='{}' WHERE id=?", (large['id'],))
            try:
                assert_rejected(s, respondent, [{'operation': 'query', 'view': 'full_thread', 'session_id': reader, 'cursor': first_cursor}])
            finally:
                with closing(sqlite3.connect(ledger)) as db, db:
                    db.execute('UPDATE ledger SET data=? WHERE id=?', (original, large['id']))
            retry_page = s.invoke(respondent, 'record', {'operation': 'query', 'view': 'full_thread', 'session_id': reader, 'limit': 1, 'cursor': first_cursor})
            require(retry_page == pages[1], 'Corrupt read advanced or changed the cursor')
            report['checks'].append({'name': 'E3-node-session-oracles-cursor-corrupt-no-advance', 'status': 'PASS',
                                     'qualification': 'Corruption is an explicit disposable supporting fault, restored byte-exactly'})
            unchanged_rows(ledger, saved)
            report['checks'].append({'name': 'E3-populated-startup-raw-preservation', 'status': 'PASS'})
            verify_provider_inputs(events(root))
            # Assembled OpenCode 2.2.0 context/compaction regression using the
            # real native runner and real tool observer; only the model is scripted.
            # Earlier E1-E3 ran capture=off; the observer correctly remembers that
            # uncertainty for this process lifetime. Start a fresh owned host
            # with capture enabled before testing positive pairing.
            admission_before = len(synthetic_events(root))
            model_before = sum(e['type'] == 'model-request' for e in events(root))
            host.close(); host = None
            (project / '.loom.yaml').write_text(
                'agents:\n  question-reader:\n    roles: [implementation]\n'
                'ledger:\n  capture: automatic\n')
            host = start('compaction-fresh-capture')
            require(len(synthetic_events(root)) == admission_before and
                    sum(e['type'] == 'model-request' for e in events(root)) == model_before,
                    'Fresh capture host replayed native work during restart')
            s = Scenario(host, root)
            compaction_session = s.session('reader')
            compaction_action = s.invoke(compaction_session, 'action', {
                'operation': 'create', 'title': 'Compaction qualification', 'goal': 'Preserve Action context and tool evidence'
            })
            s.invoke(compaction_session, 'context', {'action_id': compaction_action['id']})
            s.invoke(compaction_session, 'record', {'operation': 'add', 'kind': 'claim',
                                                    'statement': 'Context should survive native compaction'})
            pre_compaction = [e for e in events(root) if e['type'] == 'provider-request' and e['data']['role'] == 'reader']
            require(any(compaction_action['id'] in json.dumps(e['data']['prompt']) and
                        'loom:context:v2' in json.dumps(e['data']['prompt']) for e in pre_compaction),
                    'Live model request did not contain current Loom Action context before compaction')
            compact_from = len(events(root))
            request(host, 'POST', f'/api/session/{compaction_session}/compact', {})
            idle(host, [compaction_session])
            time.sleep(.2)
            compaction_events = [e for e in events(root)[compact_from:]
                                 if e['type'] == 'native-event' and e['data']['type'] == 'session.compaction.ended'
                                 and e['data']['data']['sessionID'] == compaction_session]
            require(compaction_events, 'Native compaction did not complete on the installed 2.2.0 host')
            s.invoke(compaction_session, 'record', {'operation': 'add', 'kind': 'result',
                                                    'statement': 'Postcompaction native tool completed'})
            after_compaction = [e for e in events(root)[compact_from:]
                                if e['type'] == 'provider-request' and e['data']['role'] == 'reader'
                                and compaction_action['id'] in json.dumps(e['data']['prompt'])
                                and 'loom:context:v2' in json.dumps(e['data']['prompt'])]
            require(after_compaction, 'Action context was not injected after native compaction')
            with closing(sqlite3.connect(ledger)) as db:
                observed = [json.loads(row[0]) for row in db.execute(
                    "SELECT data FROM ledger WHERE action_id=? AND kind='observation'", (compaction_action['id'],))]
            require(any(row['data'].get('phase') == 'started' for row in observed) and
                    any(row['data'].get('phase') == 'finished' and row['data'].get('attribution') == 'captured-at-start'
                        for row in observed),
                    'Real tool observations were missing or unpaired around compaction')
            report['checks'].append({'name': 'E5-compaction-context-and-observation', 'status': 'PASS',
                                     'session': compaction_session, 'observation_count': len(observed),
                                     'qualification': 'Native compaction and postcompaction context on scripted local model; not production provider coverage'})
            if duplicate_control:
                # A genuine EXTRA native input, never another answer or product
                # callback. The same normal-run assertion must detect it even
                # when the external script has already stopped producing work.
                prior_count = len(target_requests(root, asker))
                request(host, 'POST', f'/api/session/{asker}/synthetic', {**admitted[0]['data']['item']['payload'], 'resume': True, 'delivery': 'steer'})
                idle(host, [asker])
                try:
                    verify_single_admission([e for e in synthetic_events(root) if e['data']['item']['payload']['metadata']['answer_id'] == resumed['id']], asker, resumed['id'])
                except RuntimeError as error:
                    require('duplicate' in str(error), 'Countercheck failed for unrelated reason')
                else:
                    raise RuntimeError('Native duplicate input escaped the normal-run oracle')
                require(len(target_requests(root, asker)) > prior_count, 'Extra native input did not actually request a model')
                try:
                    verify_provider_inputs(events(root))
                except RuntimeError as error:
                    require('Duplicate actionable notice' in str(error), 'Raw-input countercheck failed for unrelated reason')
                else:
                    raise RuntimeError('Duplicate actionable inputs escaped the raw provider oracle')
                report['checks'].append({'name': 'negative-control-real-extra-native-input', 'status': 'PASS',
                                         'injection_flag': '--duplicate-input-control',
                                         'inputs': [{'event_id': e['id'], 'inbox_id': e['data']['inboxID'], 'target': e['data']['sessionID']}
                                                    for e in synthetic_events(root) if e['data']['item']['payload']['metadata']['answer_id'] == resumed['id']],
                                         'meaning': 'DELIBERATE extra native input DETECTED by normal assertion despite unchanged answer count/script no-op; not accidental product retry or global permission-fidelity proof'})
            # Restart must never reconstruct old or new eligibility. No model
            # prompt is sent to test startup; read-only probes do not wake work.
            host.close(); host = None
            count = len(synthetic_events(root))
            model_count = sum(e['type'] == 'model-request' for e in events(root))
            host = start('restart')
            time.sleep(.2)
            require(len(synthetic_events(root)) == count and sum(e['type'] == 'model-request' for e in events(root)) == model_count, 'Startup replayed native work')
            unchanged_rows(ledger, saved)
            report['checks'].append({'name': 'E2-E3-restart-no-reconstruction', 'status': 'PASS'})
            require(not any(e['type'] == 'observer-failure' for e in events(root)), 'Passive native admission observation failed; zero-event claims invalid')
            report['checks'].append(dict(READ_DENIAL_APPLICABILITY))
            report['component_obligation'] = {'status': 'SEPARATE COMPONENT PROOF REQUIRED',
                                             'command': 'bun test tests/question-host/get-rejection.test.ts',
                                             'boundary': 'SDK session.get rejection through production registered answer/adapter after actual commit; never installed PASS evidence'}
            report['status'] = qualification_status(report['checks'], '2.2.0')
        except Exception as error:  # noqa: BLE001 -- persist any failed qualification scenario in its report.
            report['status'] = 'FAIL'
            report['error'] = f'{type(error).__name__}: {error}'
        finally:
            if host:
                host.close()
                report['owned_process_dead'] = host.proc.poll() is not None
            for owned in owned_hosts:
                if owned.proc.poll() is None:
                    owned.close()
            for identity, owned in zip(report['owned_hosts'], owned_hosts):
                identity['process_dead'] = owned.proc.poll() is not None
            if (root / 'audit.ndjson').exists():
                shutil.copy2(root / 'audit.ndjson', output / 'audit.ndjson')
            report['activity'] = {kind: sum(e['type'] == kind for e in events(root)) for kind in ['model-request', 'provider-request', 'tool-before', 'tool-after', 'prompt']}
    report['private_root_removed'] = not Path(report['private_root']).exists()
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--opencode', type=Path, required=True)
    parser.add_argument('--report-directory', type=Path, required=True)
    parser.add_argument('--repository', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--artifact', type=Path, required=True, help='Exact npm candidate tarball installed at --plugin')
    parser.add_argument('--plugin', type=Path, required=True, help='Installed candidate plugin directory')
    parser.add_argument('--expect-plugin-version', required=True)
    parser.add_argument('--expect-sdk-version', default='2.2.0')
    parser.add_argument('--disable-filewatcher', action='store_true', help='Owned disposable host only; watcher behavior not qualified')
    parser.add_argument('--duplicate-input-control', action='store_true', help='Inject one real extra native input and require the normal oracle to reject it')
    args = parser.parse_args()
    report = run(str(args.opencode.resolve()), args.repository.resolve(), args.report_directory.resolve(),
                 args.artifact.resolve(), args.plugin.resolve(), args.expect_plugin_version,
                 args.expect_sdk_version, args.disable_filewatcher, args.duplicate_input_control)
    print(json.dumps(report, indent=2))
    if report['status'] != 'PASS':
        parser.exit(1, 'Installed question qualification incomplete or failed; inspect report.json\n')


if __name__ == '__main__':
    main()
