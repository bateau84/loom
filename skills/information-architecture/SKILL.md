---
name: information-architecture
description: Structural organization of information, commands, and concepts — independently of visual form. Use when a problem involves organizing more than a handful of concepts, commands, or content items; when users need to navigate or find things; or when the structure of a system is unclear. Not for visual presentation of structure (→ `visual-interface-design` or surface skills), task-step sequencing (→ `user-flow-design`), per-action interface response (→ `interaction-design`), or single-view problems with no navigation requirements.
metadata:
  version: "1.0.0"
---

# Information Architecture

## What this skill is for

Information architecture (IA) is the structural discipline that determines what exists in a system, how it is grouped and related, what it is called, and how users traverse it. IA is invisible to users — they do not see the taxonomy — but it determines what they can find and what mental model they form of the space they are navigating.

**Load this skill when:**
- Organizing more than a handful of concepts, commands, or content items
- Users need to navigate or find things within a system
- The structure of an application, CLI, or TUI is unclear or growing inconsistently
- Command names, subcommand groupings, or help text organization feels wrong
- A redesign requires reorganizing content that users currently cannot find
- Labels or category names are causing user confusion

**Do NOT load this skill when:**
- The problem is a single view with no navigation requirements — go directly to `interaction-design`
- The problem is about visual presentation of a known structure — that belongs to `visual-interface-design` or the appropriate surface skill
- The content or commands are already well-organized and the problem is purely about how users interact with them — that belongs to `interaction-design`

**Boundary:**
- Not for: visual presentation of structure — menu bars, nav bars, visual hierarchy (→ `visual-interface-design`, surface skills)
- Not for: task-step sequencing — the order in which users complete a workflow (→ `user-flow-design`)
- Not for: per-action response — what happens when the user clicks a navigation item (→ `interaction-design`)
- Not for: implementing navigation code (→ `golang-cli`, `golang-tui`, `design-implementation`)

**Boundary tests (use these to resolve ambiguity):**
- "Should this feature be a subcommand or a flag?" → `cli-design` (interaction detail, not structure). "Should `deploy` live under `app` or at the top level?" → IA (namespace structure).
- "What key binding moves between TUI panes?" → `tui-design`. "What panes exist and how do they relate?" → IA.
- "Should the nav be a horizontal bar or a sidebar?" → `visual-interface-design`. "What goes in the top-level navigation?" → IA.
- "In what order does the user visit these sections?" → `user-flow-design`. "What sections exist and what do they contain?" → IA.

---

## The four-component model

IA owns four simultaneous concerns. Every IA decision touches at least one; most touch several.

| Component | What it owns | Failure when absent |
|---|---|---|
| **Organization** | How content/commands are grouped and related | Users cannot predict where to look for something |
| **Labeling** | What groups and items are called | Users cannot tell what a category contains before entering it |
| **Navigation** | How users traverse the structure | Users get lost, cannot return, or miss large sections |
| **Search** | How users query the structure directly | Users who cannot browse also cannot find |

The four components are interdependent. An excellent organization scheme with poor labeling fails (users cannot tell where to click). An excellent labeling scheme over a poor organization fails (clear names for the wrong groupings). IA practice addresses all four.

---

## Organization systems

### Exact schemes — when users know what they want

Exact organization schemes allow users who know what they are looking for to find it directly:

- **Alphabetical** — works for reference content where users know the name of what they seek: API documentation, command-line flag references, glossaries. Fails for browsing — a user who does not know the name cannot use alphabetical order to discover options.
- **Chronological** — works for time-ordered content: logs, changelogs, event histories, message streams. The user's query is "what is most recent" or "what happened on this date."
- **Numerical/sequential** — works for step-based content: tutorials, onboarding sequences, release versions. The user's mental model is "where am I in the sequence."

Exact schemes fail for discovery. Users must already know what they are looking for to use them. Use exact schemes as supplemental navigation (a log sorted chronologically) or as a search result ordering — not as the primary organization scheme for a system users must browse.

### Ambiguous schemes — when users are exploring

Ambiguous schemes support browsing and discovery, but require that the groupings match users' mental models — not the system's internal structure:

- **Topical** — groups content by subject area. Works when topics map to user mental models. Fails when topics mirror product architecture rather than user concerns.
- **Task-based** — groups content by what users are trying to do. Works when the task vocabulary is known and shared. Fails when tasks are too granular (one category per task step) or too broad (all "settings" in one place). The key test: does "deploy my application" map to one coherent section, or does the user have to visit three different areas?
- **Audience-based** — groups by user type ("Administrators / Developers / End Users"). Works only when user types are mutually exclusive and each type's content is genuinely non-overlapping. Nielsen Norman Group identifies this as a primary navigation anti-pattern: users who span categories (e.g., a developer who also administers) must choose arbitrarily, and users who are uncertain of their category cannot find content they do not know exists.
- **Metaphor-based** — maps the system to a familiar physical or conceptual space ("Inbox / Drafts / Sent"). Works when the metaphor is universally understood and accurately predicts where items live. Fails when the metaphor breaks down at the edges (where does a draft that has been sent but not delivered go?).

Most real systems blend exact and ambiguous schemes: the primary navigation is task-based; within a section, items are listed alphabetically; search supplements both.

### The hierarchy depth vs. breadth trade-off

Every taxonomy is a tree with nodes at different levels. Each level adds cognitive load. The practical tension:

**Too deep** — users get lost in branching. When the taxonomy is five levels deep to reach a leaf node, users lose track of where they are relative to where they want to be. They cannot hold five nested categories in working memory simultaneously. They abandon and use search.

**Too wide** — users experience scan failure. When a single level exposes more options than users can process in a single visual pass, they miss the correct option even when it is present. Showing 30 subcommands at once produces worse findability than 8 subcommands organized into 4 groups of 2.

**The empirical reality:** The "3-click rule" — that all content must be reachable in 3 clicks — has no empirical support and is widely disproven. Nielsen Norman Group (Whitenton, 2013) found that what matters is whether users feel they are making progress toward their goal, not the literal number of steps. A 4-click path where each step is clearly right feels better than a 3-click path where one step is uncertain.

**Practical guidance for depth vs. breadth:**
- When categories are distinct and recognizable, prefer broader and shallower. Users can scan a list of 8 clear options faster than navigating 3 levels of 3 options.
- When showing all options at once would overwhelm, prefer deeper and narrower — but add supplemental navigation (shortcuts, search) to allow jumping across levels.
- The signal for "too deep": users use search even for content they know exists, because they cannot reliably navigate the tree.
- The signal for "too wide": analytics shows high exit rates from navigation pages with no content pages visited — users are scanning and not finding.

### Faceted classification — when hierarchy is too rigid

Strict hierarchies force items into one category. Real content often belongs to multiple categories simultaneously: a configuration flag that is both "authentication" and "security" and "advanced." A product that is both "red" and "under $50" and "a blouse."

**Faceted classification** allows users to filter across multiple independent dimensions (facets) simultaneously. Each facet is a controlled vocabulary. Users build their own view by combining facets.

When to use facets:
- Items legitimately belong to multiple categories (not an edge case — a significant portion of items)
- Category membership is context-dependent (the user's current task changes which category is relevant)
- The item set is large enough that strict hierarchy produces pages with one or two items per leaf node
- Users approach items with varied, independent questions ("give me red blouses under $50" — three independent facets)

**CLI application:** `git log --author --since --grep` is faceted filtering applied to a commit log. Each flag is an independent facet. Users can combine any subset.

**TUI application:** A package manager's list view filtered by `installed/not-installed`, `outdated/current`, and `name prefix` is faceted navigation within a flat list.

### Polyhierarchy — deliberate, not accidental

Polyhierarchy is placing an item in multiple locations in the hierarchy simultaneously. A "Men's Running Shoe" appears under both "Men's Footwear" and "Running Equipment."

Use polyhierarchy deliberately for high-priority ambiguous items where users can predictably approach from two different navigation paths. Do not use it globally — maintaining synchronized entries across two locations is a maintenance cost that compounds as the content grows.

**CLI example:** `git remote set-url` is discoverable from both `git remote --help` (management of remotes) and `git remote set-url --help` (changing a remote's URL). The duplication is intentional: users approaching from "I need to manage my remote" and users approaching from "I need to change this URL" both arrive.

---

## Labeling systems

### What labels are

Labels are the language the system uses to describe itself. They are the critical interface between the system's organizational model and the user's mental model. A label works if it creates accurate expectations before the user commits to a navigation action — this property is called **information scent**.

Users will not click on a category unless they can predict what they will find inside it. A label with low information scent produces avoidance: users scan past it, do not find what they need, and conclude the system does not have what they want — even when it does.

### Controlled vocabulary

A controlled vocabulary is a predefined, standardized set of labels that describe and classify content consistently across a system. The same concept always uses the same term.

Why consistent labeling matters:
- Users build mental models around vocabulary. When the same action is called "Archive" in one section and "Deactivate" in another, users assume they are different actions.
- Inconsistent labeling produces support burden: users ask "what's the difference between Archive and Deactivate?" even when there is none.
- Inconsistent labeling in a CLI produces muscle memory failures: developers scripting the system must look up which verb applies where.

The controlled vocabulary is a living document, not a one-time decision. Adding new content or commands requires checking the vocabulary before naming them. Labels are not changed arbitrarily — users will have built their workflows around existing vocabulary, and renaming without migration paths is a breaking change.

### How to evaluate labels

Apply these tests to any candidate label before accepting it:

**1. Does it use the user's language or the system's language?**

The system's internal vocabulary — module names, entity types, database table names, service names — is not user vocabulary. Users think in terms of their goals and domain concepts, not the system's implementation.

| System vocabulary | User vocabulary |
|---|---|
| `entity_relationship_manager` | Contacts |
| `fiscal_period_code` | Billing period |
| `deployment_target_descriptor` | Environment |
| `proc` | Process |

**2. Does it differentiate clearly from adjacent labels?**

Adjacent labels in the same navigation level must be distinguishable without clicking into them. If two labels could plausibly contain the same item, the taxonomy is ambiguous.

**3. Does it create a specific expectation?**

Generic verbs ("Explore," "Discover," "Learn," "Manage") create no expectation about what users will find. Domain-specific nouns or verbs ("Deploy," "Configure authentication," "View logs") create concrete expectations.

**4. Is it the term the user would search for?**

If a user wanted this thing and typed a search query, what words would they use? The navigation label should match those words, not a synonym that the team uses internally.

### Label failure modes

**Jargon labels** — system terms users do not know. `proc`, `namespace`, `daemon`, `entity`, `artifact`, `principal`. Each requires the user to learn the system's vocabulary before they can navigate it. When jargon is unavoidable (domain-specific terms with no everyday synonym), it must be introduced before it appears as a navigation element.

**Ambiguous labels** — multiple valid interpretations. "Resources" could mean documentation, compute resources, external links, or team headcount depending on context. When a label has multiple interpretations that vary by audience, it fails all audiences. The "Mystery Meat Navigation" anti-pattern (named by Vincent Flanders) describes navigation where users cannot predict what is behind a link before clicking.

**Abstract labels** — no concrete referent. "Solutions," "Services," "Insights," "Platforms" are marketing vocabulary, not navigation vocabulary. They describe the business concept, not the user's task. Users looking for "how to configure authentication" will not know whether to look under "Solutions" or "Services."

**Forced-parallel labels** — categories that do not naturally parallel each other, given identical grammatical structure to create visual symmetry. When the content does not parallel, the labels will be vague enough to accept it. The result is labels that are grammatically consistent but semantically empty.

**Trendy labels** — will date badly and violate users' established mental models when the trend passes. Language that reads as contemporary UX copy in 2024 may read as dated in 2030.

### CLI labeling — the noun/verb grammar

CLI command names are labels. The same information-scent principle applies: a command name must create accurate expectations before the user runs it.

**Noun-verb grammar** (preferred by most major CLIs): The primary object comes first, then the action. `git remote add`, `docker container run`, `kubectl pod delete`. Users who understand the object model can predict commands: "I'm working with `pod`s, I want to `get` one."

**Verb-noun grammar**: The action comes first. `create user`, `list deployments`, `delete config`. More imperative and readable in isolation, but harder to group in `--help` output — all `create` commands are listed together regardless of what they create.

**Consistency is more important than the choice.** A system that uses noun-verb for some commands and verb-noun for others forces users to check the grammar for each command rather than predicting it.

**Subcommand labeling tests:**
- Can a user predict what `my-cli resource --help` contains from the word `resource`?
- Would a user looking for "list all the things in X" look for `my-cli resource list` or `my-cli list resource`?
- Is the noun the most specific useful entity (not overly abstract like `entity`) and not the most granular implementation term (not `db_row`)?

---

## Navigation systems

### Global navigation

Global navigation is present on every view or surface state. It establishes the top-level structure and tells users "what exists here." It is the most visible expression of the IA.

Global navigation failure is the most expensive IA failure — it affects every user on every page or state. A badly labeled global navigation item causes users to never discover entire sections of the system.

**When to use:** When the system has distinct top-level sections that users need to move between. When the sections are not already obvious from context.

**When it clutters:** Single-section tools, command flows with a single linear path, TUI views where all relevant actions are already visible. Adding global navigation to a single-purpose tool adds complexity without enabling navigation.

### Local navigation

Local navigation is specific to a section or depth level. It helps users navigate within a subtree without returning to the global level.

Absence of local navigation in deep hierarchies creates the "lost in a section" failure mode: users navigate several levels into a section, cannot find what they need, and have no way to traverse siblings at the same level without returning all the way to the top.

**When to use:** When a section has multiple subsections that users move between frequently. When the global navigation is insufficient to show the current section's structure.

**CLI equivalent:** Within-group command listing. `git remote --help` lists all `remote` subcommands — local navigation within the `remote` namespace.

**TUI equivalent:** A navigation panel within a view listing the available sections (left-side pane in `lazygit` shows: Status, Branches, Commits, Stash, Files).

### Contextual navigation

Contextual navigation is inline — related links, "see also," cross-references. It supports non-linear exploration and works against purely hierarchical thinking.

Contextual navigation is particularly important for content that resists strict taxonomy: a configuration option that is relevant both to security and to performance should appear in both contexts through contextual links.

**When to use:** When items in one category are commonly needed while working in another. When the flow between related items is a recognized task pattern.

**CLI equivalent:** The `--help` flag that lists related commands ("See also: `git fetch`, `git remote`").

**TUI equivalent:** The status bar showing relevant key bindings for the currently selected item — the available actions change based on context.

### Supplemental navigation

Supplemental navigation is out-of-band: site maps, A-Z indexes, guided tours, man pages. It supplements primary navigation when primary navigation fails.

**When to use:** When the hierarchy is deep enough that users frequently cannot find things through browsing. When users are in lookup mode (they know the name but not the location). As a safety net, not as the primary path.

**CLI equivalent:** Man pages and `--help` at every level. Tab completion as a supplemental navigation layer — shows available options without requiring users to remember them.

**TUI equivalent:** Help overlays (typically `?` key) that provide a full reference independent of the current state. The goal is finding commands the user did not know existed.

---

## Wayfinding — the "you are here" problem

Wayfinding is how users answer three questions at any point in their navigation:
1. **Where am I?** — current location in the structure
2. **Where can I go from here?** — available options relative to current position
3. **How do I get back?** — the path to where I came from

When wayfinding cues are absent, users disorienting and abandon. The IA must provide wayfinding mechanisms independently of visual design — the mechanism differs by surface.

### Web wayfinding
- **Breadcrumbs**: show the path from root to current location. Useful when users arrive mid-hierarchy (from a search result or direct URL). Not useful on a flat site with no hierarchy.
- **Active state on navigation**: highlights the current section in the global navigation.
- **URL structure that maps to hierarchy**: `/settings/authentication/oauth` tells the user they are in Settings > Authentication > OAuth without relying on any visual cue.
- **Persistent section headings**: the current section title visible at all times, not just in the breadcrumb.

**When breadcrumbs help:** Deep hierarchies where users can arrive at any level and need to understand their position. Reference sites, documentation, content sites.

**When breadcrumbs are noise:** Flat sites (< 3 levels). Single-page applications where the "hierarchy" is navigational state, not a real hierarchy. They add visual clutter without enabling any navigation the user could not accomplish with the back button.

### CLI wayfinding
Users lose their position in a CLI when:
- Command structure is inconsistent — the same operation is spelled differently in different namespaces
- `--help` is absent at any level, so users cannot discover what is available from where they are
- Error messages do not indicate where in the command structure the error occurred ("`error: invalid argument`" with no indication which command or which argument)
- The prompt itself gives no context about current state (relevant for interactive CLI sessions)

**Wayfinding in CLI**: `--help` at every level. Consistent error format that names the command and the problematic argument. In interactive CLI sessions: a prompt that includes current context (environment name, current target).

### TUI wayfinding
- **Status bar**: shows current position in the navigation hierarchy, current mode, available actions for the current state. The primary wayfinding mechanism in a TUI.
- **Highlighted current item**: which item in the navigation tree is currently selected.
- **Modal/mode indicator**: the current editing or navigation mode, distinct from the selection state.
- **Focus indicator**: which panel has focus in a multi-panel TUI.

The TUI wayfinding failure mode is mode confusion: users do not know whether they are in navigation mode, selection mode, edit mode, or command mode. vim's modal model produces this confusion for new users. The fix is not removing modes (modes are appropriate for TUI) — it is ensuring the current mode is always visible in the status bar.

---

## IA for non-web surfaces

### CLI IA — command taxonomy design

A CLI's command set is a namespace. IA for CLI answers: how should commands be organized so users can discover them, remember them, and correctly predict what belongs where?

**The organizational question in CLI** is not primarily about visual layout — it is about namespace structure. The choices:

**Flat namespace**: All commands at the same level. `my-cli build`, `my-cli test`, `my-cli deploy`, `my-cli configure`. Works when there are ≤ 10–12 commands and the commands are clearly distinct. Fails when the command set grows beyond 15–20: `--help` becomes a wall of text and users cannot scan it.

**Subcommand namespace**: Commands grouped by object or domain. `my-cli app build`, `my-cli app deploy`, `my-cli env configure`. The noun (`app`, `env`) is the grouping principle. Works when the grouping matches the user's mental model of the system. Fails when the grouping mirrors internal system architecture rather than user tasks.

**Designing the namespace from user tasks, not system architecture:**

The critical IA question is: do users think in terms of the objects the system manages, or in terms of the tasks they want to accomplish?

- If users think "I want to deploy my application," the object is `app` and the verb is `deploy` → `my-cli app deploy`
- If users think "I want to run a deploy," the verb is the organizing principle → `my-cli deploy --target app`

The test: look at the user's task list. If each task naturally starts with a noun (user, deployment, config, report), noun-first subcommand structure matches the mental model. If tasks start with verbs (create, list, delete, run), verb-first may be more natural — but verb-first groups all `list` commands together regardless of what is listed, which rarely matches how users browse help.

**CLI IA failure — mirroring system internals:**

```
# System-centric (mirrors internal architecture):
my-cli datastore-manager query
my-cli event-bus publish
my-cli auth-service validate-token

# User-centric (matches user tasks):
my-cli data query
my-cli events publish
my-cli auth validate
```

The system-centric version uses the names of internal services. The user-centric version uses the concepts the user thinks about. From `--help`, the first version reads like source code; the second reads like a tool.

**Depth for CLI**: Most CLIs should not exceed 3 levels: `tool noun verb`. Deeper nesting produces commands that are hard to remember and hard to read. When a namespace would require 4 levels, it is a signal that the taxonomy is wrong — either the object is too specific and should be merged with a parent, or the operation needs a flag rather than a subcommand.

### TUI IA — view hierarchy design

TUI applications have views (screens/panels), regions within views, and navigation between them. The IA is the set of views, how they are organized, and the paths between them.

**The TUI hierarchy question**: What views exist, and what is the navigation relationship between them?

TUI navigation models:
- **Linear sequence**: views are visited in order (wizard-style). Simple to implement, constraining for experts.
- **Tab or pane model**: multiple views accessible from the same level (lazygit's five panels). Users switch between panels freely.
- **Tree model**: views nested in a hierarchy. Selecting an item in a parent view opens a detail view. Navigation is back/forward through the tree.
- **Modal overlays**: a temporary view floats above the current view. Not a separate hierarchical level — returns to the same parent when dismissed.

**Distinguishing navigable structure from view state:**

This is the critical IA distinction in TUI design. "View state" is changes within a single view (which item is selected, what the current sort order is). "Navigable structure" is movement to a different view.

If selecting a list item shows details in a side panel without changing the view — that is view state. If selecting a list item replaces the entire screen with a detail view — that is navigation. The IA must be explicit about which is happening, because the user's back-navigation expectation differs:
- View state changes: pressing `Escape` restores the previous selection, does not navigate back
- Navigation changes: pressing `Escape` or `q` or the configured back key returns to the previous view

**TUI IA failure — orphaned views:**

An orphaned view is a view that exists in the application but cannot be navigated to through the primary navigation model. Causes:
- A view added after the IA was designed, without a navigation entry point
- A view accessible only through a context menu or key binding that is not documented or discoverable
- A deep view that can be entered but has no back navigation — the only exit is quitting the application

Orphaned views are the TUI equivalent of orphaned web pages. They are a structural failure: the content exists but users cannot reach it through any discoverable path.

### Desktop IA — menu and window hierarchy

Desktop IA organizes the menu bar, preference pane structure, and the document/window hierarchy.

**Menu bar organization**: The menu bar is global navigation. Conventions are platform-specific and must be followed (macOS: File/Edit/View/Window/Help order; Windows: similar with platform-specific additions). Deviation from menu bar conventions adds learning burden without benefit — these conventions are the strongest mental models in desktop IA.

**Preference pane structure**: Settings/preferences are typically a flat or two-level taxonomy. The organiztion question: does the user think about settings by component ("Authentication settings") or by task ("Settings I need to change when I start a new project")? Component-organized settings are easier to build; task-organized settings are easier to navigate for users whose mental model is task-based.

---

## IA evaluation methods (for AI agents)

### Card sorting — as a reasoning tool

Card sorting is a method where users physically sort labeled cards into groups that make sense to them. Open card sorting reveals user-generated groupings. Closed card sorting validates predefined categories.

An AI agent cannot run card sorting sessions, but can reason with the method:

**Open card sort reasoning**: Given a list of items, ask: "If users sorted these into natural groups, what groups would they create?" Draw on:
- Analogous-system reasoning: how does `git` organize its commands? How does `kubectl`? What can be inferred about user mental models from these established systems?
- Task analysis: if users approach these items through their tasks, which tasks would group these items together?
- Domain vocabulary: what terms does the user community use to describe these concepts?

The AI agent's card sort produces a structural hypothesis — not a validated grouping. Flag it as such: "This grouping assumes users think of configuration and secrets as distinct domains; if they are often managed together, they may belong in the same section."

**Closed card sort reasoning**: Given a proposed structure, ask for each item: "Would users know which category to look in for this item? Is there ambiguity between categories?"

### Tree testing — as a reasoning tool

Tree testing presents users with a text-only hierarchy and asks them to find items without visual design cues. It reveals whether the structure works without visual aids.

AI agent tree testing: walk through the structure textually. For each important user task, trace the path a user would take to find the relevant content or command. Ask:
- Would a user arriving at the top level know which branch to enter for this task?
- At the second level, would they know they are in the right branch?
- At the leaf level, would they recognize what they found?

If the answer to any of these is "maybe," the IA has an ambiguity problem. The fix is usually labeling (the branch name is not predictive) or organization (the item is in the wrong branch).

---

## IA outputs

IA produces structural artifacts that feed downstream design skills. These are distinct from user-flow-design outputs (which describe sequences through the structure) and interaction-design outputs (which describe what happens at each point in the structure).

### Organization scheme document

How concepts, content, or commands are grouped and why. Written before any visual design begins. Format:

```
Primary grouping principle: [task-based / topical / audience / other]
Rationale: [why this principle matches the user's mental model]

Top-level categories:
- Category A — contains: [list of items], because [rationale]
- Category B — contains: [list of items], because [rationale]

Items that cut across categories (polyhierarchy candidates):
- [Item X] appears in both A and B because users approach it from both
```

### Labeling decisions (controlled vocabulary)

The label set for the system. Resolves synonyms and establishes canonical terms.

```
Canonical term: Deploy
Synonyms resolved: Launch, Push, Release, Publish — all mean "deploy" in this system
Decision: "Deploy" because it matches the user's task vocabulary and is used consistently in analogous systems (git push, kubectl apply both describe deployment-related actions)

Do not use:
- "Release" (ambiguous — also means software release artifact)
- "Push" (too specific — implies git-style pushing, not relevant to all deployment targets)
```

### Navigation model

Which navigation types are used and where. Format:

```
Global navigation: [what is in it, what it exposes]
Local navigation: [in which sections, what it shows]
Contextual navigation: [which items cross-link, why]
Supplemental navigation: [search, index, help — when available]
```

### IA diagram

Structural map showing the hierarchy and navigation paths:
- **Web/desktop**: a tree diagram showing sections, subsections, and cross-links
- **CLI**: a command taxonomy tree showing namespaces, subcommands, and flags
- **TUI**: a navigation state diagram showing views, their relationships, and the navigation actions between them

An IA diagram for CLI:
```
my-cli
├── app
│   ├── build [--env, --target]
│   ├── deploy [--env, --strategy]
│   └── status [--env, --watch]
├── env
│   ├── list
│   ├── create [--name, --region]
│   └── delete [--name, --confirm]
└── config
    ├── get [key]
    ├── set [key] [value]
    └── list
```

This diagram is the IA artifact for a CLI. It is not a design of the individual commands (that belongs to `cli-design`) — it is the structural map showing what exists and how it is organized.

---

## IA failure modes

### Mystery meat navigation

Navigation items that provide no information scent — users cannot predict where a link leads before clicking. The canonical failure is marketing vocabulary in navigation:

- "Solutions" → could mean anything
- "Resources" → documentation? Downloads? Compute resources?
- "Insights" → analytics? Blog posts? Reports?

Users confronted with mystery meat navigation must click to discover, fail to predict, and often abandon rather than explore. The fix is using the content's actual label, not a marketing concept that contains it.

**CLI equivalent**: A subcommand namespace called `utils`, `tools`, or `misc`. Users cannot predict what is inside. Any command placed here is effectively orphaned — users must know it exists before they can find it.

### Orphaned content

Content or commands that exist but cannot be navigated to through any primary navigation path. Causes:
- Content added after the IA was designed, without adding navigation
- Navigation not updated when content moves
- Content accessible only through search, with no browsable path

Orphaned content is a structural failure invisible to the designer but visible to users who know what they want but cannot find it.

**Detection**: Audit content against navigation. Every item should have a reachable path through at least one navigation type. Items accessible only through exact search are de facto orphaned for discovery.

### Inconsistent labeling

The same concept has different names in different parts of the system. A user who learned "Archive" in section A will not know that "Deactivate" in section B means the same thing. They assume they are different — and they will look for "Archive" in section B and not find it.

**CLI manifestation**: Inconsistent flag names. `--environment` in one command and `--env` in another for the same concept. Users must check the help text for each command rather than predicting flag names. In scripting, this forces inconsistent variable names.

### Over-categorization

Creating categories for only one or two items. This wastes a hierarchy level, forces an unnecessary click, and creates the impression that the category should contain more. The user clicks into "Advanced Security Settings" and finds one item.

**When it appears**: When IA is designed for anticipated future content rather than existing content. The category is created for the two items that exist today and the ten items that might exist someday. The ten future items never arrive.

**Fix**: Flatten categories that have ≤ 3 items and are not expected to grow. The navigation level costs more in user effort than the organizational clarity gains.

### Under-categorization

Everything in one flat list with no organizing principle. Works for ≤ 10 items. Fails beyond 12–15 items, where scan time exceeds the cognitive cost of one level of organization.

**CLI manifestation**: A top-level `--help` that lists 40 commands with no grouping. Users must read all 40 every time they look for a command they do not know by heart.

### Implementation-model IA

Structure follows how the system is built internally, not how users think about what they want to do.

Common forms:
- **Microservice mirroring**: navigation items that correspond to internal services (`auth-service`, `notification-service`, `billing-service`) rather than user tasks ("Account security," "Notifications," "Billing")
- **Database schema exposure**: a configuration tool organized by database table names rather than by the user's configuration domains
- **Team/department structure**: an intranet organized by which team owns the content, not by what the content is about

The test: if users on the outside of the organization would not know which category to look in, the IA is organized by internal structure rather than user mental model.

---

## AI-agent adaptation

An AI agent doing IA work cannot run card sorting sessions, conduct tree testing with users, or analyze behavioral analytics. The adaptations:

**Structural proposals are hypotheses, not validated IA.** Every organization scheme, labeling decision, and navigation model the agent produces is a design hypothesis grounded in analogous-system analysis and reasoning. It must be flagged as such:

> "This grouping places `deploy` under `app` because users in analogous systems (`git`, `kubectl`) think in terms of the target object. If users of this tool think in terms of operations rather than objects, `deploy` may need to be a top-level command. This assumption should be validated."

**Label evaluation is analytical.** The information-scent test — does this label create a specific expectation? — can be applied analytically. The agent asks: what would a user familiar with analogous systems expect to find under this label? What would a novice expect?

**Tree testing is a reasoning exercise.** For each important user task, trace the path through the proposed structure. Flag any step where the branching decision is ambiguous.

**The agent must produce specific structural proposals, not structural advice.** "Organize settings hierarchically" is not an IA output. The IA output is:

> "Settings → Appearance (color scheme, font size, theme) | Behavior (startup behavior, notifications, autosave interval) | Accounts (profile, security, connected integrations) | Advanced (performance, experimental features)"

The agent produces the specific structure so that the user can evaluate it. Vague structural advice leaves the user with the same problem they started with.

**Explicitly state what is most uncertain.** Ambiguous-scheme categories (topics, tasks, audiences) carry more uncertainty than exact-scheme categories (alphabetical, chronological). The agent must flag where the structure is most likely to be wrong, and recommend what validation would resolve it.

---

## Failure modes summary

| Failure | Recognition | Fix direction |
|---|---|---|
| Mystery meat navigation | Users cannot predict what navigation items contain | Replace marketing vocabulary with content vocabulary |
| Orphaned content | Content exists but has no navigation path | Audit content against navigation; add supplemental paths |
| Inconsistent labeling | Same concept, different names across the system | Establish controlled vocabulary; audit for inconsistency |
| Over-categorization | Categories with ≤ 2–3 items, no growth expected | Flatten; merge thin categories into adjacent ones |
| Under-categorization | Flat list of 15+ items with no grouping | Group by the user's natural task or topic groupings |
| Implementation-model IA | Navigation mirrors internal code, service, or team structure | Remap from user task vocabulary; run the "would an outsider know where to look?" test |
| Audience-based top-level nav | Primary navigation requires self-identification before accessing content | Replace with task-based or topic-based primary navigation |

---
