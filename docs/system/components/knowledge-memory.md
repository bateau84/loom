---
type: component
title: Loom Knowledge and Memory
description: Durable OKF navigation, living system documentation, and evidence-backed learning.
tags: [component, loom, okf, memory, synabun]
---

# Knowledge and Memory

## Current Repository Knowledge

OKF-MCP provides discovery over durable repository documents.

Current implemented system knowledge lives under:
- `docs/system/**`
- `docs/user/**` when user/admin guidance exists.

The Documenter updates only represented reality and verifies discovery through OKF before `knowledge-sync` can complete.

## Learning

Loom plugin storage is canonical for episode/heuristic identity, evidence, lifecycle, and validation state.

SynaBun provides semantic recall. Recalled `LOOM_EPISODE_ID` values are resolved back to Loom canonical records before use.

Source:
- `plugins/loom/knowledge.ts`
- `plugins/loom/learning.ts`
- `plugins/loom/synabun.ts`
- `agents/documenter.md`
- `opencode.json`

## Depends on

- [Verification](verification.md)
