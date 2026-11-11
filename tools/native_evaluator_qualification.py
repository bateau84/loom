#!/usr/bin/env python3
"""Collect private Evaluator audit receipts without inference or an invented PASS.

This checks supplied local observer receipts, not their authenticity. Different
observer instances are not proof of a host reboot. Reasoning, source authenticity,
provider delivery, authorization and billing require independent operator review.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

from native_evaluator_preflight import inspect_sources

FORMAT = 'loom-evaluator-observer/v1'
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}\Z')
HASH = re.compile(r'[a-f0-9]{64}\Z')
MAX_FILE = 1048576


def read_private(path: Path) -> bytes:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_FILE:
            raise ValueError('Expected bounded regular file')
        with os.fdopen(fd, 'rb', closefd=False) as source:
            raw = source.read(MAX_FILE + 1)
        after = os.fstat(fd)
        if len(raw) != before.st_size or (before.st_ino, before.st_size, before.st_mtime_ns,
                                        before.st_ctime_ns) != (after.st_ino, after.st_size,
                                                              after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError('Evidence changed during read')
        return raw
    finally:
        os.close(fd)


def identifier(value):
    return isinstance(value, str) and bool(ID.fullmatch(value))


def digest(value):
    return isinstance(value, str) and bool(HASH.fullmatch(value))


def read_log(path: Path) -> tuple[list[dict], str]:
    raw = read_private(path)
    if not raw.endswith(b'\n'):
        raise ValueError('Incomplete receipt file')
    rows = [json.loads(line) for line in raw.splitlines()]
    if not rows or len(rows) > 512:
        raise ValueError('Invalid receipt count')
    instance = rows[0].get('instance') if isinstance(rows[0], dict) else None
    if not identifier(instance):
        raise ValueError('Missing instance identity')
    for sequence, row in enumerate(rows, 1):
        if not isinstance(row, dict) or set(row) != {'format', 'instance', 'sequence', 'type', 'data'} or row['format'] != FORMAT or row['instance'] != instance or type(row['sequence']) is not int or row['sequence'] != sequence or not isinstance(row['data'], dict):
            raise ValueError('Invalid receipt envelope')
        data, kind = row['data'], row['type']
        if kind == 'ready':
            if sequence != 1 or set(data) != {'audit_session_id', 'recovery_session_id', 'host_version', 'bun_version', 'scope'} or not identifier(data['audit_session_id']) or (data['recovery_session_id'] is not None and not identifier(data['recovery_session_id'])) or data['scope'] != 'one-audit-and-recovery':
                raise ValueError('Invalid observer scope')
        elif kind in ('closed', 'limit', 'observation-gap'):
            if data:
                raise ValueError('Invalid diagnostic receipt')
            if kind in ('closed', 'limit') and sequence != len(rows):
                raise ValueError('Events after terminal observer receipt')
        else:
            common = {'session_id', 'agent', 'parent_session_id'}
            if not all(identifier(data.get(key)) for key in ('session_id', 'agent')) or (data.get('parent_session_id') is not None and not identifier(data['parent_session_id'])):
                raise ValueError('Invalid Session attribution')
            if kind == 'model-request':
                if set(data) != common | {'provider_id', 'model_id'} or not all(identifier(data[key]) for key in ('provider_id', 'model_id')):
                    raise ValueError('Invalid model receipt')
                continue
            common |= {'call_id', 'message_id'}
            if not all(identifier(data.get(key)) for key in ('call_id', 'message_id')):
                raise ValueError('Missing native tool identity')
            if kind == 'tool-failure':
                if set(data) != common | {'tool'} or data['tool'] not in ('skill', 'subagent', 'loom_record', 'loom.record', 'loom_trace', 'loom.trace'):
                    raise ValueError('Invalid tool failure')
                continue
            if kind != 'tool':
                raise ValueError('Unknown receipt type')
            common.add('kind')
            if data.get('kind') == 'skill':
                valid = set(data) == common | {'skill', 'delivered_result_sha256'} and data['skill'] == 'agent-run-audit' and digest(data['delivered_result_sha256'])
            elif data.get('kind') == 'delegation':
                valid = set(data) == common | {'child_session_id'} and identifier(data['child_session_id'])
            elif data.get('kind') == 'trace':
                valid = (set(data) == common | {'source_session_id', 'source', 'event_count', 'cursor_sha256', 'next_cursor_sha256'} and identifier(data['source_session_id']) and data['source'] in ('provided-export', 'native-context') and type(data['event_count']) is int and 0 <= data['event_count'] <= 50 and all(data[key] is None or digest(data[key]) for key in ('cursor_sha256', 'next_cursor_sha256')))
            elif data.get('kind') in ('record-write', 'record-read'):
                valid = (set(data) == common | {'record_id', 'action_id', 'writer_session_id', 'writer_agent', 'record_sha256', 'source_refs_sha256', 'source_ref_count'} and all(identifier(data[key]) for key in ('record_id', 'action_id', 'writer_session_id', 'writer_agent')) and all(digest(data[key]) for key in ('record_sha256', 'source_refs_sha256')) and type(data['source_ref_count']) is int and 0 <= data['source_ref_count'] <= 50)
            else:
                valid = False
            if not valid:
                raise ValueError('Invalid privacy projection')
    if rows[0]['type'] != 'ready':
        raise ValueError('Missing observer initialization')
    return rows, hashlib.sha256(raw).hexdigest()


def collect(log_paths: list[Path], parent_export: Path, child_exports: list[Path],
            agent_file: Path, skill_file: Path, record_id: str) -> dict:
    if not identifier(record_id) or not 1 <= len(log_paths) <= 4:
        raise ValueError('Invalid qualification scope')
    source = inspect_sources(parent_export, child_exports)
    logs = [read_log(path) for path in log_paths]
    if len({rows[0]['instance'] for rows, _ in logs}) != len(logs):
        raise ValueError('Replayed observer instance')
    entries = [row for rows, _ in logs for row in rows]
    scopes = {rows[0]['instance']: rows[0]['data'] for rows, _ in logs}
    blockers = list(source['blockers'])
    # One native Code Mode execute can emit many nested tool receipts with the
    # same Session/message/call tuple. Their local occurrence is the log sequence,
    # not an invented host subcall ID. Reusing the tuple in another instance
    # cannot support this completed-audit-then-fresh-reader qualification.
    calls = {}
    for row in entries:
        if row['type'] not in ('tool', 'tool-failure'):
            continue
        data = row['data']
        call = (data['session_id'], data['message_id'], data['call_id'])
        if call in calls and calls[call] != row['instance']:
            raise ValueError('Replayed native tool identity across observer instances')
        calls[call] = row['instance']
    if len({(scope['audit_session_id'], scope['recovery_session_id']) for scope in scopes.values()}) != 1:
        blockers.append('observer-scope-mismatch')
    if any(rows[-1]['type'] != 'closed' for rows, _ in logs):
        blockers.append('observer-closure-missing')
    if any(scope['host_version'] != '2.2.6' for scope in scopes.values()):
        blockers.append('unsupported-host-version')
    if any(row['type'] in ('limit', 'observation-gap') for row in entries):
        blockers.append('observer-coverage-gap')
    writes = [row for row in entries if row['type'] == 'tool' and row['data']['kind'] == 'record-write' and row['data']['record_id'] == record_id]
    observations = {'public_record_match': False, 'different_observer_instance': False,
                    'native_delegation_receipt': False, 'skill_result_observed': False,
                    'source_trace_pages_complete': False, 'evaluator_model_observed': False,
                    'general_model_observed': False}
    if len(writes) != 1:
        blockers.append('exactly-one-selected-write-required')
    else:
        write = writes[0]
        record = write['data']
        writer, audit = record['writer_session_id'], scopes[write['instance']]['audit_session_id']
        reader = scopes[write['instance']]['recovery_session_id']
        if record['agent'] != 'evaluator' or record['writer_agent'] != 'evaluator' or record['session_id'] != writer or record['parent_session_id'] != audit or not record['source_ref_count']:
            blockers.append('unqualified-writer-or-empty-sources')
        # Every selected observation must agree about the native actor and
        # ancestry, not only the final result record. A foreign skill/trace
        # cannot become the Evaluator's evidence merely by sharing its ID.
        owners = {}
        for row in entries:
            data = row['data']
            session = data.get('session_id')
            if session not in (writer, audit, reader) or row['type'] not in ('model-request', 'tool', 'tool-failure'):
                continue
            owner = (data['agent'], data['parent_session_id'])
            if (session in owners and owners[session] != owner) or \
                    (session == writer and owner != ('evaluator', audit)) or \
                    (session in (audit, reader) and data['agent'] != 'general'):
                blockers.append('native-session-attribution-mismatch')
            owners[session] = owner
        observations['native_delegation_receipt'] = any(row['type'] == 'tool' and row['instance'] == write['instance'] and row['data']['kind'] == 'delegation' and row['data']['session_id'] == audit and row['data']['agent'] == 'general' and row['data']['child_session_id'] == writer for row in entries)
        observations['skill_result_observed'] = any(row['type'] == 'tool' and row['instance'] == write['instance'] and row['sequence'] < write['sequence'] and row['data']['kind'] == 'skill' and row['data']['session_id'] == writer and row['data']['agent'] == 'evaluator' for row in entries)
        for actor, session in (('evaluator', writer), ('general', audit)):
            observations[actor + '_model_observed'] = any(row['type'] == 'model-request' and row['instance'] == write['instance'] and row['sequence'] < write['sequence'] and row['data']['session_id'] == session and row['data']['agent'] == actor for row in entries)
        reads = [row for row in entries if row['type'] == 'tool' and row['data']['kind'] == 'record-read' and row['data']['record_id'] == record_id]
        identity = ('record_sha256', 'source_refs_sha256', 'source_ref_count', 'action_id', 'writer_session_id', 'writer_agent')
        same = lambda row: all(row['data'][key] == record[key] for key in identity)
        if any(not same(row) for row in reads):
            blockers.append('public-record-content-or-attribution-mismatch')
        initial = any(same(row) and row['instance'] == write['instance'] and row['sequence'] > write['sequence'] and row['data']['session_id'] in (writer, audit) for row in reads)
        recovered = any(same(row) and row['instance'] != write['instance'] and row['data']['session_id'] == reader and scopes[row['instance']]['audit_session_id'] == audit and scopes[row['instance']]['recovery_session_id'] == reader and row['data']['agent'] == 'general' and row['data']['session_id'] not in (writer, audit) for row in reads)
        observations['public_record_match'] = initial and recovered and not any(not same(row) for row in reads)
        observations['different_observer_instance'] = recovered
        complete = set()
        next_cursors = {}
        for row in entries:
            data = row['data']
            if row['type'] != 'tool' or row['instance'] != write['instance'] or row['sequence'] >= write['sequence'] or data.get('kind') != 'trace' or data['session_id'] != writer or data['agent'] != 'evaluator':
                continue
            sid = data['source_session_id']
            if data['cursor_sha256'] is None or (sid in next_cursors and next_cursors[sid] == data['cursor_sha256']):
                next_cursors[sid] = data['next_cursor_sha256']
                if data['next_cursor_sha256'] is None:
                    complete.add(sid)
                else:
                    complete.discard(sid)
        observations['source_trace_pages_complete'] = {source['parent_session'], *source['child_sessions']} <= complete
    blockers.extend(key + '-missing' for key, found in observations.items() if not found)
    models = sorted({(row['data']['provider_id'], row['data']['model_id']) for row in entries if row['type'] == 'model-request'})
    scripted = any(provider in ('question-fixture', 'qab-source', 'variant-fixture') or model == 'scripted' for provider, model in models)
    if scripted:
        blockers.append('scripted-provider-not-real-evaluator')
    if not models:
        blockers.append('no-model-request-observation')
    files = {name: {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
             for name, raw in (('installed_agent', read_private(agent_file)), ('installed_skill', read_private(skill_file)))}
    return {'format': 'loom-evaluator-qualification/v1', 'native_evaluator': 'UNPROVEN',
            'receipt_consistency': 'COMPLETE' if not blockers else 'INCOMPLETE',
            'record_id': record_id, 'observations': observations, 'blockers': list(dict.fromkeys(blockers)),
            'source_preflight': source, 'installed_file_fingerprints': files,
            'observer_files': [{'instance': rows[0]['instance'], 'sha256': sha, 'events': len(rows)} for rows, sha in logs],
            'observed_model_routes': [{'provider': provider, 'model': model} for provider, model in models],
            'known_scripted_provider': scripted,
            'unproven': ['receipt-authenticity', 'original-source-authenticity-and-completeness',
                         'real-model-reasoning-and-evidence-classification', 'full-host-restart',
                         'installed-file-delivery-equivalence', 'final-provider-input-exposure',
                         'human-authorization-and-provider-entitlement', 'causal-improvement'],
            'coverage_limit': 'Local observer consistency only. File hashes and completed tools do not prove a useful audit, human consent, provider billing, a trend or instruction effectiveness. Review original private evidence independently.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--observer-log', type=Path, action='append', required=True)
    parser.add_argument('--parent-export', type=Path, required=True)
    parser.add_argument('--child-export', type=Path, action='append', required=True)
    parser.add_argument('--agent-file', type=Path, required=True)
    parser.add_argument('--skill-file', type=Path, required=True)
    parser.add_argument('--record-id', required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = collect(args.observer_log, args.parent_export, args.child_export,
                         args.agent_file, args.skill_file, args.record_id)
        fd = os.open(args.report, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(report, out, indent=2)
            out.write('\n')
        print(json.dumps({'native_evaluator': 'UNPROVEN', 'receipt_consistency': report['receipt_consistency'], 'blockers': report['blockers']}))
        return 0 if report['receipt_consistency'] == 'COMPLETE' else 1
    except (ValueError, OSError, KeyError, TypeError, RecursionError):
        print('QUALIFICATION_UNPROVEN: invalid, incomplete or inaccessible local evidence', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
