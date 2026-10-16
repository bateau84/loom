"""Test-only managed CLI lifetime, using isolated service registration/configuration."""
from __future__ import annotations
import json
import os
import secrets
import signal
import subprocess
import time
from pathlib import Path
from urllib.request import build_opener, ProxyHandler
from installed_host_smoke import PrivateHost, NoRedirect, ready_url, require


class ManagedExperimentHost(PrivateHost):
    """Use native managed startup recovery, not a manual Session wake in the test."""
    def __init__(self, executable: str, project: Path, env: dict, output: Path, label: str):
        self.project, self.output, self.label = project, output, label
        self.password = secrets.token_urlsafe(24)
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        # Both service config and registration live under this case's temporary
        # XDG paths. No existing user service is discovered, stopped or changed.
        service = Path(env['OPENCODE_CONFIG_DIR']) / 'service.json'
        service.write_text(json.dumps({'hostname': '127.0.0.1', 'password': self.password}))
        service.chmod(0o600)
        self.stdout_path = output / f'{label}.server.stdout.txt'
        self.stdout = self.stdout_path.open('w')
        self.stderr = (output / f'{label}.server.stderr.txt').open('w')
        try:
            self.proc = subprocess.Popen([executable, 'serve', '--service', '--hostname', '127.0.0.1', '--port', '0'],
                cwd=project, env=env, stdin=subprocess.DEVNULL, stdout=self.stdout,
                stderr=self.stderr, start_new_session=True)
        except Exception:
            self.stdout.close(); self.stderr.close(); raise
        try:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                require(self.proc.poll() is None, f'{label}: managed server exited before readiness')
                with self.stdout_path.open() as stream:
                    text = stream.read(65536)
                for line in text.splitlines():
                    if line.startswith('server listening on '):
                        self.url = ready_url(json.dumps({'url': line.removeprefix('server listening on ')}))
                        return
                time.sleep(.05)
            raise RuntimeError(f'{label}: managed server readiness timed out')
        except Exception:
            self.close(); raise

    def close(self):
        # Never launch the successor until this exact owned process is dead.
        # Signal shutdown is requested; forced cleanup is recorded separately.
        forced = False
        try:
            if self.proc.poll() is None:
                try: os.killpg(self.proc.pid, signal.SIGTERM)
                except ProcessLookupError: pass
            try: self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                forced = True
                try: os.killpg(self.proc.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                self.proc.wait(timeout=5)
        finally:
            self.stdout.close(); self.stderr.close()
            (self.output / f'{self.label}.teardown.json').write_text(json.dumps({
                'forced': forced, 'returncode': self.proc.returncode, 'process_dead': self.proc.poll() is not None}))
