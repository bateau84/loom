---
type: Playbook
title: "Moving the OpenCode bundle out"
description: "Describes moving the legacy OpenCode bundle to the Loom plugin layout."
tags: [loom, migration, setup]
timestamp: 2026-10-24T00:00:00Z
---

# Moving the OpenCode bundle out

This is a breaking, draft change. `main` and its history remain unchanged until
an explicit merge. Do not run the new checkout as your OpenCode config root.

The skills have already been moved into an independent repository:
**[bateau84/skills](https://github.com/bateau84/skills)**. Its `skills/`
directory has the same Git tree SHA as the original Loom `skills/` directory on
`main` (`14b6ce8c73e338ba2c03def4f5a23a9f7459c81a`), confirming the
snapshot is identical, including `SKILL.md`, `ASSESSMENT.md` and `QA.md` files.
This confirms the copy, **not** that all old Loom workflow references have been
ported or that skills are installed and discovered on the local OpenCode host.

**Keep agent definitions, personal configuration, launchers and themes outside
the plugin.** The verified active installation now uses current native agent
definitions/mappings; that is not automatic migration for other hosts. Removed
external Loom skills must stay removed; use the plugin's bundled `loom` guide.
The helper below makes a lossless legacy
snapshot for that work and optional skill backup. It does not install skills,
change OpenCode settings or create another repository.

## Preserve the configuration first

From a checkout containing this PR and its parent history:

```sh
python3 tools/export_legacy_config.py /absolute/path/outside/loom/opencode-config
```

The default source is the PR base, `c16e2c793b8faa8d21cf2ca9833606676e461e79`.
To preserve newer agent/skill changes on a different local branch, pass its ref:

```sh
python3 tools/export_legacy_config.py /absolute/path/opencode-config \
  --ref functionality-anchor-requirements-coherance
```

The destination must be new and outside the plugin checkout. The helper exports
tracked agents, skills, themes, profiles and `ocw` launchers only. It does not copy
untracked profiles, local YAML, secrets or machine-specific OpenCode settings.
Preserve those separately before moving your active configuration. Exporting an
existing destination fails rather than merging or overwriting it.

Keep exported agent definitions and other OpenCode configuration in your chosen
independent config repository/location. Use [bateau84/skills](https://github.com/bateau84/skills)
as the canonical skills source instead of copying skills back into Loom.
Install/discover those skills using native OpenCode conventions; for example,
the checkout's `skills/` directory is the content source for supported local
skill installation. The Loom plugin must not require a fixed skills checkout path.

Agent prompts in the old bundle still reference removed Loom tools such as
attachment, approval and completion operations. Port those prompts to professional
role guidance without the old machinery before using them with this plugin.
Also audit the copied skills for references to old control-plane state, workflow
gates and required agent names (the copied `skills/README.md` still describes
these). Preserve portable methodology and Assessment/QA companions; do not
mechanically remove all Loom references or assume the copy itself is a port.

## Install the plugin separately

Keep a distinct checkout for the plugin, install its dependencies, and add its
absolute directory to the `plugins` array in your existing OpenCode config.
Do not install old and new Loom runtimes together: both use the `loom` plugin ID.
Add `.loom.yaml` to the external OpenCode config directory, using names that
actually exist in your native agent definitions. Keep personal YAML untracked.

## State and rollback

The Action runtime uses a separate `actions-v1` database path. It does not mutate,
upgrade, delete or automatically import the old workflow ledger. Keep old workflow
state for inspection with the old plugin until a provenance-preserving importer exists.

Upgrading an existing **Action Store** is a different boundary. Close all writers
and SQLite connections and preserve its original files/sidecars using the
[manual stopped-writers backup/restore procedure](manual-backup-restore.md).
The retired sender's tables/projections are left in place without operational
hydration, migration or dispatch. Meaningful populated synthetic legacy history
is preserved by the frozen baseline fixture and compared through candidate reads.
Do not infer universal schema compatibility from that fixture or `user_version=1`.
Unreadable/unsupported data must fail visibly, not reset/delete state. Current
startup does not reinterpret old authorization, infer blocking intent, rewrite
answers or reconstruct pending sends. Never reopen a preserved pending projection
with an older sender merely to finish delivery.

The captured observed-empty upgrade retained all 1,675 ledger records, 2 Actions,
4 Plans and 7 focus values byte-for-byte. Its private derivative exposed five
tools with zero Session/authorization/delivery I/O; actual operator startup then
succeeded and historical Actions/Plans were accessible normally. This is evidence
for that historical observed predecessor, not a rerun on this candidate or
universal legacy migration. Current retirement preserves populated history without
an operative sender; installed preservation acceptance remains separate. See the
[alpha evidence boundaries](operating-policy.md).

For rollback to the old workflow runtime, restore its previous plugin entry/
configuration and old bundle; that workflow database remains separate. This is
not permission to run an older Action writer against an upgraded Action Store.
Preserve version provenance and originals; restore/inspect only at a separate
location with the appropriate revision, following the manual procedure. Switching
plugin versions does not migrate active native agent conversations or replay work.

## Before the PR is ready to merge

For each installation verify its native agent mappings and any applicable external
engineering skills; do not restore removed workflow-specific skills. Use the
built-in guide and current registered help. The active host has bounded native
trial and fresh-Session evidence, summarized in [operating policy](operating-policy.md),
not whole-alpha acceptance. For a new host verify installation and its own work path;
confirm that the features still listed as outstanding in `docs/design.md` are
not needed for the release being tested. No existing open PR is superseded or
closed by this draft automatically.
