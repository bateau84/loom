#!/usr/bin/env python3
"""Independent installed readback qualification. All source creation uses native tools.

Only the external provider is scripted. SQLite is observed read-only until the
explicit stopped-host original-source fault stimuli at the end.
"""
from __future__ import annotations
import argparse
import hashlib
import shlex
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import traceback
from contextlib import closing



def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def chars(value):
    return len(json.dumps(value, separators=(',', ':'), ensure_ascii=False))


def ro(path):
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    db.execute('PRAGMA query_only=ON')
    return db


def main(args):
    REPO = args.repository.resolve()
    OUT = args.report_directory.resolve()
    ROOT = OUT / 'private'
    HOST = args.opencode.resolve()
    PLUGIN = args.plugin.resolve()
    ARTIFACT = args.artifact.resolve()
    SHA = args.expect_head
    sys.path.insert(0, str(REPO / 'tests'))
    from installed_host_smoke import PrivateHost, isolated_environment, installed_plugin_inventory, require
    from installed_questions import Scenario, audit_session, final_events, request, result_value
    from installed_learning_stage3 import make_session, until, view
    OUT.mkdir(parents=True, exist_ok=False, mode=0o700)
    ROOT.mkdir(parents=True, exist_ok=False, mode=0o700)
    project = ROOT / 'project'
    project.mkdir()
    result = {'status': 'UNPROVEN', 'source_head': SHA,
              'kind': 'independent-installed-stage3-supplement',
              'external_substitution': 'scripted provider only; real native host, plugin, tools, scheduler and SQLite',
              'q4': 'UNQUALIFIED', 'q5': 'UNQUALIFIED', 'e11': 'NO-GO / UNPROVEN',
              'genuine_evaluator_reasoning': 'UNPROVEN', 'checks': [],
              'command': shlex.join([sys.executable, *sys.argv]),
              'started_at_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    host = None
    env = isolated_environment(ROOT)
    env['LOOM_QUESTION_FIXTURE'] = str(ROOT)
    config = {
        'plugins': ['*', str(PLUGIN), str(REPO / 'tests/question-host')],
        'agents': {
            name: {'description': 'Private independent mechanics qualification', 'mode': 'primary',
                   'system': 'Execute the locally scripted qualification job.',
                   'model': 'question-fixture/reader',
                   'permissions': [{'action': '*', 'resource': '*', 'effect': 'allow'}] +
                                  ([{'action': 'read', 'resource': '*ledger.sqlite', 'effect': 'deny'}]
                                   if name == 'restricted' else [])}
            for name in ('general', 'restricted')},
        'model': 'question-fixture/reader', 'update': 'disable', 'share': 'disabled'}
    (Path(env['OPENCODE_CONFIG_DIR']) / 'opencode.json').write_text(json.dumps(config))
    capture = project / '.loom.yaml'
    capture.write_text('instructions: {enabled: false}\nledger: {capture: off}\n')
    (ROOT / 'jobs.json').write_text('{}')
    subprocess.run(['git', 'init', '-q', str(project)], check=True, env=env)

    def save():
        (OUT / 'report.json').write_text(json.dumps(result, indent=2) + '\n')

    def check(name, **receipt):
        result['checks'].append({'name': name, 'status': 'PASS', **receipt})
        print('PASS ' + name, flush=True)
        save()

    def boot(label):
        h = PrivateHost(str(HOST.resolve()), project, env, OUT, label)
        require(json.loads(h.get('/api/info', 'info'))['version'] == '2.2.6', 'Wrong actual host')
        h.wait_roster('/api/plugin', 'plugins', lambda rows: all(any(
            item.get('id') == identity and item.get('state', {}).get('status') == 'active'
            for item in rows) for identity in ('loom', 'loom.question.fixture')))
        return h

    try:
        actual = subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip()
        require(actual == SHA, 'Source head changed')
        require(not subprocess.check_output(['git', '-C', str(REPO), 'status', '--porcelain'], text=True).strip(), 'Source checkout is dirty')
        result['candidate'] = installed_plugin_inventory(ARTIFACT, PLUGIN, args.expect_plugin_version, '2.2.6')
        runtime = [REPO / 'server.ts', *[p for p in (REPO / 'src').rglob('*') if p.is_file()]]
        require(all(digest(p) == digest(PLUGIN / p.relative_to(REPO)) for p in runtime), 'Packed production runtime differs')
        result['runtime_files_checked'] = len(runtime)
        result['host_version'] = subprocess.check_output([str(HOST), '--version'], text=True, env=env).strip()
        result['host_sha256'] = digest(HOST.resolve())
        result['script_sha256'] = digest(__file__)
        with audit_session(ROOT) as audit:
            try:
                host = boot('creation')
                s = Scenario(host, ROOT)
                owner = make_session(host, project, 'general')
                foreign = make_session(host, project, 'general')
                result['sessions'] = {'owner': owner, 'foreign': foreign}
                learning = next(Path(env['XDG_STATE_HOME']).rglob('learning.sqlite'))
                ledger = next(Path(env['XDG_STATE_HOME']).rglob('ledger.sqlite'))
                result['databases'] = {'learning': str(learning), 'ledger': str(ledger)}
                action = s.invoke(owner, 'action', {'operation': 'create', 'title': 'Independent large authored review', 'goal': 'Reconstruct all frozen observations'})
                plan = [{'id': 'task-' + str(i), 'kind': 'task', 'title': 'Artifact ' + str(i),
                         'outcome': 'Original acceptance contract ' + 'a' * 1500} for i in range(100)]
                s.invoke(owner, 'plan', {'operation': 'save', 'action_id': action['id'], 'expected_revision': 0, 'nodes': plan})
                work = []
                for offset in range(0, 100, 20):
                    code = 'for(let i=' + str(offset) + ';i<' + str(offset+20) + ';i++){await tools.loom.context({action_id:' + json.dumps(action['id']) + ',node_id:"task-"+i});}return 20;'
                    receipts = s.command(owner, code)
                    got = [result_value(e)['work_ref'] for e in receipts if e['type'] == 'tool-after'
                           and e['data'].get('tool') in ('loom_context', 'loom.context') and e['data'].get('status') == 'completed']
                    require(len(got) == 20, 'Missing native work references')
                    work += got
                    print('Native work references ' + str(len(work)), flush=True)
                request_id = 'independent-large-review'
                member_ids = ['member-' + str(i).zfill(3) + '-' + 'm'*109 for i in range(100)]
                frozen = {'format': 'loom-review-request/v1', 'request_id': request_id,
                    'mandate': {'question': 'Inspect this exact frozen authored population', 'dimensions': ['correctness'],
                                'criteria': [{'text': 'Keep all original evidence and identities', 'source_ref': None}],
                                'mode': 'independent', 'inclusions': [], 'exclusions': []},
                    'intended_recipient': {'agent': 'reviewer', 'session_id': None},
                    'members': [{'member_id': member_ids[i], 'work_ref': work[i], 'producing_attempt_refs': [],
                                 'artifact_refs': [{'locator': '/private/artifact-' + str(i) + '-' + 'a'*350,
                                                    'version': {'kind': 'sha256', 'value': str(i).zfill(64)}, 'content_ref': None}],
                                 'prior_review_request_id': None, 'membership_source_refs': [],
                                 'gaps': [{'reason': 'source-missing', 'source_ref': None}]} for i in range(100)],
                    'rechecks': []}
                require(s.invoke(owner, 'review', {'operation': 'freeze', 'request': frozen})['status'] == 'created', 'Native review not frozen')
                relation_ids = []
                record_ids = []
                for offset in range(0, 80, 10):
                    code = 'const ids=' + json.dumps(member_ids) + ';for(let i=' + str(offset) + ';i<' + str(offset+10) + ';i++){const r=JSON.parse(await tools.loom.record({operation:"add",session_only:true,kind:"result",statement:"Independent authored finding "+i})).result;await tools.loom.review({operation:"relate",request_id:' + json.dumps(request_id) + ',relationship:"finding",source_record_id:r.id,member_ids:ids});}return 10;'
                    receipts = s.command(owner, code)
                    rels = [result_value(e)['id'] for e in receipts if e['type'] == 'tool-after'
                            and e['data'].get('tool') in ('loom_review', 'loom.review') and e['data'].get('status') == 'completed']
                    records = [result_value(e)['id'] for e in receipts if e['type'] == 'tool-after'
                            and e['data'].get('tool') in ('loom_record', 'loom.record') and e['data'].get('status') == 'completed']
                    require(len(rels) == 10 and len(records) == 10, 'Incomplete native original generation')
                    relation_ids += rels
                    record_ids += records
                    print('Native authored findings ' + str(len(relation_ids)), flush=True)
                require(view(learning, owner).get('batch') is None, 'Capture-off unexpectedly evaluated source')
                host.close(); host = None
                final_events(ROOT)
                capture.write_text('instructions: {enabled: false}\nledger: {capture: automatic}\n')
                host = boot('automatic')
                s = Scenario(host, ROOT)
                state = until(learning, owner, lambda v: v.get('batch') and v['batch'][1] == 'complete'
                              and v.get('observations', {}).get('review-finding', 0) == 80,
                              'All native review findings automatically published', timeout=120)
                batch = state['batch'][0]
                result['batch_id'] = batch
                with closing(ro(learning)) as db:
                    rows = db.execute('SELECT m.key,r.id,r.sha256,r.body_json FROM learning_evaluation_members m JOIN learning_evaluation_reports r ON r.id=m.report_id WHERE m.batch_id=? ORDER BY m.ordinal', (batch,)).fetchall()
                originals = {key: {'id': ident, 'sha256': checksum, 'body': json.loads(body), 'stored_chars': len(body)} for key, ident, checksum, body in rows}
                target = 'review:' + request_id + ':0'
                require(originals[target]['stored_chars'] > 262144, 'Generated review did not cross actual public read budget')
                single = s.invoke(owner, 'insights', {'operation': 'evaluation', 'batch_id': batch, 'member_key': target})
                require(single['report']['id'] == originals[target]['id'] and single['report']['body'] is None
                        and single['report']['body_paginated'] is True and single['report']['availability'] == 'available',
                        'Oversized native read did not advertise stable observation paging')
                pages = []; obtained = []; after = 0
                while True:
                    page = s.invoke(owner, 'insights', {'operation': 'evaluation-observations', 'batch_id': batch, 'member_key': target,
                                                     'report_id': originals[target]['id'], 'after': after, 'limit': 200})
                    require(page['report_id'] == originals[target]['id'] and page['report_sha256'] == originals[target]['sha256'], 'Observation identity changed')
                    require(page['availability'] == 'available' and page['items'] and chars(page) <= 262144, 'Unbounded or empty successful observation page')
                    pages.append(page); obtained += page['items']
                    if page['next_after'] is None: break
                    require(page['next_after'] > after, 'Observation cursor stalled')
                    after = page['next_after']
                require(obtained == originals[target]['body']['observations'], 'Observation reconstruction differs from complete durable source-derived body')
                require(len(pages) > 1 and len({(x['source']['kind'], x['source']['id']) for x in obtained}) == len(obtained), 'No discriminating multi-page reconstruction')
                (OUT / 'large-observation-pages.json').write_text(json.dumps(pages, indent=2))
                (OUT / 'stored-large-member.json').write_text(json.dumps(originals[target], indent=2))
                check('F06-native-large-observation-complete-reconstruction', stored_body_chars=originals[target]['stored_chars'],
                      report_id=originals[target]['id'], report_sha256=originals[target]['sha256'],
                      observations=len(obtained), pages=len(pages), page_chars=[chars(p) for p in pages], no_duplicates=True)

                member_pages = []; seen = {}; after = 0
                while True:
                    page = s.invoke(owner, 'insights', {'operation': 'evaluation-members', 'batch_id': batch, 'after': after, 'limit': 100})
                    require(page['items'] and chars(page) <= 262144, 'Member page unbounded or empty')
                    for item in page['items']:
                        require(item['key'] not in seen, 'Member repeated')
                        seen[item['key']] = item
                    member_pages.append(page)
                    if page['next_after'] is None: break
                    require(page['next_after'] > after, 'Member cursor stalled')
                    after = page['next_after']
                require(set(seen) == set(originals), 'Member paging omitted durable population')
                fitting = {key: item for key, item in originals.items() if item['stored_chars'] < 262144}
                require(sum(x['stored_chars'] for x in fitting.values()) > 262144, 'Combined fitting member bodies do not exceed cap')
                reconstructed = 0
                for key, item in seen.items():
                    report = item['report']
                    if not report.get('body_paginated'):
                        require(report['body'] == originals[key]['body'], 'Inline member differs')
                        continue
                    after = 0; observed = []
                    while True:
                        p = s.invoke(owner, 'insights', {'operation': 'evaluation-observations', 'batch_id': batch,
                                                        'member_key': key, 'report_id': report['id'], 'after': after, 'limit': 200})
                        require(chars(p) <= 262144 and p['availability'] == 'available', 'Deferred member page failed')
                        observed += p['items']
                        if p['next_after'] is None: break
                        require(p['next_after'] > after, 'Deferred observation cursor stalled')
                        after = p['next_after']
                    require(observed == originals[key]['body']['observations'], 'Deferred body reconstruction lost data')
                    reconstructed += 1
                (OUT / 'member-pages.json').write_text(json.dumps(member_pages, indent=2))
                check('F07-native-combined-members-bounded-and-complete', members=len(seen), member_pages=len(member_pages),
                      page_chars=[chars(p) for p in member_pages], individually_fitting_members=len(fitting),
                      combined_fitting_body_chars=sum(x['stored_chars'] for x in fitting.values()),
                      deferred_bodies_reconstructed=reconstructed)

                params = {'operation': 'evaluation-observations', 'batch_id': batch, 'member_key': target,
                          'report_id': originals[target]['id'], 'limit': 1}
                def denied(session, value):
                    receipts = s.command(session, 'let rejected=false;try{await tools.loom.insights(' + json.dumps(value) + ')}catch(e){rejected=true}if(!rejected)throw new Error("Expected native denial");return "denied";')
                    native = [e for e in receipts if e['type'] == 'tool-after' and e['data'].get('tool') in ('loom_insights', 'loom.insights')]
                    require(len(native) == 1 and native[0]['data']['status'] == 'error', 'No actual native denied read receipt')
                denied(foreign, params)
                denied(owner, {**params, 'report_id': 'wrong-report-identity'})
                denied(owner, {**params, 'after': -1})
                request(host, 'POST', f'/api/session/{owner}/agent', {'agent': 'restricted'})
                require(request(host, 'GET', f'/api/session/{owner}')['agent'] == 'restricted', 'Native permission withdrawal not applied')
                for value in (params, {'operation': 'evaluation-members', 'batch_id': batch}, {'operation': 'evaluation-sources', 'batch_id': batch, 'member_key': target}):
                    denied(owner, value)
                request(host, 'POST', f'/api/session/{owner}/agent', {'agent': 'general'})
                intact = s.invoke(owner, 'insights', params)
                require(intact['report_id'] == originals[target]['id'] and intact['availability'] == 'available', 'Reauthorized stable historical report unavailable')
                check('native-paged-reader-permission-and-identity-denials', foreign_session=True,
                      wrong_report_id=True, invalid_cursor=True, same_session_revoked_readers=['evaluation-observations', 'evaluation-members', 'evaluation-sources'],
                      reauthorized_same_report=True)

                host.close(); host = None
                final_events(ROOT)
                with sqlite3.connect(ledger) as db:
                    raw = db.execute('SELECT data FROM review_relationships WHERE id=?', (relation_ids[0],)).fetchone()[0]
                    data = json.loads(raw)
                    data['member_ids'] = data['member_ids'][:1]
                    db.execute('UPDATE review_relationships SET data=? WHERE id=?', (json.dumps(data, separators=(',', ':')), relation_ids[0]))
                host = boot('damaged-original')
                s = Scenario(host, ROOT)
                damaged = s.invoke(owner, 'insights', params)
                require(damaged['availability'] == 'source-unavailable' and damaged['items'] == [] and damaged['observation_count'] is None and damaged['next_after'] is None,
                        'Changed original allowed derived observation body')
                overall = s.invoke(owner, 'insights', {'operation': 'evaluation', 'batch_id': batch})
                require(overall['report']['availability'] == 'source-unavailable' and overall['report']['body'] is None, 'Changed original allowed overall derived body')
                second_target = 'review:' + request_id + ':32'
                second = {'operation': 'evaluation-observations', 'batch_id': batch, 'member_key': second_target,
                          'report_id': originals[second_target]['id'], 'limit': 1}
                require(s.invoke(owner, 'insights', second)['availability'] == 'available', 'Independent untouched member was not readable before missing-source stimulus')
                (OUT / 'damaged-source-readback.json').write_text(json.dumps({'observation_page': damaged, 'overall': overall}, indent=2))
                check('damaged-original-withholds-dependent-bodies', fault='stopped-host change to original relationship member_ids',
                      original_relationship=relation_ids[0], observation_items=0, overall_body=None,
                      unaffected_member_remains_available=second_target)

                host.close(); host = None
                final_events(ROOT)
                with sqlite3.connect(ledger) as db:
                    require(db.execute('DELETE FROM review_relationships WHERE id=?', (relation_ids[20],)).rowcount == 1, 'Missing-source stimulus did not delete one original')
                host = boot('missing-original')
                s = Scenario(host, ROOT)
                missing = s.invoke(owner, 'insights', second)
                require(missing['availability'] == 'source-unavailable' and missing['items'] == [] and missing['observation_count'] is None,
                        'Missing original allowed dependent derived observations')
                sources = s.invoke(owner, 'insights', {'operation': 'evaluation-sources', 'batch_id': batch, 'member_key': second_target, 'limit': 200})
                require(any(item['id'] == relation_ids[20] and item['available'] is False for item in sources['items']), 'Missing original not identified unavailable')
                (OUT / 'missing-source-readback.json').write_text(json.dumps({'observation_page': missing, 'source_page': sources}, indent=2))
                check('missing-original-withholds-dependent-observations', fault='stopped-host delete of one original relationship',
                      original_relationship=relation_ids[20], dependent_member=second_target, observation_items=0,
                      unavailable_source_identified=True)
                with closing(ro(learning)) as db:
                    duplicate = db.execute('SELECT COUNT(*) FROM learning_evaluation_reports WHERE batch_id=? AND member_key=?', (batch, target)).fetchone()[0]
                    final_identity = db.execute('SELECT id,sha256 FROM learning_evaluation_reports WHERE batch_id=? AND member_key=?', (batch, target)).fetchone()
                require(duplicate == 1 and final_identity == (originals[target]['id'], originals[target]['sha256']), 'Read/restart/fault replaced or duplicated historical report')
                check('historical-report-identity-no-duplicate-after-read-restart-and-source-loss', publications=duplicate,
                      report_id=final_identity[0], report_sha256=final_identity[1])
                result['status'] = 'PASS'
            finally:
                if host is not None:
                    host.close(); host = None
                captured = audit.finalize(OUT / 'audit.ndjson')
                result['audit_sha256'] = captured.sha256
                result['audit_bytes'] = captured.byte_count
                result['audit_receipts'] = len(captured.events)
    except Exception as e:
        result['status'] = 'FAIL'
        result['error'] = type(e).__name__ + ': ' + str(e)
        (OUT / 'exception.txt').write_text(traceback.format_exc())
        print(result['error'], flush=True)
    finally:
        result['finished_at_utc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        save()
    print(json.dumps({'status': result['status'], 'checks': len(result['checks']), 'error': result.get('error')}), flush=True)
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--opencode', type=Path, required=True)
    parser.add_argument('--plugin', type=Path, required=True)
    parser.add_argument('--artifact', type=Path, required=True)
    parser.add_argument('--expect-head', required=True)
    parser.add_argument('--expect-plugin-version', default='2.0.0-alpha.1')
    parser.add_argument('--report-directory', type=Path, required=True)
    raise SystemExit(main(parser.parse_args()))
