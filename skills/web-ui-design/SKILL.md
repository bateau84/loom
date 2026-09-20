---
name: web-ui-design
description: Web-specific interface design — the browser as a co-host, URL as a first-class UX object, document-model vs app-model web, form design as a primary interaction concern, responsive behavior as interaction change, and web accessibility patterns. Use when designing any web application or website where users interact with the interface: SPAs, multi-page apps, forms, dashboards, admin interfaces. Load alongside Hallmark when designing the visual layer of a web product. Not for visual aesthetics (→ `hallmark`), Hallmark's visual anti-slop methodology (→ `hallmark`), CLI design (→ `cli-design`), TUI design (→ `tui-design`), desktop GUI (→ `desktop-ui-design`), or pure content sites with no interaction beyond navigation.
metadata:
  version: "1.0.0"
---

# Web UI Design

## What this skill is for

Web UI design is the structural and behavioral design of interfaces delivered through a browser. The practitioner's primary concern is: how users move through, control, and recover from web-based experiences — given that the browser itself is an irreducible layer in the interaction model.

**Load this skill when:**
- Designing the navigation model, URL structure, or routing strategy for a web application
- Designing forms, multi-step workflows, or data-entry flows for the web
- Designing loading states, error states, and empty states for async web operations
- Designing responsive breakpoints as interaction changes (not just layout changes)
- Designing web accessibility patterns: focus management in SPAs, modal focus traps, ARIA live regions
- Making a design decision about SPAs vs multi-page apps, or about which state belongs in the URL
- Reviewing an existing web design for browser-model violations (back button broken, URL not reflecting state, zoom prevented)

**Do NOT load this skill when:**
- The work is visual aesthetics — color palettes, typographic scales, component archetypes, design tokens (→ `hallmark` for web-specific visual production, → `visual-interface-design` for surface-independent visual reasoning)
- The interface is a CLI (→ `cli-design`)
- The interface is a TUI running in a terminal (→ `tui-design`)
- The interface is a desktop GUI (→ `desktop-ui-design`)
- The site is pure content with no meaningful interaction beyond links and page navigation

**Boundary with Hallmark:** Hallmark owns the visual production of web UIs — macrostructures, component archetypes, anti-slop methodology, design tokens, responsive CSS implementation. This skill owns the interaction and structural design of web UIs — the browser model, URL design, navigation hierarchy, form behavior, state management, responsive interaction changes, and accessibility patterns. Load both when designing a web application from scratch. Do not reproduce Hallmark reference content here; load Hallmark directly when visual production is needed.

**Boundary with `interaction-design`:** `interaction-design` owns the generic behavioral contract (the eight canonical states, feedback taxonomy, error recovery principles) that applies across all surfaces. This skill owns how those principles manifest under the specific constraints of the browser host: what loading states look like in SPAs vs MPAs, how error states interact with browser-managed page titles, where focus goes after client-side navigation.

---

## The Browser as Co-Host — The Defining Constraint

Web UI design is the only surface discipline where the application does not control its own chrome. The browser provides navigation affordances (back/forward buttons, address bar, tab bar, zoom, context menu, accessibility tools) that the user depends on at all times. These are **not overridable**; they are the design invariants the web UI must respect.

### Back button

The back button is used in more than 30% of navigations (usability studies). Users expect it to undo navigation. Design for it, do not fight it.

**In multi-page apps (MPAs):** The browser manages the navigation stack automatically. Each full page load creates a history entry. Back always works.

**In single-page apps (SPAs):** The JavaScript application controls DOM replacement without page loads. The application **must** push to browser history (`pushState`) on every meaningful navigation. Failure mode: the user navigates within the app, presses Back, and is ejected from the app entirely rather than returning to the previous view.

Design rule: every route change in an SPA is a design decision. When specifying an SPA, specify which navigation events push a history entry and what URL state they encode.

### Multi-tab behavior

Users open links in new tabs habitually. A web application must function correctly when the same app is open in multiple tabs, each in a different state. Designs that assume a single-tab session — single-use session tokens, state stored only in local memory — are architecture bugs that surface as user frustration.

Design rule: any link a user might right-click and open in a new tab must produce meaningful content in that new tab. If it cannot, the design should explain why and provide an alternative.

### URL as persistent state

The URL is always visible to the user. It conveys location in the hierarchy, supports bookmarking, and is the primary sharing mechanism for web content. If a user cannot paste a URL into an email and have the recipient arrive at the same view, something is wrong.

Design rule: every meaningful application state that a user would want to share or return to should have a URL. Transient UI state (which accordion is expanded, which tooltip is open) does not need a URL. Persistent application state (current filter, selected record, active tab within a page) usually does.

Concrete example: a filtered data table at `/records?status=active&sort=name-asc` is shareable and bookmarkable. The same table stored as component state is neither.

### Browser zoom

Users zoom browsers up to 400% — users with low vision routinely use 200-400%. WCAG 1.4.4 (Success Criterion) requires that text can be resized to 200% without loss of content or functionality. Preventing zoom with `user-scalable=no` in the viewport meta tag is a direct WCAG violation. Designs must function at high zoom levels; this is a design constraint, not an implementation detail to resolve in CSS.

Design rule: no design decision should rely on content being viewed at its exact designed size. Specify what happens to navigation, data tables, and forms at 200% zoom.

### Browser-native form behavior

Browser-native forms provide: submit on Enter key, Tab navigation between fields, browser autofill, password manager integration, native date/time pickers on some platforms. Designs should work *with* these behaviors, not override them.

Design rule: never specify a custom Enter key handler that submits a form before the user has navigated to the intended final field. Never specify that Tab order should not match the visual reading order. Never design an input that blocks autofill for normal data (address, name, email, password).

### Refresh behavior

Users press F5 to refresh when they are confused about why something looks wrong or suspect stale data. Refreshing should return the user to approximately the same state. If the URL reflects the full state, refresh restores it automatically. If critical state lives only in component memory, the user loses it on refresh.

Design rule: specify what state is URL-persistent (restored on refresh), what is session-persistent (stored in sessionStorage, survives tab reload but not new tab), and what is intentionally ephemeral (lost on refresh).

---

## Document-Model vs App-Model Web

This is the first question to answer when receiving a web UI brief. The two models produce fundamentally different user expectations and require different design conventions.

### Document-model (multi-page applications — MPA)

Each meaningful state is a distinct URL with a full page load. The browser shows its loading indicator (spinner in tab, progress bar in some browsers). Back button always works predictably. Session state lives primarily on the server.

**User expectations:**
- Clear navigation hierarchy with consistent landmarks
- Breadcrumbs that reflect true hierarchy (not just navigation history)
- Page-level error states (404, 500 pages that help the user continue)
- Back button returns to the previous page as it was

**Design problems to solve:**
- Consistent navigation landmarks across all pages
- How to handle state between pages (shopping cart, search filters, form state)
- Pagination (not infinite scroll) for content users need to refind
- Page-level error design for 404, 403, 500, service-unavailable

**When MPA conventions apply even to SPAs:**
Multi-step services (checkout, onboarding, complex forms) use document-model conventions even when implemented as a SPA. The GOV.UK "One Thing Per Page" pattern is document-model: each page asks exactly one question, Back restores the previous answer, each step has a distinct URL. This produces predictable, accessible experiences even for users with slow connections or assistive technology.

### App-model (single-page applications — SPA)

The JavaScript application replaces DOM content without page loads. The URL must still update on every meaningful navigation (pushState). Loading states are the application's responsibility. Focus management after navigation is the application's responsibility — the browser does not auto-scroll or reset focus on client-side navigation.

**User expectations:**
- Instant or near-instant state changes (the SPA promise)
- Persistent application context across view changes (sidebar state, selected item, notifications)
- Loading states that clearly communicate what is being fetched

**Design problems to solve (beyond MPA):**
- Loading states for every async operation — the browser provides none
- Focus management after route changes — keyboard and screen reader users remain focused at the navigation trigger element unless the design moves focus explicitly
- Where focus goes after navigation: to the new page's `<h1>`, to a designated skip target, or to the first interactive element
- Stale data handling — the app may show data cached from the last fetch; design must communicate currency
- Network failure during navigation — the user initiated navigation, the fetch failed; design must handle this gracefully, not leave the user in a broken intermediate state

### Hybrid models

Many web applications blend both models: a largely MPA e-commerce site with SPA-style cart interactions; a mostly-SPA dashboard that opens document-model content in context. The design obligation when blending: be consistent within each context. When the user is in the MPA layer, MPA conventions apply. When in the SPA layer, SPA conventions apply. Mixing them (SPA navigation that sometimes does and sometimes doesn't update the URL) breaks user mental models.

---

## Navigation Models for Web

Four primary navigation models — each appropriate for different information architectures. Choose one deliberately; using multiple within one application requires explicit reasoning.

### Hierarchical (tree-based)

Breadcrumbs + left sidebar or top navigation. Appropriate when content has a clear parent-child structure.

**Use when:** Documentation, product category browsing, file explorer, settings organized by category.

**Design constraints:**
- Each navigation level must be named consistently — a user who sees "Settings > Account > Security" expects that Security belongs to Account which belongs to Settings
- Breadcrumbs must reflect true hierarchy, not navigation history — the difference matters when users reach a page by search rather than by drilling down
- The depth must be perceptible: users need to know how deep they are, how to go up, and how to navigate laterally at the current level

**Failure mode:** Deep hierarchies where users cannot tell how far they are from the top, or where the breadcrumb becomes too long to read at mobile width.

### Flat (hub-and-spoke)

Tabs or icon navigation at top or bottom. All sections of equal weight, one tap away from each other. Appropriate for applications with 4-7 distinct areas.

**Use when:** Gmail-style applications (Inbox, Sent, Drafts, Settings), admin dashboards with independent sections.

**Design constraints:**
- The hub must always be visible or reachable in one gesture — never buried
- Spoke navigation must return cleanly to the hub without losing spoke state
- Adding more sections than the navigation can accommodate without redesigning it forces an unplanned hamburger menu

**Failure mode:** Flat nav that quietly grows past 7 items, forcing the last items into a hidden overflow — the most important items should be the visible ones, not the ones that happened to be added first.

### Sequential (wizard/stepper)

Step indicator + linear progression. Appropriate when users must complete steps in order.

**Use when:** Checkout flows, onboarding sequences, multi-step forms where each step builds on the previous.

**Design constraints:**
- Users must always know: how many steps total, which step they are on, which steps are complete
- Step labels must name what happens in that step, not just "Step 1", "Step 2"
- Back navigation must restore previous answers without clearing them — a user who goes back to check a previous answer should not have to re-enter everything
- Allowing forward navigation to a step before completing the current one: only if the steps are independent; otherwise, lock forward navigation until the current step is valid

**Failure mode:** A wizard with no progress indicator, or one that loses the user's input when they navigate back.

### Search-first

Minimal navigation structure; search bar is the primary entry point. Appropriate when the content corpus is too large for hierarchical browsing.

**Use when:** Large library apps, knowledge bases with thousands of articles, product catalogs with many categories.

**Design constraints:**
- Search results must show context (where does this item live in the hierarchy?)
- Zero results must provide guidance — not just "no results found" but suggestions for broadening the search or navigating to related content
- Filtering and sorting must be accessible directly from search results without losing the query
- Must have fallback navigation for users who cannot formulate the right search terms

**Failure mode:** Search-first with no fallback — users who don't know what to search for are stranded.

### Mobile navigation patterns

Navigation patterns change at mobile breakpoints because screen width cannot accommodate desktop navigation.

**Hamburger menu on mobile:** Acceptable when there are more navigation items than fit on screen. Usability cost: hidden navigation reduces task completion speed (NN/G Pernice & Budiu 2016 study: 15% slower on mobile). Mitigate by placing the most-accessed items visibly and putting only secondary navigation behind the hamburger.

**Bottom navigation bar:** Appropriate for mobile apps with 3-5 primary sections. Thumb-accessible. Appropriate for apps where users frequently switch between sections during a session.

**Do not:** Use a hamburger menu on desktop. NN/G quantitative study (n=179): hidden navigation on desktop produced 27% navigation usage vs 48-50% for visible navigation, 39% slower task completion, and content discoverability cut nearly in half.

---

## URL Design as UX

The URL is a first-class UX object. Professional web UI designers model URL structure as a first design step — not a detail left to implementation.

### What state belongs in the URL

**Always URL-encode:**
- The current view or route (which page the user is on)
- Filter and sort state for data tables — so filtered views are shareable
- Search queries — so search results are shareable and bookmarkable
- Selected record or item ID when it is the primary content of the view
- Active step in a multi-step form — so back button works and deep-linking into a step is possible

**Optionally URL-encode:**
- Active tab within a page (if users would want to share a specific tab view)
- Modal content that is meaningful in its own right (a settings panel, a detailed view)

**Do not URL-encode:**
- Transient UI state (which tooltip is visible, which row is hovered)
- Ephemeral form values (a partially typed search query)
- State that is personal and non-shareable (unsaved document changes)

### URL conventions

**Readable paths over opaque IDs where users read them:** `/settings/billing` is preferable to `/v2/ui/9f2a1c` when the path is something users see in their address bar. Opaque IDs are fine for resource identifiers that are never seen (API endpoints, deep link targets that open an app, not a page).

**Deep linking:** every meaningful part of the application should be linkable. A user who wants to share their current view with a colleague should be able to copy the URL. A design that fails this test has inadequate URL architecture.

**URL as navigation history:** when the user presses Back, what should they see? This is a design decision. Specify it explicitly for every navigation action in an SPA.

---

## Form Design as Primary Web Interaction

Forms are the dominant mechanism by which web applications collect user intent and data. They deserve first-class design attention — not "add a form here."

### Label placement

**Top-aligned labels (recommended for most cases):** Labels sit above the input field. Universally readable, handles long labels without wrapping issues, works on mobile. Source: NN/G eye-tracking research on form scanning.

**Left-aligned labels:** Acceptable for very short, simple desktop forms only. Problematic at mobile breakpoints (labels and inputs must stack or the inputs become too narrow).

**Placeholder-as-label (anti-pattern):** When the user starts typing, the label disappears. The user must clear their input to remember what the field requires. Placeholder text has lower contrast than label text. Source: NN/G "Placeholders in Form Fields Are Harmful" (Sherwin). The rule: placeholders may provide example values or formatting hints, but never substitute for a persistent label.

### Input type selection

Choose the right input type for the information requested. Browser-native input types provide free accessibility, autofill integration, mobile-optimized keyboards, and format validation:

- `type="email"` — email address; triggers email keyboard on mobile, browser validates format
- `type="tel"` — phone number; triggers numeric keyboard on mobile
- `type="number"` — numeric value; use with `min`, `max`, `step` constraints; avoid for phone numbers or formatted numerics (use `type="tel"` or `type="text"` with pattern)
- `type="date"` — date selection; native date picker on mobile
- `type="password"` — password; masked input, password manager integration
- `type="search"` — search input; may show a clear button natively, semantic meaning for assistive technology

Use `<select>` for mutually exclusive options when the list is long (>5 items); use radio buttons when the list is short (≤5 items) and comparison between options is important.

### Validation timing

**Validate on submit, not on blur for most cases.** Triggering validation when the user moves away from a field creates anxiety and premature error messages before the user has finished their thought. GOV.UK Design System explicitly states: "Do not validate when the user moves away from a field. Wait until they try to move to the next part of the service."

**Exception — format validation on blur:** For fields where format is verifiable before submission (email format, postal code format), showing a gentle hint on blur is acceptable — but only after the user has had a full opportunity to type the complete value. Never show an error while the user is still typing.

**Exception — character count:** When there is a hard character limit with severe consequences (a social media post length, a title field length), showing a count as the user types is appropriate.

**Never validate on keyup** for error messages. The user is in the middle of typing; an error message for an incomplete value interrupts and frustrates. Live hints (remaining character count, password strength meter) are acceptable because they are positive guidance, not error states.

### Error presentation

The error pattern that works — verified by GOV.UK Design System, USWDS, and ARIA authoring practices:

1. **Error summary at top of page or form.** A summary listing all validation errors, appearing when the user submits a form that fails validation. The summary contains links to the specific fields that failed.
2. **Move keyboard focus to the error summary** when it appears. Without this, keyboard users and screen reader users do not discover that the form has errors — they submitted and nothing seems to have happened.
3. **Individual field-level error messages** appear below each invalid field (not above, not in a tooltip — below, where the user's eye is after typing). Messages must say what is wrong and how to fix it.
4. **Preserve all user input** on validation failure. Never clear fields on error. The user typed that content; make them correct it, not retype everything.
5. **"Error:" prefix in the page `<title>`.** Screen readers read the page title on load. Adding "Error: Form name" prefix to the title causes screen readers to announce the error state immediately when the page reloads after a failed submission.

Error messages must specify what went wrong and how to fix it. "Invalid" is not an error message. "Enter an email address in the format name@example.com" is.

### Multi-step forms

When a form is too complex to complete in one step, break it into steps using the sequential (wizard) navigation pattern.

**Breaking principle:** each step should ask one logical question or a tightly related group of questions. GOV.UK's "One Thing Per Page" principle: grouping questions produces forms where users feel they are making progress without becoming overwhelmed.

**Back navigation must restore previous answers.** If the user advances to step 3 and returns to step 1, they should see their original answers. A wizard that clears previous answers on back navigation breaks trust and wastes the user's time.

**Progress indication is required.** Users must know how many steps remain. "Step 3 of 5" or a step indicator with named steps. Without this, users cannot assess whether completing the form is worth their time.

**Save-as-draft for long forms.** For forms that take substantial time (an application form, a complex configuration), offer save-as-draft for authenticated users. Losing a long form due to a session timeout or accidental navigation is a high-severity UX failure.

**Confirmation step:** for destructive or irreversible actions, include a "Check your answers before submitting" step. GOV.UK research validated this pattern for reducing errors on consequential forms.

---

## State Management as Design Concern

Every asynchronous operation requires a designed state. Production web applications spend more design time on states than on happy-path layouts.

### Loading states

**What every async operation needs:**
- An immediate acknowledgment that the action registered (within ~100ms)
- A loading state if the response takes more than ~1 second
- A timeout or failure state if the response is unexpectedly slow

**SPA-specific loading problem:** In MPAs, the browser provides its own loading indicator (spinner in tab, progress bar). In SPAs, none of this exists. The application must provide its own. An SPA that shows no loading state while fetching data fails the "did it freeze?" test — users click again, doubling the request load.

**Skeleton screens vs spinners:** For content that has a known shape (a card list, a data table), skeleton screens (placeholder shapes) are preferable to spinners. They orient the user to what is loading and feel faster. Use spinners for operations without a known output shape.

**Progress for long operations:** A spinner communicates "something is happening" but not "how long." Operations expected to take more than 10 seconds need a progress bar or step indicator, not just a spinner.

### Empty states

An empty state is what the user sees before any data exists — first-time user, empty search results, no content yet created. Empty states must be **designed**, not accidental.

A designed empty state:
- Tells the user why there is nothing (new account, no matches, empty category)
- Tells them what to do next (call to action, search suggestion, navigational cue)
- Does not look like an error or a broken page

The default — a blank area where content would be — is a failure state even when technically correct.

### Error states (web-specific taxonomy)

Every data-fetching view and every form has multiple failure modes. Each requires a distinct design:

| Error type | Design obligation | Failure if undesigned |
|---|---|---|
| **Network error** | Preserve user input, explain what happened, offer retry | User loses form content, sees generic "error" |
| **Validation error (client)** | Field-level errors before submission, focus on first error | User doesn't know which field failed |
| **Validation error (server)** | Error summary + field errors on return, preserve input, move focus | User re-enters all data |
| **Not found (404)** | Help the user continue — links to useful content, search | User abandoned at dead end |
| **Unauthorized (403)** | Explain what they lack, how to get access or where to go | User confused about whether they are in the right place |
| **Service unavailable (5xx)** | Assure data safety, give retry timing if known | User loses trust; does not know if their action completed |
| **Empty state** | Orient user, provide call to action | User thinks the app is broken |

### Optimistic updates

An optimistic update shows the result of an action before the server confirms it — the list item disappears immediately on delete before the server responds.

**When appropriate:** Fast, reversible, high-confidence operations (liking a post, reordering a list, marking a task complete). The user perceives instant response; most operations succeed; failures are gracefully corrected.

**When not appropriate:** Operations with significant side effects (sending an email, making a payment, irreversible deletes). The user must see actual confirmation from the server before treating the operation as complete.

**Design obligation for optimistic updates:** specify what happens when the optimistic update fails — the server rejected it or a network error occurred. The UI must roll back and notify the user clearly. A silent rollback is worse than no optimistic update.

### Stale data

Web applications cache data. The user may be viewing data that has changed since it was fetched. Design must communicate staleness when it matters.

**When staleness matters:** Collaborative applications where multiple users edit the same data; financial data with time-sensitive values; inventory with limited availability.

**Design patterns for staleness:** "Last updated X minutes ago" indicators, automatic background refresh with subtle notification, explicit "Refresh" button with last-updated timestamp.

---

## Responsive Interaction Design

Responsive design is not layout scaling. At mobile breakpoints, the **interaction model itself changes**. Hover is unavailable. Touch targets must grow. Two-column layouts collapse, requiring different navigation hierarchies. Touch-specific gestures appear.

Specifying responsive breakpoints as pure layout changes — "at 768px, move the sidebar to bottom" — without addressing the interaction changes is an incomplete spec.

### Desktop vs mobile interaction model

| Desktop | Mobile web |
|---|---|
| Hover states available — `:hover`, tooltips reveal on cursor approach | No hover; touch requires a tap to reveal anything |
| Mouse click — precise, small targets acceptable | Touch tap — minimum 44×44px target (WCAG 2.5.5) |
| Multiple columns visible simultaneously | Single column; context outside viewport requires scroll |
| Sidebar navigation always visible | Sidebar must collapse or become bottom navigation |
| Dense data tables render legibly | Tables must scroll horizontally or reformat to cards |
| Drag-and-drop with mouse | Drag-and-drop unreliable on touch; need alternative interactions |

### Touch target sizing

Minimum 44×44 CSS pixels for touch targets — this is WCAG 2.5.5. This is an interaction design decision, not a CSS detail. Interactive elements that are smaller require precision the human thumb cannot reliably provide; users tap neighboring targets, producing errors and frustration.

Interactive elements near the edges of the screen must account for thumb reach zones. Thumb zones on a right-handed user: comfortable in the bottom center, difficult in the top corners. This is why bottom navigation bars are thumb-accessible and why top-corner close buttons on mobile require more effort.

### Hover as an interaction pattern

Hover states that reveal content — row action buttons, tooltip content, dropdown triggers — are inaccessible on touch and must not be the **only** affordance for that content.

**Anti-pattern:** a data table where the edit and delete buttons appear only on row hover. On touch, the user cannot hover; the buttons are permanently hidden.

**Design rule:** hover may *enhance* an interaction (revealing additional context, showing a tooltip) but must never be the **only** way to access functionality. Every hover-revealed action must be reachable by touch (tap on row to reveal, explicit action buttons always visible, long-press alternative, swipe gesture).

### Swipe gestures

On iOS, the browser itself uses swipe-left and swipe-right for back/forward navigation. Custom swipe interactions in web apps can conflict with browser navigation. Design must account for this:

- A custom swipe-to-dismiss interaction on a full-width card will compete with the back swipe gesture
- Solution: design custom swipe interactions for elements that do not span the full width, or provide an explicit close button as the primary interaction

### Context-sensitive breakpoints

Specify not just what content moves at each breakpoint, but what **functionality** changes:

- At mobile: which column of a two-column table is primary and which is hidden by default?
- At mobile: does the data table become a card list? What card fields are shown vs hidden?
- At mobile: does multi-select become single-select? What happens to bulk actions?
- At mobile: does the secondary navigation move from a sidebar to a slide-in panel? What opens it?

---

## Web Accessibility Interaction Patterns

Beyond WCAG color contrast and alt text (which belong to `accessibility-design`), web UI design has specific interaction-pattern concerns that must be designed, not implemented by default.

### Focus management in SPAs

When a SPA changes route without a page reload, the browser does not move focus. Keyboard and screen reader users remain focused at the navigation trigger element — the link or button they just pressed. They do not know the page has changed.

**Design specification for every SPA route change:**
- Where does focus move after navigation? Options: the new page's `<h1>`, a skip-link container, the first interactive element in the main content area, an announced region that names the new page
- Common pattern: move focus to the `<h1>` of the new page, which causes screen readers to read the page name and contextualizes the new content

**Modal focus management (required by WCAG 2.4.3):**
- When a modal opens: move focus to the first interactive element inside the modal, or to the modal container itself
- While a modal is open: trap focus — Tab and Shift+Tab must cycle within the modal boundary; focus must not escape to the page behind
- When a modal closes: return focus to the element that triggered it

**Inline state changes:** when a section of the page updates without navigation (search results, filter changes, tab content), specify whether focus should move and where.

### ARIA live regions

Dynamic content that updates without a page load must be announced to screen reader users. ARIA live regions are the mechanism.

**Design must specify:**
1. What content changes need announcement?
2. What is the urgency of the announcement?
   - `aria-live="polite"`: announces after current speech ends — non-urgent updates (new item loaded, search results updated, toast notification)
   - `aria-live="assertive"`: interrupts current speech — urgent, critical information only (payment failed, session about to expire, destructive action confirmation)
3. What text is announced? The live region's visible text content is announced; ensure it is meaningful without visual context

**Common live region use cases:**
- Toast notifications (polite) — "Item saved successfully"
- Loading state completion (polite) — "Search results loaded, 24 items"
- Form submission errors (polite for summary, assertive for critical failures) — "Form submission failed: 3 errors found"
- Real-time updates in collaborative apps (polite) — "Jane edited this document"

**Do not overuse assertive live regions.** An assertive announcement interrupts whatever the screen reader user is doing. Reserve it for information that genuinely cannot wait.

### Skip navigation link

The first interactive element on every web page should be a skip navigation link: a link that jumps focus to the main content, bypassing repeated navigation. Keyboard users who tab through navigation on every page load would otherwise have to press Tab many times to reach page content.

**Design specification:**
- The skip link is always the first focusable element
- It may be visually hidden until it receives focus (visible-on-focus pattern)
- The link text must be descriptive: "Skip to main content" (not "Skip navigation" — some users don't know what navigation means)

### Form accessibility

Every input element requires a persistent, visible label. Placeholder text is not a label.

**Programmatic association:** labels and error messages must be associated with their fields programmatically, not just visually adjacent. This means `<label for="...">` or `aria-labelledby`, and error messages referenced with `aria-describedby`. A field without programmatic association is inaccessible to screen readers even if it looks correct visually.

**Required fields:** indicate which fields are required. Either mark all required fields explicitly (asterisk with legend, or text), or mark optional fields and treat everything else as required. Do not use color alone.

---

## Anti-Patterns (Web-Specific)

These patterns appear frequently and have quantified or documented negative UX impact. Do not use them without compelling justification specific to the product.

### Hamburger menu on desktop

NN/G quantitative study (Pernice & Budiu, 2016, n=179): hidden navigation on desktop produced 27% navigation usage vs. 48–50% for visible navigation, 39% slower task completion, and 21% higher perceived difficulty rating. Content discoverability cut nearly in half.

Not acceptable for desktop when sufficient screen width exists for visible navigation. Acceptable on mobile when navigation items exceed screen width capacity.

### Infinite scroll for refindable content

NN/G (Neusesser, 2022): infinite scroll prevents refinding content because no landmarks exist. Back button returns to top of the feed, not to the previous position. Creates false impression that all content has been seen. Makes footer inaccessible. Fails keyboard and screen reader users who cannot navigate a dynamic, unbounded list.

Acceptable for social media feeds and entertainment content where discovery is the purpose and the user has no intent to return to a specific item. Not acceptable for product catalogs, search results, email, or any content where users compare items or return to specific items.

### Placeholder-as-label on form inputs

When the user starts typing, the label disappears. The user must clear their input to see what the field required. Placeholder text has lower contrast than label text. This is a known anti-pattern with documented user confusion. Always use a persistent label.

### Disabling browser defaults

- `user-scalable=no` in viewport meta: violates WCAG 1.4.4; breaks pinch-to-zoom for users with low vision. Never justified.
- Overriding context menu (`contextmenu` event prevention): removes native browser functionality (link copying, save image, translate). Justified only for canvas-based creative applications where the browser context menu interferes with custom drawing tools.
- Preventing text selection: breaks copy-paste, screen reader selection. Not justified.

### Modal abuse

NN/G (Fessenden, 2017): modal dialogs are justified for irreversible destructive actions (confirm before permanent delete), information critical to continuing the current process, and security interruptions (session expired, permission request). Not justified for newsletter signups, optional recommendations, non-critical interruptions. Modal overuse trains users to dismiss dialogs without reading them.

Prefer inline presentation, contextual panels, or new routes over modals for optional content.

### SPAs that break the back button

Client-side routing that does not push to browser history breaks the most-used browser affordance. State that lives only in component memory and is not reflected in the URL is lost when the user shares a link or opens in a new tab. This is a design failure — a specification gap — not solely an implementation problem. The specification must require correct URL state management.

### Validate-on-blur

Triggering validation error messages when the user tabs out of a field interrupts the form-completion flow before the user has had a complete opportunity to consider their input. Creates anxiety for slow typists and users with cognitive disabilities. Validate on submit; provide format hints, not error messages, before submission.

### Color-only form validation

A red input field border without a visible error message fails WCAG 1.4.1 (use of color). Users who cannot perceive color differences (approximately 8% of males with red-green color vision deficiency) see the field as normal. Always pair color with a visible, programmatically-associated error message.

---

## AI-Agent Adaptations

When a Designer AI agent applies this skill:

**State the document/app model first.** Before any navigation or URL decisions, establish whether the design is MPA or SPA. An incorrect assumption propagates through the entire design.

**Specify URL structure explicitly.** Do not leave URL design to implementation. The Design Spec must name which application states have URLs, what the URL structure is (path components, query parameters, fragment), and what the back button should produce.

**Design all six error-state types for every data-dependent view.** An AI agent that designs only the happy path is producing an incomplete spec. Every async operation, every form, every data table needs all failure states specified.

**Specify focus placement for every navigation and state change.** Keyboard interaction and focus management cannot be left to Worker's judgment. The spec must name where focus goes after: route changes, modal open, modal close, form submission (success and error), inline content updates.

**Specify touch alternatives for every hover-only interaction.** Every interaction that relies on hover must have a touch-accessible alternative. Name it explicitly.

**Conservative default: trust the browser.** When in doubt, do not override browser defaults. Native `<dialog>` is more accessible than a custom modal. Native `<form>` submit behavior is more robust than custom submit handlers. Native `<select>` works with every keyboard, screen reader, and platform. Custom components require specifying every interaction behavior the browser would otherwise handle.

---

## References

| Source | What it covers |
|---|---|
| Nielsen Norman Group — Web UX (nngroup.com/articles/) | Browser-specific UX research, navigation studies, quantitative usability findings |
| GOV.UK Design System (design-system.service.gov.uk) | Interaction patterns verified by user research: form design, validation, error patterns, "One Thing Per Page" |
| WAI-ARIA Authoring Practices Guide (w3.org/WAI/ARIA/apg/patterns/) | Keyboard interaction patterns, focus management, ARIA roles — the authoritative reference for accessible web components |
| WHATWG HTML Living Standard (html.spec.whatwg.org) | Browser-native behavior and what the browser does by default |
| US Web Design System / USWDS (designsystem.digital.gov) | Federal design patterns with accessibility research |
| NN/G Form Design — Whitenton 2016 (nngroup.com) | 10 empirically tested form design recommendations |
| NN/G Infinite Scrolling — Neusesser 2022 (nngroup.com) | Anti-pattern evidence, pagination vs infinite scroll decision framework |
| NN/G Hamburger Menus — Pernice & Budiu 2016 (nngroup.com) | Quantitative study of hidden navigation cost on desktop and mobile |
| NN/G Modal Dialogs — Fessenden 2017 (nngroup.com) | When modal dialogs are justified vs harmful |
| WCAG 2.1 (w3.org/TR/WCAG21/) | Web Content Accessibility Guidelines — 1.4.4 (zoom), 1.4.1 (color), 2.4.3 (focus), 2.5.5 (touch target size) |

---
