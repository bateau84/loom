import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / "tools" / "export_legacy_config.py"
spec = importlib.util.spec_from_file_location("export_legacy", MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ExportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "plugin"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Test Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        for path in module.PATHS:
            target = self.repo / path
            if "." not in target.name:
                target = target / "example.md"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("Keep professional guidance.\n", encoding="utf-8")
        (self.repo / "private-local.yaml").write_text("not tracked")
        self.git("add", "--", *module.PATHS)
        self.git("commit", "-qm", "fixture")

    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], text=True).strip()

    def test_lossless_external_export_does_not_copy_untracked_files(self):
        out = self.root / "external"
        module.export(out, "HEAD", self.repo)
        self.assertEqual((out / "agents/example.md").read_text(), "Keep professional guidance.\n")
        self.assertFalse((out / "private-local.yaml").exists())
        self.assertIn(self.git("rev-parse", "HEAD"), (out / "LOOM-EXPORT.txt").read_text())
        self.assertTrue((self.repo / "agents/example.md").exists())

    def test_refuses_existing_destination(self):
        out = self.root / "existing"
        out.mkdir()
        (out / "keep").write_text("untouched")
        with self.assertRaises(ValueError):
            module.export(out, "HEAD", self.repo)
        self.assertEqual((out / "keep").read_text(), "untouched")

    def test_refuses_destination_inside_plugin(self):
        with self.assertRaises(ValueError):
            module.export(self.repo / "nested", "HEAD", self.repo)

    def test_refuses_symlink_entries_before_creating_destination(self):
        link = self.repo / "agents/link"
        link.symlink_to("/etc/passwd")
        self.git("add", "agents/link")
        self.git("commit", "-qm", "link fixture")
        out = self.root / "unsafe"
        with self.assertRaises(ValueError):
            module.export(out, "HEAD", self.repo)
        self.assertFalse(out.exists())

if __name__ == "__main__":
    unittest.main()
