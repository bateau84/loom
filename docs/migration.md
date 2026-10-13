# Moving the OpenCode bundle out

This is a breaking, draft change. `main` and its history remain unchanged until
an explicit merge. Do not run the new checkout as your OpenCode config root.

The removed agent and skill content is **not yet relocated to another GitHub
repository**. No destination was selected. It remains recoverable from the PR's
parent commit. The helper below provides a lossless, separate export; it does not
change your OpenCode setup or create a repository on your behalf.

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

Keep this export in your chosen independent configuration repository/location.
Agent prompts in the old bundle still reference removed Loom tools such as
attachment, approval and completion operations. Port those prompts to professional
role guidance without the old machinery before using them with this plugin.
Do not mechanically delete all paragraphs mentioning Loom; that could remove
useful review/QA reasoning. The external skills' domain material should be retained.

## Install the plugin separately

Keep a distinct checkout for the plugin, install its dependencies, and add its
absolute directory to the `plugins` array in your existing OpenCode config.
Do not install old and new Loom runtimes together: both use the `loom` plugin ID.
Add `.loom.yaml` to the external OpenCode config directory, using names that
actually exist in your native agent definitions. Keep personal YAML untracked.

## State and rollback

The new runtime uses a separate `actions-v1` database path. It does not mutate,
upgrade, delete or automatically import the old workflow ledger. Keep old state
for inspection with the old plugin until a provenance-preserving importer exists.

To roll back, restore the previous plugin entry/configuration and old bundle;
the old database has not been changed. The new Action data remains separate.
Switching plugin versions does not migrate active agent conversations.

## Before the PR is ready to merge

Verify external agents/skills independently; verify plugin installation on the
actual host; exercise a task, replan, cross-session context read, Assessment and QA;
confirm that the features still listed as outstanding in `docs/design.md` are
not needed for the release being tested. No existing open PR is superseded or
closed by this draft automatically.
