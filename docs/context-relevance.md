# Useful context without more orchestration

This follow-up to `e6fef59` addresses review finding B: routine observations
must not displace the conclusions an agent needs when resuming work. It also
makes this context read use one Action/Plan/ledger snapshot. It does not add a
tool, model call, scheduling rule, mandatory review stage or permission gate.

## Retrieval policy

For a selected Task, consider that Task, the Action, and relevant parents and
dependencies in breadth-first order. Unrelated sibling records are excluded.
Read the latest two records of each kind (`result`, `qa`, `assessment`, `claim`)
for each considered scope, separately from observations. Interleave scopes and
kinds before considering second-most-recent records. Thus routine tool activity
cannot displace a result, and numerous local claims cannot crowd out every
dependency result or review finding.

The bounded sample considers at most 16 scopes and returns up to 48 conclusions
plus 8 recent relevant observations. Per-kind queries use partial indexes that
exclude observations. Action-only context reads recent conclusions across the
Action without requiring a plan. This is deterministic sampling, **not semantic
ranking**: older important conclusions may still fall outside the sample when
there are many newer conclusions of the same kind. No automatic resolution,
supersession, truth, independence or success is inferred from rank or recency.

`retrieval.scopes_omitted` and `ledger_has_more` disclose sampling limits. Exact
records and full paged history remain available through `loom_record`; scope
limits do not delete records or change the selected work.

## Compact output

When the full context exceeds `context.max_chars`, keep a short goal and Task
context, then prioritize excerpts of conclusions, followed by related Task
summaries, observations and the plan map. This replaces the old IDs-only fallback.

The serializer measures actual JSON length, including escaped characters. It
marks the response and compact records as truncated, reports omitted candidate
records and plan entries, and retains the IDs needed for exact retrieval:

```text
loom_record(operation="query", action_id="...", record_id="...")
loom_plan(operation="read", action_id="...")
```

Excerpts are source-text prefixes, not generated summaries. **A qualification may
be outside an excerpt.** Read the full record/contract before relying on it for a
consequential decision. A `contract_match` value remains a plan/goal comparison,
not revalidation of the code or of an agent's claim.

## Consistency

The context reader opens one synchronous SQLite read transaction and reads the
Action, latest Plan and record sample in that snapshot. Contract comparisons use
those same in-memory objects with one fingerprint per referenced subject, rather
than reloading the Plan for each record. A controlled two-connection WAL test
commits a new goal, Plan and result after the reader's first query; the response
retains the old snapshot consistently, and the next read sees the new version.

SQLite describes the underlying WAL snapshot behavior at
https://www.sqlite.org/isolation.html. This does not make separately committed
writer updates atomic, nor does it claim to fix every other reader in Loom.

## Verification and remaining limits

Focused tests cover observation noise, busy local conclusions, dependency and
parent results, separate Assessment/QA findings, conflicting review records,
small/escaped output budgets, exact retrieval, fresh-Session selection, unchanged
history, historical contract matches, scope-limit notices and snapshot consistency.

The candidate row/query counts are bounded, but **this is not a total processing
or input-size limit**. Plan text and individual stored records may still be large;
full payload parsing, observation filtering, index creation and serialization
costs need separate limits and representative measurements. Do not mark finding E
closed merely because output length and this context snapshot are tested.

Removed-task recovery notices remain separate work. This patch preserves the
existing error behavior, with transaction rollback so it cannot leave the read
transaction open. Independent review, an installed OpenCode smoke test, frozen
installation and the reproducible two-agent release scenario remain outstanding.
The PR stays a draft. Tests of local SQLite/context functions are not live-host
acceptance or evidence of improved model task quality.
