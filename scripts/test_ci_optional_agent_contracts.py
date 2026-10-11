"""CI guard: professional agents must remain usable without the Loom plugin."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROLES = (
    "acceptance", "architect", "brainstorm", "critic", "designer", "diagnostic",
    "documenter", "general", "planner", "research", "reviewer", "specifier", "worker",
)

class TestOptionalLoomAgentContracts(unittest.TestCase):
    def test_agent_files_have_no_required_loom_api_or_permissions(self):
        for role in ROLES:
            with self.subTest(role=role):
                body = (ROOT / "agents" / f"{role}.md").read_text()
                self.assertTrue(body.startswith("---\n"))
                self.assertNotRegex(body, r"\bloom_[a-z0-9_]+\b")
                self.assertNotIn("permissions:", body.split("---", 2)[1])
                self.assertRegex(body, r"(?m)^mode: (subagent|primary)$")

    def test_runtime_contracts_are_complete(self):
        shared = (ROOT / "plugins/loom/contracts/shared.md").read_text()
        self.assertIn("loom_status", shared)
        for role in ROLES:
            with self.subTest(role=role):
                contract = (ROOT / "plugins/loom/contracts" / f"{role}.md").read_text()
                self.assertIn(f"Loom runtime contract: {role}", contract)
                self.assertRegex(contract, r"\bloom_[a-z0-9_]+\b")

    def test_migration_preserves_role_specific_behavior(self):
        # Account for the prior Loom-only role guidance rather than testing
        # merely that each new file contains some arbitrary loom_* identifier.
        expected = {
            "acceptance": ("loom_pa_plan", "loom_pa_result"),
            "architect": ("loom_verification", "loom_complete"),
            "brainstorm": ("adviceForTaskId", "loom_oq_answer"),
            "critic": ("critic-solution", "critic-final", "loom_qa"),
            "designer": ("loom_complete", "design-specification"),
            "diagnostic": ("loom_diagnostic_sandbox_start", "loom_diagnostic_sandbox_diff"),
            "documenter": ("loom_knowledge_record", "loom_complete"),
            "general": ("loom_intent_start", "loom_dispatch_grant", "loom_cancel"),
            "planner": ("loom_work_plan", "loom_task_plan"),
            "research": ("loom_complete",),
            "reviewer": ("loom_assessment", "independent-re-review"),
            "specifier": ("loom_complete",),
            "worker": ("taskOutcome", "planContext", "loom_scope_elevate"),
        }
        for role, markers in expected.items():
            with self.subTest(role=role):
                contract = (ROOT / "plugins/loom/contracts" / f"{role}.md").read_text()
                for marker in markers:
                    self.assertIn(marker, contract, f"Missing migrated {role} instruction: {marker}")

    def test_shared_runtime_guidance_keeps_user_facing_status_and_git_rules(self):
        shared = (ROOT / "plugins/loom/contracts/shared.md").read_text()
        for marker in (
            "dashboard-first", "stable workflow dashboard URL",
            "tools.browser.preview", "git status", "git diff", "git log",
            "git show", "git rev-parse", "loom_scope_elevate",
        ):
            self.assertIn(marker, shared)

    def test_optional_registration_wired_into_host(self):
        plugin = (ROOT / "plugins/loom/index.ts").read_text()
        self.assertIn("await loadLoomAgentContracts()", plugin)
        self.assertIn("roleContracts.get(", plugin)
        self.assertIn("editor.update(role, (agent)", plugin)
        self.assertIn("candidateLoomTransitions(", plugin)

if __name__ == "__main__":
    unittest.main()
