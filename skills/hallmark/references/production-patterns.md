# Context-led web production patterns

These are defaults and decision aids, not a replacement for accepted project design. Use the part relevant to the assignment.

## Design the whole flow

Start with the user's priority at entry, the information needed for the next action, and the state that confirms the result. Select a structure for that job before arranging components.

For an operations tool, an attention queue plus a stable detail region may preserve orientation better than a row of equal-weight metric cards. For an editorial site, a strong reading rhythm may matter more than persistent controls. For a restaurant, its food, setting, booking details, and identity may matter more than a software-style feature grid. These are examples to test, not templates to apply blindly.

A useful reusable flow records:

```text
Purpose and scenario
Entry conditions and permissions
Real template/components/tokens to reuse
Trigger -> visible response -> resulting state
Loading, empty, error, stale, and recovery branches that actually exist
Context/focus/progress retained across transitions
Responsive and input-mode adaptation
Accepted exceptions and evidence needed
```

Read real template/component files before claiming they support a branch. If a reference is missing, do not substitute an imaginary component or quietly use a generic scaffold. State the gap and resolve the dependent slice through the existing owner. Existing code can also be wrong; accepted intent wins over an outdated example.

## Visual structure and tokens

Use type, contrast, spacing, grouping, and position to direct attention in the order the task needs. Check long realistic content and dense, empty, and error states, not only ideal demo data. Include emotional tone and aesthetic character where the direction calls for them; do not confuse restraint with absence of craft.

Reuse the project's type, color, spacing, radius, and motion tokens. A token is a named design decision, not just a hex value. Shared names should preserve shared meaning. An accepted system change may update or remove a token: inspect consumers and coordinate migration rather than adding duplicates indefinitely. Do not silently change a shared token to repair one local screen.

Fonts and assets must be available and permitted for the project. Do not invent an installed font, silently fetch an external dependency, or substitute an unrelated brand. A reference image suggests visual qualities; it does not prove exact CSS values or asset rights.

## Components within context

Inherit the host product's language and implement the reachable states relevant to the component. A navigation link does not need a fabricated asynchronous success lifecycle. A save action needs honest pending/error/retry behavior when those states exist. Reuse a full established flow when the task matches it; compose existing components deliberately when it does not.

Keep labels and user-visible status consistent across list, detail, action, and return paths. The same entity or state should not acquire a new meaning at each screen boundary. Preserve focus and orientation when content changes.

## Responsive and accessible behavior

Let content and task constraints drive adaptation. Test the accepted narrow and wide contexts, long labels, text enlargement, relevant input modes, and the accessibility constraints of the product. Reflow or wrap controls when appropriate; do not clip content merely to hide an overflow defect. A deliberately scrollable table is different from an accidentally overflowing page.

Use more than color to convey meaning. Do not remove focus indicators for aesthetics or infer screen-reader behavior from visual appearance. Apply `accessibility-design` when choosing the experience and the implementation-focused `accessibility` skill when producing or checking code.

## Copy and motion

Prefer specific, useful language over generic enthusiasm. Errors explain what happened and how to continue without fabricating causes. Success copy must match the real effect: an accepted request is not automatically a completed operation. Never invent metrics, testimonials, customer logos, guarantees, or user observations.

Motion may clarify causality, preserve orientation, or express accepted character. It should not delay frequent actions or become the only carrier of state. Specify a reduced-motion alternative and inspect timing when it is material. Do not assume optimistic success or promise undo/rollback without the corresponding accepted capability.

## Example: interruption-aware activity flow

A project asks for calm oversight of concurrent jobs. Its existing job list exposes `running`, `waiting for input`, and `finished`, with last-update time; its detail view preserves selection on return.

Reuse those states and selection behavior. Put waiting-for-input items where the user can find them, show the actual freshness of data, and keep job identity visible in detail and recovery states. An attention count is useful only if the underlying query supports it. Do not invent a health percentage or call every finished job successful.

The point of the pattern is retained orientation and truthful attention—not a mandatory sidebar, color palette, or layout for every product.
