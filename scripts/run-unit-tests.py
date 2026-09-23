#!/usr/bin/env python3
"""Discover only zero-inference *.test.ts suites in Loom's unit-test roots."""
from __future__ import annotations

import os
import subprocess
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


def run_unit_tests(root: Path = ROOT) -> int:
    tests = discover_unit_tests(root)
    print(f"Running {len(tests)} discovered zero-inference unit suites", flush=True)
    # An argument list avoids shell/glob interpretation and propagates failure.
    return subprocess.run(["bun", "test", *tests], cwd=root, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(run_unit_tests())
