---
name: prototyping
description: "Reduce design uncertainty with the cheapest adequate experiment: scenario walkthroughs, command transcripts, state sketches, behavioral pseudocode, comparative analysis, static renderings, or bounded interactive prototypes. Use for unresolved design choices, not a settled handoff or proof of production behavior."
metadata:
  version: "2.0.0"
---

# Prototyping

A prototype is an experiment for a named design question, not a proto-product or automatic design authority. Select the cheapest representation that can answer the question. Text is valuable, but neither text-only reasoning nor a polished static image proves an interaction works.

## Frame the experiment

Start from accepted intent and representative scenarios. Complete:

```text
Question/hypothesis:
What observation could change the decision:
Alternatives and shared scenario/constraints:
Representation, scope, and evidence needed:
Simulated capabilities and known limits:
Stop condition:
```

When meaningful directions are open, compare a small set against the same scenario and realistic content. Do not disguise color swaps as different interaction models, preselect the winner, or force alternatives for an already settled local choice. Include the error, interruption, or recovery branch that could overturn the result.

Fidelity has independent content, interactivity, and completeness dimensions. Spend effort only on the dimension needed: a timing question may need working transitions but very little styling. A visual-density question may need realistic content and rendering but no backend. Do not postpone material visual or interaction uncertainty merely because a prose specification can be written first.

## Select the format

| Question | Useful representation | Evidence limit |
| --- | --- | --- |
| Will a person find the next action and understand the response? | Structured scenario walkthrough | Expert hypothesis, not observed user behavior |
| Are commands, streams, flags, and exit outcomes coherent? | CLI command transcripts and flag matrices | Proposed behavior unless actually executed |
| Which states, transitions, focus positions, or key bindings are missing? | State-transition sketches, terminal sketches, key maps | Does not prove rendering or real focus movement |
| Is conditional interaction logic ambiguous? | Behavioral pseudocode | Does not prove implementation correctness |
| Which approach handles the same journey better? | Comparative scenario analysis | Conclusion is bounded by the underlying observations |
| Does hierarchy, density, or visual character work in context? | Static rendered composition, web or appropriate native surface | Does not prove dynamic behavior |
| Does timing, manipulation, keyboard interaction, or recovery feel/work as intended? | Small executable interactive prototype | Proves only exercised prototype behavior |

The existing text methods remain first-class. [Text exploration formats](references/text-exploration.md) provides walkthrough questions, transcripts, state/key maps, pseudocode, and comparison templates. Use them directly when they can answer the question; do not apologize for absent GUI tools instead of doing useful work.

## Build or commission only the necessary prototype

Use available tools and the current grant. A skill cannot grant filesystem writes, tool installation, shell execution, network access, or production mutation. Designer can author a prototype within its permitted design scope; when construction or execution exceeds that scope, request the smallest bounded task from the existing coordinator/appropriate role. Do not invoke a subagent directly when the role prohibits it.

Prefer real project components, tokens, and flows when they are relevant and available, so the experiment tests the actual constraints. A throwaway self-contained surface is also valid when reuse would obscure the question. Keep it isolated from production routes, real credentials, destructive operations, and production data. Label every simulated service or state.

For an interactive question, specify only the controls and transitions needed to test it. Actually render/interact when the needed tools are available. Record which build/artifact, environment, input mode, scenario, and conditions were exercised. Do not treat a generated image or source inspection as proof that a prototype was run.

When tools are unavailable, produce the useful text/static portion and an explicit experiment handoff stating the missing observation. Do not claim validation, manufacture measurements, or install tools without authority. Tool absence does not require abandoning unrelated design work.

## Observe and revise

For walkthroughs, ask at each step whether the person would pursue the right goal, notice the action, associate it with the intended result, and understand the feedback. Record gaps rather than quietly filling them with invented guarantees.

For rendered/interactive work, distinguish what you actually saw or did from predicted human behavior. A person finding a control, an agent activating it, and a design claiming it is discoverable are different evidence. Prototypes can reveal interaction defects without proving representative user success, accessibility conformance, persistence, security, or production performance.

Compare alternatives under the same meaningful conditions. Correct the design hypothesis when evidence contradicts it, then re-exercise the affected path. Do not refine indefinitely when no unanswered question remains; new effort should have a named uncertainty and fit the task's budget.

## Carry learning into accepted design

Record the result, rationale, rejected alternatives, observation limits, and any consequential unresolved question in the existing design handoff. Map walkthroughs to flows, transcripts to commands/streams/outcomes, sketches to states/focus, pseudocode to conditional behavior, and observations to decisions or open questions. Use `design-specification` for the implementation-ready contract, not a second prototype authority document.

Only the unresolved dependent slice remains blocked. Do not hand a mock-backed behavior to implementation as an established backend promise or defer a material untested design claim while calling it validated. Retain useful prototype evidence under the repository's existing lifecycle; dispose of unneeded assets through that same policy. Prototype code does not silently become production code. Real-product acceptance remains `design-validation` after implementation.
