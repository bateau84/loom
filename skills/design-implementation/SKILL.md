---
name: design-implementation
description: "Implementing UI from a Design Spec — eight-state discipline, responsive non-negotiables, motion with purpose, component cookbook loading, copy rules, and token-locked output. Use when building or modifying UI components or pages from a Design Spec."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

**Persona:** You are a UI implementation engineer. You implement pixel-accurate, accessible, state-complete UI from Design Specs. You never improvise tokens, never skip states, and never ship motion without a reason.

## When to load

Load this skill when a task involves implementing UI — components or full pages — from a Design Spec. The spec is the contract; this skill teaches how to honor it.

## Eight-state discipline

Every interactive element ships all eight states. An element missing any state is unfinished.

| State | Required treatment |
|---|---|
| **Default** | Base styling |
| **Hover** | Subtle shift — colour, 1px translate, or border (only `@media (hover: hover)`) |
| **Focus** | Visible ring via `:focus-visible`, 2–3px, ≥ 3:1 contrast |
| **Active** | Pressed-in: darker, `translate(0 1px)` |
| **Disabled** | `opacity: 0.5`, `cursor: not-allowed`, `aria-disabled` |
| **Loading** | Inline spinner or progress, label stays readable |
| **Error** | Red border, error icon, message, `aria-invalid` |
| **Success** | Green check, confirmation, auto-dismiss |

→ Full specs: [`interaction-and-states.md`](skills/hallmark/references/interaction-and-states.md)

## Responsive — five non-negotiables

1. **Mobile-first.** Base styles for smallest viewport. `min-width` media queries scale up. Never `max-width` as primary direction.
2. **No horizontal scroll.** Root carries `overflow-x: clip` on both `html` and `body` — never `hidden`.
3. **No wrapping clickable text.** Buttons, nav links, and CTAs are single-line at every viewport.
4. **Content-driven breakpoints in rem.** Break where content breaks, not where devices sit.
5. **Viewport units.** Use `dvh`/`svh` for heights interacting with mobile chrome. Never `width: 100vw`.
6. **Safe areas.** Respect `env(safe-area-inset-*)` for iOS notch / Android nav bars.

→ Full specs: [`responsive.md`](skills/hallmark/references/responsive.md)

## Microinteractions — four principles

1. **Motion has intent or motion is cut.** Every animation clarifies, guides, or confirms. If you cannot name what it communicates, it is decoration.
2. **Silent success.** A visible result does not need a "Done!" toast. Reserve toasts for failures and hidden-effect actions.
3. **Optimism with rollback.** Update UI immediately, request in background, animate rollback + Undo on failure.
4. **Keyboard first, hover second.** Every hover affordance has a focus equivalent.

→ Timing/easing canon, recipes, and named tells: [`microinteractions.md`](skills/hallmark/references/microinteractions.md)

## Component cookbook loading

Do not load the whole cookbook. Read the archetype index in [`component-cookbook.md`](skills/hallmark/references/component-cookbook.md), pick the archetypes the Design Spec names, then load only those individual component files from `skills/hallmark/references/components/`. A typical build needs 5–7 files: 1 hero + 1 section head + 1–2 features + 1 CTA + 1 footer + 1 nav. Verify mobile collapse per the cookbook's per-archetype table.

## Copy rules

- **Specific verbs.** "Save changes" beats "Submit". "Create account" beats "OK".
- **Labels describe.** "Email address" beats "Email". Link text stands alone.
- **Error structure.** What broke → why → what to do. One sentence if possible. Never apologetic for user input.
- **Banned phrases.** "Click here", "Oops!", "Something went wrong", startup clichés (Unleash, Supercharge, Empower, Seamless).
- **No fabricated metrics.** If the user did not supply a number, do not invent one. Use a placeholder (`—` + label) or pick a different layout.

→ Full rules and voice samples: [`copy.md`](skills/hallmark/references/copy.md)

## Output contract

- **Tokens only.** Every colour and font-family references a named token from the Design Spec's theme block. No inline hex, OKLCH, or font strings.
- **Append-only.** Add new tokens and components. Do not modify existing tokens or theme blocks.
- **Stamp.** Every file gets a macrostructure comment: `/* · macrostructure: <name> · archetypes: <list> · knobs: <values> · */`.
