---
name: accessibility-design
description: Accessibility as a design input, not a compliance checkbox. Apply WCAG 2.2 normatively at design time, reason about the disability spectrum as design constraints, and produce specific, verifiable accessibility requirements for the Design Spec. Organized around standards (WCAG POUR, ARIA), disability types (visual, motor, cognitive, hearing, vestibular), and surface-specific constraints (web, CLI, TUI, desktop). Use when designing any human-facing interface — this skill is always relevant. Not for implementing accessibility in code (→ `accessibility` skill for Worker/Reviewer), not for web-specific rendering mechanics (→ `web-ui-design`), not for visual design (→ `visual-interface-design`).
metadata:
  version: "1.0.0"
---

# Accessibility Design

## What this skill is for

Accessibility design is the discipline of making accessibility a structural input to design decisions — ensuring that interfaces are usable by people with visual, motor, cognitive, hearing, and vestibular disabilities from the moment design decisions are made.

**This skill does not repeat what the existing `accessibility` skill covers.** The `accessibility` skill at `skills/accessibility/SKILL.md` is an implementation-focused skill for Worker and Reviewer — it teaches how to implement accessible code (native `<dialog>`, focus management patterns, ARIA attribute usage in markup). This skill is design-focused for Designer — it teaches how to make design decisions that prevent accessibility barriers before implementation begins. The two are complementary: this skill's output (accessibility requirements) feeds that skill's implementation.

**Load this skill always.** Every design engagement involving a human interface needs it. Reduce scope to surface-specific constraints (CLI accessibility differs from web accessibility), but never treat it as a final-phase compliance review.

**Do NOT load when:** The engagement is reviewing an implementation against a spec (load `design-validation` instead) — though `accessibility-design` informs the evaluation criteria `design-validation` uses.

**Boundary:**
- Not for: implementing accessibility in code (→ `accessibility` skill — Worker/Reviewer audience)
- Not for: surface-specific rendering mechanics (→ surface skills own the rendering layer)
- Not for: visual design choices outside accessibility constraints (→ `visual-interface-design`)
- Not for: interaction design state modeling (→ `interaction-design` owns states; this skill adds accessibility constraints on top of those states)

**Upstream inputs:** Experience goals and scenarios from `experience-design`, interaction states from `interaction-design`, surface type from Designer's skill selection.

**Downstream outputs:** Accessibility requirements — specific, standard-referenced, surface-appropriate, verifiable — for the `Accessibility requirements` section of the Design Spec via `design-specification`. Each requirement names: the component/interaction, the standard (WCAG SC number, ARIA pattern, or platform convention), the implementable condition, and the verification method.

---

## The POUR Framework as Design Tool

WCAG 2.2 is organized around four principles — **Perceivable, Operable, Understandable, Robust**. These are not an audit checklist; they are design questions to ask at every decision point.

### Perceivable — Is all information available in more than one modality?

Design questions:
- Can a screen reader access every piece of information on screen? If not, where does the screen reader encounter a wall?
- For every color-coded signal (status, error, category, completion), what is the non-color signal?
- Can a user who cannot see the interface access all its information through text equivalents?
- Can the layout reflow to a single column at 320 CSS pixels (mobile/zoom) without information loss?

The designer's obligation: every purely visual signal must have a text, structure, or shape alternative specified in the design. "Red for errors" is incomplete; "red background, ⚠ icon, 'Error:' text prefix, and the error message in text" is a complete accessible design decision.

### Operable — Can every function be performed without a mouse?

Design questions:
- Can every interactive element be reached by Tab key?
- For every drag interaction, is there a keyboard alternative that accomplishes the same function?
- Are time limits user-controllable — can the user pause, extend, or disable them?
- Is the tab order logical — does it follow the visual reading order?

The designer's obligation: if you cannot describe the keyboard path to every function, the design is incomplete. This is a design specification gap, not an implementation detail to leave for Worker.

### Understandable — Does labeling match user mental models?

Design questions:
- Are error messages specific — do they name the field that failed, describe what went wrong, and suggest a correction?
- Does behavior change only when the user initiates it — or do focus/selection trigger unexpected context changes?
- Are components used consistently — if a component performs the same function in two places, does it have the same label?
- Is authentication free of cognitive function tests (memorized passwords, CAPTCHA, transcribing codes)?

The designer's obligation: error messages, labels, and behavior patterns are design decisions — specifying "show an error" without specifying the error message content is incomplete.

### Robust — Does the design rely on capabilities assistive technology may not support?

Design questions:
- Does the design depend on hover (which is inaccessible to switch users)?
- Does the design depend on color (which is inaccessible to color-blind users and some screen readers)?
- Does the design specify interactive elements that have no semantic HTML equivalent (requiring ARIA)?
- Does the design use motion as the only confirmation signal?

The designer's obligation: when you specify a custom component, you are creating an ARIA obligation. The design must acknowledge this and specify the required keyboard interaction pattern.

---

## WCAG 2.2 — Normative Structure for Designers

WCAG 2.2 (W3C Recommendation, December 2024) is organized in three layers: **Principles → Guidelines → Success Criteria**. Designers reason about all three layers, but interact most directly with Success Criteria (SC) — the testable requirements.

### Three Conformance Levels

| Level | Meaning | Obligation |
|---|---|---|
| **A** | Minimum — absence creates serious barriers | Required; omission locks out users |
| **AA** | Standard — legally required in most jurisdictions | Required for most product contexts |
| **AAA** | Enhanced — typically applied to specific content, not universally | Apply where feasible; not required everywhere |

Target for most design work: **WCAG 2.2 Level AA**. This includes all Level A criteria.

### Key Criteria Designers Must Apply at Design Time

These are the criteria where the design decision — not the implementation — determines compliance:

| SC | Level | Design obligation |
|---|---|---|
| 1.1.1 Non-text Content | A | Specify alt text for every informative image; specify that decorative images are marked as decorative |
| 1.3.1 Info and Relationships | A | Specify heading hierarchy; specify form label associations; specify table structure |
| 1.3.2 Meaningful Sequence | A | Specify reading order for all complex layouts where visual order may differ from DOM order |
| 1.4.1 Use of Color | A | For every color-coded signal, specify the non-color redundant signal |
| 1.4.3 Contrast (Minimum) | AA | Normal text: 4.5:1 minimum; large text: 3:1 minimum |
| 1.4.4 Resize Text | AA | Text must remain functional at 200% zoom — design for this, don't assume it works |
| 1.4.10 Reflow | AA | Specify that content must reflow to single column at 320 CSS px without horizontal scroll |
| 1.4.11 Non-text Contrast | AA | UI component boundaries and graphical objects: 3:1 contrast |
| 2.1.1 Keyboard | A | Every function must have a keyboard path — specify it |
| 2.1.2 No Keyboard Trap | A | Users must be able to leave any component by keyboard — modals intentionally trap focus but must provide Escape |
| 2.4.1 Bypass Blocks | A | Specify skip navigation for repetitive content blocks |
| 2.4.3 Focus Order | A | Specify tab order for complex layouts |
| 2.4.7 Focus Visible | AA | Specify that focus indicators are visible — this is a design state, not a CSS implementation detail |
| 2.4.11 Focus Not Obscured | AA | *(New in 2.2)* Sticky headers must not fully hide the focused element |
| 2.5.7 Dragging Movements | AA | *(New in 2.2)* Every drag interaction must have a single-pointer alternative |
| 2.5.8 Target Size Minimum | AA | *(New in 2.2)* 24×24 CSS pixels minimum with 4px spacing, or larger targets |
| 3.2.1 On Focus | A | Focus alone must not trigger context change |
| 3.2.2 On Input | A | Selecting a form control must not automatically navigate or submit |
| 3.2.6 Consistent Help | A | *(New in 2.2)* Help mechanisms must appear in consistent locations |
| 3.3.1 Error Identification | A | Error messages must identify the field by name in text |
| 3.3.2 Labels or Instructions | A | Form controls must have labels; specify the label text |
| 3.3.3 Error Suggestion | AA | Error messages must suggest correction where known |
| 3.3.7 Redundant Entry | A | *(New in 2.2)* Information entered in a prior step must not be re-entered — design autofill or summary |
| 3.3.8 Accessible Authentication | AA | *(New in 2.2)* No cognitive function tests in authentication without an alternative |
| 4.1.2 Name, Role, Value | A | Every interactive element must have an accessible name — specify it |

**Design rule:** You do not need to memorize all 78 success criteria. You need to be able to reason about which criteria apply to each design decision as you make it. The table above covers the criteria most frequently violated by design decisions (as opposed to implementation decisions).

---

## The Disability Spectrum as Design Constraints

### Visual Disability

**Blindness — Screen Reader Model**

Screen readers convert visual interfaces to a serialized, linear audio or braille stream. The design implications:

- **Reading order problem:** CSS can reorder elements visually without changing DOM order. Screen readers follow DOM order. Design decision: specify the reading order for any layout where visual position and logical order might diverge (e.g., a multi-column layout where the right column is visually first but logically secondary).

- **Landmark structure is a design decision:** Screen readers let users jump between landmarks. ARIA landmarks: `banner` (site header), `main`, `navigation`, `search`, `complementary` (aside), `contentinfo` (footer), `form`, `region` (named). The Designer must specify landmark structure — leaving it to developer judgment is a design gap that produces inconsistent, unnavigable structure.

- **Accessible names are design deliverables:** Every interactive element and every informative image must have an accessible name specified in the design. Not "an icon button" — "an icon button with accessible name 'Close dialog'." The accessible name is a design requirement, not an implementation detail.

- **Dynamic content announcements are design decisions:** When content updates without a page reload, screen reader users do not see visual changes. The design must specify which updates are announced live (status messages, loading states, error messages, search results) and which are not. This is a `aria-live` region decision — the designer specifies it, the worker implements it.

**Low Vision**

Design constraints:
- Contrast minima from WCAG 2.2: 4.5:1 for normal text, 3:1 for large text (≥18pt regular or ≥14pt bold), 3:1 for UI component boundaries
- Text must remain functional when the user zooms to 200% browser zoom (SC 1.4.4)
- Content must reflow to a single column at 320 CSS pixels without horizontal scrolling (SC 1.4.10)
- Text size must be specified in relative units (em, rem) — a design decision that constrains the typography system

**Color Deficiency**

~8% of men have red-green color deficiency (deuteranopia or protanopia). Tritanopia (blue-yellow) is rarer. Design rule derived from SC 1.4.1:

> Color must NEVER be the only distinguishing signal for state, error, category, completion, or identity.

When color-coded signals appear in a design, specify the redundant non-color signal:
- Red error state → also specify: ⚠ icon, "Error:" text prefix, or distinct border style
- Green success state → also specify: ✓ icon, "Success:" label, or distinct visual treatment
- Category color coding in a chart → also specify: pattern, label, or shape redundancy

Design failure: "show errors in red." Design requirement: "show errors with red border, ⚠ icon at field level, and 'Error:' text prefix in the error message."

---

### Motor Disability

Motor disability includes limited hand control, tremor, paralysis, switch access users, and one-handed keyboard navigation.

**Target Size (WCAG 2.2 SC 2.5.8, AA — new)**

Minimum: 24×24 CSS pixels with 4px spacing to adjacent targets (or the target's bounding box must meet a 24px circle without intersection). This is a design constraint, not an implementation detail. The designer specifies minimum target sizes; the implementation must meet them.

Recommended practice: 44×44 CSS pixels for touch targets (SC 2.5.5, AAA) — especially for mobile. The 44px guideline comes from iOS and Android platform guidelines and WCAG 2.5.5; it is widely adopted as the practical standard even though SC 2.5.8 specifies 24px as the AA minimum.

Design failures created by the designer:
- Icon buttons specified smaller than 24×24 CSS pixels
- Grouped buttons with less than 4px spacing
- Small touch targets in mobile-first designs

**Keyboard-Only Navigation**

All interactive elements must be keyboard-reachable (SC 2.1.1). Design obligations:
- Tab order must follow logical reading order — detected when visual layout contradicts the intended logical sequence
- Focus indicators must be clearly visible — this is a focus state in the design, with specified appearance (contrast, area)
- Modals must trap focus while open and return focus to the trigger on close
- No interaction must require a time limit that cannot be disabled or extended (SC 2.2.1)

**No Hover-Only Affordances**

Switch users and keyboard users cannot hover. Design rule: any information revealed only on hover must also be accessible by focus. Design failure: a tooltip shown only on hover with no keyboard access to the tooltip content.

**Drag Interactions (WCAG 2.2 SC 2.5.7, AA — new)**

Every drag interaction must have a single-pointer (click/tap) alternative that accomplishes the same function. Design obligation: when a drag interaction is specified (drag-to-reorder, drag-to-dismiss, drag-to-resize), specify the keyboard/click alternative that performs the same action.

---

### Cognitive Disability

Cognitive disability is the most underserved accessibility domain in typical engineering practice. It includes ADHD, dyslexia, memory impairment, intellectual disability, processing speed differences, and acquired cognitive disability.

WCAG 2.2 addresses some cognitive concerns normatively (SC 3.3.7 Redundant Entry, SC 3.3.8 Accessible Authentication, SC 3.2.6 Consistent Help, SC 3.1.5 Reading Level). The COGA (Cognitive and Learning Disabilities Accessibility) framework from W3C provides supplemental design guidance beyond WCAG.

**Cognitive accessibility is not the same as "keeping things simple."** It is a design discipline with specific failure modes that are measurable, preventable, and frequently ignored.

#### The COGA Eight Objectives

The W3C "Making Content Usable for People with Cognitive and Learning Disabilities" (Working Group Note, 2021) defines eight design objectives for cognitive accessibility:

1. **Help users understand what things are and how to use them** — familiar patterns, clear purpose, consistent component behavior
2. **Help users find what they need** — clear navigation, predictable structure, consistent labels
3. **Use clear and understandable content** — short sentences, simple vocabulary, active voice, no double negatives
4. **Help users avoid mistakes** — prevent errors by design, not only by warning; autofill, validation, confirmation
5. **Help users focus** — no auto-advancing carousels, no auto-playing audio/video, no content that jumps position
6. **Ensure processes do not rely on memory** — no mandatory password recall without alternative, visible breadcrumbs, persistent state, autofill support
7. **Provide help and support** — contextual help, consistent placement (SC 3.2.6), tooltips, inline guidance
8. **Support adaptation and personalization** — do not block browser extensions or assistive plugins

#### Working Memory Load

Working memory capacity: users can reliably hold approximately 3-4 items in working memory at once (Miller's Law; practical design ceiling is lower than the often-cited "7±2"). Design failures that overload working memory:
- Requiring users to remember a confirmation code shown on a previous screen (SC 3.3.8 violation)
- Multi-step forms where the user must remember what they entered in step 1 when completing step 3
- Error messages that don't repeat the field name ("This field is invalid" without naming which field)
- Navigation that removes the user's location context (no breadcrumbs, no highlighted current section)

Design requirement: specify persistence of user context across steps; specify error messages that are self-contained (field name + error description + correction suggestion).

#### Authentication Without Cognitive Function Tests (SC 3.3.8, AA — new)

A cognitive function test is: memorizing a password, transcribing a one-time code from a previous screen, solving a CAPTCHA, performing arithmetic, or identifying distorted characters. SC 3.3.8 requires that all authentication paths have an alternative that does not require a cognitive function test.

Acceptable alternatives:
- Password manager autofill (do not block paste — blocking paste is a design failure that forces memorization)
- Biometrics (TouchID, FaceID, Windows Hello)
- OAuth (sign in with identity provider)
- WebAuthn / passkeys
- Magic link via email

Design failure: "Security: disable paste in the password field" — this explicitly breaks SC 3.3.8 and forces memorization.

#### Reading Level and Plain Language

SC 3.1.5 (Reading Level, AAA) recommends providing a version understandable at 9 years of education level when content requires higher reading level. For most product UI copy, the design obligation is:
- Error messages in plain language: "Your password must be at least 8 characters" not "Password complexity requirement not met"
- Button labels that describe the action: "Save changes" not "Submit"
- Help text that explains without jargon

Calibration tool: Flesch-Kincaid grade level is a rough indicator. Grade 6–8 is appropriate for most UI copy. Technical documentation for expert users may justify higher levels.

#### Predictable Behavior

SC 3.2.1 (On Focus) and SC 3.2.2 (On Input) are cognitive accessibility criteria:
- Focus alone must not trigger navigation or context change
- Selecting a form control must not automatically submit, navigate, or change context

Design failures: a select dropdown that navigates immediately on arrow key (no confirm step), a radio button group that submits the form on selection, an autocomplete that redirects to a search results page on first character typed.

---

### Hearing Disability

Hearing disability primarily affects audio and video content. For software without audio/video, hearing accessibility has minimal impact. When audio is present:

- All audio content that conveys information requires captions (SC 1.2.2, AA)
- Video with meaningful audio requires captions or audio description
- Alerts that use sound must also have a visual equivalent
- The design must specify that audio is NOT the primary channel for important information — a sound-only error alert is an accessibility failure

**Design principle:** If your design includes any audio feedback (error sounds, success chimes, notification alerts), specify the visual alternative. Audio feedback is an enhancement, not a primary signal.

---

### Vestibular Disability

Vestibular disorders affect the inner ear system that controls balance and spatial orientation. Examples: benign paroxysmal positional vertigo (BPPV), Ménière's disease, vestibular migraine, MS-related vestibular effects. Exposure to certain motion patterns can trigger dizziness, nausea, headache, and disorientation severe enough to require rest.

This is not a minor accessibility concern. Vestibular reactions to screen motion are a documented, non-trivial injury class.

**Triggering motion patterns** (design decisions that cause vestibular harm):
- Parallax scrolling (elements moving at different rates from the scroll direction)
- Auto-playing animations that continue without user initiation
- Large-scale transformations triggered by scroll or interaction (the element "flies in" across a large distance)
- Rapidly changing content (news tickers, carousels with fast auto-advance)
- Page-flip animations and zoom effects
- Elements that move independently of scroll direction

**WCAG coverage:**
- SC 2.3.1 (Three Flashes or Below Threshold, A) — no content flashing more than 3 times per second
- SC 2.3.3 (Animation from Interactions, AAA) — motion animation triggered by interaction can be disabled unless essential

**Design obligation — a designer decision, not an implementation detail:**

The designer must classify every animation and transition in the design into two categories:
1. **Essential motion** — conveys information that cannot be expressed without motion (e.g., a loading spinner, a drag-to-position feedback)
2. **Decorative motion** — aesthetic enhancement (e.g., entrance animations, hover effects, background parallax)

Decorative motion must be removable. The implementation mechanism is `prefers-reduced-motion` CSS media query, but the **design decision** — which animations are essential vs decorative — belongs in the Design Spec. The designer must specify this; the developer cannot infer it.

**Format for specifying:** For each transition or animation, the Design Spec must include:
```
Transition: [name of the transition]
Purpose: [essential — what information it conveys] OR [decorative — aesthetic only]
Reduced-motion alternative: [no animation; instant state change] OR [fade only, no movement]
```

If the designer cannot specify what information an animation conveys, it is decorative by definition.

---

## Keyboard and Focus Design — Design Decisions, Not Implementation Details

### Tab Order as a Design Specification

Tab order is the sequence in which keyboard focus moves when the user presses Tab. WCAG SC 2.4.3 requires meaningful focus order. **The tab order is a design decision** — it follows DOM order unless deliberately altered, but the designer must specify when the visual layout and the intended tab order differ.

Design obligations:
- For every complex layout (multi-column, grid, card grid, floating elements), specify the intended tab order explicitly
- When visual position and logical order diverge, note this in the spec with the intended reading order
- Groups of related controls should be reached as a group

Design failure: a three-column layout where the design shows the right column as visually prominent (perhaps larger text), but the intended tab order is left-to-right across all three columns. Without specifying this, the worker implements DOM order, which may not match the visual layout if CSS grid or flexbox reorders elements.

### Focus States as a Design State

Focus is the eighth canonical interaction state (default, hover, focus, active, disabled, loading, error, success). It must be designed, not left to browser default.

Requirements from WCAG 2.2:
- SC 2.4.7 (Focus Visible, AA): a visible focus indicator must exist
- SC 2.4.11 (Focus Not Obscured, AA — new in 2.2): the focused element must not be entirely hidden behind sticky headers, floating toolbars, or other overlapping content
- SC 2.4.13 (Focus Appearance, AAA): focus indicator must have area ≥ perimeter of unfocused component × 2px, with 3:1 contrast between focused and unfocused states

Design requirement: specify the focus state appearance for every interactive component, including:
- Focus ring color and contrast ratio against background (minimum 3:1)
- Focus ring area (meeting or exceeding 2px outline around the component perimeter for AAA compliance)
- That sticky headers and overlay elements do not cover focused elements as the user tabs down the page

Design failure: specifying default, hover, and active states for buttons but omitting the focus state. The developer either removes focus styles (creating an invisible focus, SC 2.4.7 violation) or uses browser default (which may fail contrast in some themes).

### Focus Management in Dynamic Content

When content changes dynamically — modals open, panels slide in, wizard steps advance, content is filtered — where does keyboard focus go? This is a design question. The developer cannot infer it.

Standard focus management patterns:

| Trigger | Focus destination |
|---|---|
| Modal opens | First focusable element inside modal (typically the close button or the first form field) |
| Modal closes (Escape, Cancel, or close button) | The element that triggered the modal open |
| Wizard advances to next step | First focusable element in the new step content, or the step heading |
| Page navigation (SPA route change) | Page/view heading, or first meaningful content |
| Error on form submit | First field in error state, or the error summary |
| Toast/alert appears | Toast content (for `aria-live` region) — focus does not move to toast |
| Content loaded via search/filter | First result, or the result count announcement via `aria-live` |

**Design obligation:** The Design Spec must specify focus destination for every context change. "Handle focus in the modal" is not a specification — it is a delegation of a design decision to the developer.

### Skip Navigation

SC 2.4.1 (Bypass Blocks, A) requires a mechanism to skip repeated content blocks (navigation, header). **This is a design decision** — the designer must specify:
- Whether a skip link exists (required when there is repetitive navigation at the top of each view)
- What it links to ("Skip to main content")
- Whether it is visible by default or only on focus (either is conformant; visible-by-default is better UX)
- For complex pages: whether multiple skip targets exist (skip to main content, skip to search, skip to navigation)

Landmark regions may substitute for skip links when screen readers allow landmark navigation, but the landmark structure is itself a design decision (see Landmark Structure above).

---

## Screen Reader Interaction Model — Design Implications

### How Screen Readers Traverse Content

Screen readers offer multiple traversal modes:
1. **Sequential reading** — reads the full page in DOM order (the primary mode for exploring unfamiliar pages)
2. **By landmark** — jumps between landmark regions (banner, main, navigation, etc.)
3. **By heading level** — jumps between H1→H2→H3 headings
4. **By interactive elements** — jumps between links, buttons, form fields, and other interactive elements

Design implications of each mode:

**Sequential (DOM order):** Visual layout and DOM order must align or the designer must explicitly specify the intended reading order.

**By landmark:** Landmark structure is a design deliverable. A page with `main`, `navigation`, and `footer` lets screen reader users jump directly to any of these. An unlabeled design leaves the developer to guess the landmark structure.

**By heading:** Heading hierarchy must be semantic, not presentational. The design must specify heading levels (H1, H2, H3) based on content hierarchy, not based on visual size. Design failure: "use a large, bold font for section titles" without specifying H2. A developer who renders large bold text as a `<p>` element with CSS creates a visual hierarchy with no semantic structure — screen reader users cannot navigate by heading.

**By interactive elements:** Every interactive element must have an accessible name. The ARIA naming order (highest priority to lowest): `aria-labelledby` → `aria-label` → `<label>` association → `title` attribute → element content (for buttons). The designer specifies the accessible name; the worker implements the most appropriate HTML mechanism.

### The Reading Order Problem

This is the most common design-level accessibility failure:

Visual layout: Card 1 (large, prominent) | Card 2 | Card 3
DOM order (what screen reader reads): Card 1 | Card 2 | Card 3

This works. But consider:

Visual layout: Recent Activity (right sidebar, visually prominent) | Main Content (left column) | Navigation (top, reused across pages)
Intended reading order: Navigation | Main Content | Recent Activity

If the visual layout is achieved with CSS float or flexbox order, the DOM order may follow source order (Navigation | Main Content | Recent Activity), which is correct. But if the designer specifies visual prominence without specifying reading order, the worker may implement this differently.

**Design obligation:** For any layout where visual position is used to establish priority, specify whether the visual priority matches the intended reading order. If they differ, specify the intended reading order explicitly.

---

## Color and Contrast — Design Decisions

### WCAG 2.2 Contrast Requirements

These are minimums, not targets. Good accessible design typically exceeds these:

| Content type | Minimum contrast (AA) | Enhanced contrast (AAA) |
|---|---|---|
| Normal text (< 18pt or < 14pt bold) | 4.5:1 | 7:1 |
| Large text (≥ 18pt or ≥ 14pt bold) | 3:1 | 4.5:1 |
| UI component boundaries (borders, outlines) | 3:1 | — |
| Graphical objects conveying information | 3:1 | — |
| Focus indicators | 3:1 against unfocused state | — |
| Inactive/disabled components | No requirement | — |
| Logotypes | No requirement | — |

**The rationale matters for design decisions:** 4.5:1 compensates for visual acuity loss to approximately 20/40 (typical for an 80-year-old). Designing to exceed minimums — 7:1 for body text, 10:1 for critical UI — improves legibility in bright ambient light, on low-quality displays, and at small text sizes. Treat contrast ratios as floor values, not targets.

**Contrast calculation:** Luminance ratio is computed from relative luminance values of the two colors, per the WCAG formula. Tools: WebAIM Contrast Checker, Figma plugins, browser dev tools (accessibility panel). The designer is responsible for verifying contrast ratios at design time, not deferring to implementation.

### The Non-Color Rule (SC 1.4.1)

Color must NEVER be the only means of conveying:
- Information (this element is an error)
- Indicating an action (click here)
- Prompting a response (this field requires input)
- Distinguishing an element (this is the selected state)

**Color blindness types and what signals are lost:**
- **Protanopia** (red blind, ~1% of men): red appears very dark or black; red/green distinction is lost
- **Deuteranopia** (green blind, ~5% of men): green appears yellow-brown; red/green distinction is lost
- **Tritanopia** (blue blind, rare): blue/yellow distinction is lost

Combined, red-green blindness affects approximately 8% of men of Northern European descent. In a team of 25 engineers, statistically 2 have some form of color deficiency. Design for this as a routine constraint, not an edge case.

**Color blindness simulation tools:** Figma plugins (Color Blind, Stark), browser dev tools (Chrome DevTools > Rendering > Emulate vision deficiencies). Use these to verify designs before specification.

### Dark Mode as Accessibility

Dark mode is an accessibility feature for users with photosensitivity, migraines, and vestibular sensitivity. Design obligation: when designing for a product that supports dark mode, verify contrast ratios in both light and dark themes. A color pair that passes at 4.5:1 in light mode may fail in dark mode when light and dark values are inverted naively.

The designer specifies both light and dark mode color semantics; each must independently pass contrast requirements.

---

## ARIA — When the Designer Creates an Obligation

ARIA (WAI-ARIA) is a specification defining attributes that communicate roles, states, and properties to assistive technologies when semantic HTML alone is insufficient. The key principle:

> **If a native HTML element with the semantics and behavior already built in exists, specify it — do not specify a custom element and compensate with ARIA.**

This is the First Rule of ARIA (W3C principles retained in the ARIA Authoring Practices Guide). It is **a design principle**: when the designer specifies a custom checkbox instead of specifying `<input type="checkbox">`, that design decision forces the developer to implement an ARIA role, state management, and keyboard behavior from scratch — work that the native element provides for free.

**The designer's ARIA obligation:** When specifying a custom interactive component that has no direct HTML equivalent, the Design Spec must:
1. Name the applicable ARIA pattern from the WAI-ARIA Authoring Practices Guide (APG)
2. Specify the required keyboard behavior for that pattern
3. Specify the ARIA roles, states, and properties required

**29 ARIA patterns with keyboard behavior** (from the APG, available at https://www.w3.org/WAI/ARIA/apg/patterns/): Accordion, Alert, Alert Dialog, Breadcrumb, Button, Carousel, Checkbox, Combobox, Dialog, Disclosure, Feed, Grid, Landmarks, Link, Listbox, Menu/Menubar, Menu Button, Meter, Radio Group, Slider, Spinbutton, Switch, Table, Tabs, Toolbar, Tooltip, Tree View, Treegrid, Window Splitter.

For each custom pattern the design specifies, the Design Spec must reference the applicable APG pattern and state the keyboard interaction model.

**ARIA is harmful when:**
- Added to elements that already have the correct semantics (doubly specified roles)
- `aria-hidden="true"` is applied to a focusable element (the user focuses on "nothing")
- ARIA roles are applied without implementing the required keyboard behavior
- `aria-label` overrides visible text (breaks synchronization between visual and assistive technology label)

---

## Cognitive Accessibility as First-Class Design Concern

This section addresses the design-level application of COGA objectives — not as additional guidance, but as a design quality gate that runs alongside WCAG.

### The COGA Design Audit

After completing a design, run this audit before specification is complete:

**Memory requirement check:**
- Does any step require the user to remember information from a previous step? → Specify persistence or visible carry-forward
- Does authentication require remembering a password without a paste-or-autofill alternative? → SC 3.3.8 violation by design
- Does any error message fail to identify the field that contains the error? → SC 3.3.1 violation, COGA Objective 4 failure

**Distraction check:**
- Does the design include auto-advancing content (carousels, tickers)? → Specify pause/stop controls
- Does the design include audio that plays automatically? → Specify a control to stop it within 3 seconds
- Does the design change content position without user initiation? → Specify pause or user-controlled trigger

**Cognitive load at decision points:**
- How many choices does the user face at the most complex decision point? Keep to 3-5 options at peak
- Are choices labeled in plain user-goal language, or in system vocabulary? → Specify user-goal labels
- Is the consequence of each choice stated before the user commits? → Specify preview/confirmation where destructive

**Error recovery quality check:**
- When validation fails, does the error message name the field, describe the problem, and suggest a solution? → SC 3.3.1 (A), SC 3.3.3 (AA)
- Is data preserved on error? A form that clears all fields on validation failure imposes severe cognitive penalty → Specify field-level error handling, not form-level clearing
- Does the design allow undo where actions are difficult to reverse? → Specify undo or confirmation for destructive actions

---

## Accessibility for Non-Web Surfaces

### CLI Accessibility

Screen readers work with terminal output. All CLI output is inherently screen-reader-compatible if it is text — this is CLI's fundamental accessibility advantage. The design-level concerns are different from web:

**Error message design (most important CLI accessibility concern):**
- Error messages must identify the cause in text, not only by exit code. "Error: --env is required" is accessible; exit code 1 without a message is not.
- Error messages go to stderr — this allows screen reader users and scripts to separate error output from program output
- Color in error messages is enhancement only: the same information must appear in text alongside any color indication

**Exit code discipline:**
- Exit 0 means success — a program that exits 0 on error breaks every script that tests exit codes (POSIX convention, and a named CLI accessibility failure mode)
- Exit 1: general error
- Exit 2: misuse of shell command / invalid arguments (with usage on stderr)
- Exit 130: user interrupt (Ctrl-C)
- Specify exit codes for every command in the Design Spec

**Color and screen reader compatibility:**
- `TERM=dumb` environments (common in CI, screen reader users) have no color support
- Color-only signals fail in these environments — specify text redundancy for all color signals in CLI output
- Design `--no-color` or `--plain` flags as accessibility features for users who need no-color output

**Paste and autofill support:**
- Do not design interactive CLI prompts that block paste — this breaks password managers and violates SC 3.3.8 for authentication prompts
- Single-line password prompts should accept pasted input

**Flag and command naming:**
- Long-form flags (`--verbose`, `--output`, `--help`) are more discoverable than single-character flags (`-v`, `-o`, `-h`) for new users and screen reader users reading help text
- Specify both forms when both are supported

**WCAG does not directly apply to CLI.** The accessibility obligations are: information completeness in text form, no color-only signaling, clear error descriptions, exit code discipline.

### TUI Accessibility

TUI (terminal UI interactive applications) have a fundamentally different accessibility model from web:

**No browser accessibility tree exists.** Terminal screen readers (BRLTTY on Linux, JAWS for terminal on Windows) read the terminal buffer character-by-character. There is no landmark, heading, or ARIA concept — what the user hears or reads in braille is exactly the rendered character grid.

**Keyboard is the only input method — this is baseline, not accommodation.** Keyboard-only navigation in a TUI is not an accessibility feature; it is the only mode of operation. The design obligation is to ensure keyboard navigation is complete and documented.

**Design obligations for TUI keyboard access:**
- Specify every key binding in the Design Spec key binding table — no interactive element should be reachable only by mouse
- Specify key binding conflict resolution (what happens when a key binding conflicts with a terminal shortcut)
- Modal dialogs must have an explicit close key binding (Escape is conventional)
- Document key binding help access (typically `?` or `F1`)

**TUI cognitive accessibility:**
- Mode indicators must be clearly visible in the layout (vim mode indicators, vim-like "insert" vs "normal" mode)
- Status bar content serves as the TUI equivalent of ARIA live regions — specify what status bar sections display and when they update
- Error states must appear as text in a visible location, not only as colored text (color may be invisible in low-color-depth terminals)

**Design for limited terminal accessibility:**
- Recommend that TUI-heavy tools provide a non-TUI mode (e.g., `--plain` or `--output=json`) for environments where TUI screen reader support is poor
- If a function is available in the TUI only, it is inaccessible to users on terminal screen readers

**Modifier key accessibility:**
- `Ctrl+Alt+` chords are difficult or impossible for some motor-impaired users
- Prefer single-key or simple `Ctrl+` bindings for frequent operations
- Avoid requiring simultaneous multi-key chords (three or more keys) for any primary function

### Desktop Accessibility

Native desktop GUIs expose accessibility via platform APIs:
- **macOS:** NSAccessibility protocol (AppKit/SwiftUI exposes this automatically for standard controls)
- **Windows:** UI Automation (UIA) and MSAA (WinForms and WPF expose this for standard controls)
- **Linux:** ATK/AT-SPI (GTK and Qt expose this for standard controls)

**Design obligations for desktop:**
- Standard platform controls preferred over custom — native controls expose accessibility automatically
- Custom controls require explicit accessibility implementation — the Design Spec must flag any custom control and specify the accessibility contract (role, name, state properties)
- Keyboard shortcuts must follow platform conventions (macOS: Cmd+, Windows: Ctrl+, with standard menu shortcuts)
- Menu bar accessibility is handled automatically by platform APIs — but the menu structure and keyboard shortcut assignment are design decisions

**For hybrid apps (Electron, Tauri):**
- Inherits web accessibility (ARIA, focus management) but must also expose the UI to the platform accessibility API via Chromium's accessibility layer
- Custom TitleBar implementations in Electron commonly break platform accessibility conventions — specify that the standard OS window chrome is preferred
- Verify that drag-to-resize and other native behaviors are preserved or have accessible alternatives

---

## Verifiable Accessibility Requirement Format

Accessibility requirements in the Design Spec must follow this format (from architecture §3 Invariant I-7):

```
Component/interaction: [what it applies to]
Standard: [specific WCAG SC, ARIA pattern, or platform convention]
Requirement: [specific implementable condition]
Verification: [how Worker/Reviewer confirms it]
```

**Examples:**

**Example 1 — Web form field label:**
```
Component/interaction: Email input field in the registration form
Standard: WCAG 2.2 SC 4.1.2 Name, Role, Value (A)
Requirement: The email input must have an associated <label> element with text "Email address".
  The association uses the for/id pattern or wraps the input. aria-label is not used because
  a visible label is present.
Verification: Automated: axe-core reports label association present. Manual: VoiceOver reads
  "Email address, edit text" when field receives focus.
```

**Example 2 — Modal focus management:**
```
Component/interaction: Confirmation modal — open and close behavior
Standard: WCAG 2.2 SC 2.4.3 Focus Order (A), ARIA APG Dialog pattern
Requirement: On modal open, focus moves to the modal's close button ("×" with aria-label
  "Close dialog"). Tab order within modal: Close button → Cancel button → Confirm button
  (no other focusable elements). On modal close (any method — Escape, Cancel, Confirm, or
  clicking the overlay), focus returns to the button that triggered the modal open.
Verification: Keyboard test: tab into the modal and confirm the focus cycle matches the
  specified order. Close the modal; confirm focus returns to the trigger.
```

**Example 3 — CLI error message:**
```
Component/interaction: deploy command — failure output
Standard: Not applicable to CLI (WCAG is for web content). CLI accessibility convention:
  error message completeness.
Requirement: When the deploy command fails for any reason, stderr must contain:
  (1) the word "Error:" at the start of the error message, (2) the specific cause
  ("Error: --env is required" not "Error: invalid arguments"), (3) a reference to --help
  if relevant ("Run 'tool deploy --help' for usage"). Exit code must be non-zero.
  No color-only error signaling — the error must be identifiable from text alone.
Verification: Run the command without --env; confirm stderr output matches the format.
  Run with TERM=dumb or NO_COLOR=1; confirm error is still readable.
```

**Example 4 — Target size (new in WCAG 2.2):**
```
Component/interaction: Icon-only toolbar buttons (close, settings, refresh)
Standard: WCAG 2.2 SC 2.5.8 Target Size Minimum (AA), SC 1.1.1 Non-text Content (A)
Requirement: Each button renders at minimum 24×24 CSS pixels with 4px spacing between
  adjacent buttons. Each button has an aria-label matching its function: "Close", "Settings",
  "Refresh". The aria-label matches the tooltip text (when a tooltip is present).
Verification: Measure rendered size in browser DevTools (computed size, not declared size).
  Automated: axe-core confirms aria-label presence. Spot check: hover each button; confirm
  tooltip text matches aria-label.
```

**Example 5 — Vestibular motion:**
```
Component/interaction: Card entrance animation on page load
Standard: WCAG 2.2 SC 2.3.3 Animation from Interactions (AAA)
Requirement: Card entrance animation (slide up + fade in, 300ms) is decorative — it conveys
  no information. When prefers-reduced-motion is set, the animation is removed entirely:
  cards appear immediately in their final position with no transition. No content or
  information is lost when animation is absent.
Verification: In Chrome DevTools, enable "Emulate CSS media feature prefers-reduced-motion".
  Reload the page. Confirm cards appear without movement. Confirm no content is missing
  compared to the animated version.
```

---

## AI-Agent Adaptation

What Designer can do without user testing or AT session:

**Contrast ratio verification:** Designer can calculate luminance ratios from specified RGB/hex color values and flag any color pair that fails WCAG SC 1.4.3 or SC 1.4.11. This is deterministic — no user observation required.

**Keyboard flow completeness check:** Designer can audit the spec for every specified interactive element and verify that each has a keyboard access path specified. Any interactive element without a keyboard path is a gap to flag before specification is complete.

**Accessible name completeness:** Designer can audit every interactive element in the spec and flag any that do not have an accessible name specified.

**Reading order specification:** Designer can reason about a specified layout and determine where visual order and DOM order are likely to diverge, flagging these for explicit reading order specification.

**Disability-type scenario analysis:** Designer applies scenario-based analysis through disability-type lenses — the primary substitute for observational user research:

> "A screen reader user encounters the three-column layout: the Design Spec specifies visual order (column 2, then 1, then 3) but does not specify reading order. DOM order likely follows source order (column 1, then 2, then 3). These differ — the spec must specify reading order explicitly."

> "A keyboard-only user tabs to the modal close button: is the focus indicator visible? The Design Spec specifies a white close button on a light gray modal. Does the focus ring have 3:1 contrast against the white button background? The specified focus ring color (#555, gray) against white background is approximately 4.5:1 — this passes."

> "A switch-access user encounters the file upload area that requires drag-and-drop: the Design Spec specifies only drag-to-upload without a browse button alternative. SC 2.5.7 requires a single-pointer alternative. This is a design failure to fix before specification."

**What Designer cannot do:**
- Observe user behavior, hesitation, or comprehension
- Conduct user testing with participants with disabilities
- Test actual AT compatibility (JAWS + Chrome vs VoiceOver + Safari produce different results)
- Measure cognitive load in practical use (can reason about it from scenario analysis)

---

## Design Failures That Are Not Implementation Bugs

These failures originate at design time. Flagging them in code review is too late.

1. **Unlabeled interactive elements** — The spec specifies an icon button, search input, or widget without an accessible name. WCAG SC 4.1.2 failure baked into the design.

2. **Missing focus state** — The spec defines default, hover, and active states but omits focus. Developer removes focus styles (SC 2.4.7 violation) or relies on browser default (which may fail contrast).

3. **Color-only information** — The spec uses color to signal status without a non-color redundant signal. SC 1.4.1 violation baked into the design.

4. **Deep navigation with no skip mechanism** — The spec has no skip link, no landmark structure, no breadcrumb. Every keyboard user must tab through the entire header on every view. SC 2.4.1 violation by design.

5. **Motion as required feedback** — The spec uses animation as the only confirmation of an action (card flip = selected). Users with `prefers-reduced-motion` get no feedback. The design must specify the non-motion alternative.

6. **Target size below minimum** — Small icon buttons with < 24px spacing. SC 2.5.8 violation designed in, not implemented in.

7. **Authentication requiring memorization** — PIN or password field that blocks paste, or a CAPTCHA with no alternative. SC 3.3.8 violation designed in.

8. **Reading order not specified** — Multi-column layout without reading order specification. DOM order is implementation-defined; visual order is the spec; they will diverge.

9. **Custom pattern without ARIA specification** — A custom radio group, tab panel, or select specified without the ARIA pattern and keyboard behavior. The developer must guess the interaction model.

10. **Drag without alternative** — A drag-to-reorder list or drag-to-resize panel specified without a keyboard/click alternative. SC 2.5.7 violation designed in.

---

## Research Quality Gate

This skill's content passes the research quality gate (architecture §9) if:

- Vestibular/motion sensitivity is addressed specifically — ✓ (Vestibular section, motion classification design obligation, prefers-reduced-motion as designer decision)
- CLI and TUI accessibility constraints are addressed separately from web — ✓ (separate sections with surface-specific obligations)
- Cognitive accessibility has equivalent depth to visual/motor — ✓ (COGA 8 objectives, working memory, authentication, reading level, predictable behavior, COGA design audit)
- WCAG 2.2 is cited normatively (POUR principles, specific SC numbers) — ✓ (POUR section, complete normative table, new 2.2 criteria marked)
- Every section gives a design decision, not an implementation instruction — ✓ (focus management specifies destinations, not code; vestibular specifies classification, not CSS; contrast specifies ratio requirements, not stylesheet values)

---

## Sources

- WCAG 2.2 (W3C Recommendation, December 2024): https://www.w3.org/TR/WCAG22/
- ARIA Authoring Practices Guide — Patterns: https://www.w3.org/WAI/ARIA/apg/patterns/
- Making Content Usable for People with Cognitive and Learning Disabilities (W3C Working Group Note, April 2021): https://www.w3.org/TR/coga-usable/
- WCAG Understanding 2.3.3 Animation from Interactions: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
- WCAG Understanding 2.5.8 Target Size Minimum: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- WCAG Understanding 3.3.8 Accessible Authentication Minimum: https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html

**Adjacent skills:**
- `accessibility` — implementing accessibility in code (Worker/Reviewer audience); receives requirements produced by this skill
- `interaction-design` — owns state modeling; this skill adds accessibility constraints on those states
- `visual-interface-design` — owns visual design choices; this skill provides the normative constraints those choices must satisfy
- `design-specification` — formats and communicates accessibility requirements in the spec; the verifiable requirement format must be consistent between both skills

---
