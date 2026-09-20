---
name: user-flow-design
description: Task-level state sequences — the path a user takes through steps, decisions, branches, and outcomes across a task or workflow. Use when users must move through more than one view or state to accomplish a goal; when entry points, decision points, or error recovery paths matter; when designing CLI pipelines or TUI navigation between views. Not for per-action response within a single view (→ `interaction-design`), structural organization of content or commands (→ `information-architecture`), or cross-channel emotional experience over days or weeks (→ `experience-design`).
metadata:
  version: "1.0.0"
---

# User Flow Design

## What this skill is for

User flow design defines the sequence of states a user moves through to accomplish a goal — from entry point through decision points, branches, error paths, and exit states. A flow is task-level: each step corresponds to a state (a screen, a view, a mode, a prompt, a command invocation), not to a single action within that state.

**Load this skill when:**
- Users must move through more than one view, command, or mode to accomplish a goal
- The design problem involves multi-step tasks (checkout, onboarding, CLI pipeline, TUI navigation between views)
- Entry points are not obvious or vary (user arrives mid-flow, user resumes an abandoned flow)
- There are decision branches (existing account vs. new account; `--dry-run` before execution)
- You are designing a CLI pipeline and the failure of any command mid-sequence is a design decision
- TUI navigation between panes, panels, or modes needs to be specified before the interaction within each view

**Do NOT load this skill when:**
- The problem is limited to what happens within a single view when the user performs an action — that is `interaction-design`
- The problem is purely about organizing content into categories and navigation paths — that is `information-architecture`
- The problem is a high-level experience story covering days, channels, or emotional arcs — that is `experience-design`
- The problem is limited to key binding design or visual layout within a single TUI pane — load `tui-design` directly

**Boundary (OQ-3 resolution):**
- Not for: per-action response within a view — what animation plays, what error message appears, what state changes when the user clicks (→ `interaction-design`)
- Not for: the organizational structure of views, commands, or content (→ `information-architecture`)
- Not for: surface-specific rendering — key binding mechanics, terminal capability constraints (→ `tui-design`, `cli-design`)
- Not for: user journey maps with emotional content, multi-channel touchpoints, or a timeline measured in weeks (→ `experience-design`)

**Boundary tests (use these to resolve ambiguity):**
- "Does the user go from step A to step B, or to step C at this point?" → user-flow-design (which step comes next)
- "What happens when the user presses Enter on this form field?" → interaction-design (what happens within this step)
- "Should `deploy` be under `app` or at the top level?" → information-architecture (namespace structure)
- "Which commands does the user run in sequence to publish a package?" → user-flow-design (a CLI pipeline is a flow)
- "Does this flow include emotions and multi-channel touchpoints over three months?" → experience-design (journey map, not task flow)

---

## The core pattern: build the complete flow, not just the happy path

### Step 1 — Task analysis before drawing

Before defining any flow, answer these four questions:

1. **Who is the user, and what do they already know?** The same task has different flows for a first-time user vs. an expert. A first-time user installing a CLI tool encounters an onboarding flow; an expert re-installing runs a two-command pipeline. The difference is what the user knows at entry.

2. **What is the user's goal?** State it as an action the user wants to complete, not a feature the system provides. Not "the system processes payment" — "the user pays for an order." The goal defines when the flow ends.

3. **What must the system already have done before the user reaches step one?** Flows do not start at a blank slate. A checkout flow assumes an authenticated user with items in a cart. A CLI pipeline assumes a configured environment. Unstated preconditions produce flows that break at step one for half the users.

4. **What are the realistic alternative starting points?** A flow designed for the canonical entry point will fail when users arrive mid-flow from an email link, a deep URL, a shell script, or an interrupted session. Enumerate these before proceeding.

### Step 2 — Define the happy path first, explicitly

The happy path is the shortest sequence of steps in which everything goes correctly and the user makes the expected choices. It is the starting point — not the output.

Format for an AI agent:

```
Goal: [user's goal in one sentence]
Preconditions: [what the user and system must have before step 1]
Entry: [where the user starts and what they already know]

Step 1: [user action that moves the flow forward — not an implementation step]
  System response: [what the system does in response — from the user's perspective]
  State after: [the new state the user is in]

Step 2: [next user action]
  System response: [...]
  State after: [...]

[...continue until...]

Exit (success): [explicit confirmation that the goal was accomplished]
  What the user sees/knows: [the user can tell they succeeded — this is a design decision]
```

Each step is a state transition. "User fills out a form" is not a step — it is a collection of interaction-design decisions within a single state. "User submits the form" is a step — it produces a state transition.

### Step 3 — Enumerate every decision point

At each step, ask: **Can the user reach this step from somewhere other than the previous step?** And: **Can the user's path branch here?**

Decision points have two types:

- **User-driven:** The user makes a choice (new vs. existing account; `--force` flag vs. not; press `d` to delete vs. `n` for new item). Both branches must be designed. The non-default branch is not "handled by the implementation."

- **System-driven:** The system determines the path based on its state (email not verified → route to verification flow; file not found → error path; command returns non-zero → pipeline branches). Design the branching condition explicitly, including what the user is shown when the branch occurs.

Document each decision point with:
```
Decision at Step N: [condition]
  Branch A: [what happens — full path or reference to a named sub-flow]
  Branch B: [what happens — including how the user knows they are on branch B]
  Default: [which branch runs when the user does not actively choose]
```

### Step 4 — Design every error path as a first-class flow branch

**The most common flow design failure: designing only the happy path and leaving error states as "the system shows an error."**

An error path is any divergence from the happy path caused by:
- Invalid user input ("email already registered")
- System failure ("payment gateway timeout")
- Violated constraint ("file exceeds 100MB limit")
- User mistake ("ran command from wrong directory")

Each error path must be designed with:
1. **The error condition** — precisely when this path is triggered
2. **What the user sees** — not "error message shown" but the specific information the user needs to recover
3. **The re-entry point** — exactly which step in the happy path the user returns to after the error
4. **What is preserved** — does the user's progress survive? Are form fields cleared? Does a partially-executed pipeline require cleanup?

```
Error at Step N: [specific condition — not "something goes wrong"]
  User sees: [specific information for recovery — the user knows what went wrong and what to do]
  Re-entry: Step [X] [with/without the user's prior input preserved]
  Progress preserved: [yes / no / partial — specify what is lost]
```

An error path that ends with "the user sees an error message and the flow ends" is a dead end. Dead ends are a design failure.

### Step 5 — Define every exit point

A flow has exactly three categories of exit:

| Exit type | Description | Design obligation |
|---|---|---|
| **Success** | User accomplished the goal | Explicit confirmation — the user can verify they succeeded. A silent state change is not a success exit. |
| **Abandonment** | User left mid-flow (closed the window, pressed Ctrl+C, navigated away) | What is the system state when the user returns? Is progress saved? Does the user re-enter at the start or resume where they left? |
| **Terminal error** | System cannot complete the task; the user cannot proceed | The user knows the goal was not accomplished, understands why (briefly), and knows what their options are (retry, contact support, use a different path). |

All three must be specified. A flow where abandonment state is undefined produces bugs when the user returns. A flow where terminal error state is undefined produces dead ends.

### Step 6 — Verify flow completeness

Check each flow against this list before finalizing:

- [ ] Every decision point has all branches designed (including the non-default branch)
- [ ] Every error path has an explicit re-entry point back to the happy path
- [ ] Every exit point makes the system's state clear to the user (they know if they succeeded)
- [ ] Every entry point variant is covered (not just the canonical entry)
- [ ] Abandonment behavior is defined (what happens when the user does not complete the flow)
- [ ] No dead ends — every state the user can reach has a forward path or a clear exit

---

## Flow granularity: task level vs. interaction level

The dividing line is this question: **"Which step comes next?"**

If you are answering that question, you are doing flow design.

If you are answering "what happens within this step when the user does X," you are in interaction-design territory.

| Task-level (flow design) | Interaction-level (interaction-design) |
|---|---|
| "User submits the form → system validates → user sees confirmation" | "What error message appears when the email field is empty?" |
| "User runs `git commit` → commit succeeds → user is at their shell prompt" | "What does the terminal output look like for a clean commit?" |
| "User navigates to the pod detail view → user sees pod status" | "How does the status indicator animate during refresh?" |
| "User chooses 'delete' at the confirmation prompt → item is removed" | "What does the confirmation dialog look like?" |

**Going too granular (you are specifying interaction-design):** You are specifying what happens when the user presses a specific key within a state, what a single UI element looks like, or what animation plays. These are not flow steps — they are interaction details.

**Going too coarse (you are at journey level):** Your steps span multiple sessions, include emotional states ("user feels frustrated at this point"), or cross channels ("user receives an email, then logs in"). That is experience-design territory. A task flow covers one product, one task, in minutes to a few hours.

---

## CLI flows

Command pipelines are flows. A sequence of commands the user runs to accomplish a goal is a user flow with explicit entry points, decision branches, and exit states defined by exit codes.

### The pipeline as a flow

```
Goal: Publish a package to the registry
Entry: User has a configured project with a clean working tree
Preconditions: `~/.npmrc` configured with registry credentials; `package.json` version bumped

Step 1: npm test
  System response: Test suite runs
  Exit code 0 → Step 2
  Exit code non-zero → Error path A (tests fail — pipeline aborts)

Step 2: npm run build
  System response: Build artifacts generated in dist/
  Exit code 0 → Step 3
  Exit code non-zero → Error path B (build fails — check dist/ for partial output)

Step 3: npm publish
  System response: Package uploaded to registry
  Exit code 0 → Exit (success): version N is published
  Exit code non-zero → Error path C (registry error — network, auth, or version conflict)

Error path A: Tests failed
  User sees: Test runner output on stderr; non-zero exit terminates the pipeline if using &&
  Re-entry: Step 1 after fixing the failing test
  Progress preserved: No build or publish attempted — clean state

Error path C: Publish failed (version conflict)
  User sees: Registry error message on stderr
  Re-entry: Step 3 only — build artifact is still valid
  Progress preserved: Build output is still in dist/
```

### CLI-specific flow design rules

**Exit codes are flow terminators.** Exit 0 means the step succeeded and the flow can continue. Non-zero exit codes are error exits. Design each non-zero exit code as an explicit exit state, not as "returns non-zero." The user (and scripts using the command) need to know what each non-zero code means.

*Critical failure mode:* A command that exits 0 on error silently continues the pipeline. If `backup-tool copy-files` exits 0 even when the copy fails, any pipeline using `&&` will proceed to the next step on corrupt state. Exit 0 must mean "this step succeeded and the flow can continue."

**Entry context is explicit.** CLI commands do not run in a vacuum. The entry point includes:
- Working directory (does the command assume it's run from the project root?)
- Environment variables (`AWS_PROFILE`, `NODE_ENV`, config file path)
- Required files (`~/.config/tool/config.yaml` must exist)
- Required global state (the user must be authenticated; the server must be running)

Flows designed without specifying entry context produce commands that silently fail when the context is wrong.

**Interactive CLI flows require step-by-step design.** When a CLI prompts the user for input, the prompt sequence is a flow. Design it:

```
Step 1: `git commit` (no message flag)
  System response: Opens editor or prompts for message
  Decision: User provides message vs. user closes editor without saving
    Branch A (message provided): Step 2
    Branch B (editor closed without saving): Exit — commit aborted

Step 2: User writes commit message and saves
  System response: Commit created; stdout shows commit hash and summary
  Exit (success): User sees commit confirmation
```

**Scripted vs. interactive contexts are different flows.** A command that works interactively may fail when scripted. Design the scripted flow separately if it differs:
- Prompts that block for input break non-interactive scripts — must accept `--yes`, `--no-input`, or equivalent flags
- Color output in a script context goes to logs, not a terminal — must detect TTY
- Progress spinners in a script produce garbled log output

### Decision points in CLI flows

**Flag combinations branch the flow.** `--dry-run` before execution, `--force` to bypass a guard, `--output json` to switch the exit state from "human-readable summary" to "machine-parseable blob" — each is a decision point that produces a different flow branch.

Design these branches explicitly:
```
Decision: `--dry-run` flag present
  Branch A (dry-run): Steps 1–N execute with no side effects; exit 0 with what would have happened
  Branch B (live): Steps 1–N execute with side effects; exit 0 on success, non-zero on failure
```

**Conditional shell execution (`&&`, `||`, `;`) is a flow decision.** `cmd-a && cmd-b` means "run cmd-b only if cmd-a exits 0." This is a decision point. The designer must know whether the user's intent is "stop on any failure" (`&&`) or "try all steps even if earlier ones fail" (`;`). These produce different user experiences when a mid-pipeline step fails.

---

## TUI flows

TUI navigation is a state machine. Each view, mode, or panel is a state. Key presses and commands are transitions. User flow design specifies the states and transitions; `tui-design` and `interaction-design` specify how each state is rendered and what happens within it.

### TUI state machine notation

```
State: [view or mode name]
  Visible content: [what the user can see in this state — at a level of abstraction, not layout]
  Available transitions:
    [key or command] → [target state]
    [key or command] → [target state]
  Entry from: [which states lead to this state and how]
  No-escape test: [how the user exits this state — must have at least one exit]
```

### Entry state design

Every TUI application has a first state when it opens. Design this state explicitly:
- What view opens by default?
- What is pre-populated vs. empty vs. loading?
- What does the user see if the application opens with no data (empty state)?
- What does the user see if the application opens with an error (auth failed, data source unavailable)?

The empty state and the error state are not implementation details — they are flow states. A TUI that shows a blank screen when there is no data and a generic error when the data source fails has two undecided exit states that produce user abandonment.

### Navigation paths as flows

A TUI with multiple views has navigation flows. Map them as a state machine:

```
State: Cluster list view
  Visible: List of clusters with status indicators
  Available transitions:
    Enter / l → Namespace list view (for selected cluster)
    ? → Help overlay (modal, returns here on q)
    q → Exit (with confirmation if changes pending)
  Entry from: Application start; Back navigation from Namespace list view
  No-escape test: q exits; ? overlay returns here

State: Namespace list view
  Visible: Namespaces in the selected cluster
  Available transitions:
    Enter / l → Pod list view (for selected namespace)
    h / Esc → Cluster list view
    ? → Help overlay (modal)
    q → Exit
  Entry from: Cluster list view
  No-escape test: h, Esc, and q all provide exits

State: Help overlay
  Visible: Key binding reference for current context
  Available transitions:
    q / Esc / ? → Return to previous view (whatever triggered the overlay)
  Entry from: Any view (modal)
  No-escape test: q, Esc, and ? all close the overlay
```

### TUI error paths and the no-escape test

The **no-escape test** is the TUI-specific flow completeness check: every state the user can enter must have at least one way out that does not require quitting the application.

*Classic failure mode:* vim's `:q` discovery problem. New users enter insert mode (a state) and have no discoverable way to exit it. The state has an exit (`Esc`), but it is not surfaced. The no-escape test catches this at design time.

Error states in TUI applications:
- **What view does the user see when an operation fails?** A modal with the error message? An inline status bar update? A full-view error state?
- **How does the user dismiss the error and return to the main flow?** This must be designed explicitly.
- **Does the error state preserve the user's navigation context?** If the user was in the pod detail view and a refresh fails, do they return to the pod detail view or the namespace list?

### TUI exit design

TUI applications need an explicitly designed quit flow:
- What key or command triggers exit?
- Is there a confirmation prompt? Under what conditions (unsaved changes, pending operations)?
- What happens to in-progress operations when the user quits?

The quit flow is a flow. Design it:

```
Exit flow: User presses q
  Decision: Are there unsaved changes or pending operations?
    Branch A (no pending state): Exit immediately — no confirmation
    Branch B (pending state): Confirmation prompt
      User confirms → Exit (discards pending state)
      User cancels → Return to previous view (pending state preserved)
```

---

## Flow representation for AI agents

AI agents cannot produce interactive wireflow diagrams. The canonical representation is structured natural language — and it must be more precise than prose.

### Text-based flow notation

Use this format for complete flows:

```
Flow: [flow name]
Goal: [the user's task in one sentence]
Preconditions: [what must be true before step 1]
Entry points:
  Primary: [canonical starting point]
  Variant A: [alternative entry — e.g., arriving from an email link]
  Variant B: [another alternative — e.g., resuming an abandoned flow]

HAPPY PATH

Step 1: [user action]
  → System: [response from the user's perspective]
  → State: [the state after this step]

Step 2: [user action]
  → System: [response]
  → State: [state]

[Decision at step N]
Step N: [user reaches a decision point]
  Branch A ([condition]): → Step N+1 (happy path continues)
  Branch B ([condition]): → Error path B

Exit (success): [explicit success state]
  User knows: [how the user can confirm success]

ERROR PATHS

Error A: [specific condition]
  Triggered at: Step [X]
  User sees: [specific information for recovery]
  Re-entry: Step [Y] [with/without prior input preserved]
  Progress: [what is and is not preserved]

Error B: [specific condition]
  [same format]

ABANDONMENT
  If user leaves at Step [X]: [system state; can the user resume?]
  If user leaves at Step [Y]: [system state; can the user resume?]
```

### When to use state machine notation

Use state machine notation instead of (or alongside) step notation when:
- The flow is non-linear (users can move between states in multiple orders)
- The flow involves modes (insert/normal, edit/view, expanded/collapsed)
- The flow is a TUI with many valid navigation paths

State machine notation:
```
States: [list all states]
Transitions:
  [State A] → [State B]: triggered by [condition]
  [State A] → [State C]: triggered by [condition]
  [State B] → [State A]: triggered by [condition or escape]
  [error state] → [State A]: triggered by [dismissal]
Initial state: [State A]
Terminal states: [success state, abort state, error state]
```

### AI-agent flow design obligations

When producing a flow design as an AI agent:

1. **Produce error paths explicitly.** Do not write "the system handles errors appropriately" — this defers error path design to the worker and produces dead ends. Name each error condition and its re-entry point.

2. **Name the exit states.** Do not write "the flow ends" — write "the user sees confirmation that the order was placed, including the order number and estimated delivery date." Success confirmation is a design decision, not an implementation detail.

3. **Specify the re-entry point for every error.** "User sees an error message" is not a complete error path. "User returns to Step 2 with their form input preserved; the error message appears inline above the relevant field" is a complete error path.

4. **Check for dead ends.** Read every state in your flow and ask: is there a forward path from here? A state with only a "go back" option that does not preserve context is a potential dead end if the user cannot tell why they are going back.

5. **Flag flows you cannot fully design.** When the happy path or an error path requires information you do not have (what does this API return on failure? what is the server timeout?), flag the gap explicitly: "Error path C is not designed — depends on: [specific unknown]. This must be specified before implementation."

---

## Flow granularity: distinguishing task flows, journey maps, and system flows

These three artifacts look similar and are frequently confused. Each serves a different purpose and operates at a different level.

| Dimension | Task flow (this skill) | User journey map | System flow diagram |
|---|---|---|---|
| **Scope** | One product, one task | Multi-channel, multi-touchpoint | One technical process |
| **Perspective** | The user's actions and states | The user's experience, emotions, perceptions | The system's operations |
| **Time scale** | Minutes to hours | Days, weeks, or longer | Milliseconds to seconds |
| **Content** | Steps, decisions, error paths, exit states | Touchpoints, emotions, pain points, opportunities | API calls, database operations, conditions |
| **Includes emotions?** | No | Yes | No |
| **Includes technical processes?** | No — only what the user sees | No | Yes — the technical substrate |
| **Produced by** | user-flow-design | experience-design | Architecture / Engineering |

**Falsifiable distinction tests:**

- Does the artifact include "user feels frustrated" or "user's confidence increases"? → It is a journey map, not a task flow.
- Does the artifact include "API call returns 200" or "database transaction committed"? → It is a system flow, not a user flow.
- Does the artifact span multiple products or channels (email → web app → mobile notification)? → It is a journey map, not a task flow.
- Does the artifact cover one product and one task completable in a single session? → It is a task flow.

---

## The IA-flow relationship

Flows traverse IA structure. IA defines what exists and how it is organized; flows define the sequences users take through that structure. The two disciplines are co-dependent:

- An IA that buries the payment method settings three levels deep makes every checkout flow three steps longer
- A checkout flow that requires frequent access to payment methods means the IA must surface them at a shallow depth
- When IA and flows are designed independently, they often produce contradictions — flows that route through structure that does not exist, or IA that makes required flow steps unreachable

**Cross-check protocol:** After designing both IA and task flows, trace each major flow through the IA structure:
1. Does each step in the flow correspond to a node in the IA?
2. Are the transitions between steps consistent with the navigation paths in the IA?
3. Does any flow require the user to navigate to a location the IA does not surface?

If yes to (3): the IA is incomplete or the flow is wrong. They must be reconciled — not finalized independently.

---

## Failure modes

### Happy-path-only design

The most prevalent flow design failure. The happy path is fully specified; error states are marked "TBD" or "the system shows an error." At implementation, the undecided states produce:
- Forms that clear all user input on validation error (progress not preserved)
- Error messages that do not help the user recover (no specific information)
- States from which there is no forward path (dead ends)

The fix: treat error path design as mandatory, not optional. Every decision point has all branches. Every error has an explicit re-entry point.

### Dead ends

A state the user can enter but cannot exit without quitting the application (or the terminal, or the browser tab). Dead ends appear when:
- An error state has no dismissal mechanism
- A multi-step form rejects the user at a late step with no way to correct earlier input
- A TUI modal opens with no advertised key to close it

Detection: trace every error path in the flow to its end. Does the user have a clear forward path, or is the flow diagram a dead branch with no return?

### Unclear success states

The user completes the flow but cannot tell whether they succeeded. Common after form submission when the page appears to reload without explicit confirmation. Users submit again (duplication) or assume failure (abandonment).

Fix: every success exit state explicitly states what the user sees and knows. "User sees confirmation toast" is not enough — "User sees a confirmation toast stating 'Order #1234 placed. Estimated delivery: Sep 5.' The cart is emptied." is a design decision.

### Entry-point blindness

Flow designed only for the canonical entry point. Users who arrive mid-flow (from an email link, a bookmark, a `--resume` flag in a CLI) hit a state that requires context the flow has not provided.

Fix: enumerate all realistic entry points before designing. For each entry point, verify the flow handles the specific context the user carries when they arrive there.

### Forced paths

Flows that prevent the user from abandoning mid-task — onboarding wizards that block navigation, interactive CLI prompts with no `^C` handling, TUI modals with no escape. Users who are interrupted or uncertain cannot leave gracefully; they lose progress or must force-kill the process.

Fix: every flow must have an abandonment path. Specify what the system state is after abandonment and whether the user can resume.

### Granularity mismatch

The flow diagram mixes task-level steps ("user submits the form") with interaction-level details ("user sees the Submit button turn grey and the spinner appear for 1.2 seconds"). This produces a document too detailed for stakeholders and too coarse for engineers — useful to neither.

Fix: keep each step at the grain of a state transition. What the button looks like during loading is an interaction-design decision; the fact that the form submission transitions to a loading state is a flow-design decision.

### Flow-IA contradiction

The flow routes the user to a location that does not exist in the IA (or routes through structure that requires five navigation steps to reach). This produces designs that cannot be implemented without either breaking the flow or redesigning the IA.

Fix: trace every major flow through the IA structure explicitly before finalizing either. Contradictions must be resolved at design time.

---

## Flow outputs

When producing flow design artifacts as an AI agent, deliver these outputs explicitly:

**Flow specification** (per flow): The steps, decision points, error paths, and exit states in the text-based notation defined above. One flow specification per user task.

**Flow coverage list**: A list of all primary tasks the design must support. For each task, a corresponding flow is named. Gaps in the coverage list are gaps in the design — tasks without flows will have their paths decided at implementation time.

```
Coverage list for [product/feature]:
  ✓ User creates a new account (Flow: registration)
  ✓ User logs in with existing credentials (Flow: login)
  ✓ User resets forgotten password (Flow: password-reset)
  ✗ User changes email address — NOT DESIGNED
  ✗ User deletes account — NOT DESIGNED
```

**Gap analysis**: Explicitly flagged missing flows, incomplete error paths, and flow-IA contradictions. Do not omit these — the worker will discover the gaps and invent solutions that may not match design intent.

---

## Upstream and downstream

**Upstream (feeds into user-flow-design):**
- `experience-design` — the human problem statement and scenarios that ground the flow in a specific user context and goal
- `information-architecture` — the structural model that constrains which flows are possible

**Downstream (fed by user-flow-design):**
- `interaction-design` — within each step, the per-action response model
- `design-specification` — task flows are element 3 in the Design Spec format
- Surface skills (`cli-design`, `tui-design`, `web-ui-design`) — surface-specific execution of the flow steps

---
