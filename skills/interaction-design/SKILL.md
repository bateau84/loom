---
name: interaction-design
description: Behavioral contract design between human and system — specifying how interfaces respond to user actions, what states they occupy, what feedback they produce, and how errors are handled and recovered from. Use when any element of the design involves user actions and system responses — which is almost always. Covers all surfaces equally: GUI, CLI, TUI, web, desktop. Not for task-level step sequences across views (→ `user-flow-design`), visual presentation of states (→ `visual-interface-design`, surface skills), information structure and navigation (→ `information-architecture`), or accessibility standards compliance (→ `accessibility-design`).
metadata:
  version: "1.0.0"
---

# Interaction Design

## What this skill is for

Interaction design is the practice of defining the behavioral contract between human and system: when the user does *this*, the system does *that*. It operates at the grain of per-action response within a view or state — not the task-level sequence of views (user-flow-design) and not how states visually appear (visual-interface-design and surface skills).

Interaction design is **surface-type-agnostic**. The forms of interaction differ by surface; the principles transfer. A CLI command that produces no output violates the same feedback principle as a web button that provides no loading state. The analysis tools — state modeling, the action cycle, feedback taxonomy, error design — apply identically to a terminal prompt and a React component.

**Load this skill when:**
- Any interface element responds to a user action and you need to specify what happens
- You are designing or evaluating states for a component (all 8, not just default and success)
- You need to specify feedback behavior: latency acknowledgment, progress signals, error messages, confirmation
- You are designing error handling — which is not an afterthought but a primary design concern
- You are working across CLI, TUI, web, or desktop and need consistent behavioral principles

**Do NOT load this skill when:**
- The design problem is purely structural (what views exist, how they relate) → `information-architecture`
- The design problem is task-level flow (what step comes next, what branch leads where) → `user-flow-design`
- The question is only how a state *looks*, not what it communicates → `visual-interface-design`
- The engagement is validating an existing implementation → `design-validation`

**Boundary:**
- Not for: task-level state sequences across steps (→ `user-flow-design`). If the question is "what step comes next?", it belongs there. If the question is "what happens when the user does *this*?", it belongs here.
- Not for: surface-specific rendering mechanics — CSS transitions, ANSI escape sequences, CLI flag conventions (→ surface skills)
- Not for: accessibility standards compliance specifics (→ `accessibility-design`), though interaction design feeds accessibility requirements
- Not for: information organization and navigation taxonomy (→ `information-architecture`)

---

## Norman's Action Cycle — The Evaluation Protocol

Norman's Seven Stages of Action (Norman 2013, *The Design of Everyday Things*, Basic Books) structures every human-system interaction into phases. Use it as a structured walkthrough protocol — not a diagram on a slide.

**The seven stages:**
1. **Form a goal** — what does the user want to accomplish?
2. **Plan the action** — what action would achieve it?
3. **Specify the action** — which interface element, which command, which key?
4. **Execute the action** — perform the physical act (click, keystroke, command)
5. **Perceive the state** — what is the system's new state?
6. **Interpret the state** — what does that state mean?
7. **Evaluate the outcome** — did the action achieve the goal?

**The two gulfs that interaction design must bridge:**

**Gulf of Execution** (Stages 2–4): The distance between the user's intended action and the actions the system makes available. Wide when: affordances are hidden, actions require knowledge the user doesn't have, the mapping between controls and effects is arbitrary.

*Gulf of Execution applied to surfaces:*
- **CLI**: Can the user discover the command and its syntax? Does `--help` reveal what they need? Are flag names predictable from the task vocabulary?
- **TUI**: Are key bindings discoverable without reading documentation? Is there a visible key binding legend? Are modal states indicated so the user knows which keys are active?
- **GUI**: Do controls signify their interactivity? Is the spatial relationship between controls and their effects predictable?

**Gulf of Evaluation** (Stages 5–7): The distance between system state and the user's ability to perceive and interpret it. Wide when: the system changes state silently, output is ambiguous, the user cannot tell whether they succeeded.

*Gulf of Evaluation applied to surfaces:*
- **CLI**: Does stdout communicate success? Does stderr communicate failure? Does the exit code correctly signal success (0) or failure (non-zero)? Does long-running output indicate progress?
- **TUI**: Is the current application state visible at all times? Does the status bar reflect the last action's result? Is focus position always legible?
- **GUI**: Does the component's state change visibly within 100ms of action? Is an error state distinct from a success state? Does a loading state indicate the operation is in progress?

**Using the action cycle as a walkthrough:**
For each user action in the design, walk all seven stages and ask:
- Stage 2–3: "Would the user know to try this? Would they know how to specify it on this surface?"
- Stage 5–6: "Would the user see the state change? Would they know what it means?"
- Stage 7: "Would the user know if they succeeded or failed?"

Any "no" answer identifies a design gap that must be addressed in the behavioral contract.

---

## Affordances and Signifiers

**Gibson's affordance** (Gibson 1979): An action possibility that exists in the environment relative to an actor's capabilities, independent of whether the actor can perceive it. A button that can be clicked has the affordance of clickability whether or not it looks clickable.

**Norman's signifier** (Norman 2013): Perceptual information that communicates an affordance. The visual appearance of a button that makes it look clickable. Signifiers make affordances discoverable.

**Why the distinction matters for design:** Designing an affordance without a signifier creates a hidden capability — users cannot discover it. Designing a signifier without an affordance creates a false affordance — users try and fail. Both are Gulf of Execution failures.

**Gaver's (1991) taxonomy:**
- **Perceptible affordance**: action possible + signifier present → interaction works as expected
- **Hidden affordance**: action possible + no signifier → users miss the capability entirely
- **False affordance**: no action possible + signifier present → users attempt and fail

**Signifier design per surface:**

| Surface | Element | Signifier that communicates the affordance |
|---------|---------|-------------------------------------------|
| GUI | Button | Elevated appearance, cursor change to pointer, hover state contrast |
| GUI | Text field | Recessed appearance, cursor changes to text cursor on hover |
| GUI | Draggable item | Drag handle icon, cursor changes to grab, subtle reorder indicator |
| GUI | Link | Color differentiation, underline, cursor pointer |
| CLI | Flag | `--help` output listing the flag; tab completion offering it; man page |
| CLI | Interactive mode | Prompt character (e.g., `>`) signaling the system is awaiting input |
| TUI | Key binding | On-screen legend, status bar key hints, `?` help overlay pattern |
| TUI | Focused element | Highlight, border, cursor position — always visible, never ambiguous |
| TUI | Scrollable region | Scroll indicator, partial content visible at edge |

**The design obligation:** For every affordance your design provides, specify the signifier that makes it discoverable. If you cannot specify the signifier, the affordance is hidden.

---

## Feedback Design

Feedback is the system's communication to the user about what happened in response to their action, and about the current state of the system.

### Response Time Tiers

Nielsen's three limits (Nielsen 1993, confirmed nngroup.com 2014) are grounded in perceptual psychology and apply to every surface equally:

| Tier | Threshold | User experience | Required design response |
|------|-----------|-----------------|--------------------------|
| **Direct** | < 0.1 second | User feels direct manipulation — action and effect are one | No acknowledgment needed; result must be visible |
| **Acknowledged** | 0.1s – 1.0s | User notices delay but task coherence is preserved | Immediate acknowledgment that action registered, even if result is not ready (e.g., button state change, spinner appears) |
| **Progress** | > 1.0s (< 10s) | User's flow is interrupted; user monitors progress | Activity indicator (spinner, progress bar when total work is known) |
| **Percent-done** | > 10 seconds | Limit for maintaining user attention | Percent-complete indicator + estimated time remaining (when calculable) + explicit interrupt mechanism |

**These thresholds apply identically across surfaces:**
- A CLI command that runs 30 seconds with no output violates the 10-second rule exactly as a web form does
- A TUI operation that blocks the render loop for 200ms must show an acknowledgment state
- A web API call that takes 500ms must show that the submit button received the action, even before the response arrives

**The 0.1–1.0s gap is the most commonly missed design obligation:** In this window, the system appears frozen momentarily. Users re-click or re-submit. The design must immediately change state (button appears pressed, cursor changes to loading, a spinner appears) to signal the action registered — even though the result is not yet available.

### Feedback Types by Surface

| Feedback type | GUI | CLI | TUI | Web |
|--------------|-----|-----|-----|-----|
| Latency acknowledgment | Button state change, spinner | Cursor acknowledgment in interactive mode | Status bar update | Button disabled + spinner |
| Progress | Progress bar, percentage, spinner | Progress bar (`=====>`), percentage to stderr | Progress component in render loop | Progress bar, skeleton loading |
| Completion | State transition to success | Exit code 0 + stdout message | Status bar success message + state change | Success state, toast notification |
| Error | Inline error state, error banner | Non-zero exit code + stderr message | Error overlay, status bar error | Inline error state, error boundary |
| Confirmation | Modal dialog (for irreversible actions only) | Prompt (`Are you sure? [y/N]`) or `--yes` flag for scripting | Confirmation dialog component | Modal dialog (for irreversible actions only) |

**CLI-specific feedback discipline:**
- **stdout**: data output and success messages that downstream commands or scripts consume
- **stderr**: diagnostic messages, warnings, error messages — never data, always human-readable
- An error message on stdout is a design failure — it breaks pipeline composition because the next command receives error text as its input

**Shneiderman's Rule 3 (informative feedback):** Every user action must produce feedback. Minor/frequent actions deserve modest feedback; major/infrequent actions deserve substantial feedback. No action should be silent.

---

## The Eight Component States — All Are Design Decisions

The eight canonical UI states apply to every interactive component on every surface. Leaving any state unspecified means engineering invents the behavior — usually wrong.

| State | What it means | Design obligation |
|-------|--------------|-------------------|
| **Default** | Initial state; no user interaction has occurred | The starting condition; must be clearly distinct from all other states |
| **Hover** (GUI/web only) | Pointer is over the element | Must signal interactivity without triggering action; required signifier for discoverability |
| **Focus** | Element is the current keyboard input target | Always has an explicit visual indicator (WCAG requirement); critical for keyboard navigation |
| **Active** | User is in the act of interacting (mouse down, touch down, key held) | Confirms the action is registering; must be visually distinct from hover |
| **Disabled** | Element exists but cannot be interacted with | Must communicate unavailability without removing the element; never looks identical to enabled |
| **Loading** | An asynchronous operation is in progress | User cannot proceed; system is working; must show acknowledgment within 0.1s of trigger |
| **Error** | An action failed or input is invalid | Must communicate what failed and what the user can do to recover — not "An error occurred" |
| **Success** | An action completed successfully | Confirms the user's goal was accomplished (Shneiderman's Rule 4: closure) |

**The design obligation for each state:**
1. Specify *what the user can do* from this state (which actions remain available)
2. Specify *what feedback the user receives* when entering this state
3. Specify *how the user exits* this state
4. Verify the state has no trapped exit — no state the user cannot leave

**Surface-specific states beyond the canonical eight:**
- **CLI**: `waiting-for-input` (interactive mode prompt); `pipe-mode` (stdin receiving data); `complete` (process exited)
- **TUI**: `modal` (all input captured by overlay); `focused-panel` (which component has keyboard focus); `scroll-position` (visible data window)
- **Web**: `skeleton` (content loading, structure visible); `empty` (no data available); `offline` (network unavailable)

**The anti-pattern:** Designing only the default and success states. The error state, loading state, disabled state, and focus state are where most user failures occur. An interaction design that omits them is not a design — it is a happy-path sketch.

---

## State Machines as Design Completeness Tool

A state machine is the primary tool for verifying interaction design completeness. Use it as a design tool, not an implementation tool.

**The state machine protocol:**
1. List every state the component or view can occupy — including error, loading, disabled, success, and any surface-specific states
2. For each state, list what actions are available to the user in that state
3. For each action, specify what state it transitions to and what feedback accompanies the transition
4. Verify every state is reachable from at least one other state
5. Verify every state has an exit path — no trapped states
6. Verify error states have recovery paths that return the user to a sensible prior state
7. Look for impossible states — if your spec implies two mutually exclusive states simultaneously, the design is contradictory

**Example state machine for a CLI deployment command:**

```
States: idle → validating → deploying → succeeded / failed

idle:
  action: run command
  transitions-to: validating
  feedback: "Starting validation..." to stderr

validating:
  action: (none — system working)
  transitions-to: deploying (on pass) | failed (on validation error)
  feedback: progress dots or "Validating..." to stderr

deploying:
  action: Ctrl-C (interrupt)
  transitions-to: failed (with rollback)
  feedback: progress bar to stderr + estimated time

succeeded:
  action: (terminal — process exits 0)
  feedback: "Deployed successfully." to stdout; "Deployment complete." + summary to stderr

failed:
  action: (terminal — process exits non-zero)
  feedback: specific failure reason to stderr; suggested recovery action to stderr
  exit-code: non-zero (specific code documents which failure class)
```

**The state machine reveals:** Missing states (what happens when the network drops during deployment?), trapped states (can the user interrupt during validation?), feedback gaps (what does the user see at each state?).

---

## Error Design — First-Class Interaction Design Concern

Error design is not a subsection of interaction design. It is one of its primary concerns, equal in design weight to the happy path. Every operation that can fail must have a designed failure state.

### The Error Prevention Hierarchy

Design in this order — preventing errors is always cheaper than recovering from them:

1. **Prevent** — use constraints to make invalid actions impossible (disable the submit button until required fields are filled; validate file type before upload begins; disable flags that conflict with current state)
2. **Detect early** — validate at the earliest point where the error is detectable (inline field validation on blur, not on submit; preflight checks before destructive operations begin)
3. **Recover gracefully** — preserve the user's work; return them to the nearest sensible prior state; provide a specific recovery path
4. **Explain clearly** — if the error occurs, make the message actionable, specific, and human-readable

### Error Message Design

An error message is an interaction design decision, not an engineering default. Specify it explicitly.

**Three requirements for every error message:**
1. **Specific**: name what failed, not just that something failed ("File `config.yaml` not found" not "File not found" not "An error occurred")
2. **Actionable**: tell the user what to do next ("Check that the path is correct and the file exists" not "Please try again")
3. **Human-readable**: written for the person experiencing the failure, not for the system that generated it

**Error message design per surface:**

CLI error messages must serve two audiences simultaneously:
- **Human reading the terminal**: full-sentence explanation with specific cause and recovery step
- **Script parsing stderr**: consistent, parseable prefix or exit code that lets the script branch without parsing prose

Good CLI error pattern:
```
error: config file not found at './config.yaml'
  → run 'mytool init' to create a default config, or pass --config to specify a path
exit code: 2 (configuration error)
```

TUI error messages must not interrupt the interaction permanently:
- Use a dismissible error overlay or a status bar error message that clears on next action
- Preserve the user's place — don't reset focus or scroll position on error
- Distinguish error (action failed) from warning (action succeeded but with caveats)

GUI/web error messages must be:
- Positioned inline where the problem occurred (not at the top of the page for a field error)
- Visible without scrolling (if the error is below the fold, scroll to it or show a summary above)
- Not the only signal (don't rely on color alone — include an icon or text prefix)

### Reversibility and Recovery

**Shneiderman's Rule 6:** Actions should be reversible. Reversibility reduces anxiety and encourages exploration.

Design decisions for reversibility:
- **Undo/redo**: available for every non-trivial destructive or transformative action; scope (local to component vs global) is a design decision
- **Optimistic UI**: perform the action immediately and show the result; provide undo if the action can be reversed; rollback if the server rejects it
- **Trash vs permanent delete**: a two-stage delete (move to trash, then permanently delete) is a reversibility pattern, not just an engineering convention — it is a design decision
- **CLI destructive commands**: `--dry-run` flag for previewing destructive changes; explicit confirmation prompt for irreversible operations; no silent destructive defaults

### Confirmation Pattern Design

Confirmation dialogs are a last resort, not a default. Use only when both conditions apply:
1. The action is irreversible (or difficult to reverse)
2. Accidental triggering is plausible (the trigger is near other triggers, or the action label does not make the consequence clear)

**When NOT to use a modal confirmation:**
- When the action is reversible (just do it; provide undo)
- When the user explicitly chose a destructive action from a clearly labeled "Danger Zone" section (they already confirmed by navigating there)
- When confirmation is being added to make engineers feel safer, not because accidental triggering is a real risk

**CLI confirmation pattern:** `--yes` / `--force` flag for scripted contexts (confirmation prompts break non-interactive scripts); interactive prompt for human-facing operations. Design the flag name and the default behavior explicitly — the safe default is always "do not proceed without confirmation."

---

## Mapping and Consistency

**Natural mapping:** Controls spatially or metaphorically correspond to their effects. A volume slider that moves right to increase volume maps naturally. A scrollbar that moves down when you scroll down maps naturally. Breaking natural mapping forces users to learn arbitrary relationships.

**Consistency types (Shneiderman's Rule 1):**
- **Internal consistency**: identical behavior for identical actions within the product (same key binding does the same thing in every view; same error message format throughout)
- **External consistency**: alignment with platform conventions that users already know (macOS Cmd+Q, Windows Alt+F4, Ctrl+C for CLI interrupt)
- **Operational consistency**: the same action always produces the same result — no context where the same gesture means different things without a clear mode indicator

**Tension between internal and external consistency:** When the platform convention conflicts with the product convention, make a deliberate choice. Document it. Don't let it happen by default.

*Example*: A TUI application must decide whether `q` quits (Unix terminal convention) or goes back (vim-style navigation). Choosing external consistency (quit) aligns with tools like `less` and `man`. Choosing internal consistency (back, with `Q` to quit) aligns with vim and ranger. Either choice is valid — inconsistency (sometimes quit, sometimes back) is not.

---

## Constraints — Error Prevention by Design

Norman's three constraint types:

**Physical constraints (disabled states):**
The interface makes invalid actions impossible. The submit button is disabled until required fields are filled. The "Deploy to production" action is disabled when running on a feature branch. The destructive flag is rejected when the target path does not exist.

Designing disabled states requires: specifying *why* the element is disabled (tooltip or adjacent explanation), specifying *what changes to enable it*, and ensuring the disabled state is visually distinct from the enabled state.

**Logical/semantic constraints (domain meaning):**
The interface uses domain meaning to prevent invalid inputs. A date-of-birth field rejects future dates. A file size field rejects negative numbers. A CLI flag that requires a preceding flag produces an error if the preceding flag is absent.

**Cultural constraints (conventions):**
Users won't do certain things by convention. Red means error; green means success in most Western contexts. `q` exits in most Unix tools. `Ctrl+Z` undoes. Deviating from these creates friction that users experience as bugs.

**Constraints as the primary error prevention mechanism:** The strongest form of error prevention is making the error impossible, not recoverable. A form that disables the submit button prevents submission errors. A CLI that validates flags before executing prevents mid-operation failures. Design constraints first; error messages second.

---

## Surface-Specific Interaction Models

Each surface has a fundamentally different interaction model. Adapting interaction patterns from web to CLI by replacing "click" with "type command" is the most common interaction design failure.

### GUI / Desktop: Direct Manipulation

The direct manipulation model (Shneiderman 1983): users operate on a continuous representation of the object of interest using physical actions (drag, resize, click) with immediate feedback and rapid reversibility.

Design obligations:
- Visible state at all times — the object exists in front of the user
- Physical actions correspond directly to effects — drag moves, resize resizes, click activates
- Rapid, reversible operations — drag-and-drop is always reversible with Escape; resize is always reversible with undo
- Incremental feedback during the action — drag previews the drop target; resize previews the new dimensions

When to use form-based interaction instead: when the action space is large or heterogeneous (entering a date requires precision that drag cannot provide), when the action is deferred (batch operations), or when the action affects a non-visible state.

### Web: Async DOM Events

The web interaction model: user actions are DOM events that trigger JavaScript handlers; handlers make async requests; handlers update the DOM with results. The fundamental complication: the gap between user action and server response must be explicitly designed.

Design obligations:
- **Optimistic UI pattern**: show the result immediately, rollback if the server rejects it — use for operations that rarely fail
- **Pessimistic pattern**: show loading state until server responds — use for operations with significant failure rates or irreversible effects
- **Progressive enhancement**: design for the case where JavaScript is slow, fails, or is absent — native form submission as fallback
- **Browser-native interactions as part of the contract**: the back button must work; the page must be bookmarkable at meaningful states; tab navigation must follow logical focus order

### CLI: Stateless Command-Response

The CLI interaction model: user types command → system executes → system outputs result → system exits → user reads output → user constructs next command. No persistent visual state. No live feedback channel during execution (except stdout/stderr streaming). No mouse. No hover.

Design obligations:
- **Gulf of Execution**: commands must be discoverable without documentation. Design `--help` as the primary discoverability surface; design tab completion as the secondary; design command naming to match user vocabulary
- **Gulf of Evaluation**: output is the only feedback channel. Design stdout and stderr as explicit, disciplined contracts. Silence is not success — a command that exits 0 with no output is ambiguous
- **Exit codes as machine-readable feedback**: 0 = success, non-zero = failure. Define which non-zero codes mean which failure class. Exit code discipline is an interaction design decision
- **Pipeline composition**: design output format to be usable as input to the next command. Column alignment is a human affordance; tab-delimited or JSON output is a machine affordance. These are distinct output modes — design both when the command will be used in scripts
- **Interactive mode vs batch mode**: design the interface boundary explicitly. A command that prompts for confirmation must have a `--yes` / `--non-interactive` flag for automation contexts

**The anti-pattern:** Designing "confirm with Y/N prompt" without providing a `--yes` flag. This traps the command in interactive mode and breaks scripts that call it. Interactive confirmation is a feature for humans; `--yes` is the machine affordance for the same decision.

### TUI: Stateful Event Loop

The TUI interaction model: the application holds a persistent event loop; user actions (keystrokes, resize signals, mouse clicks if enabled) are events the application handles; state is maintained across events; feedback is rendered continuously in the terminal.

The fundamental difference from CLI: the system is always "running," not executing and exiting. This changes every interaction design decision.

Design obligations:
- **Focus model**: which component receives keyboard input is always explicit. Design the focus flow: what keystroke moves focus between panels, what happens when a panel is focused, how focus is restored after a modal closes
- **Modal vs modeless states**: a modal state (overlay, dialog, prompt) captures all input — no other action is possible. A modeless state allows navigation. Design explicitly which states are modal and how the user exits them
- **Key binding design**: key bindings are the interaction design. Design them with:
  - Discoverability: a `?` key binding help overlay is the standard signifier
  - Consistency with tool conventions: `q` to quit, `j/k` for down/up (vim-style), `g/G` for top/bottom
  - Namespace awareness: which keys are global vs which keys are panel-specific
  - Modal distinction: different key bindings active in different modes (insert mode vs normal mode in vim-style tools)
- **Gulf of Execution in TUI**: key bindings without a visible legend are hidden affordances. Design the discoverability mechanism alongside the key binding itself
- **Gulf of Evaluation in TUI**: the status bar is the primary feedback channel. Design what the status bar shows in each state: current mode, current action in progress, last action result, navigation context

---

## Microinteractions — The Texture of Interaction

Microinteractions are contained product moments with one main task (Saffer 2013 `[unverified — established practitioner framework]`). Structure:
- **Trigger**: what starts the microinteraction (user action, system event)
- **Rules**: what governs it (what happens, in what order, under what conditions)
- **Feedback**: what the user sees/hears/feels (the visible manifestation of the rules)
- **Loops and modes**: whether it repeats and how it responds to context changes

**Well-designed microinteractions are invisible** — they work so naturally that users don't notice them as separate moments. A checkbox that toggles state on click with a smooth animation. A button that shows a brief loading spinner before showing a checkmark on success. The terminal cursor that changes to a block in insert mode and a line in normal mode.

**Poorly-designed microinteractions are friction** — they delay feedback without adding information, interrupt the user's flow, or train users to ignore them (the "OK" button in the error dialog they always dismiss without reading).

**Design test for a microinteraction:** If the animation or transition were removed, would the user lose information they need? If yes, the feedback is necessary. If no, the feedback is decoration that may become noise.

---

## Shneiderman's Eight Golden Rules — Applied

Shneiderman's Eight Golden Rules of Interface Design (Shneiderman et al., *Designing the User Interface*, 6th ed., 2016; primary source: cs.umd.edu/users/ben/goldenrules.html):

### Rule 1: Strive for consistency
Consistent terminology in prompts, menus, and help; consistent color, layout, and fonts across similar situations; consistent behavior for identical actions.

*Application*: Define a vocabulary for state names (use "disabled" everywhere, not "disabled" in one place and "unavailable" in another). Define error message format once. Exceptions (delete confirmation, password masking) must be comprehensible and limited.

*CLI application*: Flag naming conventions must be consistent — if long flags use `--verb-noun` format, maintain it everywhere. If error exit codes follow a scheme, apply the scheme consistently.

### Rule 2: Seek universal usability
Design for novice-to-expert range, disability, and context diversity. Novice explanations plus expert shortcuts.

*Application*: Progressive disclosure — beginners can use the obvious path; experts can discover shortcuts without the path becoming inaccessible. Cooper's perpetual intermediate user `[unverified — established HCI practice]` occupies the middle: past novice, not reaching expert. Design for this majority, not for the extremes.

### Rule 3: Offer informative feedback
Every user action gets a response. Frequent minor actions: modest response. Infrequent major actions: substantial response.

*Application*: The response time tier framework (above) operationalizes this rule. Silence is not a valid feedback response for any user-initiated action.

### Rule 4: Design dialogs to yield closure
Action sequences have beginnings, middles, and ends. Completion feedback gives a sense of accomplishment and permission to proceed.

*Application*: Every multi-step operation must communicate completion. A deployment that finishes silently leaves the user uncertain. A form submission that succeeds without confirmation leaves the user wondering. Closure is the permission to drop the contingency plan.

### Rule 5: Prevent errors
Gray out inapplicable options. Don't allow invalid inputs. If error occurs, give simple, constructive, specific recovery instructions. Erroneous actions should leave state unchanged or provide a restoration path.

*Application*: The error prevention hierarchy (above) operationalizes this rule. The strongest form is prevention (constraints); the fallback is specific, actionable error messages with recovery paths.

### Rule 6: Permit easy reversal of actions
Actions should be reversible. Relieves anxiety and encourages exploration.

*Application*: Design undo/redo scope explicitly. Design optimistic UI for reversible async operations. Design `--dry-run` for destructive CLI commands. Reversibility is a design decision — implement it as a constraint on the interaction model, not as an afterthought.

### Rule 7: Keep users in control
Experienced users must feel they control the interface. Avoid surprises. Familiar behavior must stay familiar.

*Application*: Don't change application state without a user action triggering it. Don't reorder lists while the user is navigating them. Don't move focus without the user initiating a focus change. In TUI: don't repaint content that the user is actively reading. In CLI: don't produce output to stdout during an operation unless it is progress data the user needs.

### Rule 8: Reduce short-term memory load
Don't require users to remember information from one display to use on another. Keep locations visible. Keep relevant state visible.

*Application*: In TUI: show the current mode, current context, and available actions in the status bar — don't require the user to remember what mode they are in. In CLI multi-step operations: echo the key parameters the user provided before executing, so they can verify before the operation runs. In web forms: preserve entered data across validation errors — don't force the user to re-enter after a submit failure.

---

## AI-Agent Adaptation

An AI agent performing interaction design has access to the following analytical tools — no user observation required:

**Available:**
- **State machine enumeration**: listing all states and transitions for a described component is pure analytical reasoning. An agent can produce a complete state model for any described interface component.
- **Action cycle walkthrough**: applying the seven stages to a described interaction produces specific design questions that reveal gaps. This is the heuristic cognitive walkthrough method applied systematically.
- **Shneiderman's eight rules as inspection checklist**: every rule is a testable property of a described design. An agent can evaluate a design description against all eight rules.
- **Response time tier classification**: classifying operations by their likely response time and specifying appropriate feedback per tier is analytical reasoning.
- **Error path enumeration**: for any described operation, an agent can systematically enumerate what can go wrong and specify the required feedback and recovery for each failure mode.
- **Cross-surface consistency checking**: an agent can reason about whether an interaction principle has been applied consistently across CLI, TUI, web, and desktop surfaces.
- **Affordance/signifier audit**: for each interactive element in a described design, an agent can verify that a signifier is specified and that it matches the affordance.

**Not available:**
- Real user observation (no eye tracking, think-aloud, behavioral logging)
- Usability testing (no direct measurement of success/failure rates)
- Actual response time measurement (can specify thresholds, cannot measure implementation performance)
- Tactile and spatial feedback evaluation (cannot assess haptics or motor precision requirements)

**Standard evaluation protocol for AI agent interaction design work:**
1. Enumerate all eight canonical states before specifying any interaction — resist the pull toward happy-path-only design
2. Walk every operation through the response time tier framework and specify the required feedback for each tier
3. Apply the action cycle walkthrough to at least one non-happy-path scenario
4. Enumerate error states for every operation that can fail
5. Apply Shneiderman's eight rules as a review checklist after drafting the behavioral contract
6. For each surface in scope, verify the interaction model matches the surface's event model (stateless command-response vs. stateful event loop vs. async DOM)
7. Verify no trapped states exist in the state model

---

## Failure Modes — Recognition Criteria

**Anti-pattern 1: Happy-path-only design**
*What it looks like:* The interaction spec shows one or two states per component. No loading state. No error state. "Error handling TBD." The spec walks through the user action and the success result and stops.
*Why it fails:* Engineering implements default behavior for unspecified states — generic error messages, broken loading states, invalid inputs accepted silently.
*Recognition signal:* If you can describe the full interaction in under 30 words without mentioning an error or failure, the spec is almost certainly missing states.

**Anti-pattern 2: Surface adaptation instead of surface translation**
*What it looks like:* The interaction spec for a CLI is a web interaction spec with "click" replaced by "type command." The spec mentions persistent state, visual feedback, hover effects, or refers to elements that don't exist in CLI.
*Why it fails:* The fundamental interaction model difference (stateless command-response vs persistent event-driven UI) is ignored. Exit codes, stdout/stderr discipline, and pipeline composition are absent from the spec.
*Recognition signal:* Can you replace "CLI" with "web" throughout and get a coherent web interaction spec? If yes, the spec is not addressing CLI-specific interaction.

**Anti-pattern 3: Affordance without signifier (hidden affordances)**
*What it looks like:* Interactive elements have no specified hover state, focus state, or visible indicator of interactivity. Key bindings in TUI have no legend. CLI flags are not listed in `--help`.
*Why it fails:* Users cannot discover the capability. The affordance exists; they simply never find it.
*Recognition signal:* For each interactive element in the design, ask "how does the user know they can do this?" If the answer is "they just know" or "it's obvious," that is a hidden affordance.

**Anti-pattern 4: Feedback absence in the 0.1–1.0 second window**
*What it looks like:* The spec acknowledges that an operation takes 200–500ms but specifies no immediate feedback. The button does not change state until the result returns.
*Why it fails:* Users re-click or re-submit. Multi-submit errors. User uncertainty about whether the action registered.
*Recognition signal:* Any operation with a response time between 0.1s and 1.0s that has no specified immediate acknowledgment state.

**Anti-pattern 5: Modal overuse**
*What it looks like:* Every confirmation, warning, or secondary action is a modal dialog. "Just to be safe" modals for actions that are reversible or that the user explicitly chose.
*Why it fails:* Modals interrupt flow, stack (modals on modals), and train users to dismiss without reading — making them actively harmful for the cases they are supposed to prevent.
*Recognition signal:* If the answer to "is this action irreversible?" is "not really, the user can undo it," the modal is friction, not safety. If users see this modal on every deployment to a staging environment, they have been trained to click through it.

**Anti-pattern 6: Inconsistent state vocabulary**
*What it looks like:* Different components use different vocabulary for the same state ("disabled" vs "inactive" vs "unavailable"; "error" vs "invalid" vs "failed"). State names are chosen per-component rather than from a shared vocabulary.
*Why it fails:* Users must separately learn each component's vocabulary. Cognitive load accumulates. Shneiderman's Rule 1 violation.
*Recognition signal:* Look at state names across multiple components in the design. If the same state concept has more than one name, the vocabulary is inconsistent.

**Anti-pattern 7: Confirmation without recovery**
*What it looks like:* The spec requires a confirmation dialog for a destructive action, but the error state for "user confirmed but operation failed" is unspecified. Or: the spec adds confirmation but does not design reversibility — so confirmation is the only protection against an irreversible mistake.
*Why it fails:* Confirmation is not the same as protection. Users confirm incorrectly. If the action has no recovery path, confirmation reduces but does not eliminate the risk.
*Recognition signal:* Any destructive action that has a confirmation dialog but no undo, rollback, or recovery path specified.

---

## Boundary with Adjacent Skills — Falsifiable Tests

**interaction-design vs. user-flow-design:**
Test: "Does this decision concern the sequence of steps across a task, or the response to a specific action within a step?"
- Sequence across steps → `user-flow-design`
- Response to an action within a step → interaction-design

Falsification: if an interaction design artifact contains a task-level sequence (Step 1, Step 2, Step 3, with the content of each step defined), it has overstepped into `user-flow-design`. If a user-flow-design artifact contains per-action response specifications (what happens when the user clicks X in Step 2), it has overstepped into interaction-design.

**interaction-design vs. surface skills (cli-design, tui-design, web-ui-design):**
Test: "Does this decision apply only to one surface type, or does it apply across surfaces?"
- Surface-specific (flag syntax, ANSI codes, CSS transitions) → surface skill
- Cross-surface behavioral contract (state modeling, feedback latency tiers, error message content obligations) → interaction-design

Interaction design specifies that an error state must exist and what feedback it must produce. The surface skill specifies how that error state is rendered on that specific surface.

**interaction-design vs. visual-interface-design:**
Test: "Does this decision concern what the state communicates, or how that communication looks?"
- What it communicates → interaction-design ("error state: message tells user what failed and what to do")
- How it looks → visual-interface-design ("error state: red inline text, 12px, positioned below the failing field")

**interaction-design vs. experience-design:**
Test: "Does this decision concern the quality of the whole experience, or what the system does in response to a specific action?"
- Whole experience quality → `experience-design`
- Per-action response → interaction-design

Interaction design receives experience goals from experience design and uses them to prioritize which states and feedback mechanisms matter most.

**interaction-design vs. accessibility-design:**
Interaction design specifies that a focus state must exist and must have a visible indicator. Accessibility-design specifies the WCAG 2.1 SC 2.4.7 requirement (focus visible) that makes this a compliance obligation, and the specific testable condition.

---
