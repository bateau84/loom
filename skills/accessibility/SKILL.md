---
name: accessibility
description: Use when designing, implementing, or reviewing user interfaces, web components, dialogs, or any code that produces visual or interactive output — when keyboard navigation, screen reader support, or WCAG 2.1 AA compliance could be affected by implementation choices.
license: MIT
metadata:
  author: Bateau
  version: "2.0.0"
---

> **House skill.** Cross-cutting a11y discipline shared by every agent. Per-agent role hooks live in the agent files and `current Loom role directive and control-plane state`.

## When to load

- **Designer** — producing a Design Spec with any user-facing UI
- **Worker** — implementing components, pages, forms, or interactive flows
- **Reviewer** — auditing a PR that touches HTML, JSX, or any UI code
- **Problem** — investigating a reported a11y incident

## The 8 non-negotiables

1. **Use native `<dialog>` + `showModal()`.** You get focus trap, Escape, and inert background for free. Do not build a modal from `<div>` unless you have a reason that survives a 5-minute audit. (Native `<dialog>` has implicit modal semantics — do NOT add `aria-modal='true'`; the browser handles it.)

2. **Focus management is non-negotiable.** On open, focus moves into the dialog (capture `document.activeElement`). On close, it returns to the trigger. A modal that drops focus on close is broken for keyboard users, even if it "looks fine."

3. **Never `autoFocus` a destructive action.** Delete, Remove, Reset must focus Cancel, the dialog itself, or nothing. autoFocusing Delete means a screen-reader user who hits Enter reflexively destroys their data. Destructive buttons must specify the object: "Delete account" not "Delete".

4. **ARIA fills gaps semantic HTML cannot.** `aria-labelledby` and `aria-describedby` on dialogs. `aria-live` for state changes. `aria-expanded` for disclosure widgets. If semantic HTML covers it, do not add ARIA.

5. **Every mouse interaction needs a keyboard equivalent.** Backdrop click to close = close button or Escape. Drag-to-reorder = keyboard alternative. Hover-to-show = focus-to-show. If you cannot describe the keyboard path, it is not accessible.

6. **Focus must be visible.** Override `outline: none` only if you replace it with a `:focus-visible` style that meets 3:1 contrast. A focus ring is a feature for keyboard users, not a design flaw.

7. **Respect `prefers-reduced-motion`.** Any animation >150ms or any parallax/motion must have a `no-preference`-only version. No exceptions.

8. **In forced-colors mode** (Windows High Contrast), use `forced-color-adjust: auto` on borders/icons and let the system palette drive the color.

## Triage

Skip in this order: focus management > semantic HTML > keyboard equivalents > ARIA > color contrast > focus-visible styling > reduced-motion. A modal that drops focus is broken; one with no focus ring is imperfect.

## Rationalization table

| Excuse | Reality |
| --- | --- |
| "It's a simple modal" | A modal that drops focus on close is broken, not simple |
| "It works for the mouse user" | 15-20% of users rely on keyboard or assistive tech |
| "ARIA covers it" | ARIA on top of wrong HTML compounds the problem |
| "We'll add a11y in a follow-up" | The follow-up never comes |
| "The user can see it" | 8% of men have red-green color blindness. Never rely on color alone |
| "Outline ruins the design" | A focus ring IS the design for keyboard users. Replace it, never delete it |

## The 60-second audit

Before merging any UI change, verify:

- Tab order is logical
- Focus is visible on every interactive element
- Dialog: focus moves in, returns to trigger on close
- Destructive actions: Cancel focused, not Delete
- All images have `alt` (or `alt=""` if decorative)
- All form fields have labels
- Color is not the only signal
- CSS is in a stylesheet, not inline; class names follow a convention (BEM, utility-first, or project) so auditors can grep, not read JSX
- Icon-only buttons have `aria-label` or visible text; an `×` alone is invisible to screen readers
- A test asserts focus order, destructive-action focus, and Escape behavior
- Tested with: Tab key, screen reader (NVDA or VoiceOver), 200% browser zoom, forced-colors mode — not just visually inspected
- Screen reader announces dialog title when it opens

## Cross-references

For accessibility incident observability, load the `observability` skill. For TDD with ARIA assertions, load the `test-driven-development` skill.
