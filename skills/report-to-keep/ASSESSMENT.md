# report-to-keep Assessment Contract

Reviewer treats report promotion as controlled retention.

## Review criteria

- the selected source is the intended report under `ephemeral-reports/`, follows the Loom report profile, and has successful OKF-MCP validation rather than only frontmatter-looking text;
- promotion is justified by lasting value of the report itself, not merely by useful conclusions inside it;
- durable conclusions that belong in requirements/design/architecture/current-reality docs are routed to the role that owns that artifact instead of using a raw report as substitute authority;
- destination is under `docs/reports/`, is non-colliding, and does not overwrite another durable report;
- promoted bytes preserve the original report exactly, including verdict, confidence, provisional wording, and provenance;
- the source remains intact;
- promotion is performed through `loom_report_promote`, not a generic write/copy;
- durable placement is not described as approval or semantic elevation.

Block when the wrong report is retained, report meaning changes, existing durable evidence can be overwritten, or promotion is used to smuggle execution output into authority-bearing documentation.
