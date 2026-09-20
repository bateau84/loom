---
name: visual-interface-design
description: Surface-independent visual design reasoning for application interfaces — how to use type, color, spacing, and visual hierarchy as a communication system, not decoration. Use when making visual decisions for any application interface: web app, desktop GUI, TUI, or CLI output. Load alongside `hallmark` when working on web products that have both marketing and application surfaces. Not for web-specific visual production (→ `hallmark`), surface rendering mechanics (→ `tui-design`, `web-ui-design`), interaction behavior (→ `interaction-design`), or implementing accessible code (→ `accessibility`).
metadata:
  version: "1.0.0"
---

# Visual Interface Design

## What this skill is for

Visual interface design is the discipline of using visual properties — type, color, spacing, size, weight, contrast, position — as a **communication system** to encode meaning, establish hierarchy, and guide attention. It is not about making interfaces attractive. The measure of a visual design decision is whether it correctly communicates structure, priority, and state to users.

**The foundational test:** Can this visual decision be justified by what it communicates, independent of aesthetics? If the only justification is "it looks nice," the decision lacks communicative grounding.

**Load this skill when:**
- Making visual decisions that communicate meaning: hierarchy, status, state, type, category, action affordance
- Designing visual systems for application interfaces: dashboards, forms, tools, data tables, monitoring views
- Specifying the visual semantics section of a Design Spec
- Evaluating whether a described visual design correctly communicates its intended meaning

**Load alongside `hallmark` when:**
- Working on web products that have both application interfaces (logged-in views, dashboards) and marketing surfaces (landing pages, promotional content). `hallmark` handles the marketing surface; this skill handles the application surface.

**Do NOT load this skill when:**
- Designing for web marketing/landing pages (→ `hallmark`) — Hallmark teaches macrostructures, component archetypes, web design tokens, OKLCH palettes, Tailwind configuration, and the slop test for web visual production. None of that belongs here.
- Choosing surface rendering mechanics: ANSI color codes, CSS layout engines, rendering APIs (→ `tui-design`, `web-ui-design`)
- Specifying interaction states or behavior (→ `interaction-design`)

**Hallmark boundary — explicitly enforced:**
Hallmark is a **production skill**: it generates web visual artifacts. This skill is a **reasoning skill**: it teaches how to think about visual decisions before producing anything. Hallmark owns web themes, macrostructures (H1–H9, S1–S5, F1–F6), component archetypes, the slop test, web design tokens, OKLCH palettes, and responsive production implementation. This skill owns visual hierarchy principles, semantic color, typography reasoning, spacing logic, iconography criteria, data visualization principles, motion semantics, dark mode as a design decision, and surface-specific visual constraints (TUI character grids, desktop platform conventions, CLI output formatting). These territories do not overlap.

The falsifiable test: if a piece of content in this skill is web-specific and would be equally at home in Hallmark's references, it violates the boundary. If it addresses TUI color constraints or CLI output alignment, it is correct.

---

## Visual hierarchy as attention management

Visual hierarchy is the designed order in which the eye processes elements. It is not decoration — it is the interface's answer to: **what should the user look at first, second, third?**

A hierarchy that serves the system's organizational model rather than the user's attention priorities is a design failure. Structure in code (feature categories, module boundaries) has no obligation to match reading priority. Design must override code organization to produce reading order that serves the user's task.

### The five hierarchy signals

These signals work in combination. Any single signal used alone is fragile; combining two or more creates unambiguous hierarchy.

| Signal | How it works | Use for |
|--------|-------------|---------|
| **Scale** | Larger elements claim more attention. 2–3 distinct sizes per composition. | Primary vs secondary vs tertiary content |
| **Weight** | Bold draws more attention than regular. Heavy weight signals primary content. | Emphasis within body copy, primary labels |
| **Contrast** | High contrast (dark on light, light on dark) claims attention; low contrast recedes. | Focus indicators, primary actions, critical state |
| **Position** | Top-left is the primary reading-entry point in LTR interfaces. | Primary actions in predictable positions |
| **Color saturation** | Saturated colors attract attention; desaturated colors recede. | Separating primary from supporting information |

**The grayscale test:** Remove all color. Does the hierarchy survive? If the hierarchy depends entirely on color, it will fail for colorblind users and in monochrome contexts (some terminal environments, printed output). Any hierarchy that only exists in color is a design gap.

### Failure: hierarchy that matches code structure

The most common visual hierarchy failure in application interfaces: the visual layout mirrors the system's internal organization (feature categories, module boundaries, database schemas) rather than the user's task priorities. A settings page organized as "Authentication / Authorization / Audit" mirrors the code modules. A user who needs to change their password has no way to predict which module contains it. Redesigning around user tasks ("Account & Security / Notifications / Appearance") requires visual hierarchy that matches what users are looking for, not what the system calls things.

### Gestalt principles applied operationally

Gestalt principles are not aesthetic guidelines — they describe how human visual processing groups elements without conscious reasoning.

**Proximity:** Elements closer together appear related. Cluster form fields for the same concept. Separate groups with whitespace, not just visual dividers. A label 24px below its input field will appear to belong to the input above it, not to the input it labels.

**Similarity:** Elements that look the same belong to the same category. Consistent button shape means "all buttons behave like buttons." Consistent tag styling means "all tags are the same kind of thing." Breaking similarity inadvertently creates false category distinctions.

**Common region:** Elements inside a visible container belong together. Cards, panels, and dialogs exploit this. Overlapping containers create ambiguity — an element visually inside two containers belongs to neither clearly.

**Figure/ground:** Interactive elements must read as figure (foreground, attended-to), not as ground (background, ignored). A button that blends into its container background reads as ground and will not be clicked.

---

## Color as information encoding

Color in application interfaces encodes meaning. Every color in an application UI should have a role. Color without information function is visual noise that reduces the signal-to-noise ratio for the colors that do carry meaning.

### Color roles for application UI

**Foreground / Background:** The neutral surface on which content appears. In light mode: dark text on light surfaces. In dark mode: light text on dark surfaces. The neutral pair must meet WCAG contrast requirements.

**Brand / Accent:** A single color (or narrow palette) that identifies the application and marks interactive affordances. Use sparingly — the more an accent color is used, the less it signals interactivity.

**Status colors:** Four reserved roles with established semantic conventions. These must not be inverted or reused for non-status purposes.

| Status | Convention | What it communicates |
|--------|-----------|---------------------|
| Error | Red (adjusted for medium) | Something is wrong and requires user action |
| Warning | Yellow / Amber | Something may become wrong; user should be aware |
| Success | Green | An action completed correctly |
| Info | Blue | Neutral information, no action required |

The status color conventions are universal — they have been established by decades of interface convention and operating system design. Inverting them (green for error, red for success) is not a creative decision. It is a communication failure.

**Interactive states:** Separate visual treatment for hover, focus, active, and disabled states. See §Interactive state colors below.

### The non-decorative rule

Ask of every color in an application: "What information does this color encode?" If the answer is "none" or "it looks good with the other colors," the color should be removed or replaced with neutral. Decorative color competes with semantic color for attention and trains users to ignore color signals.

### Color accessibility: designing for color blindness

Color blindness affects approximately 8% of males and 0.5% of females. The three common forms each affect different parts of the spectrum:

| Form | Affects | What is lost |
|------|---------|-------------|
| Protanopia | Red receptors | Red appears dark; red-green distinction lost |
| Deuteranopia | Green receptors | Green appears dark; red-green distinction lost (most common) |
| Tritanopia | Blue receptors | Blue-yellow distinction lost |

**The design rule:** Never use color as the only visual means of conveying information. WCAG 1.4.1 (Level AA) makes this a conformance requirement. Always pair color with a secondary signal:
- Status indicators: color + icon (✓, ✗, !, ℹ) + text label
- Chart series: color + line style (solid, dashed, dotted) + data point shape
- Validation state: color + border change + explanatory text

### Contrast ratios

WCAG 2.2 contrast requirements are design minimums, not targets:

| Context | Minimum ratio | Applies to |
|---------|--------------|-----------|
| Normal text (< 18pt or 14pt bold) | 4.5:1 | Body text, labels, captions |
| Large text (≥ 18pt or 14pt bold) | 3:1 | Headings, large labels |
| UI components and graphics | 3:1 | Buttons, inputs, icons, chart elements |
| Focus indicators | 3:1 | Focus ring vs adjacent color |

**Design practice:** Check contrast ratios for body text, interactive elements, and focus indicators before finalizing any color decision. A color combination that fails 4.5:1 cannot be used for body text regardless of how visually appealing it appears.

### Interactive state colors

Each interactive state must be visually distinguishable from all other states through a signal that is not color alone:

| State | What to change | Secondary signal |
|-------|---------------|-----------------|
| Default | Baseline | Label, border |
| Hover | Subtle background shift | Cursor change |
| Focus | Visible focus ring (3:1 minimum) | Ring, not just color change |
| Active | Pressed state (shadow inward, slight scale) | Visual compression |
| Disabled | Reduced opacity (≥ 30% to remain perceptible) | Cursor change, non-interactive |
| Loading | Spinner or skeleton | Motion signal (be motion-sensitive) |
| Error | Red / status-error token | Icon + text |
| Success | Green / status-success token | Icon + text |

### TUI color model

Terminal color support is a design constraint, not just a technical one. Design choices must fall within what the target terminal supports.

**16-color ANSI / 8-color ANSI (VT100 basic):**
8 foreground + 8 background colors with bright variants. Cannot control saturation or lightness — only predefined color names. Design hierarchy using combinations:
- Primary content: default foreground on default background
- Emphasis: bright/bold variants
- Status: reserved semantic colors (red for error, green for success, yellow for warning, cyan for info)
- Structural: use box-drawing characters (─, │, ┌, ┐, └, ┘) for containment rather than color-filled backgrounds

**256-color (xterm-256color):**
Adds a 6×6×6 color cube plus 24-step grayscale ramp. Enables subtle tonal variation for depth, but terminal color rendering varies by terminal emulator — test in both light and dark terminal themes.

**Truecolor (24-bit):**
Full RGB. Most modern terminal emulators support this. Check `$COLORTERM` before assuming truecolor is available; design a 256-color fallback.

**CLI output color principle:** Color in CLI output must be optional. Terminal pagers (`less`), log aggregators, and some CI environments strip ANSI codes; others display them as escape sequences. Honor the `NO_COLOR` environment variable (no-color.org standard). Use color for emphasis only, never as the sole structural signal. Output must be readable without color.

---

## Typography for interfaces

Typography in interfaces is not font selection. It is a system that encodes information structure through visual contrast between levels.

### Legibility vs readability

**Legibility** is whether individual characters can be distinguished — a font-level property. A font with poorly differentiated letterforms (`1`, `l`, `I` all looking the same) has poor legibility even at large sizes.

**Readability** is whether text can be read comfortably at speed — affected by size, line length, line height, contrast, and spacing. A font that is legible character-by-character may be unreadable in long passages due to tight line height or excessive line length.

Both must be addressed. Legibility is the floor (can they read it at all?); readability determines whether they will sustain reading.

### Type scale for application UI

A type scale is a constrained set of sizes — typically 5–8 — where each step signals a level in the information hierarchy. Without a type scale, sizes proliferate arbitrarily (11px, 12px, 13px, 14px, 15px appear with no hierarchy signal between them).

**Scale design principle:** Adjacent scale steps must have enough contrast to read as distinct levels. A 14px vs 15px distinction is not perceivable. A 14px vs 18px distinction is.

**Common named scale levels for application UI:**

| Level | Typical use | Visual signal |
|-------|-------------|--------------|
| Display / Hero | Empty states, major headlines | Largest; sparing use |
| Heading | Section titles, panel headers | Bold weight, +4–6px over body |
| Subheading | Group labels, secondary structure | Medium weight, +2px over body |
| Body | Primary content, descriptions | Regular weight; most content lives here |
| Caption / Label | Metadata, timestamps, helper text | Smaller, often muted color |
| Monospace | Code, paths, terminal output, data | Fixed-width; distinct family |

### Information hierarchy through type

Use type attributes in combination to create unambiguous hierarchy within a component:

- **Weight** (bold = primary): bold text draws more attention. Use for the most important element in a group. Using 4+ weight variants creates visual noise, not hierarchy.
- **Size** (large = heading): size signals structural level. Reserve size differences for structural transitions (section heading vs body), not emphasis within a passage.
- **Color** (muted = metadata): supporting information (timestamps, metadata, helper text) uses a muted foreground color. Full-contrast text for metadata competes with primary content.
- **Style** (italic = secondary or cited): italic signals secondary or definitional content. Do not use italic for general emphasis in interfaces — it reduces legibility.

**Practical example — a data table row:**
- Column header: caption weight bold, muted foreground
- Primary cell content: body weight regular, full foreground
- Secondary cell content (e.g., "updated 3 min ago"): caption size, muted foreground
- Status cell: body size with status icon + color token

### Interface-specific typography decisions

**Table column headers:** Lower case or sentence case (not ALL CAPS) for legibility. Left-align text columns; right-align numeric columns (so decimal points align). Column header weight: bold or medium, one size smaller than body.

**Label/value pairs:** Label above or to the left of value. Label uses caption size and muted foreground. Value uses body size and full foreground. Gap between label and value must be less than gap between pairs (gestalt proximity).

**Error messages:** Full contrast. Do not use muted foreground for errors — urgency must be visually present. Pair with the status-error color token.

**Tooltips:** Small size (caption level), high contrast background, generous padding. Tooltips are transient; their text is secondary. Do not put critical information only in tooltips.

### Monospace for code, data, and terminal output

Proportional fonts do not align tabular data. Monospace is mandatory for:
- Code samples and inline code
- File paths and system commands
- Terminal output reproduced in a GUI
- Data tables where column alignment is meaningful (monetary amounts, IP addresses, timestamps)
- Any content where character-position alignment carries information

Monospace also signals "this is data, not prose" — a reading mode signal that prepares the user for precise scanning rather than flowing reading.

---

## Spacing and rhythm as structure

Spacing is the primary gestalt proximity signal. It groups and separates — without any visual divider — based purely on physical distance between elements.

### Spacing scale

Design on a spacing scale, not arbitrary values. A 4px base unit (or 8px) multiplied consistently produces visual rhythm that users can scan:

**4px base:** 4, 8, 12, 16, 24, 32, 48, 64
**8px base:** 8, 16, 24, 32, 48, 64, 96

Spacing at arbitrary values (7px, 11px, 23px) destroys visual rhythm. Adjacent elements with slightly different spacing look like mistakes, not design.

**Internal vs external spacing:** Padding *inside* a container signals "these belong together." Margin *between* containers signals "these are separate groups." The ratio of internal-to-external spacing determines whether the grouping reads clearly. Rule: the space between siblings within a group should be less than the space between different groups.

### Density decisions

Density is a deliberate design decision — not a failure mode and not an automatic success.

**High-density (appropriate for):**
- Data tables with many columns
- Monitoring dashboards with simultaneous metrics
- Code editors and terminal applications
- Expert users who need maximum information per viewport

**Low-density (appropriate for):**
- Onboarding flows where cognitive load reduction matters
- Mobile contexts where touch targets must be larger
- Settings dialogs where users need to read carefully before acting

**Anti-pattern:** Applying low-density spacing conventions from marketing pages to data-dense application interfaces. A monitoring dashboard that uses 48px vertical rhythm for every row wastes screen space and forces scrolling that makes the full picture invisible.

### Vertical rhythm and baseline grid

For text-heavy interfaces, consistent line-height values tied to the spacing scale create vertical rhythm — a predictable cadence that makes sustained reading easier. Text at 16px with 24px line height (1.5×) on a 24px baseline grid aligns with component spacing values at the same multiple.

Vertical rhythm matters more for editorial and form-heavy interfaces than for data-dense dashboard views, where cell height is driven by data density requirements.

---

## Iconography: when it works and when it fails

Icons work only within specific conditions. Outside those conditions, they increase cognitive load rather than reducing it.

### When icons work

1. **With text labels** — always better than icon alone. The icon provides quick visual recognition after learning; the label provides meaning on first encounter.

2. **For universal symbols** — a small set of icons have near-universal recognition: magnifying glass (search), gear (settings), X (close), hamburger (navigation menu), floppy disk (save — legacy but established), play/pause/stop (media), trash (delete). Universal symbols can be used without labels in space-constrained contexts.

3. **In expert interfaces** — users who work in the interface daily develop icon vocabulary over time. A code editor's toolbar can use icon-only controls because users invest in learning them. A consumer onboarding flow cannot.

4. **For status and state** — icons communicate state more efficiently than color alone. A ✓ icon alongside green conveys success to colorblind users. A ⚠ icon alongside yellow conveys warning. Never use status icons without accompanying text for novel states.

### When icons fail

1. **Without labels in novel interfaces** — first-time users cannot infer icon meaning. NN/g research: navigation labels significantly improve task completion rates over icon-only navigation. "Cleaner" icon-only navigation trades discoverability for aesthetics — a bad trade.

2. **For metaphorically clever icons** — an icon requires immediate recognition, not inference. A "collaboration" icon might make sense in retrospect but will not be recognized without prior experience.

3. **At small sizes without sufficient weight** — fine-line icons at 16px collapse into illegible shapes. Icons for interactive use need adequate stroke weight and sufficient size (minimum 24×24px touch target; 16×16px minimum for decorative/read-only icons).

4. **When relying on color alone for meaning** — an icon that is red to mean "error" and the same icon shape that is green to mean "success" will confuse colorblind users. Use distinct icon shapes for distinct states.

### Icon design criteria

When assessing iconography quality:
- Clear, recognizable silhouette at the smallest rendered size
- Distinguishable from adjacent icons in the same context
- Adequate stroke weight — not so fine that it collapses at small sizes
- Not reliant on color alone for its meaning
- Culturally neutral where the application has a diverse international audience (thumbs-up is ambiguous in some regions; check marks are safer)

---

## Data visualization design

Data visualization for application interfaces is governed by a different set of principles than visualization for marketing (where aesthetics may dominate). The primary principle: **visual elements that do not encode data are noise**.

### Choosing chart types

The chart type must match the comparison the user needs to make:

| Comparison | Chart type | Why |
|-----------|-----------|-----|
| Ranking or comparison of distinct values | Bar chart | Length encodes quantity unambiguously |
| Change over time for continuous data | Line chart | Slope encodes rate of change |
| Correlation between two variables | Scatter plot | Position encodes both variables simultaneously |
| Part-of-whole relationships | Pie chart (≤ 5 segments) | Area encodes proportion |
| Distribution of values | Histogram | Bars show frequency across ranges |
| Many metrics at a glance | Small multiples | Same structure repeated, easy comparison |

**Pie chart limit:** Pie charts are only useful with 5 or fewer segments. With more segments, individual slice sizes become impossible to compare accurately. Prefer a bar chart when segments exceed 5.

**Avoid:** Dual Y-axis charts (implies a relationship between series that may not exist); 3D charts of any kind (perspective distortion misrepresents values); area charts on non-zero baselines (exaggerates differences).

### Data tables

When to use tables vs charts:
- Use **tables** when users need to look up specific values, not just observe overall patterns
- Use **charts** when users need to observe trends, comparisons, or distributions across many data points

**Scannable table design:**
- Right-align numeric columns so decimal points and digit positions align vertically
- Left-align text columns
- Use consistent date/time formatting within a column (ISO 8601 for machine-readable; locale-formatted for human reading)
- Row striping (alternating light/very-light background) aids row tracking in wide tables — use subtle contrast, not high-contrast stripes
- Column headers: smaller size than body, bold or medium weight, lower case or sentence case
- Sortable columns: visual indicator of sort state (▲/▼), not just which column sorts

### The chartjunk principle (Tufte)

**Data-ink ratio:** Maximize the proportion of ink that represents data; minimize ink that does not represent data. The following are candidates for removal:

- 3D perspective on bars and pies (adds ink, distorts data)
- Excessive grid lines (thin, light grid lines are acceptable; heavy grids dominate the data)
- Decorative backgrounds and fills on chart areas
- Unnecessary borders around chart components
- Legends that repeat information already labeled on the chart

**Small multiples:** When the same chart structure applied across many datasets needs comparison, arrange the same chart at small scale in a grid. Users can compare across multiples faster than interpreting a single animated chart with toggleable series.

**Sparklines:** "Intense, simple, word-sized graphics" (Tufte) — tiny trend lines embedded alongside data in tables, showing the shape of change without axes, labels, or interactive elements. Appropriate for showing directionality in a data-dense monitoring view without consuming layout space.

### Color for data

**Categorical data:** Assign distinct colors to categories. The colors must be distinguishable for colorblind users — test with protanopia and deuteranopia simulators. Do not use more categories than can be clearly distinguished (practical limit: 8–10 colors maximum).

**Quantitative magnitude:** Use a sequential palette (light→dark within a single hue) that progresses monotonically. A darker shade should always encode a higher value. Avoid rainbow palettes for quantitative data — they imply categorical boundaries that do not exist in the data.

**Bipolar data (positive/negative, hot/cold):** Use a diverging palette (blue→white→red for negative/neutral/positive) where the midpoint is visually neutral and the two poles are perceptually distinct.

---

## Motion as communication

Motion in application interfaces must communicate something. Motion that communicates nothing is a cost — it consumes time, competes for attention, and causes vestibular harm in users with motion sensitivity.

### What motion should communicate

**State change:** An element appearing signals it has entered the visible state. Disappearing signals it has left. Collapsing/expanding signals a density change. Without motion, abrupt appearance can disorient; with motion, the user knows something happened.

**Causality:** A shared-element transition (an element moves from one location to another across a navigation) connects cause and effect in the user's mental model. The user sees that the card they tapped became the detail view they are now seeing.

**Direction:** Slides in from the right = navigating forward. Slides in from the left = navigating back. This directional language must be consistent across the application or the spatial model collapses.

**System status:** A spinner communicates "something is happening." A progress bar communicates "something specific is happening and here is how much remains." A completion animation communicates "the action is done." Remove any motion that does not carry one of these signals.

### What motion must not do

**Slow task completion:** An animation that runs while the user waits to interact is a cost, not a feature. A 300ms entry animation on a dropdown that users open hundreds of times per day accumulates to minutes of involuntary waiting per week. Motion that habitual users must wait through on every interaction should have a duration under 150ms or be removed.

**Cause vestibular harm:** Parallax effects, large-scale zooming, and rapid directional movement trigger vestibular disruption (dizziness, nausea) in users with vestibular disorders. WCAG 2.3.3 (Animation from Interactions, AAA) prohibits motion that cannot be disabled. Even at AA level, designing with this constraint produces better interfaces.

**Distract from content:** Ambient motion — animations that play continuously without user action — competes with user attention. A progress animation in a sidebar panel distracts from the main content. Motion must be initiated by user action or system-state change, not run continuously.

### Designing for prefers-reduced-motion

`prefers-reduced-motion: reduce` is a user OS setting that should be honored. The behavior must not be: "all animations are removed, the interface breaks." The correct design is:

- All functional information conveyed by motion must also be conveyed statically (state changes must be visible without animation, not communicated only through transition)
- Transition durations collapse to near-zero (50ms or less) — the element is still "animated" but imperceptibly so
- Continuous ambient animations are stopped
- State changes are communicated through immediate visual difference (color, icon, label) rather than through the motion of entering a new state

**Design rule:** If removing all motion makes the interface lose essential information, the motion is doing work that the visual design should be doing without motion. Fix the static design first; then add motion as enhancement.

---

## Dark mode as a distinct visual design

Dark mode is not color inversion. Programmatically inverting a light-mode color palette produces: shadows on dark surfaces (which look wrong — shadows recede from light, not from dark), semantic colors that are illegible (pure red on pure black), and text contrast that is overwhelming (pure white on pure black causes halation and eye strain). Each of these requires deliberate redesign.

### Surface layering in dark mode

In **light mode**, elevation (Z-axis depth) is expressed through shadows on a light surface. Shadows darken the surface beneath a raised element, simulating depth.

In **dark mode**, shadows are barely perceptible on dark surfaces. Elevation must instead be expressed through **surface lightness**: the elevated element's background is lighter than the surface below it. A card on a dark-mode background is lighter than the background. A modal or popover is lighter still. The hierarchy inverts: lighter surfaces are closer in dark mode.

This is the Material Design "surface tonal overlay" approach and is also reflected in macOS dark mode — the system background is darker; elevated panels are lighter.

### Text on dark backgrounds

**Avoid pure white on pure black:** The maximum-contrast combination (white #FFFFFF on black #000000) produces halation — the text appears to blur at its edges due to the extreme contrast. This causes eye strain on extended reading.

**Use off-white on off-dark:** White text at 87–95% opacity on a very dark gray background (not black) reduces halation while maintaining sufficient contrast. Material Design's recommendation: #FAFAFA text on #121212 surface. macOS uses system-defined semantic text colors that are slightly off-white in dark mode.

### Status colors in dark mode

Status colors designed for white backgrounds (the conventional fully-saturated red #CC0000, green #00AA00) appear harsh on dark backgrounds and may fail contrast requirements. Dark mode requires desaturated, lightened status colors — the same hue family, but shifted toward higher lightness and lower saturation.

**Design requirement:** Dark mode is not a toggle instruction in the Design Spec. It is a complete second color specification. Every semantic color (foreground, background, brand/accent, status-error, status-warning, status-success, status-info, muted foreground, surface, elevated surface) must have both a light-mode and a dark-mode value. This is a design deliverable.

### Design tokens enable dark mode

A design token is a named design decision: `color.status.error = #D32F2F`. Tokens make dark mode structurally possible:

```
color.status.error.light = #D32F2F  (fully saturated, for white backgrounds)
color.status.error.dark = #EF9A9A   (desaturated/lightened, for dark surfaces)
```

Without token-level dark mode specification, developers must guess which colors to adjust and by how much. The token vocabulary is the interface between design reasoning and implementation. In the Visual Semantics section of a Design Spec, express visual decisions as token references, not as raw color values. The implementation resolves the tokens — the design specifies the intent.

---

## Surface-specific visual constraints

### TUI: character grid forces visual discipline

The terminal character grid imposes constraints that web and desktop interfaces do not have:

**Grid alignment is absolute:** Every visual element is one or more character cells wide and tall. There is no sub-pixel positioning, no fractional units, no pixel-precise layout. Visual alignment must be designed in character columns and rows.

**Box-drawing characters for structure:** Borders, panels, and containment are expressed using Unicode box-drawing characters (─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼). These are visual structure without color — they work in 1-color terminals and degrade gracefully when box-drawing Unicode is unavailable (falls back to ASCII `+-|`).

**Focus through cursor and highlight:** TUI focus is expressed through cursor position (visible blinking cursor) and cell highlighting (inverted colors or bold weight on the focused row or cell). There is no `:focus` ring equivalent — the entire focused element or row changes visual treatment. Design focus states as complete cell-level inversions, not subtle border additions.

**Color depth must be treated as a design constraint, not assumed:** Design the primary visual hierarchy in the 16-color (ANSI basic) model. Test the design at that constraint before assuming xterm-256color or truecolor is available. A TUI that requires 256 colors to be readable excludes users on older terminals, remote SSH connections, and some CI environments.

**No sub-pixel rendering, no antialiasing:** Text in terminals renders at the character level — each character occupies exactly its cell. Fine-line icons from icon fonts do not render reliably in terminals; Unicode block characters (█ ▌ ▎ ▏) and Braille patterns are the TUI designer's alternative for non-character graphical elements.

### Desktop: platform design language is the foundation

Desktop applications exist within a platform design language that users have internalized. Visual design that fights the platform creates cognitive friction and accessibility failures (platform accessibility APIs expect platform controls).

**Platform typography defaults:**
- macOS: SF Pro (text), SF Mono (monospace). System fonts provide automatic dark mode adaptation, optical size variants, and Dynamic Type support.
- Windows: Segoe UI Variable (text), Cascadia Code (monospace). WinUI controls use these automatically.
- GNOME Linux: Cantarell (text), Monospace (monospace).

**When to use system fonts vs custom fonts:** System fonts signal "this is a native application." Custom fonts signal "this has its own visual identity." For utilities, tools, and developer-facing applications, system fonts are almost always preferable — they integrate with platform accessibility, scale with system font size preferences, and require no font loading. For branded consumer applications on hybrid frameworks (Electron, Tauri), custom fonts may be appropriate but must be carefully tested for legibility at system font size settings.

**Semantic color from the platform:** macOS defines system colors with light/dark mode equivalents (NSColor.label, NSColor.secondaryLabel, NSColor.systemRed, etc.). Windows Fluent Design defines system accent colors. Prefer platform semantic colors for text, backgrounds, and status indicators — they inherit dark mode automatically and match the OS's visual language.

### Web application: pixel-precise but context-variable

Web application interfaces are not the same design problem as web marketing pages. The constraints differ:

**Zoom changes proportions:** Browser zoom (Ctrl/Cmd +) scales all text and layout proportionally. A design that depends on exact pixel relationships will reflow when zoomed. Use relative units (rem, em, %) for sizing rather than fixed pixel values wherever the design must zoom gracefully.

**Font loading introduces rendering variance:** Web fonts load after initial render, causing FOUT (flash of unstyled text) or FOIT (flash of invisible text) without explicit management. This is not purely a CSS problem — it is a design decision: which fonts are critical enough to warrant blocking render, and which can fall back to system fonts during load?

**System dark mode requires explicit support:** Unlike desktop native applications where platform controls automatically adapt, web applications must explicitly implement dark mode via CSS `prefers-color-scheme` or equivalent. A web application with no dark mode implementation will have system UI (scrollbars, form controls on some browsers) in dark mode while the application itself remains light — visually incoherent.

**Data-dense web application design:** Information-dense web applications (monitoring dashboards, data tables, analytics views) require different spacing conventions than marketing pages. Dense tables use 4–8px row padding. Cards in a data grid use tighter margins. Using marketing-page spacing conventions (24px+ padding everywhere) in a data-dense interface forces scrolling and hides the global picture.

---

## Anti-patterns

These are predictable failures in application visual design. Each has a diagnostic question you can ask of any design.

**1. Color as the only differentiator between states**
Diagnostic: does the design remain understandable with all color removed?
Fix: pair color with shape, text, icon, or weight as a secondary signal.

**2. Visual hierarchy that mirrors code structure**
Diagnostic: does the layout organization map to developer-facing categories (modules, features, database tables) rather than user-facing tasks?
Fix: reorganize around what users are looking for, not how the system is built.

**3. Inconsistent spacing creating false groupings**
Diagnostic: can you identify which elements belong together by proximity alone, without reading the content?
Fix: constrained spacing scale — elements in the same group use smaller gaps than gaps between groups.

**4. Decorative icons without labels in non-expert interfaces**
Diagnostic: would a first-time user recognize every icon without its label?
Fix: add text labels to navigation and command icons; rely on icon-only only for truly universal symbols after confirming users have learned the vocabulary.

**5. Motion that plays while the user is completing a task**
Diagnostic: is there any animation running that was not triggered by user action?
Fix: stop ambient animations; keep interaction-triggered animation under 150ms for habitual flows.

**6. Dense data applications using marketing-page spacing**
Diagnostic: does the data-dense view use ≥24px padding everywhere because "it looks clean"?
Fix: density appropriate to the user's task; 4–8px padding in data rows, not 24px.

**7. Dark mode as color inversion**
Diagnostic: were the dark mode colors produced by inverting light mode values, or designed independently?
Fix: design a separate color specification for dark mode; elevation through lightness, not shadow; desaturated status colors.

**8. Chartjunk obscuring data**
Diagnostic: which visual elements in this chart do not represent data?
Fix: remove 3D perspective, decorative fills, excessive gridlines, and any visual element that does not encode a data value.

**9. Typography decoration over legibility**
Diagnostic: has this font been tested at its actual rendered size on the target display at actual user distance?
Fix: test type at the precise pixel size it will render at, on a representative screen; choose legibility over brand expression.

**10. Type hierarchy that mirrors code hierarchy, not reading priority**
Diagnostic: does the most important information for the user's immediate task have the highest visual weight?
Fix: visual weight must match task-relevance, not system-organizational-level.

---

## AI-Agent Adaptation

A Designer AI agent cannot view a rendered interface, use a color picker, or observe how typography renders at actual size on target hardware. What is available is analytical reasoning applied to described visual decisions.

**Available to a Designer AI agent:**
- **Contrast ratio verification:** Given hex/RGB color values, calculate luminance ratio and flag failures against WCAG 4.5:1 and 3:1 thresholds. Deterministic — no visual judgment required.
- **Grayscale test (analytical):** Given a described layout, reason about whether the hierarchy survives without color — if only color distinguishes elements, the hierarchy fails the test.
- **Spacing scale audit:** Given a list of spacing values, verify they derive from a consistent scale and flag arbitrary values that break rhythm.
- **Color role audit:** For each color in a described design, ask "what information does this color encode?" and flag decorative colors that compete with semantic ones.
- **Type scale analysis:** Given a list of font sizes, verify they produce perceptible hierarchy distinctions (adjacent sizes must differ by at least 4px to be distinct).
- **Iconography criteria check:** Verify that specified icons meet the when-to-use conditions.
- **Gestalt reasoning from layout descriptions:** If told "the form label is 32px below the input field," apply gestalt proximity: the label reads as belonging to the input *above* it, not the input it labels. Spatial relationships described in text are sufficient to apply proximity and common-region principles.
- **Anti-pattern detection from specification:** If the spec describes "icon-only navigation," apply the iconography failure pattern without seeing the icons. If the spec describes "animations on page load," apply the motion-must-not-slow-task-completion principle. The principles apply to design descriptions, not just rendered artifacts.

**Not available — requires human visual judgment:**
- Assessing whether a color palette "feels right" or has the intended emotional register
- Evaluating visual tension, figure/ground quality, or gestalt grouping in rendered output
- Verifying that visual hierarchy works in practice across different monitors, zoom levels, and ambient lighting conditions
- Testing with real users for whether visual hierarchy guides attention correctly
- Checking contrast ratios with a color picker tool (use luminance calculation from specified RGB/hex values instead)

**Design decision scope:** An AI agent doing visual interface design produces a visual semantics specification — a set of decisions and their communicative rationale expressed as named token references and precise numeric values (`color.status.error` instead of "make it red"; "16px / 24px line height" instead of "comfortable body text"). It does NOT produce a subjective aesthetic judgment that substitutes for human visual review. Mark visual decisions that depend on rendered evaluation as open design questions if the agent cannot verify them analytically.

---

## Sources

- Nielsen Norman Group — 5 Principles of Visual Design in UX (Kelley Gordon, 2020) [nngroup.com/articles/principles-visual-design/]
- Nielsen Norman Group — 10 Usability Heuristics for User Interface Design (Nielsen, 1994; reviewed 2024) [nngroup.com/articles/ten-usability-heuristics/]
- Tufte, E.R. — *The Visual Display of Quantitative Information* (1983, 2nd ed. 2001) — data-ink ratio, chartjunk, small multiples, sparklines
- Material Design 3 [m3.material.io] — color roles, tonal palette system, surface elevation in dark mode
- Apple Human Interface Guidelines [developer.apple.com/design/human-interface-guidelines/] — SF Pro type system, semantic color system, dark mode surface layering
- GOV.UK Design System [design-system.service.gov.uk] — color-as-functional-signal only, baseline spacing system, line length guidance
- WCAG 2.2 Success Criteria 1.4.1 (non-text color), 1.4.3 (contrast minimum), 1.4.11 (non-text contrast), 2.3.3 (animation from interactions) — W3C [w3.org/TR/WCAG22/]
- Wathan, A. & Schoger, S. — *Refactoring UI* (2018) [refactoringui.com] — type scale systems, hierarchy without color, spacing as design tool [partially verified — established professional reference]
- no-color.org — NO_COLOR convention for CLI environments

---
