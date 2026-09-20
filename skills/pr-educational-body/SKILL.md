---
name: pr-educational-body
description: Create GitHub PRs with human-readable, educational PR bodies that explain WHY the work was done. Use when about to open or update a PR, when a PR body is missing or auto-generated from commit titles, or when a reviewer needs context beyond the diff. Not for commit messages (→ See `git-commit-discipline`), merge conflict resolution (→ See `git-conflicts`), code review (→ See `reviewer`), or CI/CD configuration.
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

# PR Educational Body

This skill teaches agents to produce GitHub PRs with educational, human-readable PR bodies. Not for commit messages (→ See `git-commit-discipline`), code review (→ See `reviewer`), or merge conflicts (→ See `git-conflicts`).

> These section names mirror the commit format's teaching order by design — they serve the same purpose (explain WHY before WHAT) at the PR granularity. A PR synthesizes multiple commits into one narrative that stands alone for a cold reader.

**Persona:** You treat the PR body as the primary communication channel between the author and the reviewer — not as metadata to fill after the fact. A reviewer with zero context about the repo, the internal workflow, or the reasoning behind the changes should be able to read the PR body alone and understand _why_ the work was done, _what_ changed, and _how_ it was verified. The body is the map; the commits are the terrain.

## 1. The two problems this skill solves

1. **Illegibility.** A PR body that is empty, auto-generated from commit titles, or a mechanical dump of the commit log leaves external reviewers reverse-engineering the reasoning from the diff alone. The body must explain _why_ — not just restate _what_.
2. **Duplication.** When the PR body repeats the commit messages verbatim, the reviewer reads the same information twice — once in the body, once in the commits. The PR body explains the whole; each commit explains its part. They should not overlap.

## 2. The synthesis workflow

The PR body is a teaching aid for a **cold reviewer**: someone who understands software but may know nothing about this repository, its terminology, or the history behind the branch.

The body must help that reader move through three stages:

```text
ORIENT      → Why does this PR exist?
UNDERSTAND  → What changes conceptually?
REVIEW      → Where should I look, and how was it verified?
```

Do not optimize for completeness. Optimize for the minimum information needed to build the correct mental model.

### Step 1 — Understand the complete diff

Read:

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
git diff main..HEAD
```

Use commits for historical intent and the diff for actual behavior. Neither is sufficient alone.

### Step 2 — Identify the conceptual delta

Before writing sections or listing files, answer:

> **What can the system do, guarantee, express, or prevent after this PR that it could not before?**

Prefer a before/after formulation:

```text
Before:
<important limitation or behavior>

After:
<new behavior, guarantee, capability, or operating model>
```

If you cannot state the conceptual delta clearly, you do not yet understand the PR well enough to describe it.

### Step 3 — Build the cold-reader mental model

Identify only the concepts the reader must understand to make sense of the diff.

Introduce repository-specific terminology **after** explaining the underlying concept.

Prefer:

> Requirements become durable obligations carried into downstream agent work. The repository represents those relationships through its OKF profile.

Over:

> Adds OKF `satisfies`, `implements`, and `derived-from` relationships.

For structural changes, a small diagram is often more educational than prose:

```text
Input
  → transformation
  → governing artifact
  → consumer
```

Use a diagram only when it reduces explanation. Keep it under ~10 lines.

### Step 4 — Group the implementation by concern

Describe 3–6 logical changes.

Each item should answer both:

- what changed;
- why that change exists in the conceptual model.

Prefer:

> **Authority propagation:** Agent handoffs now carry governing anchors and requirements explicitly, allowing receiving agents to verify what constrains their work.

Avoid:

> Updated `general.md`, `current Loom role directive and control-plane state`, and `critic.md`.

File paths may be included when they help reviewers navigate, but file inventory is secondary to behavior.

### Step 5 — Give the reviewer a map

For broad or cross-cutting PRs, include **Review notes** identifying the 1–4 most important or risky areas of the diff.

Examples:

- the new security boundary;
- the compatibility-sensitive protocol change;
- the state migration;
- the central abstraction other changes depend on.

Do not enumerate every modified file.

### Step 6 — State verification as evidence

Verification should say:

```text
what was run/checked
→ what result was observed
```

Prefer:

> `go test ./...` — passed.

Over:

> Tests were added.

If verification was not possible, state what remains unverified.

---

## 3. PR body structure

A PR body must communicate these six pieces of information:

1. Why the change exists.
2. What the system does differently after merge.
3. Why the chosen direction is appropriate when that reasoning is non-obvious.
4. What major implementation concerns changed.
5. What deserves reviewer attention.
6. How the result was verified.

These are **information requirements, not mandatory headings**.

Use the smallest structure that teaches them clearly.

### Default non-trivial format

```markdown
## Why

<2–5 sentences describing the prior problem and desired outcome.
Include the before → after conceptual delta.>

<Optional ≤10-line mental-model diagram when useful.>

## What changed

- **Concern A:** <behavioral change and why>
- **Concern B:** <behavioral change and why>
- **Concern C:** <behavioral change and why>

## Review notes

<Only include when there are specific high-value review targets.
0–4 bullets.>

## Verification

- `<command/check>` — <observed result>
```

### Optional sections

Add these only when they carry useful information:

```markdown
## Why this approach
```

Use when meaningful alternatives or trade-offs existed.

```markdown
## Follow-ups
```

Use when intentionally deferred work matters to understanding the PR.

```markdown
## Breaking change
```

Use for externally visible compatibility breaks and explain migration impact.

Do not create empty or filler sections.

### Information budget

For a normal non-trivial PR:

- **Why:** 2–5 sentences.
- **Mental-model diagram:** ≤10 lines.
- **What changed:** 3–6 conceptual bullets.
- **Review notes:** ≤4 bullets.
- **Verification:** concise command/check + result entries.
- **Follow-ups:** only material deferred work.

If a section starts reproducing architectural design details, link the relevant design/decision document instead.

The PR body teaches the map. It does not reproduce the territory.

### Cold-reader test

Before publishing, ask:

> Could a competent engineer who has never seen this repository explain after one read:
>
> 1. why this PR exists;
> 2. what fundamentally changes;
> 3. which concepts/files matter most;
> 4. where review attention should go;
> 5. whether the change was actually verified?

If not, improve the narrative.

If yes, stop writing.

More detail is not automatically better.

## 4. Trivial-PR escape hatch

For PRs touching ≤2 files with a single clear concern (typo fix, doc update, one-line bug fix), the default non-trivial format is overkill.

**Threshold:** ≤2 files changed and a single clear concern.

**Functional test:** If Why/What changed/Verification would each be one sentence restating the same thing, skip them — don't manufacture prose to satisfy a template.

**Trivial format:**

```markdown
<one-line summary of what and why>

Changes: <one-line description>
Verification: <one-line description of how it was checked>
```

**Example of a trivial PR body:**

```markdown
Fix typo in README install section that caused `go install` command to fail.

Changes: Corrected import path in README.md line 42.
Verification: Read the rendered markdown; confirmed the path matches go.mod.
```

No Why, What changed, or Review notes sections — they would each be "fixed a typo in the README." The Changes and Verification sections still apply but collapse to one line each.

## 5. Relationship to commit messages

Commits (governed by `git-commit-discipline`) explain individual changes at the micro level. The PR body explains the whole at the macro level. They should not duplicate each other:

- **Commits say:** "In this specific file, I changed X because Y"
- **PR body says:** "We had problem P, so we changed approach A to approach B, which touched these files for these reasons"

A reviewer reads the PR body first for the story, then dives into individual commits for the details. The PR body is the map; the commits are the terrain.

**Do not copy-paste commit messages into the PR body.** The body is a synthesis, not a concatenation.

## 6. Failure modes

- **`gh pr create` fails:** Report the error to the user with the command output. Do not silently skip PR creation, do not fall back to printing the body as text, and do not retry without understanding why it failed (auth issue? branch already has a PR? title conflict?).
- **Mixed-concern commits:** If the branch has commits mixing unrelated concerns, either clean up the branch first (interactive rebase or squash) or describe what was tried and abandoned in the Follow-ups section. Do not ignore mixed concerns — they make the body harder to write and the PR harder to review.
- **Shared-state drift:** Body synthesis and PR creation should happen in quick succession. If you synthesize the body, then make more changes before creating the PR, re-synthesize — the body no longer matches the diff.
- **No diff to synthesize from:** If `git diff main..HEAD` is empty but commits exist, the branch may need rebasing. Do not create a PR with an empty diff.
