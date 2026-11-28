---
type: Qualification Report
title: "Session evaluation and incremental learning rebuild"
description: "Fresh implementation evidence, independent findings, resource measurements and remaining acceptance dependencies for issue 227."
tags: [loom, learning, qualification, sessions, recovery]
timestamp: 2026-11-28T00:00:00Z
---

# Session evaluation and incremental learning rebuild

This is a fresh reconstruction against merged main `687c0029ccb1f8231765aad271e87a5af3d1fd76`, which includes #262. Earlier temporary patch/package downloads became unavailable. Their lost receipts are not evidence for this reconstruction.

The implementation follows [ARD-018](../design/ard-018-session-evaluation-and-incremental-learning.md), [ARS-015](../spec/ars-015-session-learning.md) and [DS-001](../../design/design-spec/ds-001-session-learning.md). [#227](https://github.com/bateau84/loom/issues/227) remains open. A controlled fixture demonstrates the supported ordinary Session path; an authorized private historical Session and genuine qualified inference remain separate acceptance dependencies.

## What the controlled journey exercises

`tests/session-retrospective-browser/generate.ts` uses actual registered Loom callbacks and SQLite owners. Its host registration and permission transport are simulated. The Session has no Action, Plan or authored objective. Six authored records describe the intent, an unsuccessful restart, an unresolved Ethernet concern, a correction, a Wi-Fi check and an abandoned polling alternative.

Two deterministic increments process three new originals each. Repeated unchanged opportunities reuse their successful checkpoint. The second increment retains the earlier Ethernet concern and its exact source request. A seventh record resumes engineering work after subject establishment; it remains outside the frozen retrospective. Failed supported retrieval remains in the separate audit. A controlled S5 execution publishes an evidence-linked interpretation through the existing execution/publication contracts. No native history enumeration, original-conversation injection or production model dispatch occurs.

The generated manifest binds source file hashes and all HTML/JSON/Markdown bytes, records exact final disclosure hashes, and reports elapsed time, peak RSS, returned bytes and source-owner reads. These measurements describe the complete fixture generator, not a production-agent budget or a comparison with the previously reported 840 MB crawler.

## Independent findings and corrections

An independent reviewer exercised actual registered readers and persisted owner state. The review found issues that schema validation alone would have missed:

| Finding | Correction and regression |
|---|---|
| Selecting one incremental original caused other originals to resolve without their exact grants. | Public source planning uses membership metadata and resolves/revalidates only the selected original. |
| Retained earlier concerns needed permissions beyond the newest increment's membership. | Metadata-only dependency unions include retained originals; stamped read snapshots reject changed pages or newly published dependencies before hydration. |
| Legacy evaluation readers could accept new incremental batch IDs. | Legacy readers and preparation reject the incremental scopes before report or original reads. |
| Code Mode inner calls share outer session/message/call IDs. | Classification excludes the proven Code Mode wrapper while preserving colliding engineering shell/read observations. A bounded observation hint survives a failed preview audit until the normal wrapper finish. |
| Cross-owner population read attached the wrong subject to the reader's audit. | Foreign evidence remains authorized normally; audit attachment is limited to the subject owner. |
| An empty preview advertised an impossible freeze. | It now explains the empty boundary and returns no freeze request. |
| Audit/hint persistence could become a preview prerequisite. | Preview rendering remains available when optional audit or wrapper-hint recording fails. |

The earlier review was a finding record on a changing candidate, not approval of the final revision. Final review and integration receipts must name the candidate they inspect.

## Persisted membership and late classification

Report-level mixing alone does not establish a storage defect. Controlled state tests independently exercise persisted membership. A wrapper start can be processed before a later supported read reveals its learning purpose. The retained population and report bytes are not rewritten. Current readback withholds the affected interpretation; a subsequent checkpoint withdraws the proven learning source. An unavailable ordinary engineering original cannot use that recovery path or advance the cursor.

This demonstrates the specific late-classification case and its recovery. It does not establish what happened in the unavailable private Waybar database. Unknown native ancestry and ambiguous inner invocation identities remain explicit limits; an agent name is not classification evidence.

## Recovery evidence

`tests/session-learning-backup-native.test.ts` exercises the actual stopped paired-backup/restore command with ordinary Session subjects, two increments, failed retrieval audit, child/grandchild learning provenance, V2 preparation, controlled S5 publications, an actual prior-original receipt, pending method work without authority, and a no-inference checkpoint preserving the latest synthesis.

The new suite passed 13 tests and 99 assertions. The Python backup suite passed 30 tests. A broader native backup run passed 104 tests and 682 assertions before the final two new cases and bounded lookup cleanup; the complete new suite and Python checks were rerun afterward. Tests reject checksum-consistent invalid owner cursors, broken predecessor continuity, omitted committed prefixes, missing dependencies, changed member slots and invalid prior-original bindings before a restore destination is created. Missing engineering originals remain preservable offline but make dependent learning unavailable after restore.

## Human comprehension and retrieval

An independent fresh agent used only four rendered HTML documents, registered tool help and the bounded public reader. It could identify the attempted restart, abandoned alternative, correction, remaining Ethernet gap, later continuation exclusion and separate failed retrieval audit. It used three selected originals, rather than fetching all six. Nine public-reader calls included seven successes and two avoidable failures: the harness added an unsupported format to an audit request, and its lower page bound was not documented. Both harness issues were corrected. UI feedback also corrected increment numbering, ambiguous “no change” wording, duplicated evidence backlinks and visibility of the separate audit request.

This was an HTML-as-text comprehension exercise, not browser or human-user qualification. The Chromium journey separately exercises actual anchors, source disclosures, conclusion/counterevidence/backlinks, supported original retrieval, keyboard focus, narrow reflow, inertness and axe. A local standard Chromium download returned HTTP 403, so no local browser pass is claimed. The existing read-only GitHub Actions browser workflow now includes the Session journey and retains its reports and screenshots.

## Reproduction and final gates

Use the repository-pinned Bun and dependency lockfile:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test:core
bun run test:native
bun run test:python
bun tests/session-retrospective-browser/generate.ts /absolute/fresh-fixture-directory
node tests/session-retrospective-browser/qualify.mjs /absolute/fresh-fixture-directory /absolute/report-directory
```

The browser command requires the pinned test-only Playwright/axe prefix and Chromium described by `.github/workflows/engineering-history-browser.yml`. Browser dependencies remain outside the plugin dependency graph. Actual Code Mode validation uses the existing isolated `LOOM_CODEMODE_ROOT` qualification path; the tool discovery budget has not been increased.

Final integrated test, browser and review results will be recorded on the draft PR and in this report. A successful controlled fixture is not approval for production execution.

## Remaining acceptance dependencies

- An authorized ordinary historical Session from its supported source owner, including its actual missing/denied evidence boundaries.
- A human walkthrough of the preview, frozen foundation, conclusions and selective original navigation, including accessibility needs beyond automated checks.
- Qualified native execution provenance, protected recipient transfer and configured usage/resource authority for a real provider/model route. Deterministic learning is available without those capabilities.
- Genuine inexpensive-model interpretation and stronger-Evaluator synthesis quality on that real evidence. Scripted S5 output proves contracts, not reasoning quality.
- S5's existing 32-report context bound still applies. A long-running method must narrow or rebase its admitted context explicitly; it must not silently discard important earlier findings.

No additional scheduler, evidence database, transcript crawler or production execution authority was introduced.
