---
name: experience-design
description: Problem framing and scenario construction — the upstream discipline that identifies the actual human problem before any interface decision is made. Use when the problem is new or poorly defined, the interface type is unclear, the stated solution might not address the real need, or the user population is broad or unfamiliar. Not for information structure or navigation (→ `information-architecture`), per-action interface response (→ `interaction-design`), task-step sequencing (→ `user-flow-design`), or surface-specific design (→ `cli-design`, `tui-design`, `web-ui-design`, `desktop-ui-design`).
metadata:
  version: "1.0.0"
---

# Experience Design

## What this skill is for

Experience design is the entry discipline for every design engagement. It identifies the actual human problem from a stated request, defines the quality criteria a solution must meet, and produces the scenarios and experience goals that feed every downstream design discipline.

**Load this skill when:**
- The problem is stated as a request for a specific UI component, feature, or interaction ("add a button", "add a dashboard", "redesign the settings page")
- The interface type is not yet determined — could be CLI, TUI, web, desktop
- The human need behind the stated request has not been established in a prior, documented design
- The user population is unfamiliar, broad, or working in contexts that have not been analyzed

**Do NOT load this skill when:**
- The scope is explicitly limited to a named component-level change with a known, agreed problem statement (e.g., "fix this modal's focus trap") — verify the problem statement is accurate, then proceed directly to `interaction-design`
- This engagement validates an existing design against a known spec — load `design-validation` instead
- The problem space has been fully framed in prior design work and this engagement only extends a piece of it — re-read the prior experience goals before deciding if re-framing is needed

**Boundary:**
- Not for: information structure or navigation design (→ `information-architecture`)
- Not for: per-action interface response — what happens when the user does something (→ `interaction-design`)
- Not for: task-step sequencing — the order of steps in a user task (→ `user-flow-design`)
- Not for: surface-specific design decisions — command grammar, key bindings, layout (→ surface skills)

---

## The problem reframing protocol

A stated request is never a problem statement. It is a proposed solution. Experience design's first move is always to identify what problem the proposed solution assumes is real, then verify that assumption.

### Step 1 — Deconstruct the stated request

Ask: **What problem does this request assume to be true?**

The stated request embeds one or more assumptions about what is wrong for the user. Surface those assumptions explicitly before accepting them.

| Stated request | Embedded assumption | What to verify |
|---|---|---|
| "Add a confirmation dialog before delete" | Users are accidentally deleting things | Is accidental deletion the actual failure mode, or is the issue that the action is ambiguous and should be reversible instead? |
| "Add a dashboard" | Users need to see aggregated information at a glance | Do users actually want a dashboard, or do they need to get to specific information quickly — which a different structure might serve better? |
| "Add a progress bar" | Users are confused about how long an operation takes | Is duration uncertainty the problem, or do users not know whether their action registered at all? |
| "Add a settings page" | User-configurable preferences exist and users know what they want to change | Do users actually want to configure this, or does the system need better defaults? |

### Step 2 — Identify who is affected and in what context

This is not persona creation. It is a rapid characterization of the actual user in their actual situation.

Answer these questions with specificity:

**Who:** What is the user's role, expertise level, and relationship to this system? (A developer debugging a deployment pipeline is different from a sales rep entering customer data.) At minimum: domain expertise level (novice/intermediate/expert in this domain), frequency of use (occasional/regular/daily), and primary goal type (get information / accomplish a task / monitor a state / configure behavior).

**Context:** What is the user doing *around* this interaction? Is this a primary task or an interruption? What has the user just done before reaching this moment? What will they do immediately after? Physical environment (at desk, in the field, under time pressure)? Operating alongside other tools?

**Analogous systems:** What similar systems has this user likely spent time in? This is Jakob's Law: users spend most of their time in other systems and arrive with mental models formed by those systems. A developer who uses `kubectl` daily has strong expectations about CLI composability. A user who lives in Google Docs has strong expectations about collaborative, auto-saving documents. These expectations constrain what designs will feel coherent.

### Step 3 — State the human need, not the interface solution

A well-formed problem statement has four properties:
1. **Names who** — the user in their specific context, not "users in general"
2. **States what they are trying to accomplish** — the goal, not the task steps
3. **States what currently prevents success** — the gap the design must close
4. **Does not presuppose the solution** — no interface vocabulary

**Weak (presupposes solution):** "Users need a confirmation dialog so they don't accidentally delete items."

**Strong (states the human problem):** "A developer cleaning up a project who accidentally removes a shared resource may not realize the deletion was irreversible until collaborators report missing work — by which time recovery is expensive or impossible. The design must reduce the consequence of accidental destructive actions."

The strong version opens the solution space: reversibility, undo, pre-deletion impact preview, or a confirmation dialog are all options. The weak version closes the solution space prematurely.

### Step 4 — Construct 1–3 scenarios

Scenarios are the design's primary evaluation tool. A scenario must be specific enough to make design decisions visible — "will this design work for *this person* in *this situation*?" — without presupposing the solution.

**Scenario anatomy:** context / goal / task sequence / outcome

Every useful scenario includes a **failure path or edge condition**. A scenario that only describes the happy path is not useful — it fails to reveal where the experience can go wrong, which is what experience design is for.

**CLI example — scenario with edge condition:**
> **Context:** A developer running a deploy pipeline in CI automation; no interactive terminal, output piped to a log file. **Goal:** Verify that a deployment succeeded so the pipeline can gate the next stage. **Task sequence:** CI runner executes `deploy verify --env production`; captures stdout to the log; reads exit code. **Edge condition:** The command exits 0 but the deployment actually failed because the health check endpoint was temporarily unavailable. **Outcome:** Pipeline continues. The failure is discovered hours later by an alerting system.

This scenario constrains interaction design: exit codes must be semantically correct (0 = verified success only), health check failure must produce a non-zero exit, and the command must not be silent when the verification is inconclusive.

**Web UI example — scenario with error path:**
> **Context:** A project manager reviewing team progress on a Friday afternoon; multiple browser tabs open, working across a slow VPN. **Goal:** Export the current sprint status to share with stakeholders. **Task sequence:** Navigates to sprint view → selects export → waits for download → download appears to complete → attachment cannot be opened. **Error path:** The export silently failed due to a timeout; no error was surfaced; the file is 0 bytes. **Outcome:** User discovers the problem only when stakeholders cannot open the file.

This scenario constrains interaction design: export operations must surface failure states; file readiness must be confirmed before the download is presented as complete.

**TUI example — interrupted flow:**
> **Context:** An ops engineer running an interactive monitoring tool during an incident; simultaneously responding to messages in another window. **Goal:** Dismiss a resolved alert so it no longer appears in the urgent queue. **Task sequence:** Switches to monitor → identifies the alert → presses the dismiss key → switches away to respond to a message → returns 20 seconds later. **Interrupted path:** After switching back, the user is unsure whether the dismiss action registered (no visible confirmation persisted). **Outcome:** User dismisses the alert again, causing a duplicate action log entry.

This scenario constrains TUI interaction design: actions that change state must leave visible confirmation in the interface that persists long enough for a distracted user to verify.

### Step 5 — Define experience goals

Experience goals are qualitative criteria for what a successful interaction feels like — not what it does. They are the evaluation standard against which all downstream design decisions are tested.

**Format:** "This experience should feel [quality] because [user context and concern]."

| Task requirement (not an experience goal) | Experience goal |
|---|---|
| "The user can delete a file." | "The user feels confident they can undo or recover from mistakes, because destructive actions are reversible or clearly confirmed." |
| "The user can configure the deployment target." | "The user who has set up one deployment confidently applies that mental model to the next, because the configuration pattern is consistent across environments." |
| "The user can export data." | "The user who shares an export trusts that the recipient will receive what was intended, because the export process confirms successful completion before reporting done." |

Aim for 2–4 experience goals per design problem. More than four is usually a sign the goals are too granular (they have become task requirements) or too numerous (the problem scope is too broad).

### Step 6 — Check for premature interface framing

Before completing experience design, verify: **Has any design decision already been made about how the interface will work?**

Premature interface framing means a specific component, layout, or interaction pattern was decided before experience goals were established. The component decision then constrains all downstream work, even if it was the wrong choice.

Recognition signals:
- The design brief contains layout terms ("modal", "sidebar", "wizard", "drawer", "tooltip") before the experience goals are defined
- The brief describes a component's behavior without stating what human problem it solves
- The interaction model (CLI command, web form, menu) was decided before the surface type was evaluated against the user's context

When premature framing is detected: name the assumption explicitly, set it aside, and work through the problem reframing protocol. Then re-evaluate whether the assumed interface is still the right choice. Often it is — but the evaluation must happen, not the assumption must be preserved.

---

## Mental model alignment

Users form expectations about how a system will work based on prior experience with similar systems and with the world. These expectations are their **mental model** of the system.

When the system's conceptual model (how the designer organized it) conflicts with the user's mental model, interaction failures result — not because the user made a mistake, but because the design did not match their expectations. Nielsen Norman Group: "It's amazing how one misconception can thwart users throughout an entire session and cause them to systematically misinterpret everything that happens."

**Three design responses to a mental model mismatch:**
1. **Conform to the user's mental model** — the system adopts the organization or vocabulary the user already expects. Lower learning burden; higher initial design constraint.
2. **Invest in educating users** — the system adopts a different model and commits to teaching it. High cost; high rate of failure unless the new model is genuinely better and clearly communicated.
3. **Acknowledge and bridge** — the system provides a visible mapping between the user's expectation and the system's actual model (e.g., command aliases that map familiar terminology to new vocabulary). Pragmatic for incremental changes.

**How to reason about mental models without user testing:**

In the absence of research, use analogous-system reasoning:
- What other systems do users in this context spend significant time in?
- How do those systems organize this type of content or action?
- What would a user familiar with those systems expect by default?

For CLI users: `git`, `docker`, `kubectl` are the high-mileage reference systems. A developer who uses these daily expects `--help` flags, subcommand structure, non-zero exit on failure, and stderr for diagnostics.

For web app users: Google Docs, Figma, Notion, Slack, Gmail set the baseline for collaborative tool conventions. Users expect persistent state, auto-save, inline editing, and notification of changes made by others.

For TUI users: `htop`, `lazygit`, `k9s`, `vim` establish keyboard-first navigation, modal operation, and character-based layout as the baseline. Users expect `q` to quit, `h`/`?` to show help, and `j`/`k` for vertical navigation.

---

## Cognitive load

Cognitive Load Theory (Sweller 1988, refined by Sweller/van Merriënboer/Paas 1998) identifies three types of load on working memory:

- **Intrinsic load**: the inherent complexity of the task itself. Cannot be designed away; can be scaffolded.
- **Extraneous load**: load imposed by how information is presented — the tax the design adds on top of the real task. This is what bad experience design creates.
- **Germane load**: cognitive effort spent building useful understanding of the system. What good experience design supports.

Experience design's obligation is to **reduce extraneous load** (eliminate complexity the design imposes) and **support germane load** (help users build an accurate mental model of the system).

**Specific extraneous load generators to diagnose:**

| Extraneous load pattern | Example | Experience design question |
|---|---|---|
| Domain translation required | User must map their mental vocabulary ("sync my data") to the system's vocabulary (`db-sync --table accounts --operation upsert`) at every step | Does the design's vocabulary match the user's mental model of the task? |
| Information the user must carry across steps | User must remember a setting from step 2 to correctly interpret a result in step 5 | Does the design surface relevant context at the point where it is needed? |
| System state is invisible | User cannot tell whether an action registered without additional confirmation | Does the design communicate system state clearly enough to eliminate guessing? |
| Structural navigation mismatch | The system organizes content by its internal structure (modules, services, entities) rather than by user tasks | Is the organizational logic the user's or the system's? |
| Vocabulary inconsistency | "Archive" in one part of the system, "Hide" in another, "Deactivate" in a third — all for the same action | Is state vocabulary consistent throughout the experience? |

---

## Experience principles

An experience principle is a constraint derived from the experience goals and user context that all downstream design must honor. A good experience principle is:
- **Specific to the problem** — not a generic UX value
- **Falsifiable** — you can test whether a design honors it
- **Actionable** — it constrains actual design decisions

**Good experience principle:** "A developer using this CLI in a CI pipeline never sees output intended for human reading — status messages go to stderr, data goes to stdout, and any operation that fails exits non-zero."

This principle is falsifiable: does the command write diagnostic text to stdout? Does it exit 0 on a health check failure? The principle eliminates entire classes of design options.

**Weak (generic, not falsifiable):** "The experience should be intuitive." Every designer will agree, nothing is constrained.

**Weak (task requirement, not experience principle):** "The user can export data." This is an acceptance criterion, not a principle. It describes what the system does, not what quality the experience must maintain.

**Deriving experience principles from scenarios:**

For each scenario, ask: "What property must this experience maintain for this person in this situation to succeed?" The answer to that question is the experience principle.

From the CI pipeline scenario above: a developer in a non-interactive context cannot distinguish stdout from stderr visually, but their pipeline automation can. The experience principle protects the user who is not watching the terminal.

From the distracted ops engineer scenario: an engineer who returns to the TUI after an interruption must be able to reconstruct what state they left things in. The experience principle protects the user who cannot hold context across an interruption.

---

## Experience design outputs

Experience design produces four artifacts. These are the inputs to all downstream design skills.

### 1. Problem statement
The human need, not the interface solution. Named user in specific context, goal they are trying to accomplish, current obstacle to success, no interface vocabulary. One paragraph.

### 2. Scenarios
1–3 concrete narratives, each covering a specific person, context, goal, task sequence, and outcome. Each scenario must include at least one failure path, error condition, or edge case — not just the happy path.

### 3. Experience goals
2–4 qualitative criteria for what the interaction must feel like to succeed. Format: "This experience should feel [quality] because [user context and concern]."

### 4. Experience principles
Constraints that all downstream design must honor. Each principle is problem-specific, falsifiable, and actionable.

**What experience design does NOT produce:**
- Wireframes or mockups (→ surface skills, Hallmark, prototyping)
- Navigation taxonomy or information hierarchy (→ `information-architecture`)
- Step-by-step task flows (→ `user-flow-design`)
- Per-action response specifications (→ `interaction-design`)
- Visual design decisions (→ `visual-interface-design`, surface skills)

---

## When personas and journey maps are — and are not — useful

**Personas** are a tool for making user context concrete and communicable when multiple stakeholders need a shared reference. They are useful when:
- A team is designing for a user population they have not personally experienced
- Design decisions keep getting resolved by "our typical user would..." arguments that everyone defines differently
- The design must serve genuinely distinct user types with incompatible goals

Personas are not useful when:
- They are produced ceremonially to "follow the process" but contain no insight that changes a design decision
- The design has a well-understood user population (e.g., internal tooling for a known team)
- They are used as a proxy for scenarios — personas describe who, but scenarios describe what the person does and what goes wrong

**This skill does not mandate persona creation.** If a persona would produce insights that change design decisions, construct one. If it would not, construct a scenario instead. A scenario is almost always more useful for evaluating a specific design — it is falsifiable in a way a persona is not.

**Journey maps** are useful for identifying where in a larger workflow an experience is failing. They are useful when:
- The design problem spans multiple sessions, channels, or touchpoints
- The failure mode is in transitions between phases, not within any single interaction

Journey maps are not useful when:
- The design scope is a single screen, command, or interaction state
- They are produced without data or genuine analysis (hypothetical journey maps are often high-effort, low-insight)

Neither artifact replaces a scenario. Neither is a deliverable of experience design — both are instruments that may produce insight useful for problem framing.

---

## Failure modes

### Failure 1 — Designing the stated request instead of the human problem

The most common experience design failure. The design implements the feature as described without questioning whether it addresses the human need. The classic result: technically correct features that fail in use.

**Recognition:** The problem statement contains a solution ("add X" or "build Y") rather than describing a human situation and gap.

**Consequence:** All downstream work — interaction design, IA, surface decisions — is applied to the wrong problem. Redesign is expensive.

### Failure 2 — Premature interface framing

An interface component or pattern is decided before the experience goals are established. All downstream work then optimizes for the component rather than for the human goal.

**Recognition:** The brief contains layout or component vocabulary (modal, wizard, sidebar, drawer) before any experience goals have been stated.

**Consequence:** If the component choice was wrong, all downstream work is wasted. The design team defends the component because abandoning it "wastes all the work."

### Failure 3 — Happy-path-only scenario construction

Scenarios describe only the ideal case: user has the right information, has no interruptions, makes no mistakes, succeeds first try. The design is evaluated only against this scenario.

**Recognition:** All scenarios end with the user successfully completing the intended task. No scenario includes: missing information, a mistaken action, an interrupted session, a slow or failed system response.

**Consequence:** The experience fails users in realistic conditions. These failures are discovered in user testing (if it happens) or in production (if it doesn't).

### Failure 4 — Mental model mismatch left unexamined

The design follows an organizational logic that makes sense to the development team but conflicts with how users think about the problem domain.

**Recognition:** The IA or command structure mirrors the system's internal code structure (entities, modules, services) rather than the user's task vocabulary.

**Consequence:** Users learn workarounds or abandon the system. Retraining users' mental models is expensive and often fails — conforming to existing mental models from the start is cheaper.

### Failure 5 — Extraneous cognitive load from domain translation

The experience forces users to translate between their domain vocabulary and the system's vocabulary at every step.

**CLI example:** `db-sync --table accounts --operation upsert` when the user's mental model is "sync accounts." The user must know the system's internal vocabulary (table names, operation names) to accomplish their goal. Every command invocation requires translation — extraneous load, not intrinsic task difficulty.

**Web example:** An expense management tool that organizes reports by "fiscal period code" (the system's taxonomy) when the user thinks in terms of "the trip I took in March." The user must learn the fiscal calendar to file a routine expense.

### Failure 6 — Skipping experience design for "small" problems

Small features embed themselves in larger experiences and can damage coherence, introduce unexpected cognitive load, or create contradictions in the system's conceptual model.

**Recognition:** "This is just a small change, we don't need to frame it." The premise that scope determines whether the problem needs framing is incorrect — what determines whether framing is needed is whether the assumptions embedded in the stated request have been verified.

**Consequence:** Small changes that contradict existing experience principles accumulate into incoherence. The system becomes internally inconsistent over time, each inconsistency explainable individually, collectively damaging.

---

## AI-agent adaptation

A human experience designer has access to: user interviews, ethnographic observation, usability testing, behavioral analytics. An AI design agent has access to none of these. The adaptations:

### What remains available

**Heuristic scenario analysis:** Constructing scenarios based on domain knowledge, likely user contexts, and established mental model patterns for similar systems. Apply Jakob's Law explicitly: what systems do users in this domain spend significant time in? What conventions have those systems established?

**Cognitive load analysis:** Evaluating a proposed design against CLT principles is analytical reasoning, not observation-dependent. The three load types (intrinsic, extraneous, germane) and the extraneous load patterns described above can be applied to any described design.

**Analogous-system analysis:** Examining how similar problems are solved in well-understood real-world systems. The CLI conventions of `git`, `docker`, `kubectl`, `gh`, `rg` are documented and observable. The web conventions of Google Docs, Figma, Notion are documented and observable. Reason from these explicitly.

**Assumption surfacing:** Identifying the assumptions embedded in a stated request and examining each one for validity is pure reasoning. The Step 1 protocol above is entirely available to an AI agent.

**Structured heuristic walkthrough:** The cognitive walkthrough method — asking "would the user know what to do here?" and "would the user know if they succeeded?" for each step of a scenario — requires no user observation.

### What is unavailable — and must be acknowledged

- Real user observation: no ethnography, no field visits, no contextual inquiry
- User testing: no usability sessions, no think-aloud protocols
- Quantitative behavioral data: no analytics unless explicitly provided
- Lived context knowledge: the AI agent cannot experience the user's actual environment

### How to handle unavailability honestly

An AI agent doing experience design must be explicit about which claims are grounded in documented domain knowledge versus heuristic reasoning versus inference.

**Acceptable:** "Based on analogous systems (git, kubectl), developers in this context are likely to expect non-zero exit codes on failure and stderr for diagnostics — this should be verified with the actual user population."

**Not acceptable:** "Users need a real-time dashboard" stated as a fact without qualification when no user research was conducted.

Mark assumptions explicitly: "This scenario assumes the user has prior experience with containerized deployments [assumption: should be verified]." The output of AI-agent experience design is a *design hypothesis with explicit assumptions*, not a validated understanding of user needs.

---

## Using experience design outputs downstream

Experience design outputs are the inputs to every other loaded skill:

| Output | Consumed by |
|---|---|
| Problem statement | All skills — the framing constraint everything else must honor |
| Scenarios | `interaction-design` (as test cases for state coverage), `user-flow-design` (as task narratives to flow-map), `information-architecture` (as evidence of what information users need and in what context) |
| Experience goals | All skills — the qualitative success criteria |
| Experience principles | `design-specification` (as constraints that must be preserved in the spec), all surface skills (as constraints that cannot be violated by surface-specific decisions) |

Experience design feeds all downstream disciplines. It is not revised by them. If a downstream skill reveals that a scenario was missing an important case, or that an experience goal was unachievable given surface constraints, that finding goes back to the problem framing — not silently dropped.

---
