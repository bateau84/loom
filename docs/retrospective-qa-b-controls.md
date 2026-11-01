# QA-B control evidence

QA-B keeps source creation, independent retrospective investigation, and five
adversarial controls separate. Discovery remains part of the primary investigator
scenario. The read-denied, inaccessible-child and privacy controls now name the
actual candidate Session and export path to exercise: a model must still call
the installed trace tool and report what happened. These requests do not supply
source-event IDs, expected results or permission grants.

## Run and inspect

Use the existing [QA-B runbook](retrospective-qa-b.md) with a new private report
directory. `--continue-on-unproven` attempts the controls even when the primary
investigator is unqualified; it cannot turn missing evidence into acceptance.
It spends additional real-model quota.

The terminal summary includes `control_diagnostics`: execution, native evidence,
acknowledged limitations, reply completeness and a bounded reason code. It does
not print prompts, model replies, source IDs or raw provider errors.

For each attempted control, `controls/<name>.json` retains the prompt, complete
reply, Session identities, model, audit interval and result. The directory is
mode 0700 and files are mode 0600, outside the disposable model project. Treat
these files as private: a failing privacy test can contain the synthetic secret
it was meant to withhold. Inspect before sharing. No automatic upload occurs.
Replies over 256 KiB are marked incomplete rather than clipped and accepted.
A write failure cannot leave a control marked PASS or erase an observed FAIL.

## Regrade without another model call

Run the existing offline command against the same report directory:

```bash
python3 tests/retrospective_qab_regrade.py --report-directory /PRIVATE/results
```

Where complete control evidence exists, the regrader validates its target
identities, model and audit interval, then reapplies the same control evaluator.
`replayed_controls` names the controls it actually rechecked. Historical bundles
without these files retain their previous control verdicts. A saved 200-character
excerpt is not a complete reply, and skipped controls remain UNPROVEN. Original
FAIL results remain FAIL; missing files or incomplete evidence cannot override
a demonstrated access or privacy violation.

This is deterministic evidence scoring, not an independent semantic review.
Full QA-B still requires the primary investigator and all five controls to
qualify, followed by review of factual accuracy and attribution in the report.
