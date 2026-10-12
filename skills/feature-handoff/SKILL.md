---
name: feature-handoff
description: Transfer an actionable, self-contained dependency request to another component, repository, or fresh agent session. Preserve enough background, decisions, evidence, and expected outcomes that the receiver does not need the original conversation. Use focused YAML for simple seams or context-rich Markdown for unfamiliar or complex work. Not for Loom internal task routing or replacing durable specifications.
---

# Feature handoff

Use this skill when work in one context discovers a dependency that another independently handled component, repository, or session must address.

A handoff is a **copy/paste transfer of understanding and an actionable request**, not a raw chat summary. The receiver may know little about the source product, its terminology, or why earlier decisions were made. Optimize for **minimum reconstruction effort**, not minimum document length. One sufficiently complete handoff is better than a short handoff that forces the receiver to rediscover the source session.

## Authority and scope

A handoff conveys existing intent; it does **not** create new product or architecture authority.

- Preserve accepted requirements, constraints, and decisions at their established strength. Link their authoritative artifacts when available.
- Separate **verified facts**, **source-side reports**, **assumptions**, **proposals**, and **open decisions**. Do not present an inference as observed implementation.
- Describe needed outcomes before suggesting a solution. A convenient endpoint or payload is not automatically a required contract.
- Explain relevant existing implementation and useful code entry points when known. Do not dictate speculative receiver-internal architecture, task decomposition, or an unapproved plan.
- State what the receiver is being asked to do (investigate, design, implement, review, or continue), and what should come back. Do not imply permission to broaden scope, use secrets, merge, or otherwise bypass existing authorization.
- If the work needs a new correctness-sensitive normative contract, use `obligation-contract`; if it needs a durable behavioral or architectural specification, use `behavioral-spec` or `architectural-spec`. A handoff can point to these artifacts but does not replace them.
- Do not use this skill for Loom's internal task routing or as a substitute for its authoritative workflow state.

## Choose the level of detail

**Focused handoff — YAML v1:** Suitable for a narrow, well-understood dependency with shared vocabulary, few decisions, and little background needed. Preserve the existing v1 shape when a receiver expects it.

**Context-rich handoff — Markdown v2:** Prefer for a different repository or fresh session, unfamiliar domain language, multiple interacting systems, security/authorization concerns, material research, prior decisions, or significant unknowns. Use a small YAML frontmatter for identification and Markdown prose for explanations.

These are options, **not mandatory checklists or length tiers**. Follow a caller's requested format and a receiver's established machine-readable contract. A short handoff can include more context; a rich handoff can be brief. Add, rename, combine, or omit prose sections based on what the receiver actually needs. Do not create filler merely to match a template.

When in doubt, preserve a little more *relevant reasoning and context*, especially across repositories or sessions.

## Build the handoff

1. **Orient an unfamiliar receiver.** Identify source and target repositories/components or responsibilities. Explain the product use case, user journey, and important terms or acronyms before relying on local jargon. If the target is unknown, name the needed responsibility rather than guessing.
2. **Explain why now.** Describe the originating problem, the current limitation, the desired end-to-end result, and why the other component is involved.
3. **Transfer system context.** Summarize relevant data/identity flows, integration boundaries, existing behavior, and interaction with other components. Include known code locations or interfaces when they save investigation, but do not invent locations or designs.
4. **Preserve research and decision history.** Carry forward findings, established decisions and reasons, meaningful alternatives considered or rejected, and assumptions that affect the next step. Do not turn a preference into an accepted decision.
5. **Separate outcomes from mechanisms.** State the receiver-visible behavior, necessary requirements, constraints, non-goals, and proposed interfaces. Mark any interface as `required`, `suggested`, or `example`; say why if that distinction matters.
6. **Make verification possible.** Include integration-facing acceptance conditions, failure cases, and relevant security or lifecycle cases where material. A full Given/When/Then list is optional, not a format tax.
7. **Make the request actionable.** Name the requested type of work, any scope/authority limits, decisions the receiver may own, and the expected response or deliverables (for example, agreed contract, tests, documentation, or unresolved blockers). Do not add an invented implementation plan.
8. **Carry useful evidence.** Prefer stable repository paths with owner, branch/commit when relevant, and precise findings; link documents, PRs, tests, and public references. Summarize crucial inaccessible information instead of depending on a chat or screenshot. Do not copy credentials, tokens, or other secrets.
9. **Surface unknowns honestly.** Identify unresolved questions and, when useful, whether they block implementation or belong to the receiving side. Do not guess to make the handoff appear complete.
10. **Run the fresh-session test.** With no source conversation, can the receiver explain *why this exists, how the systems fit, what is known, what is settled vs proposed, what it must accomplish, how success is checked, and what to return*? Fill genuine gaps before trimming words.

### Requirement levels

When giving normative requirements stable IDs, use them deliberately:

- **MUST** — necessary for the established outcome.
- **SHOULD** — expected unless the receiver has a concrete reason to choose differently.
- **MAY** — optional capability or convenience.

Keep stable IDs such as `REQ-001` and `AC-001` when another session may refer to them. Do not label a suggested implementation as MUST simply because the source envisioned it.

## Focused format: YAML v1

This is the existing compatible shape for concise handoffs. Omit unused optional sections, but expand context when needed to make the request standalone. Do not silently change the structure for an established v1 consumer.

```yaml
kind: feature-handoff
version: 1
title: <short descriptive title>

source:
  component: <component, repository, subsystem, or responsibility>
  need: <why the source side needs this>

target:
  component: <component, repository, subsystem, or responsibility>

objective: >
  <end-to-end outcome this dependency enables>

context:
  current_behavior:
    - <relevant existing behavior, gap, or finding>

requested_behavior:
  - <observable outcome at the integration seam>

requirements:
  - id: REQ-001
    level: MUST
    text: <single falsifiable requirement>

acceptance:
  - id: AC-001
    given: <relevant starting condition>
    when: <interaction or trigger>
    then: <observable result>

constraints:
  - <material established constraint>

non_goals:
  - <explicitly excluded behavior when useful>

interface:
  status: suggested # required | suggested | example
  description: <established contract or proposal>
  example: <optional payload or interaction example>

open_questions:
  - <unresolved question that must not be silently decided>

evidence:
  - <durable reference plus what it establishes>
```

## Context-rich format: Markdown v2

The frontmatter identifies the handoff; the document itself is **flexible prose**, not a fixed schema. The headings below are prompts for useful information, not required sections. `version: 2` denotes this Markdown presentation; it does not claim compatibility with a v1 YAML parser.

```markdown
---
kind: feature-handoff
version: 2
title: <outcome-oriented title>
source: <repository or component>
target: <repository or responsibility>
purpose: <implementation-request | investigation | review | continuation>
---

# Requested outcome

What should become possible, for whom, and what the receiving side is asked to do.

## Background and user journey

Why the feature exists, what happens today, and where the user gets blocked.
Define source-specific terms the receiver might not know.

## System context and verified findings

Relevant components, data/identity flows, current contracts, and useful code
entry points. Distinguish inspected code from source reports and assumptions.

## Decisions and rationale

Accepted decisions and reasons; material alternatives not chosen.
Keep suggestions and undecided questions visibly separate.

## Requirements, interfaces, and boundaries

Required observable behavior, constraints, non-goals, and integration shape.
Label proposed interfaces as suggested/example rather than established.

## Acceptance and failure cases

How the two sides can verify the outcome, including relevant error paths.

## Open questions and receiver discretion

What is unknown, what blocks work, and what the receiver may decide.

## Expected return

What the receiving session should report or deliver back to the source.

## Evidence and references

Repo/path/ref + finding; durable specs, tests, PRs, and relevant research.
```

### Illustrative rich handoff

The following names and details are fictional. This example demonstrates *how to convey context and uncertainty*, not an authorization or a reusable API contract.

```markdown
---
kind: feature-handoff
version: 2
title: Let the repository console discover current-user Admin capability
source: example/repository-console
target: example/repository-api
purpose: implementation-request
---

# Requested outcome

The console needs to know whether the signed-in user may use the API's
Admin-only repository team-management controls. The API should provide a
caller-scoped capability response; the console will integrate it separately.

## Why and how it is used

On a repository details page, ordinary users can view team ownership. Admins
also need controls to manage team assignments. The page currently cannot
determine whether to display those controls. This request is about UI
discovery, not changing authorization for writes.

## System context and confidence

- Established for this example: the console makes user-scoped requests through
  its server; the API independently authorizes team-assignment mutations.
- Source report, not independently verified: no caller-capability read is
  exposed for this screen.
- Not yet checked: whether the API already has a reusable capability endpoint
  or authorization predicate. Inspect the receiving repository before adding one.
- Identity boundary: the browser must not receive the downstream access token.

## Decisions and contract boundary

- Required: reflect the authenticated caller, not a supplied user ID.
- Required: a capability response never authorizes a later write.
- Suggested, not accepted: GET /me/capabilities with
  can_manage_repository_team_assignments: boolean.
- Still open: whether the flag means Admin-only management or all assignment
  operations the caller could perform. Resolve this before fixing the response.

## Verification and expected return

Check Admin/non-Admin callers, failed lookup, and a forbidden write after a
positive UI hint. Return the chosen endpoint, exact capability meaning and
response, authentication/failure behavior, test evidence, and questions that
remain for console integration.

## References

Attach inspected repository/path/commit references and the finding supported
by each. No source code references have been verified in this fictional example.
```

## Output quality

- Make the artifact **as complete as needed to be understood independently**, not as short as possible. Relevance matters more than length; avoid raw transcripts and unrelated history.
- Prefer a short, clear explanation of a decision's *reason* over unexplained decisions or a wall of links.
- Be specific about which repository owns a fact or document. If access to a reference is uncertain, summarize the essential fact and flag the limitation.
- Do not invent source evidence, receiver internals, user permissions, or accepted scope to fill a section.
- Preserve concrete payload examples and edge cases where they remove ambiguity; label examples honestly.
- A handoff is not a substitute for an implementation plan, independent review, or authoritative specs. It should allow those to begin without reconstructing the originating conversation.
- By default, output just the handoff artifact unless the caller requests discussion around it.
