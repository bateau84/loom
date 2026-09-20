#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"

errors: list[str] = []
seen: dict[str, Path] = {}

for directory in sorted(path for path in SKILLS.iterdir() if path.is_dir()):
    skill = directory / "SKILL.md"
    if not skill.is_file():
        errors.append(f"{directory.relative_to(ROOT)}: missing SKILL.md")
        continue

    text = skill.read_text(encoding="utf-8")
    if not text.strip():
        errors.append(f"{skill.relative_to(ROOT)}: empty")
        continue

    if not text.startswith("---\n"):
        errors.append(f"{skill.relative_to(ROOT)}: missing YAML frontmatter")
        continue

    end = text.find("\n---", 4)
    if end < 0:
        errors.append(f"{skill.relative_to(ROOT)}: unterminated YAML frontmatter")
        continue

    frontmatter = text[4:end]
    name_match = re.search(r"(?m)^name:\s*['\"]?([^'\"\n]+)", frontmatter)
    description_match = re.search(r"(?m)^description:\s*(.+)$", frontmatter)

    if not name_match:
        errors.append(f"{skill.relative_to(ROOT)}: frontmatter missing name")
        continue
    if not description_match:
        errors.append(f"{skill.relative_to(ROOT)}: frontmatter missing description")

    name = name_match.group(1).strip()
    if name != directory.name:
        errors.append(
            f"{skill.relative_to(ROOT)}: name {name!r} does not match directory {directory.name!r}"
        )

    previous = seen.get(name)
    if previous:
        errors.append(
            f"{skill.relative_to(ROOT)}: duplicate skill name {name!r}; first seen at {previous.relative_to(ROOT)}"
        )
    else:
        seen[name] = skill

if errors:
    print("Skill validation failed:", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    raise SystemExit(1)

print(f"Validated {len(seen)} Loom skills.")
