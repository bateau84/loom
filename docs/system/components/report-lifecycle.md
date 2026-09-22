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

`type: report` without a producer suffix is also accepted. Frontmatter must be valid YAML; `title` and `description` must be non-empty strings; `tags` must be a non-empty array of non-empty strings. Report-producing roles validate persisted reports through OKF-MCP before relying on discovery. Each producing role has write access only to its own `ephemeral-reports/<role>/**` namespace; General cannot rewrite another role's report before promotion. `loom_report_promote` independently parses the YAML and enforces this minimum profile before copying.

A report is evidence or analysis. Its location never upgrades its semantic authority.

## Durable reports

Raw reports are committed only when the report itself has lasting documentary, audit, historical, or compliance value.

Durable raw reports live only under:

`docs/reports/<producer>/**`

Agents must not write directly there. General performs explicit promotion through `loom_report_promote`.

Promotion:
1. accepts one Markdown source under `ephemeral-reports/`;
2. requires OKF-style report frontmatter whose `report <producer>` type matches the source producer namespace when a producer suffix is present;
3. accepts one destination under the matching `docs/reports/<producer>/` namespace;
4. copies bytes unchanged;
5. retains the ephemeral source;
6. serializes promotion/recovery per destination with Loom's cross-process runtime lock;
7. hashes and validates the source before persisting a `pending` audit record with expected size/hash;
8. writes a same-directory temporary file and atomically hard-links it into the final destination without overwrite;
9. reconciles stale `pending` records on Loom startup by comparing the durable destination with the expected size/hash, completing matching publishes or failing safely when publication never happened or content differs;
10. persists source, destination, reason, SHA-256, actor, timestamp, status, recovery state, and unchanged authority;
11. exposes successful promotion metadata through Loom evidence;
12. leaves report authority unchanged.

If only a conclusion inside a report is durable, the owning role updates the correct requirements, design, architecture, system, or user document instead. The raw report stays ephemeral.

## Skill policy

The `report-to-keep` skill decides whether retention is appropriate. It does not search, index, transform, or copy reports.

OKF-MCP owns report discovery. Loom owns the controlled promotion transition.

## Source

- `plugins/loom/reports.ts`
- `skills/report-to-keep/`
- `agents/general.md`
