#!/usr/bin/env python3
"""Test Loom-owned policy retained after Task 9 Stage 2A.

The old test_eval_actions.py mixed project semantics with a now-removed generic
scheduler, direct-container invoker and artifact writer. Only the below
project-owned compatibility checks remain executable. Current generic
orchestration and runtime evidence are exercised by the runner acceptance
suite and the modern loom_eval_profile / skill-ablation adapter tests.

Legacy observer/projection tests in test_eval_tool_results.py are historical
diagnostics, NOT a source of authoritative runtime facts or current acceptance.
"""
from __future__ import annotations

import unittest

import test_eval_actions

RETAINED_CLASSES = (
    "WorkflowCredentialTests",
    "DatabaseSeedTests",
    "RuntimeEvalProjectTests",
    "MountPreparationTests",
    "CentralEvalDiscoveryTests",
    "SkillOwnedEvalDiscoveryTests",
    "ConversationalFeedbackCostTests",
    "ArtifactHandoffCostTests",
)


def main() -> int:
    suite = unittest.TestSuite()
    for name in RETAINED_CLASSES:
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(
            getattr(test_eval_actions, name)
        ))
    count = suite.countTestCases()
    if count < 30:
        raise RuntimeError(f"unexpected loss of retained Loom policy coverage: {count} tests")
    print(f"Running {count} retained Loom policy tests (no legacy engine)", flush=True)
    return 0 if unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
