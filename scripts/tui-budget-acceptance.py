#!/usr/bin/env python3
import fcntl
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time

if len(sys.argv) != 6:
    raise SystemExit(
        "usage: tui-budget-acceptance.py <project> <prompt> <server-url> <session-id> <password>"
    )

project, prompt, server_url, session_id, password = sys.argv[1:6]
env = os.environ.copy()
env.setdefault("TERM", "xterm-256color")

ROWS = 42
COLS = 140
DEADLINE_SECONDS = 50
deadline = time.monotonic() + DEADLINE_SECONDS
submitted = False
submit_visible_at = None
answered = False
finished = False
child_exited = False
transcript = bytearray()

winsize = struct.pack("HHHH", ROWS, COLS, 0, 0)
pid, fd = pty.fork()
if pid == 0:
    # OpenTUI reads the terminal dimensions during renderer initialization.
    # Set them on the slave before exec so it never sees the PTY default 0x0
    # size and gets stuck with an empty render surface.
    fcntl.ioctl(0, termios.TIOCSWINSZ, winsize)
    os.chdir(project)
    env["OPENCODE_SERVER_PASSWORD"] = password
    os.execvpe(
        "opencode",
        [
            "opencode",
            "--server",
            server_url,
            "--session",
            session_id,
            "--prompt",
            prompt,
        ],
        env,
    )

fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
try:
    os.kill(pid, signal.SIGWINCH)
except ProcessLookupError:
    child_exited = True

ansi_csi = re.compile(r"\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
ansi_osc = re.compile(r"\x1b\][^\x07]*(?:\x07|\x1b\\)")

def clean() -> str:
    text = transcript.decode("utf-8", errors="ignore")
    text = ansi_osc.sub("", text)
    return ansi_csi.sub("", text)

def answer_terminal_queries(data: bytes) -> None:
    # OpenCode probes OSC 11 during TUI startup. A raw PTY has no terminal
    # emulator to answer it, so provide a deterministic dark background.
    if b"\x1b]11;?\x07" in data:
        os.write(fd, b"\x1b]11;rgb:0000/0000/0000\x07")
    # Cursor-position reports are another common terminal capability probe.
    if b"\x1b[6n" in data:
        os.write(fd, b"\x1b[1;1R")

try:
    while time.monotonic() < deadline:
        readable, _, _ = select.select([fd], [], [], 0.2)
        if readable:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break
            if not data:
                break

            transcript.extend(data)
            if len(transcript) > 2_000_000:
                del transcript[:-1_000_000]

            answer_terminal_queries(data)
            text = clean()

            composer_visible = (
                prompt in text
                and ("shift+tab agents" in text or "ctrl+p commands" in text)
            )
            if not submitted and composer_visible and submit_visible_at is None:
                submit_visible_at = time.monotonic()

            if submitted and not answered and "Allow +1 dispatch" in text and "Stop here" in text:
                # The real OpenCode single-select question maps key 1 to the
                # first canonical option. This exercises the actual TUI input
                # path rather than injecting a plugin/tool result.
                os.write(fd, b"1")
                answered = True

            if answered and "LOOM_TUI_BUDGET_ACCEPTANCE_DONE" in text:
                finished = True
                break

        if (
            not submitted
            and submit_visible_at is not None
            and time.monotonic() - submit_visible_at >= 0.4
        ):
            # The prompt is prefilled by OpenCode's supported --prompt flag;
            # submit it through the real TUI once the composer frame is stable.
            os.write(fd, b"\r")
            submitted = True

        done, _ = os.waitpid(pid, os.WNOHANG)
        if done == pid:
            child_exited = True
            break
finally:
    if not child_exited:
        try:
            os.kill(pid, signal.SIGTERM if finished else signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass

    try:
        os.close(fd)
    except OSError:
        pass

text = clean()
tail = text[-16000:]
sys.stdout.write(tail)
sys.stderr.write(
    f"\n[TUI acceptance diagnostics] bytes={len(transcript)} "
    f"submitted={submitted} submit_visible_at={submit_visible_at} "
    f"answered={answered} finished={finished} "
    f"child_exited={child_exited}\n"
)

if not submitted:
    raise SystemExit("\nTUI acceptance did not submit the pre-filled OpenCode prompt")
if not answered:
    raise SystemExit("\nTUI acceptance did not observe the real budget question options")
if not finished:
    raise SystemExit("\nTUI acceptance did not observe completed same-target recovery")
