#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"

errors: list[str] = []
seen: dict[str, Path] = {}
assessment_count = 0
qa_count = 0

FORBIDDEN_SKILL_H2 = {"review criteria", "adjudication criteria", "qa criteria"}
FORBIDDEN_ASSESSMENT_H2 = {"adjudication criteria", "qa criteria", "qa attack", "qa depth"}
FORBIDDEN_QA_H2 = {"review criteria", "adjudication criteria"}

def h2s(text: str) -> set[str]:
    return {
        match.group(1).strip().lower()
        for match in re.finditer(r"(?m)^##\s+(.+?)\s*$", text)
    }

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

    mixed = h2s(text) & FORBIDDEN_SKILL_H2
    if mixed:
        errors.append(
            f"{skill.relative_to(ROOT)}: reviewer/QA-owned H2 section(s) in SKILL.md: {', '.join(sorted(mixed))}"
        )

    assessment = directory / "ASSESSMENT.md"
    if assessment.is_file():
        assessment_count += 1
        assessment_text = assessment.read_text(encoding="utf-8")
        if not assessment_text.strip():
            errors.append(f"{assessment.relative_to(ROOT)}: empty")
        else:
            headings = h2s(assessment_text)
            if "review criteria" not in headings:
                errors.append(f"{assessment.relative_to(ROOT)}: missing '## Review criteria'")
            forbidden = headings & FORBIDDEN_ASSESSMENT_H2
            if forbidden:
                errors.append(
                    f"{assessment.relative_to(ROOT)}: Critic/QA-owned H2 section(s): {', '.join(sorted(forbidden))}"
                )

    qa = directory / "QA.md"
    if qa.is_file():
        qa_count += 1
        qa_text = qa.read_text(encoding="utf-8")
        if not qa_text.strip():
            errors.append(f"{qa.relative_to(ROOT)}: empty")
        else:
            headings = h2s(qa_text)
            if "qa criteria" not in headings:
                errors.append(f"{qa.relative_to(ROOT)}: missing '## QA criteria'")
            forbidden = headings & FORBIDDEN_QA_H2
            if forbidden:
                errors.append(
                    f"{qa.relative_to(ROOT)}: Reviewer-owned H2 section(s): {', '.join(sorted(forbidden))}"
                )

if errors:
    print("Skill validation failed:", file=sys.stderr)
    for error in errors:
        print(f"- {error}", file=sys.stderr)
    raise SystemExit(1)

print(
    f"Validated {len(seen)} Loom skills "
    f"({assessment_count} Reviewer assessments, {qa_count} Critic QA contracts)."
)
