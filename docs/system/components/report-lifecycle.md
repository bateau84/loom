---
type: component
title: Loom Report Lifecycle
description: Standard lifecycle for ephemeral operational reports and explicit durable promotion.
tags: [component, loom, reports, okf, governance]
---

# Report Lifecycle

## Default: ephemeral

Loom distinguishes durable repository documentation from execution reports.

Operational reports are ephemeral by default, including:
- Reviewer and Critic reports;
- failed or successful gate/readiness reports;
- design validation reports;
- diagnostic/debug investigations;
- transient research reports;
- eval/run summaries.

When a report needs file persistence, write OKF-compliant Markdown under:

`ephemeral-reports/<producer-or-kind>/<report>.md`

The repository ignores `ephemeral-reports/` in Git. OKF-MCP remains the discovery/read surface for compliant reports.

### Loom OKF report profile

Persisted operational reports use this minimum profile:

```yaml
---
type: report <producer>
title: <non-empty title>
description: <non-empty description>
tags: [report, <producer>, <other-string-tags>]
---
```

`type: report` without a producer suffix is also accepted. Frontmatter must be valid YAML; `title` and `description` must be non-empty strings; `tags` must be a non-empty array of non-empty strings. Report-producing roles validate persisted reports through OKF-MCP before relying on discovery. `loom_report_promote` independently parses the YAML and enforces this minimum profile before copying.

A report is evidence or analysis. Its location never upgrades its semantic authority.

## Durable reports

Raw reports are committed only when the report itself has lasting documentary, audit, historical, or compliance value.

Durable raw reports live only under:

`docs/reports/**`

Agents must not write directly there. General performs explicit promotion through `loom_report_promote`.

Promotion:
1. accepts one Markdown source under `ephemeral-reports/`;
2. requires OKF-style report frontmatter;
3. accepts one destination under `docs/reports/`;
4. copies bytes unchanged;
5. retains the ephemeral source;
6. rejects overwrite and path/symlink escape;
7. persists a Loom audit record containing source, destination, reason, SHA-256, actor, timestamp, status, and unchanged authority;
8. exposes successful promotion metadata through Loom evidence;
9. leaves report authority unchanged.

If only a conclusion inside a report is durable, the owning role updates the correct requirements, design, architecture, system, or user document instead. The raw report stays ephemeral.

## Skill policy

The `report-to-keep` skill decides whether retention is appropriate. It does not search, index, transform, or copy reports.

OKF-MCP owns report discovery. Loom owns the controlled promotion transition.

## Source

- `plugins/loom/reports.ts`
- `skills/report-to-keep/`
- `agents/general.md`
