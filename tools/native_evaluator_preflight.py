#!/usr/bin/env python3
"""Fail-closed check for *source shape* before a paid/native Evaluator audit.

This NEVER runs OpenCode, sends a model request, or proves source authenticity.
Use the actual native host to prove registered tools, instruction exposure,
source attribution, public Loom persistence and restart recovery.
"""
from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

MAX_EXPORT = 16 * 1024 * 1024
SESSION_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}\Z")


def read_export(path: Path) -> dict:
    # Do not follow symlinks or open FIFOs; private source exports can be large.
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
    except OSError as exc:
        if exc.errno in (errno.ELOOP, errno.EMLINK):
            raise ValueError('Export must be a regular non-symlink file') from exc
        raise
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError('Export must be a regular non-symlink file')
        if before.st_size > MAX_EXPORT:
            raise ValueError('Export exceeds 16 MiB limit')
        if before.st_size < 10:
            raise ValueError('Export is empty or malformed')
        raw = b''
        while len(raw) <= MAX_EXPORT:
            part = os.read(fd, min(128 * 1024, MAX_EXPORT + 1 - len(raw)))
            if not part:
                break
            raw += part
        after = os.fstat(fd)
        if (len(raw) != before.st_size or (before.st_dev, before.st_ino, before.st_mtime_ns,
                                          before.st_size) != (after.st_dev, after.st_ino,
                                                            after.st_mtime_ns, after.st_size)):
            raise ValueError('Export changed during read')
    finally:
        os.close(fd)
    try:
        parsed = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError('Export is not valid JSON') from exc
    transfer = parsed.get('data', parsed) if isinstance(parsed, dict) else None
    if not isinstance(transfer, dict):
        raise ValueError('Export has no native data object')
    info = transfer.get('info')
    messages = transfer.get('messages')
    if not isinstance(info, dict) or not isinstance(messages, list) or len(messages) > 20000:
        raise ValueError('Export lacks native info/messages or exceeds message limit')
    session = info.get('id')
    project = info.get('projectID')
    directory = info.get('location', {}).get('directory') if isinstance(info.get('location'), dict) else None
    if not isinstance(session, str) or not SESSION_ID.fullmatch(session):
        raise ValueError('Invalid native Session identity')
    if not isinstance(project, str) or not project or len(project) > 256:
        raise ValueError('Invalid native project identity')
    if not isinstance(directory, str) or not directory.startswith('/') or len(directory) > 4096:
        raise ValueError('Missing native location')
    parent = info.get('parentID')
    if parent is not None and (not isinstance(parent, str) or not SESSION_ID.fullmatch(parent)):
        raise ValueError('Invalid native parent Session identity')
    return {
        'id': session, 'project': project, 'directory': directory, 'parent': parent,
        'messages': messages, 'sha256': hashlib.sha256(raw).hexdigest(),
        'bytes': len(raw),
    }


def inspect_sources(parent_export: Path, child_exports: list[Path]) -> dict:
    paths = [parent_export, *child_exports]
    sources = [read_export(Path(path)) for path in paths]
    parent = sources[0]
    by_id = {s['id']: s for s in sources}
    blockers: list[str] = []
    if len(by_id) != len(sources):
        blockers.append('duplicate-session-identity')
    if not child_exports:
        blockers.append('no-child-export')
    for source in sources:
        if source['project'] != parent['project']:
            blockers.append('project-mismatch:' + source['id'])
        if not any(isinstance(m, dict) and m.get('type') == 'user'
                   and isinstance(m.get('id'), str) for m in source['messages']):
            blockers.append('missing-user-request:' + source['id'])
        if source['id'] != parent['id']:
            current = source
            visited = set()
            while current['id'] != parent['id']:
                if current['id'] in visited or current['parent'] not in by_id:
                    blockers.append('unlinked-session:' + source['id'])
                    break
                visited.add(current['id'])
                current = by_id[current['parent']]

    def sanitized(source: dict) -> bool:
        return source['directory'] == f"/[redacted:session-directory:{source['id']}]"

    directory_identity = ('unverified-sanitized' if any(sanitized(s) for s in sources)
                          else 'identical-exported-paths')
    for source in sources[1:]:
        if not sanitized(parent) and not sanitized(source) and source['directory'] != parent['directory']:
            blockers.append('directory-mismatch:' + source['id'])
    # The metadata and messages may have been edited before this check.
    # A byte hash is an immutable receipt, not source authenticity proof.
    return {
        'source_shape_eligible': not blockers,
        'native_evaluator': 'UNPROVEN',
        'project_id': parent['project'], 'parent_session': parent['id'],
        'child_sessions': [s['id'] for s in sources[1:]],
        'source_sessions': len(sources), 'directory_identity': directory_identity,
        'exports': [{'session_id': s['id'], 'sha256': s['sha256'], 'bytes': s['bytes'],
                     'message_count': len(s['messages'])} for s in sources],
        'blockers': blockers,
        'coverage_limit': ('Export identity/ancestry/shape only. Caller-supplied bytes are not '
                           'authenticated native Session history. No corrections, verification, '
                           'Evaluator behavior, skill delivery, provider charges, or Loom recovery verified.'),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parent-export', required=True, type=Path)
    parser.add_argument('--child-export', required=True, action='append', type=Path)
    parser.add_argument('--report', required=True, type=Path,
                        help='New local redacted report; input exports remain unchanged')
    args = parser.parse_args(argv)
    if args.report.exists():
        parser.error('Refusing to overwrite an existing evidence report')
    try:
        report = inspect_sources(args.parent_export, args.child_export)
        args.report.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(args.report, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(report, out, indent=2)
            out.write('\n')
        print(json.dumps({'source_shape_eligible': report['source_shape_eligible'],
                          'native_evaluator': 'UNPROVEN', 'blockers': report['blockers']}))
        return 0 if report['source_shape_eligible'] else 1
    except (ValueError, OSError):
        # Avoid echoing private export content or arbitrary file paths/errors.
        print('PRECHECK_UNPROVEN: source export failed basic structural validation', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
