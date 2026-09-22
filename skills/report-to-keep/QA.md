# report-to-keep QA Contract

Attack false confidence around durable retention.

## QA criteria

- a failed or provisional gate report being described as approved because it was promoted;
- useful conclusions being used to justify keeping an otherwise disposable raw report instead of updating the correct governed artifact;
- path traversal, symlink escape, or alternate-path tricks around `ephemeral-reports/` and `docs/reports/`;
- collision or overwrite behavior that can replace unrelated durable evidence;
- crash/interruption between audit state and filesystem publication leaving partial, unrecoverable, or contradictory durable state;
- cross-process promotion/recovery races that can misclassify an in-flight promotion as abandoned;
- direct generic writes into `docs/reports/` that bypass the promotion seam;
- non-OKF or ambiguous source material being promoted as if provenance were established;
- transformations, summaries, metadata rewrites, or redactions silently changing the retained evidence;
- promotion by a role that does not own the retention transition.

Promotion should survive these attacks without increasing the report's authority.
