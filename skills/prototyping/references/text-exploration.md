# Text exploration formats

These formats make design hypotheses inspectable. Their contents are proposed behavior unless supported by separately identified observation. Use one or combine a few as the question requires.

## Structured scenario walkthrough

```text
Scenario and user context:
Starting state:
Step:
  User goal:
  User sees:
  User does:
  System responds:
  Resulting state and focus:
  Gap or observation:
```

At each step ask:

1. Would this person try to achieve the intended result?
2. Would they notice the correct action is available?
3. Would they associate that action with the intended result?
4. Would the response show that progress was made?

Do not skip apparently obvious steps. For a pod/log viewer, walk namespace filtering, pod selection, opening logs, interruption, and return. What happens to focus and the log pane when the filter excludes the selected pod? A screen sketch without that journey leaves the important question unanswered.

## CLI transcript and flag matrix

Show concrete invocations, stdout, stderr, and exit codes separately. Include an interactive and a piped/non-interactive context when applicable.

```text
Scenario: inspect migration status; illustrative proposed output
$ dbmigrate status --json
stdout: {"pending": 2, "applied": 4}
stderr: (empty)
exit: 0

Scenario: apply fails after one migration succeeded
$ dbmigrate up
stdout: (per accepted data-output contract)
stderr: Migration 005 applied; migration 006 failed. Inspect status before retrying.
exit: non-zero; exact taxonomy is a design question unless already accepted
Gap: rollback, persistence, and safe retry require confirmed behavioral capability.
```

Compare `--quiet`, `--dry-run`, machine output, and error cases in a flag matrix when combinations matter. Do not let `--quiet` hide a failure or assume dry-run always succeeds. Decide whether callers need distinct failure codes; do not invent a different code for every error by quota. Do not promise rollback merely to make the transcript reassuring.

## State-transition sketch and key map

For each state identify visible content, available actions, entry/exit conditions, and focus. For each transition use `trigger -> visible response -> resulting state`. Include cancellation, slow/stale results, empty data, and re-entry when they may change the decision.

A terminal sketch might show list, detail, filter, and confirmation regions at distinct states. Mark dimensions and input assumptions rather than pretending character art demonstrates an actual terminal render.

| Key | List | Filter | Confirmation |
| --- | --- | --- | --- |
| Enter | Open focused item | Apply filter | Activate focused choice |
| Escape | Accepted top-level behavior | Cancel edit/restore prior filter | Cancel destructive action |
| Tab | Next region | Next control | Next choice within dialog |

The map exposes conflicts: a key cannot both navigate and destroy an item in the same state without a resolved distinction. State where focus returns and what happens when the prior target no longer exists.

## Behavioral pseudocode

Use conditions to expose ambiguity, not choose storage architecture:

```text
On Escape with an edited form open:
  if unsaved changes exist:
    show the accepted discard/keep-editing choice
    keep editing -> preserve values and restore a meaningful focus position
    discard -> close form and return to its trigger or a defined fallback
  else:
    close form and restore focus
```

Define what counts as an unsaved change and what a second Escape does while the confirmation is open. Distinguish a visual recovery affordance from a guaranteed backend undo. Pseudocode is not evidence of actual focus restoration or persistence.

## Comparative scenario analysis

```text
Question:
Shared scenario, data, constraints, and evaluation criteria:
A: approach; step-by-step journey; strengths; gaps; observations/assumptions
B: approach; same journey; strengths; gaps; observations/assumptions
Decision or remaining uncertainty:
Why the observed differences matter to this user:
What would reverse the choice:
What enters the design handoff:
```

Compare a persistent filter and an invoked search surface through the same interruption/no-results journey, not abstract claims that one is simpler and the other more powerful. Neither approach wins by convention alone. When the deciding question is actual focus, timing, visual density, or manipulation, pair the analysis with the required rendered or interactive experiment.
