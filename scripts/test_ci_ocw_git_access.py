"""Regression tests for ocw linked-worktree Git metadata permissions."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parent
SHELLS = (
    ("bash", "ocw.sh"),
    ("zsh", "ocw.zsh"),
    ("fish", "ocw.fish"),
)
GIT_DENY = {"action": "shell", "resource": "git push *", "effect": "deny"}


def run(*args, **kwargs):
    return subprocess.run(
        args, check=True, text=True, capture_output=True, **kwargs
    )


class OcwGitAccessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ocw-git-access-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self._repo("source")
        self.config = self.root / "config" / "opencode"
        (self.config / "profiles").mkdir(parents=True)
        (self.config / "cli").mkdir()
        self.base_config = {
            "model": "base/model",
            "permissions": [GIT_DENY],
            "agents": {"worker": {"model": "base/worker"}},
        }
        (self.config / "opencode.json").write_text(json.dumps(self.base_config))
        (self.config / "profiles" / "demo.json").write_text(
            json.dumps({"agents": {"reviewer": {"model": "profile/reviewer"}}})
        )
        (self.config / "cli" / "demo.json").write_text('{"tabs":{"mode":"off"}}')
        self.resolved = self.root / "resolved-config.json"
        self.resolved.write_text(json.dumps({
            "model": "resolved/model",
            "permissions": [
                GIT_DENY,
                {"action": "edit", "resource": "*/secrets/*", "effect": "deny"},
            ],
            "agents": {"worker": {"model": "resolved/worker"}},
        }))
        bindir = self.root / "bin"
        bindir.mkdir()
        fake = bindir / "opencode"
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, sys\n"
            "from pathlib import Path\n"
            "if sys.argv[1:3] == ['debug', 'config']:\n"
            "    print(Path(os.environ['OCW_RESOLVED']).read_text())\n"
            "    sys.exit(0)\n"
            "Path(os.environ['OCW_CAPTURE']).write_text(json.dumps({\n"
            "    'args': sys.argv[1:],\n"
            "    'cwd': os.getcwd(),\n"
            "    'config': os.environ.get('OPENCODE_CONFIG_DIR'),\n"
            "    'cli': os.environ.get('OPENCODE_CLI_CONFIG_CONTENT'),\n"
            "    'inline': os.environ.get('OPENCODE_CONFIG_CONTENT'),\n"
            "}))\n"
        )
        fake.chmod(0o755)
        runtime = self.root / "runtime"
        runtime.mkdir()
        self.env = {
            **os.environ,
            "PATH": f"{bindir}{os.pathsep}{os.environ['PATH']}",
            "XDG_CONFIG_HOME": str(self.root / "config"),
            "XDG_RUNTIME_DIR": str(runtime),
            "OCW_RESOLVED": str(self.resolved),
        }
        self.env.pop("OPENCODE_CONFIG_DIR", None)
        self.env.pop("OPENCODE_CONFIG", None)
        self.env.pop("OPENCODE_CONFIG_CONTENT", None)

    def _repo(self, name):
        repo = self.root / name
        run("git", "init", "-q", "-b", "main", str(repo))
        run("git", "-C", str(repo), "config", "user.name", "ocw-tests")
        run("git", "-C", str(repo), "config", "user.email", "ocw-tests@example.invalid")
        (repo / "README.md").write_text("initial\n")
        run("git", "-C", str(repo), "add", "README.md")
        run("git", "-C", str(repo), "commit", "-qm", "initial")
        return repo

    def _launch(self, shell, branch, *, profile=None, repo=None, no_worktree=False):
        shell_bin, file = shell
        capture = self.root / "capture.json"
        capture.unlink(missing_ok=True)
        env = {
            **self.env,
            "OCW_CAPTURE": str(capture),
            "OCW_SCRIPT": str(SCRIPTS / file),
            "TEST_REPO": str(repo or self.repo),
        }
        args = [branch]
        if no_worktree:
            args.append("--no-worktree")
        if profile:
            args.extend(["--profile", profile])
        command = "ocw " + " ".join(args)
        if shell_bin == "fish":
            source = f"cd $TEST_REPO; and source $OCW_SCRIPT; and {command}"
        else:
            source = f'cd "$TEST_REPO" && source "$OCW_SCRIPT" && {command}'
        result = subprocess.run(
            [shell_bin, "-c", source],
            env=env,
            text=True,
            capture_output=True,
        )
        self.assertEqual(
            result.returncode, 0,
            f"{shell_bin}: {result.stdout}\n{result.stderr}",
        )
        self.assertTrue(capture.exists(), f"{shell_bin}: missing launch capture")
        return json.loads(capture.read_text())

    def _shells(self):
        for shell in SHELLS:
            if shutil.which(shell[0]):
                yield shell

    def _assert_grants(self, capture, repo):
        common = str(repo / ".git") + "/*"
        config_dir = Path(capture["config"])
        config = json.loads((config_dir / "opencode.json").read_text())
        for action in ("external_directory", "read", "edit"):
            self.assertEqual(
                config["permissions"].count({
                    "action": action, "resource": common, "effect": "allow"
                }), 1,
            )
        self.assertEqual(config_dir.stat().st_mode & 0o777, 0o700)
        self.assertEqual(capture["args"][0], "--standalone")
        self.assertTrue(Path(capture["cwd"]).is_dir())
        self.assertIsNone(capture["inline"])
        return config

    def test_launch_with_profile_preserves_base_and_cli(self):
        for shell in self._shells():
            with self.subTest(shell=shell[0]):
                capture = self._launch(shell, "with-profile", profile="demo")
                config = self._assert_grants(capture, self.repo)
                self.assertEqual(config["model"], "base/model")
                self.assertIn(GIT_DENY, config["permissions"])
                self.assertEqual(
                    config["agents"]["reviewer"]["model"], "profile/reviewer"
                )
                self.assertEqual(json.loads(capture["cli"])["tabs"]["mode"], "off")
                self.assertEqual(
                    json.loads((self.config / "opencode.json").read_text()),
                    self.base_config,
                )

    def test_launch_without_profile_retains_resolved_project_policies(self):
        for shell in self._shells():
            with self.subTest(shell=shell[0]):
                capture = self._launch(shell, "plain")
                config = self._assert_grants(capture, self.repo)
                self.assertNotIn("model", config)
                self.assertNotIn("agents", config)
                self.assertIn(GIT_DENY, config["permissions"])
                self.assertIn(
                    {"action": "edit", "resource": "*/secrets/*", "effect": "deny"},
                    config["permissions"],
                )
                self.assertIsNone(capture["cli"])

    def test_configs_are_isolated_across_repositories(self):
        other = self._repo("other")
        for shell in self._shells():
            with self.subTest(shell=shell[0]):
                first = self._launch(shell, "branch-one", profile="demo")
                second = self._launch(
                    shell, "branch-two", profile="demo", repo=other
                )
                self.assertNotEqual(first["config"], second["config"])
                first_config = self._assert_grants(first, self.repo)
                second_config = self._assert_grants(second, other)
                self.assertNotIn(
                    {"action": "external_directory",
                     "resource": str(self.repo / ".git") + "/*",
                     "effect": "allow"},
                    second_config["permissions"],
                )
                self.assertNotIn(
                    {"action": "external_directory",
                     "resource": str(other / ".git") + "/*",
                     "effect": "allow"},
                    first_config["permissions"],
                )

    def test_reopening_worktree_does_not_duplicate_grants(self):
        for shell in self._shells():
            with self.subTest(shell=shell[0]):
                first = self._launch(shell, "reuse")
                second = self._launch(shell, "reuse")
                self.assertEqual(first["config"], second["config"])
                self._assert_grants(second, self.repo)

    def test_normal_checkout_without_profile_keeps_original_launch(self):
        for shell in self._shells():
            with self.subTest(shell=shell[0]):
                capture = self._launch(shell, "normal", no_worktree=True)
                self.assertIsNone(capture["config"])
                self.assertEqual(capture["args"], [])

    def test_no_worktree_outside_git_still_launches(self):
        outside = self.root / "not-a-repository"
        outside.mkdir()
        for shell in self._shells():
            with self.subTest(shell=shell[0]):
                capture = self._launch(
                    shell, "outside", no_worktree=True, repo=outside
                )
                self.assertIsNone(capture["config"])
                self.assertEqual(capture["args"], [])

    def test_existing_linked_worktree_no_worktree_mode_gets_git_access(self):
        for shell in self._shells():
            with self.subTest(shell=shell[0]):
                self._launch(shell, "linked")
                linked = Path(str(self.repo) + "-wt") / "linked"
                capture = self._launch(
                    shell, "linked", no_worktree=True, repo=linked
                )
                self._assert_grants(capture, self.repo)

    def test_script_syntax_where_shell_is_installed(self):
        for binary, file in SHELLS:
            if shutil.which(binary):
                with self.subTest(shell=binary):
                    run(binary, "-n", str(SCRIPTS / file))


if __name__ == "__main__":
    unittest.main()
