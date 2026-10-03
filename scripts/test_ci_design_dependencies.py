"""Check the bundled design-method dependencies; not model-behavior evidence."""
from __future__ import annotations

from pathlib import Path
import re
from tempfile import TemporaryDirectory
import unittest
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
ENTRYPOINTS = (
    "skills/hallmark/SKILL.md",
    "skills/prototyping/SKILL.md",
    "skills/design-implementation/SKILL.md",
)
# Deliberately bounded to inline Markdown links used by these packages.
# Ignore fenced examples, which are not declared file dependencies.
LINK = re.compile(r"\[[^\]\n]*\]\(([^)\n]+)\)")


def markdown_targets(text: str) -> list[str]:
    targets: list[str] = []
    fence: str | None = None
    for line in text.splitlines():
        stripped = line.lstrip()
        marker = re.match(r"(`{3,}|~{3,})", stripped)
        if marker:
            token = marker.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
            continue
        if fence is not None:
            continue
        for match in LINK.finditer(line):
            target = match.group(1).strip()
            # Titles and angle-delimited paths are allowed in our inline links.
            if target.startswith("<") and ">" in target:
                target = target[1:target.index(">")]
            else:
                target = target.split(maxsplit=1)[0]
            parts = urlsplit(target)
            if parts.scheme or parts.netloc or not parts.path:
                continue
            targets.append(unquote(parts.path))
    return targets


def dependency_errors(root: Path, entrypoints: tuple[str, ...]) -> list[str]:
    """Follow local file links from the entrypoints; fail on missing/escaping files."""
    root = root.resolve()
    pending = [(root / name, "entrypoint") for name in entrypoints]
    visited: set[Path] = set()
    errors: list[str] = []
    while pending:
        path, source = pending.pop()
        resolved = path.resolve()
        if not resolved.is_relative_to(root):
            errors.append(f"{source}: dependency escapes repository: {path}")
            continue
        if resolved in visited:
            continue
        visited.add(resolved)
        relative = resolved.relative_to(root).as_posix()
        if not resolved.is_file():
            errors.append(f"{source}: missing file {relative}")
            continue
        if resolved.suffix.lower() != ".md":
            continue
        for target in markdown_targets(resolved.read_text(encoding="utf-8")):
            # Older skills used explicit repo-root paths such as skills/hallmark/...
            base = root if target.startswith("skills/") else resolved.parent
            pending.append((base / target, relative))
    return sorted(errors)


class DesignDependencyTests(unittest.TestCase):
    def test_bundled_design_methods_are_self_contained(self) -> None:
        self.assertEqual(dependency_errors(ROOT, ENTRYPOINTS), [])

    def test_unported_hallmark_is_rejected(self) -> None:
        with TemporaryDirectory() as directory:
            errors = dependency_errors(Path(directory), ("skills/hallmark/SKILL.md",))
        self.assertEqual(errors, ["entrypoint: missing file skills/hallmark/SKILL.md"])

    def test_missing_legacy_cookbook_reference_is_rejected(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "skills/design-implementation/SKILL.md"
            source.parent.mkdir(parents=True)
            source.write_text("Read [cookbook](skills/hallmark/references/component-cookbook.md).\n")
            errors = dependency_errors(root, ("skills/design-implementation/SKILL.md",))
        self.assertEqual(errors, ["skills/design-implementation/SKILL.md: missing file skills/hallmark/references/component-cookbook.md"])

    def test_relative_reference_and_cycle_are_supported(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "references").mkdir()
            (root / "SKILL.md").write_text("[Method](references/method.md#details)\n")
            (root / "references/method.md").write_text("[Back](../SKILL.md)\n")
            self.assertEqual(dependency_errors(root, ("SKILL.md",)), [])
            (root / "references/method.md").write_text("[Missing](missing.md)\n")
            self.assertEqual(dependency_errors(root, ("SKILL.md",)), ["references/method.md: missing file references/missing.md"])

    def test_external_links_anchors_and_fenced_examples_are_not_files(self) -> None:
        text = """[Web](https://example.org/x) [Mail](mailto:x@example.org) [Section](#here)
[Remote](//example.org/x)
```markdown
[Example](not-a-dependency.md)
```
[Actual](references/actual.md)
"""
        self.assertEqual(markdown_targets(text), ["references/actual.md"])

    def test_titles_and_encoded_paths(self) -> None:
        self.assertEqual(markdown_targets('[A](refs/a.md "Title") [B](<refs/with space.md>) [C](refs/with%20space.md#x)'), ["refs/a.md", "refs/with space.md", "refs/with space.md"])

    def test_reference_cannot_escape_repository(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "SKILL.md").write_text("[Outside](../outside.md)\n")
            errors = dependency_errors(root, ("SKILL.md",))
        self.assertEqual(len(errors), 1)
        self.assertIn("dependency escapes repository", errors[0])


if __name__ == "__main__":
    unittest.main()
