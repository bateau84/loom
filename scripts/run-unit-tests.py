#!/usr/bin/env python3
"""Discover only zero-inference *.test.ts suites in Loom's unit-test roots."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UNIT_ROOTS = ("plugins/loom", "scripts", "dashboard")


def discover_unit_tests(root: Path) -> list[str]:
    tests: list[str] = []
    for relative in UNIT_ROOTS:
        directory = root / relative
        if not directory.is_dir() or directory.is_symlink():
            raise RuntimeError(f"Missing or symlinked unit-test root: {relative}")
        for parent, directories, files in os.walk(directory, followlinks=False):
            directories[:] = sorted(
                name for name in directories
                if name != "node_modules" and not name.startswith(".")
                and not (Path(parent) / name).is_symlink()
            )
            for name in files:
                path = Path(parent) / name
                if name.endswith(".test.ts") and not path.is_symlink():
                    tests.append("./" + path.relative_to(root).as_posix())
    if not tests:
        raise RuntimeError("No unit-test suites discovered")
    return sorted(tests)


def isolated_test_environment(isolation_root: Path) -> dict[str, str]:
    """Build a fresh process environment whose Loom state roots cannot alias the host installation."""
    if isolation_root.is_symlink():
        raise RuntimeError("Unit-test isolation root must not be a symlink.")
    root = isolation_root.resolve(strict=True)
    if any(root.iterdir()):
        raise RuntimeError("Unit-test isolation root must be fresh and empty.")
    original_home = Path(os.environ.get("HOME") or Path.home()).resolve()
    original_state = Path(
        os.environ.get("XDG_STATE_HOME") or original_home / ".local" / "state"
    ).resolve()
    test_home = root / "home"
    state_home = root / "state"
    runtime_home = root / "runtime"
    temp_home = root / "tmp"
    config_home = root / "config"
    data_home = root / "data"
    cache_home = root / "cache"
    for path in (test_home, state_home, runtime_home, temp_home, config_home, data_home, cache_home):
        path.mkdir(mode=0o700)
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise RuntimeError(f"Unit-test isolation path escaped its private root: {path}")

    # A new state root has no persisted installation runtime-root selector. Combined
    # with the inherited-child environment below, resolveRuntimeIdentity can only
    # create its DB/lock state under this disposable root.
    test_database = state_home / "loom" / "execution-state.sqlite"
    host_database = original_state / "loom" / "execution-state.sqlite"
    if test_database.resolve() == host_database.resolve():
        raise RuntimeError("Unit-test database path aliases the host installation database.")

    env = {key: value for key, value in os.environ.items() if value is not None}
    env.update({
        "HOME": str(test_home),
        "USERPROFILE": str(test_home),
        "XDG_STATE_HOME": str(state_home),
        "XDG_RUNTIME_DIR": str(runtime_home),
        "XDG_CONFIG_HOME": str(config_home),
        "XDG_DATA_HOME": str(data_home),
        "XDG_CACHE_HOME": str(cache_home),
        "TMPDIR": str(temp_home),
        "TMP": str(temp_home),
        "TEMP": str(temp_home),
        "LOOM_TEST_ISOLATION_ROOT": str(root),
    })
    return env


def run_unit_tests(root: Path = ROOT) -> int:
    tests = discover_unit_tests(root)
    print(f"Running {len(tests)} discovered zero-inference unit suites", flush=True)
    # Set isolation before Bun starts; test functions and their subprocesses inherit
    # these roots rather than temporarily redirecting a process that already began
    # with access to the user's Loom installation state.
    with tempfile.TemporaryDirectory(prefix="loom-unit-isolation-") as directory:
        env = isolated_test_environment(Path(directory))
        return subprocess.run(
            ["bun", "test", *tests], cwd=root, check=False, env=env,
        ).returncode


def preflight_isolation() -> int:
    """Prove child-process root propagation without opening any Loom state store."""
    with tempfile.TemporaryDirectory(prefix="loom-isolation-preflight-") as directory:
        root = Path(directory)
        env = isolated_test_environment(root)
        probe = (
            "import json, os; print(json.dumps({key: os.environ[key] for key in "
            "('HOME','XDG_STATE_HOME','XDG_RUNTIME_DIR','TMPDIR','LOOM_TEST_ISOLATION_ROOT')}))"
        )
        child = subprocess.run(
            [sys.executable, "-c", probe],
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        observed = json.loads(child.stdout)
        expected = {
            key: env[key]
            for key in ("HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "TMPDIR", "LOOM_TEST_ISOLATION_ROOT")
        }
        if observed != expected:
            raise RuntimeError("Child process did not inherit the complete isolated Loom test environment.")
        test_state = Path(env["XDG_STATE_HOME"]) / "loom"
        test_database = test_state / "execution-state.sqlite"
        host_state = Path(
            os.environ.get("XDG_STATE_HOME") or Path(os.environ.get("HOME") or Path.home()) / ".local" / "state"
        ).resolve()
        host_database = host_state / "loom" / "execution-state.sqlite"
        if (test_state / "runtime-root.json").exists() or test_database.exists():
            raise RuntimeError("Isolation preflight unexpectedly found a pre-existing Loom state store.")
        database_aliased = test_database.resolve() == host_database.resolve()
        if database_aliased:
            raise RuntimeError("Isolation preflight database path aliases the host Loom installation.")
        print(json.dumps({
            "status": "isolated",
            "processEnvironmentVerified": True,
            "stateHome": env["XDG_STATE_HOME"],
            "runtimeHome": env["XDG_RUNTIME_DIR"],
            "runtimeRootSelectorExists": False,
            "executionDatabaseExists": False,
            "hostDatabasePathAliased": database_aliased,
        }, sort_keys=True))
    return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--preflight-isolation"]:
        raise SystemExit(preflight_isolation())
    if sys.argv[1:]:
        raise SystemExit("Usage: run-unit-tests.py [--preflight-isolation]")
    raise SystemExit(run_unit_tests())
