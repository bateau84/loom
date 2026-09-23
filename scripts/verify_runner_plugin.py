#!/usr/bin/env python3
"""Zero-inference activation probe; run as a mounted file in the pinned runner."""
from __future__ import annotations

import sys
from collections.abc import Callable
from typing import Any

EXPECTED = "loom"
MISSING = "loom-ci-deliberately-missing"
VERIFICATION = "plugin-entrypoint+activation-barrier+plugin-inventory"
Verifier = Callable[[dict[str, str], str, str, str, int], dict[str, Any]]


def check_activation(verify: Verifier, env: dict[str, str]) -> None:
    result = verify(env, "general", "openai/preflight-no-inference", EXPECTED, 30)
    if not isinstance(result, dict):
        raise RuntimeError("Activation probe returned no structured result")
    plugin = result.get("plugin")
    state = plugin.get("state") if isinstance(plugin, dict) else None
    if (
        result.get("expected") != EXPECTED
        or result.get("agent") != "general"
        or result.get("verification") != VERIFICATION
        or not isinstance(result.get("entrypoints"), list)
        or not result["entrypoints"]
        or not isinstance(plugin, dict)
        or plugin.get("id") != EXPECTED
        or not isinstance(state, dict)
        or state.get("status") != "active"
    ):
        raise RuntimeError("Activation probe did not establish the active Loom plugin")

    # Only the pinned verifier's specific missing-entrypoint rejection counts.
    # A timeout, auth failure, or unrelated exception is not a negative PASS.
    try:
        verify(env, "general", "openai/preflight-no-inference", MISSING, 30)
    except RuntimeError as error:
        expected_error = f"expected plugin {MISSING!r} is not materialized in "
        if not str(error).startswith(expected_error):
            raise RuntimeError("Negative control failed for an unrelated reason") from error
    else:
        raise RuntimeError("Negative control incorrectly accepted a missing plugin")


def main() -> None:
    # This module is provided by the immutable eval-runner image, not a PyPI dep.
    sys.path.insert(0, "/opt/opencode-eval-runner")
    from container.invoke import prepare_opencode_env, verify_expected_plugin

    check_activation(verify_expected_plugin, prepare_opencode_env())
    print("PASS real Loom plugin activation", flush=True)
    print("PASS missing plugin rejected", flush=True)


if __name__ == "__main__":
    main()
