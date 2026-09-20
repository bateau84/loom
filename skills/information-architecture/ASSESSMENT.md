# information-architecture Assessment Contract

## Review criteria

Reviewer asks whether a user can **predict where something belongs and recover when their first guess is wrong**:

1. **Task/mental-model fit** — organization reflects user tasks/concepts rather than implementation/package structure unless the target users actually think in those terms.
2. **Information scent** — labels distinguish siblings, use audience vocabulary, and communicate what lies behind them before selection.
3. **Placement consistency** — the same organizing principle is applied coherently; items with multiple legitimate homes have cross-link/search/facet strategy rather than arbitrary hiding.
4. **Findability** — every required content/function has a plausible discovery path from representative entry contexts; no orphan capability exists.
5. **Breadth/depth by task cost** — hierarchy depth and menu breadth are justified by scanning, disambiguation, and navigation cost; do **not** apply folklore thresholds such as `7±2` or four levels as universal limits.
6. **Context preservation** — users know where they are, how they got there, and how to move laterally/back without losing task state when the surface requires it.
7. **Search/facets/filter semantics** — categories/facets are non-contradictory, labels and values have stable meaning, and empty/no-result recovery is considered where search is load-bearing.
8. **Flow consistency** — accepted user flows and role/access differences can traverse the IA without hidden jumps or terminology changes.
9. **Surface adaptation** — CLI command taxonomy, TUI pane/navigation, web navigation, etc. use the medium’s actual discovery mechanisms.

## Adjudication criteria

Critic gives representative users/tasks “wrong first guesses” and tests whether the structure remains recoverable. Attack ambiguous sibling labels, cross-cutting concepts forced into one hierarchy, orphan functions, duplicate concepts with drifting names, role-dependent dead ends, and implementation-model leakage.

Block when an accepted scenario becomes materially undiscoverable/incoherent, required capability has no route, terminology causes a dangerous semantic mistake, or IA contradicts accepted flows. Do not block because a hierarchy exceeds an arbitrary numeric depth/breadth heuristic.

## Scaling

Increase depth with content/function breadth, cross-cutting taxonomy, role/audience differences, search/facet dependence, terminology novelty, navigation statefulness, and consequence of misclassification.