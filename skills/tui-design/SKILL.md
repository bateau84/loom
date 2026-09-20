---
name: tui-design
description: Design, build, refactor, or review terminal interfaces—full-screen TUIs, interactive prompts, and command-line tools. Dual-audience: Designer loads this skill for human-centered TUI design reasoning (terminal constraints, keyboard interaction philosophy, focus model design, key binding design, color strategy, accessibility); Worker loads it for implementation (Bubble Tea, Ratatui, Textual, Ink, framework lifecycle, testing). Use for terminal-app layout and UX, CLI behavior, ncurses-style tools, dashboards, REPLs, fzf-like pickers, and libraries such as Bubble Tea, Ratatui, Textual, or Ink, including requests that name a known TUI such as lazygit, k9s, btop, helix, or yazi instead of saying "TUI." Do not use for browser or web UI, native GUI, editor or font configuration, or backend and shell work that has no terminal interface.
metadata:
  version: "1.0.0"
---

## Human-Centered TUI Design Reasoning

*This section is the design-reasoning layer for Designer. It addresses the what and why of TUI design decisions — terminal-specific constraints, keyboard interaction philosophy, focus model design, and known design failures. This is NOT adapted from web or GUI conventions — the terminal is a fundamentally different medium that requires its own design vocabulary. If you are a Worker implementing a TUI, skip to [TUI & CLI Design](#tui--cli-design) below.*

---

### The Terminal as a Constrained Design Environment

A terminal is not a canvas. It is a character-cell grid with properties that make it categorically different from a pixel-based surface:

**Character-cell grid constraint.** Every layout decision is made in character columns and rows, not pixels. An element that is 40 characters wide occupies exactly 40 character cells. There is no sub-pixel rendering, no anti-aliasing, no fractional positioning. Layout is integer arithmetic — splitting a 79-column terminal into two equal halves produces one 39-column and one 40-column pane (with one column for a border). Borders consume cells; a 1-character border on each side of a 40-column panel leaves 38 columns of content. This is not a limitation to work around — it is the design medium, and designing with it (not against it) produces clean, correct TUI layouts.

**Cell-width ≠ byte-length.** CJK characters are 2 cells wide. Many emoji are 2 cells wide. Combining marks may be 0 cells wide. Designing a table column as "20 characters" is ambiguous; designing it as "20 terminal cells" is precise. Truncation, alignment, and padding must all be specified in cell units.

**Color depth varies by terminal.** Three tiers:
- **16 ANSI colors** — the universal baseline; maps to user's terminal color scheme (user controls exact RGB values). A TUI using only 16 colors works everywhere and respects the user's theme.
- **256 xterm colors** — de facto standard for modern terminals; includes a 6×6×6 color cube and 24-color grayscale ramp.
- **24-bit true color** — supported by most modern terminals (kitty, iTerm2, Windows Terminal, GNOME Terminal); not available in some SSH or embedded environments.

Design implication: never assume 24-bit color. Design with semantic color tokens (see Color Model below) that map to 16-color semantics and are enriched for 256-color and true-color environments.

**Terminal emulator variation.** Rendering varies by terminal emulator: Unicode support, mouse event types, alternate screen buffer behavior, OSC sequence support (OSC 8 hyperlinks, OSC 7 working directory), and window title setting. Design for the common subset; acknowledge where enhancements are optional.

**No browser host.** A TUI has no back button, no URL, no zoom, no DOM. All navigation must be explicitly designed into the key binding scheme and view hierarchy. There is no platform-managed scroll bar or window chrome — every affordance is the application's responsibility.

**Historical origin.** The DEC VT100 (1978) standardized ANSI escape codes. Modern terminals still emulate VT100 behavior — the character-cell model is a 50+ year legacy that defines the medium. This is why the design constraints are structural, not incidental.

---

### Full-Screen TUI vs Line-Mode TUI — Choose Consciously

This is the first design decision, made before any framework or layout work:

| Mode | Characteristics | Examples | Use when |
|---|---|---|---|
| **Full-screen TUI** | Owns the entire terminal via the alternate screen buffer; stable spatial layout; controlled resize; no scrollback during session | vim, htop, lazygit, k9s | Multiple views must be simultaneously visible; navigating large state spaces; spatial memory is part of the UX |
| **Line-mode TUI** | Writes to primary screen; contributes to terminal scrollback; interactive chrome on stderr/`/dev/tty`; selection result on stdout | fzf, gum, peco | Temporary picker or selection from calling shell; result must be capturable via pipe; inline selection better than taking over the screen |
| **One-shot CLI** | Runs and exits; no persistent screen | grep, git log | Single command producing output — not TUI scope |

**The line-mode (summon-choose-exit) design rule:** The interactive UI must use stderr or `/dev/tty`, not stdout. The selected result must go to stdout. This is not implementation detail — it is a design contract that determines whether the tool can be composed with shell scripts and pipelines.

Full-screen adds complexity — terminal restoration, resize handling, suspend/resume — that line-mode avoids. Choose full-screen only when spatial layout across multiple interactions is genuinely required.

---

### Keyboard-First Interaction Design

A TUI is keyboard-first by design. Mouse is optional enhancement, never the primary modality. This is not a constraint to work around — it is the design principle that enables the efficiency advantages TUIs offer practiced users.

**How keyboard-first differs from GUI/web interaction:**
- **No hover state.** There is no cursor-over-element pre-selection. Focus is binary: an element either has focus or it does not.
- **No visible affordances for actions.** A button in a web UI shows its clickability visually. A TUI action requires knowing the key binding — there is no "button" to discover. The design must surface discoverability explicitly.
- **Key events are global by default.** The application must implement its own key routing to deliver events to the focused component. Scoping is a design decision.

#### Key Binding Conventions Users Bring as Expectations

Users arrive with learned key binding conventions. A TUI design that violates established conventions increases learning cost and produces errors.

| Convention | Keys | Applies in |
|---|---|---|
| **Vim navigation** | `h`/`j`/`k`/`l` (left/down/up/right), `g`/`G` (top/bottom), `/` (search), `:` (command mode), `q` (quit) | List navigation, file managers, git TUIs |
| **Arrow key navigation** | `↑`/`↓`/`←`/`→` | Universal; always provide alongside vim keys in navigation contexts |
| **Emacs / readline** | `Ctrl-A`/`Ctrl-E` (line start/end), `Ctrl-P`/`Ctrl-N` (prev/next), `Ctrl-K`/`Ctrl-U` (kill to end/start) | Text input fields — always apply in text input contexts |
| **Universal TUI** | `Enter` (select/confirm), `Escape` (cancel/go back), `?` (help), `q` (quit), `Tab`/`Shift-Tab` (panel switching) | All TUIs |

**Conflict resolution.** When vim navigation keys and readline keys are both in scope — a list panel with a filter text input visible on screen — scope them by context: vim/arrow keys apply when a navigation element has focus; readline keys apply when a text input has focus. The focus model (see below) determines which context is active.

**Terminal-reserved bindings that must not be overridden:**
- `Ctrl-C` → SIGINT (interrupt) — the user's universal "stop this program." Capturing it without providing another exit route is a keyboard trap.
- `Ctrl-Z` → SIGTSTP (suspend) — should background the TUI and restore terminal state.
- `Ctrl-S` / `Ctrl-Q` → XON/XOFF flow control — some terminals use these; overriding can freeze output.
- `Ctrl-D` → EOF in some contexts.

**Modal key bindings (vim-style).** If the design uses modes (normal/insert/command/visual), the current mode must always be visible in the design — a status bar indicator or status line. A modal design where the mode is invisible fails: key presses produce unexpected results, and the user cannot self-rescue.

#### Designing for Key Binding Discoverability

Users cannot see available key bindings. The design must surface them:

- **Minimum always visible:** "? = help" in the status bar at all times. If the user can find help, they can find anything else.
- **Context-sensitive bindings:** Show 3–5 bindings for the current focus context in the status bar. Not all bindings — just the most common for the current state.
- **? help overlay:** A `?` key opens a complete key binding overlay; `Escape` closes it. This is the established convention across htop, lazygit, k9s, and broot.
- **Modal context display:** If the design is modal (vim-style), the status bar must always show the current mode.

**Designing the key binding map.** Produce this as a design artifact: a table of key → action organized by context (navigation, text-input, global, modal). This is the primary deliverable from key binding design — not as prose description but as a structured map that both documents the design and enables implementation review.

---

### Focus Model Design

In a GUI, focus is managed by the OS window manager and shown via OS-level visual affordances. In a TUI, focus is managed entirely by the application using only character-cell rendering and cursor position. This is a design responsibility, not an implementation detail.

**Focus communication mechanisms (in priority order):**
1. **Cursor position.** The terminal cursor (blinking block, underscore, or bar) is the universal focus indicator. In a text input, cursor position IS focus. In a list, the application must draw an equivalent: a highlighted row, a `▶` marker, or reversed foreground/background.
2. **Reverse video (highlight).** The selected item in a list is rendered with inverted foreground and background — the TUI equivalent of a selection highlight. This is the primary selection indicator.
3. **Border color/style.** Active panels show a bright or distinctively styled border; inactive panels show a dim border. This is the multi-panel focus indicator (lazygit's panel model is the reference).
4. **Status bar.** Shows current context and available bindings for the focused component.

**Focus model design decisions to make explicit:**
- **How many focus levels?** Typically: focused panel → focused item within panel → focused modal (if open). Define the levels before designing transitions.
- **Focus traversal order.** What does Tab do? Arrow keys? Are there distinct bindings for panel switching vs item navigation?
- **Focus and modal overlays.** When a modal is open, focus must be trapped inside it — navigation outside the modal must not function. Escape closes the modal and returns focus to its trigger point. This is a focus-trap design, not just implementation.
- **Focus on resize.** The selected item must remain visible (not scroll off screen) when the terminal is resized. Define this as a design constraint.

**The htop focus model** (archetypal single-panel): one scrollable list with highlighted row; function-key labels at the bottom for available actions. Single focus level — only the list has focus.

**The lazygit focus model** (archetypal multi-panel): five panels with explicit panel focus; active panel has bright border, inactive panels dim; Tab switches panel focus; arrow keys navigate within the active panel; Enter drills down, Escape goes back. Context-sensitive status bar shows bindings for the active panel.

---

### Layout Model: Character-Grid Constraints

**Responsive terminal design.** Design at three breakpoints:
- **80×24** — the standard minimum. Every TUI must be fully functional at this size. If it is not, the design is not complete.
- **60 columns** — tmux split or narrow terminal. Multi-column designs must degrade to single-panel fallback.
- **Below minimum** — show a "terminal too small" message rather than corrupt the layout. Define what this message says.

**Common TUI layout patterns:**
| Pattern | Description | When to use |
|---|---|---|
| Full-screen single panel | One scrollable list or editor | Simple navigable tools (htop, less) |
| Vertical split | Left panel + right panel | File manager (left: tree, right: preview); git (left: file list, right: diff) |
| Horizontal split | Top panel + bottom panel | Command input at bottom; process list at top |
| Miller columns | Parent → child → grandchild | Deep hierarchies (ranger, broot) |
| Modal overlay | Centered panel drawn over main view | Confirmation dialogs, input prompts, help overlays |
| Status bar | Fixed bottom row | Current state, mode, available bindings |
| Command bar | Bottom input area | Search mode, filter mode, `:` command mode |

**Border cost.** Borders consume character cells. A 1-character box border on each side costs 2 columns and 2 rows of content space. At 80×24, a bordered main panel with a status bar row and a border leaves approximately 76×20 of content. Plan for this in the layout specification.

**Integer split arithmetic.** Document how panels split at each breakpoint. "Equal halves" at 79 columns = 39 + 40. "Left sidebar 25%" at 80 columns = 20 + 60. This is a design specification, not an implementation detail — the implementer should not have to invent these rules.

---

### Color Model: Design for the Full Capability Range

**Use semantic color tokens, not literal color values.** Define roles, not RGB values:

| Token | Purpose |
|---|---|
| `fg-primary` | Main content text |
| `fg-secondary` | De-emphasized text, labels |
| `bg-primary` | Main background |
| `bg-selected` | Selected/focused row background |
| `accent` | Highlight, active indicator |
| `error` | Error state indicator |
| `success` | Success state indicator |
| `warning` | Warning state indicator |
| `border-active` | Active panel border |
| `border-inactive` | Inactive panel border |

Map these tokens to 16 ANSI colors for the base tier. Add 256-color mappings for the enhanced tier. This ensures the TUI degrades gracefully to 16-color terminals and respects the user's terminal color theme.

**`NO_COLOR` design requirement.** When `NO_COLOR` environment variable is set, strip all color. The design must specify: what information is communicated by color, and how that information is still communicated without color. Answer: by character symbol, position, or text label. Color is always the secondary signal; the primary signal must work without it.

**Color is never the only signal.** A list row colored red for "error" must also carry a text indicator (e.g., `✗`, `ERROR`, `[FAIL]`) or position signal. This applies to: error/success states, selected/focused elements, active/inactive panels, any state distinction. Color-blind users, `NO_COLOR` contexts, and monochrome terminals all fail when color is the sole signal.

**Contrast.** TUI users set their own terminal theme (dark-on-light or light-on-dark). A TUI design must work in both. Semantic tokens that map to ANSI colors (which the user's theme defines) automatically respect this. Hard-coded RGB values that assume a dark background fail on light-background terminals.

---

### Navigation Patterns (TUI-Specific)

**List navigation.** `j`/`k` or `↑`/`↓` to move the selected item. `Enter` to select or drill down. `Escape` or `q` to go back. This is the primary navigation pattern in most TUIs.

**Tree navigation.** `Enter` or `→` to expand/open; `Escape` or `←` to collapse/go up. Parent/child traversal must be explicit in the design — not implied.

**Panel switching.** `Tab`/`Shift-Tab` to move between named panels. This is the established convention; deviating from it without a strong reason increases learning cost.

**Modal overlay navigation.** `Escape` closes the modal and returns focus to the trigger. Navigation inside the modal uses the same movement keys as the rest of the TUI. Focus is trapped inside the modal — panel-switching bindings (`Tab`) must not move focus outside the modal.

**Help overlay.** `?` opens; `Escape` closes. The help overlay lists all key bindings, organized by context. It is NOT a separate view — it is an overlay drawn over the current state.

**Search/filter input.** `/` (vim-style) or a dedicated command bar opens a text input. The filter applies as the user types. `Escape` clears and closes.

---

### Status Bar and Command Bar Design

The status bar occupies the bottom row (or rows) of the terminal. It is the TUI's primary discoverability mechanism — the equivalent of tooltips, button labels, and menu bars in GUIs.

**Always visible at minimum:**
- Current mode (if the design is modal)
- "? = help" — the entry point to full discoverability
- How to quit

**Context-sensitive content.** Show the 3–5 most relevant bindings for the current focus context. Not every binding — only the current ones. Showing 15 bindings in a status bar that is 80 columns wide makes none of them readable.

**Status bar vs command bar distinction.** The status bar is read-only information about current state. A command bar is an active text input for search, filter, or `:` command entry. When command bar is active, focus is in the text input — the status bar content may change to reflect input mode.

**Design decision: what goes in the status bar per context.** Specify this per view and per modal. The implementation must not invent this.

---

### TUI Accessibility Constraints

TUI accessibility is categorically different from web accessibility — and significantly more limited. The design must acknowledge these limits honestly, not treat TUI accessibility as equivalent to WCAG compliance.

**What TUI accessibility primarily means:**
1. **Keyboard completeness.** Every operation is reachable by keyboard. No feature requires mouse. This is the primary accessibility criterion for TUIs.
2. **Plain-text fallback mode.** Provide a `--no-tui` or `--plain` mode that produces structured text output for users whose accessibility tools cannot handle full-screen TUI. This is a design requirement, not a nice-to-have.
3. **No color-only signals.** State, error, and status must be communicable without color — character/symbol as the primary signal (see Color Model above).
4. **Predictable layout.** Screen reader users read terminal output row by row. Keep key state in predictable positions (status bar at bottom, consistent panel layout) so the screen reader can be directed to the right area.

**What TUI accessibility cannot provide (by design of the medium):** ARIA roles, semantic structure, live regions, accessible names for custom components. Terminal emulators do not expose the semantic accessibility tree that browser accessibility APIs do. A TUI screen reader reads character cells in order — it does not understand that a highlighted row is a "selected list item."

**Design implication.** For a TUI that requires full accessibility compliance (government tool, tool used by diverse accessibility needs), a `--plain` or `--no-tui` output mode that produces structured text is the design answer. The full-screen TUI serves practitioners who choose it; the plain mode serves those who need it.

**Modifier key accessibility.** Avoid chords that require simultaneous holding of 3+ modifier keys. Provide single-key alternatives for all common operations. `Ctrl-Shift-R` is inaccessible to users with motor impairments; `r` (in the appropriate mode) is not.

---

### TUI Design Failure Modes

These are named failure modes from real TUI tools — each with a concrete consequence. A TUI design must address all of them.

#### TF1: Keyboard Trap — No Escape Route
A modal or overlay that captures keyboard input with no conventional dismiss binding (Escape, q). The user cannot exit the mode without killing the process. **Every modal, overlay, and context must have a clear keyboard exit.** Escape must either dismiss or navigate to a context where quit is available.

#### TF2: No Help Without a Hidden Key
A TUI where the help binding itself must be discovered before any help is accessible. The status bar shows nothing. `?` is not documented anywhere visible. The user must guess or read external documentation. **Design must show "? = help" at all times.** The help entry point cannot itself be undiscoverable.

#### TF3: Assuming 256 Colors Without Detection
Using 256-color or true-color escape sequences on terminals that support only 16 colors. Result: garbled colors, invisible text, broken visual hierarchy. **Detect color capability; degrade gracefully.** Semantic tokens mapped to 16-color ANSI automatically avoid this.

#### TF4: Color as the Only Signal
Using only color to distinguish state — green rows for success, red for error — with no text, symbol, or position signal. Fails for color-blind users, `NO_COLOR` contexts, and monochrome terminals. **Every state distinction must have a non-color signal.** (See Color Model above.)

#### TF5: No Resize Handling
A TUI that does not handle `SIGWINCH`. When the user resizes the terminal window, the display is not re-rendered — corrupted layout or partial UI from the prior size. **SIGWINCH handling is a design requirement, not an implementation detail.** Define what the TUI does at each breakpoint in the layout spec.

#### TF6: Not Restoring Terminal State on Exit
A TUI that crashes or exits abnormally without restoring: raw input mode, alternate screen buffer, cursor visibility, mouse capture. **The user's terminal is left in an unusable state.** The design spec must define all exit paths (normal exit, error exit, Ctrl-C, crash/panic) and require terminal restoration on each. This is a user-experience failure mode, not just an implementation bug.

#### TF7: Mouse Required for Critical Operations
A feature accessible only via mouse click — no keyboard equivalent. Fails for remote SSH sessions (mouse forwarding often disabled), keyboard-only users, and screen reader users. **Every critical operation must be keyboard-reachable.** Mouse may accelerate; it must never gate.

#### TF8: Adapting Web or Desktop Patterns Without Translation
Designing a TUI by adapting web UI patterns without acknowledging the medium. Examples: designing modal dialogs without accounting for the lack of z-ordering in character-cell grids; designing hover states that have no terminal equivalent; assuming a "flex layout" that does not translate to integer cell arithmetic. **A TUI must not be treated as a GUI rendered with text.** Every design decision must be made in terms of the terminal medium.

#### TF9: Blocking Event Thread on I/O
Not a key binding issue — a UX issue. A TUI that performs network requests or file reads on the main event loop becomes completely unresponsive during the operation. From the user's perspective: the TUI freezes, key presses are buffered and fire unexpectedly when unblocked. **The design must specify: all long-running operations are async and show progress indication while running.**

---

### Real TUI Tools as Design References

#### `htop` — Process Monitor (Single-Panel Model)
**Design decisions:** Fixed header with CPU/memory bar graphs; scrollable process list as the main body; function-key label bar at bottom (`F1 Help  F2 Setup  F3 Search  F4 Filter  ...`). All navigation via arrow keys and function keys.

**What works well:** The bottom bar makes every major operation discoverable on first use without any external documentation. Single focus level — only the list has focus — minimizes cognitive load. Minimal chrome: most of the screen is data.

**Design lesson:** A status bar that shows actionable bindings (not just state information) serves as both discoverability and documentation. For simple single-panel tools, this is sufficient — a `?` help overlay is not needed when all bindings fit in one visible line.

**Design trade-off:** Function key bindings (`F5 = Tree`, `F6 = Sort`) are not finger-friendly on laptops where function keys require `Fn+key`. btop++ responded by shifting to letter-based bindings — a valid correction.

#### `lazygit` — Git TUI (Multi-Panel Model)
**Design decisions:** Five panels (status/files, branches, commits, stash, and a detail panel), with explicit panel switching via Tab. Active panel has bright border; inactive panels have dim border. Context-sensitive status bar shows bindings for the active panel only. `Enter` drills down, `Escape` goes back. Consistent vim-style navigation within each list. `?` opens full help overlay.

**What works well:** The panel focus model is explicit and visually clear — bright vs dim borders communicate active panel at a glance. Context-sensitive help bar reduces cognitive load by showing only relevant bindings. Consistent enter/escape navigation model applies everywhere.

**Design lesson:** Multi-panel TUIs must make current panel focus unambiguous. The bright-border / dim-border contrast is the minimum visual signal required. Status bar showing context-specific bindings prevents the "which panel am I in, what do my keys do?" confusion that plagues multi-panel tools.

**Design trade-off:** Five panels on first load is a complex initial IA. New users must learn the panel structure before they understand the git workflow. Progressive disclosure was sacrificed for power-user density.

#### `k9s` — Kubernetes TUI (Command-Mode Model)
**Design decisions:** Vim-inspired command mode with `:` prefix (`:pod<Enter>` navigates to pod view, `:deploy<Enter>` to deployments). Context-aware header showing current cluster/namespace. Color coding for pod status (green=running, red=error, yellow=pending) with accompanying text labels. Mouse support for click-to-select.

**What works well:** Command mode scales to large command spaces without exhausting key binding vocabulary. Typing what you want (`:pod`) is more discoverable for known actions than memorizing an obscure key. Context header prevents "which cluster am I on?" errors.

**Design lesson:** When the action space is very large (dozens of resource types in Kubernetes), command-mode (`:action`) is more scalable than key-binding proliferation. The design must still make command-mode discoverable — `k9s` does this with a `:?` palette.

**Design trade-off:** Command mode privileges advanced users. `:?` for the command palette is itself an undiscoverable binding. New users arriving without knowing `:?` exists have poor initial discoverability.

#### `broot` — File Manager (Unified Interaction Model)
**Design decisions:** Type-to-filter as the primary interaction — no mode switching. Typing any string immediately filters the file tree. `Enter` opens, `Backspace` goes up or clears filter. Small key binding hint at the bottom. Immediate visual feedback on every keystroke.

**What works well:** Single interaction model (type to filter) is learnable in under a minute. Removes the modal complexity that plagues other file managers. Status bar at the bottom provides just enough affordance.

**Design lesson:** Reducing the number of distinct interaction modes reduces learning cost significantly. A single, well-designed interaction model is not necessarily less powerful — broot navigates very large directory trees efficiently with this approach. The design question "how many modes does this tool need?" is worth asking explicitly before adding modal complexity.

---

### AI-Agent TUI Design Capabilities

**What a Designer AI agent can evaluate:**
- Layout coherence from a textual description — does the panel structure match the workflow? Is the focus model explicit?
- Key binding coverage — are all primary operations keyboard-accessible? Do conventions match vim/emacs/readline expectations?
- Status bar completeness — does the design show "? = help" and current mode at all times?
- Color model — does the design use semantic tokens rather than literal colors? Does it address `NO_COLOR`?
- Accessibility floor — is `--plain` mode specified? Are color signals paired with non-color signals?
- TUI lifecycle — does the spec address terminal restoration on all exit paths?

**What requires runtime access to verify:**
- Whether escape sequences are correctly implemented
- Whether `SIGWINCH` handling actually re-renders correctly
- Whether color detection works for the actual terminal capability
- Whether key binding conflicts with the specific terminal emulator's shortcuts

**Design spec production.** A complete TUI design spec must enumerate: layout structure (panels, sizes, resize behavior at each breakpoint), focus model (which elements have focus, how focus transfers, modal focus-trap behavior), key binding map (organized by context), status bar content (what is shown in each context), color strategy (semantic tokens, `NO_COLOR` fallback, non-color alternatives), lifecycle boundaries (startup, normal exit, error exit, Ctrl-C, resize, suspend, resume).

---

## TUI & CLI Design

Design terminal software that is calm, predictable, fast, and honest about the medium. Treat this file as the workflow and cross-cutting contract. Load detailed guidance from the one reference that owns it instead of reconstructing or repeating it here.

## Route before answering

| Need | Authoritative reference |
|---|---|
| Go, Bubble Tea, Lipgloss, Bubbles, tview, gocui | `references/ecosystem-go.md` |
| Rust, Ratatui, crossterm, Cursive | `references/ecosystem-rust.md` |
| Python, Textual, Rich, prompt_toolkit, urwid | `references/ecosystem-python.md` |
| TypeScript/JavaScript, Ink, OpenTUI, Clack, Inquirer | `references/ecosystem-typescript.md` |
| One-shot commands, arguments, streams, exit codes, automation | `references/cli-basics.md` |
| Layouts, buffers, borders, hierarchy, color, density, responsive behavior, tables, themes, accessibility | `references/visual-patterns.md` |
| Keys, focus, navigation, modes, forms, mouse, confirmation, undo, OSC features | `references/interaction-patterns.md` |
| Case studies: lazygit, k9s, fzf, btop, helix, yazi, atuin | `references/exemplar-apps.md` |
| Screenshots or demo recordings | Use the separate `vhs-cli-demos` skill |

Load only the references the task needs. When the prompt names a framework or ecosystem, always load its ecosystem reference before making API, lifecycle, implementation, or testing claims. Ecosystem references own those specifics. The visual and interaction references own their domains for every ecosystem. Exemplar apps are evidence and inspiration, not substitutes for the pattern references.

If no language is named, ask only when ecosystem choice would materially change the answer or implementation. Otherwise state a reasonable recommendation and proceed: Go for polished single binaries, Rust for control and reliability, Python for rapid product work, and TypeScript when React or npm distribution is already an advantage.

## Classify the product first

Choose the output contract before choosing a framework or layout:

| Product shape | Default contract |
|---|---|
| One-shot CLI | No live full-screen UI. Stable stdout for results, stderr for diagnostics, meaningful exit codes. Load `cli-basics.md`. |
| Summon–choose–exit tool | Prefer inline when shell context matters. Put interactive chrome on stderr or `/dev/tty` and the selected result on stdout. Use full-screen only when a large preview or working set needs stable space. |
| Full-screen session | Use the alternate screen and a stable spatial model. Treat terminal restoration, resize, suspend, and redraw behavior as product requirements. |

Then name the workflow shape—persistent panels, Miller columns, drill-down stack, dashboard, IDE-style panes, overlay, or tabs—and verify it against `visual-patterns.md`. Sketch the states and layout before writing code: initial, loading, empty, partial, success, error, disconnected, and too-small.

## Work the task

1. Classify the product shape and its stdout/stderr contract.
2. Identify the dominant user loop and the 5–8 most common actions.
3. Select the ecosystem and load its reference plus any relevant pattern reference.
4. Sketch the layout and state transitions at wide, standard, narrow, and minimum sizes.
5. Implement in the ecosystem's native architecture; keep state/update/event work separate from rendering where the framework permits.
6. Verify lifecycle cleanup, input discoverability, output behavior, width handling, and async work.
7. Test the cheapest stable layer first, then rendered frames, then a small PTY smoke path only if its integration risk justifies it.

For design questions, make the recommendation before explaining it. For implementation, inspect the existing architecture and dependencies before introducing a new framework or abstraction. For reviews, cite concrete observations and prioritize changes by user harm.

## Preserve these cross-cutting contracts

### Terminal lifecycle

- Use the alternate screen for full-screen sessions; keep bounded and one-shot workflows inline when possible.
- Prefer framework-managed terminal cleanup. Restore raw mode, screen buffer, cursor, and input modes on every exit path, including errors and panics. Do not invent custom signal handling when the framework already owns it.
- Re-layout from the current frame or window size on resize. Coalesce bursts only when layout work is expensive.
- Treat final shutdown and temporary handoff as different boundaries. For an editor, shell, or supported suspend, prefer the framework's handoff API: pause UI input, restore the shell-facing terminal, wait, re-enter modes, reload externally mutable data, and force a full redraw. Redrawing only repaints the current model; it does not refresh changed data. Do not final-unmount an app that must resume, and do not assume POSIX signals exist on Windows.
- Keep logs and debug output away from the screen the TUI owns. Use a file, framework console, or separate diagnostic stream.

### Rendering, data, and performance

- Never block the UI/event thread on disk, network, or subprocess work. Return results through commands, messages, tasks, channels, or framework events.
- Render on input, data, resize, or intentional ticks; do not redraw unchanged state in an unconditional loop.
- Measure terminal cell width, not bytes, code points, `len()`, or JavaScript string length. Test CJK, combining marks, and emoji.
- Virtualize collections that can grow beyond a few hundred rows. Truncate rather than wrap inside tables; reveal full values in a detail view.
- Keep panel positions stable unless the user explicitly changes the layout. Spatial memory is part of navigation.

### Meaning and access

- Define semantic style tokens rather than scattering color literals. Honor `NO_COLOR` in automatic color mode and preserve meaning in monochrome.
- Never use color alone. Pair it with text, shape, position, or symbols, and provide an ASCII fallback when Unicode support is uncertain.
- Make every action keyboard-reachable. Mouse support may accelerate an action but must not gate it.
- Offer familiar navigation aliases only where they do not conflict with text entry or a complete bounded prompt keymap. Preserve terminal-reserved behavior such as interrupt, suspend, and flow control.
- Match discoverability to complexity: complete inline controls for bounded prompts; contextual hints, help, and optionally a command palette for action-rich full-screen apps.
- Provide a plain `--no-tui` or equivalent mode when automation or serious accessibility needs require linear output.

## Apply two review reflexes unprompted

These catch the failures users rarely name. Apply both to every layout you design or review, even when the question is about something else.

### Run a clutter audit

Make "busy" countable. Report:

- border-nesting depth—more than one border between the terminal edge and content is usually too much;
- how many signals encode the same state—`[PASS]`, green, a checkmark, and a row marker is four;
- markers present on every row, which therefore mark nothing;
- the share of cells spent on chrome, labels, and repeated boilerplate instead of data.

Name the exact borders, markers, labels, or repeated fields to remove. Do not stop at "simplify it." Use the full method in `visual-patterns.md` → *The clutter audit*.

### Pressure-test the floor

State what happens at 80×24 and in a 60-column tmux split: which pane wins, what hides, what truncates, what becomes drill-down, and when the truthful "terminal too small" state appears. Every multi-column design needs a single-pane fallback. Use the breakpoint ladder and minimum-size method in `visual-patterns.md` → *Responsive design*.

## Build and verification discipline

Keep business state independent enough to test without a terminal. In MVU or immediate-mode systems, feed synthetic events into update logic and assert state. In retained/widget systems, drive the smallest widget or app harness that owns the behavior.

Use a bottom-heavy test pyramid:

1. Unit-test state transitions, parsing, sorting, filtering, and command construction.
2. Snapshot or golden-test rendered frames at pinned terminal sizes and color profiles, including 80×24, 60 columns, and the hard minimum.
3. Use one or two PTY end-to-end flows for lifecycle and real-keyboard integration, not as the primary suite.

Verify at least:

- normal exit, interrupt, error, and panic cleanup;
- resize, too-small behavior, and suspend/resume where supported;
- empty, loading, partial, error, disconnected, and large-data states;
- keyboard reachability, focus visibility, and help accuracy;
- `NO_COLOR`, 16-color or monochrome, ASCII fallback, and non-TTY output;
- wide characters, combining marks, truncation, sorting, and virtualization;
- no stdout corruption and no blocking I/O in the event/render path.

Use the ecosystem reference's exact testing and debugging APIs. Never print diagnostics into an active raw-mode or alternate-screen UI.

## Review existing interfaces

Report evidence in priority order:

1. Is the product shape right, or should a full-screen flow be inline or one-shot?
2. Can any exit path leave raw mode, cursor state, mouse capture, or the screen buffer behind?
3. Does the UI block, redraw wastefully, crash on resize, or mismeasure cell width?
4. Can a first-time user find and reach the important actions without breaking text entry or terminal conventions?
5. What does the clutter audit count, and which exact elements should be cut?
6. What happens at 80×24, 60 columns, and the declared minimum?
7. Do output streams, exit codes, non-TTY behavior, `NO_COLOR`, and plain mode support scripts and accessibility?
8. Are state transitions and pinned frames covered at the right test layers?

Avoid generic verdicts. Tie each recommendation to a user-visible failure, an implementation risk, or a measurable reduction in noise.

## Give useful recommendations

Be decisive where practice has converged: semantic colors, clean terminal restoration, responsive fallback, non-blocking work, width-aware rendering, and honest stream contracts. Explain real tradeoffs for inline versus full-screen, modal versus modeless input, mouse support, and destructive-action confirmation.

Use the chosen ecosystem's idioms rather than translating another framework's architecture literally. When a design choice remains abstract, point to the relevant case study in `exemplar-apps.md` and explain which part of its solution transfers.

---
