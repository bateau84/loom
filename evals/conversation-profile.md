---
type: evaluation
title: Conversation Instruction Delivery Probe
description: A zero-inference standalone OpenCode check of General's instruction delivery, with explicit proof limits.
tags: [evaluation, loom, conversation, evidence, integration]
---

# Conversation instruction delivery

Repeated response failures can come from incomplete instruction delivery or from the model not following instructions it received. A wrapper-construction test alone cannot distinguish them. This probe checks delivery before more paid prompt-tuning runs.

## Run

With the supported OpenCode CLI installed:

```sh
python3 scripts/verify_conversation_profile.py
```

The probe is also included in `bun run integration:opencode`, after the existing host integration test. Ordinary `bun run test` runs only the probe's unit-level negative controls; it does not start OpenCode.

## What is checked

The probe uses the real `setup_projects` conversation-response wrapper, the current General file, and the existing HUMAN-06 secure-access scenario from the default suite. It invokes the standalone OpenCode CLI with an explicit agent, model, and fixed title, matching the inspected eval transport's invocation shape. A temporary local fake provider records the HTTP request and returns a fixed reply without calling a model.

Success requires all of the following:

- General's complete body appears in provider instruction roles, not merely in user text. Only outer Markdown whitespace is ignored; internal text must match exactly.
- The scenario appears in user input and the case's judge-only grading strings do not appear in message content.
- The standalone CLI exits successfully and returns the fake provider's reply as a structured text event.

The process uses fresh temporary home/config/data directories, an environment allowlist, and only the local dummy provider. User credentials are not loaded. The fake endpoint binds only to loopback. Temporary files and the process are cleaned up on success or failure. The probe prints receipts and the source-body hash, rather than a full provider prompt.

Negative controls reject no request, incomplete or changed policy, policy in the wrong role, missing scenario, unexpected model, leaked grading, and an echoed response marker without a real text event. A success in one captured request cannot hide a bad captured request.

## Proof limits

This is an installed-CLI/local-provider integration check, not a replay of the user's OCI container, real provider adapter, or historical session. Its source hash identifies this probe's source body; it does not retroactively bind old eval artifacts to that revision.

A PASS does not show that Luna or another model follows the communication contract. It does not close a behavioral failure, establish model quality, or prove interruption/timing behavior. Keep the [actual-response evals](human-interaction.md) and their historical results separate.

The initial probe's health-parser and outer-whitespace mismatches were probe defects, not proof that General was absent. The final probe uses the actual standalone CLI entry path and retains exact matching of the meaningful instruction body.
