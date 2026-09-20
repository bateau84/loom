---
name: python-design-patterns
description: "KISS, Separation of Concerns, Single Responsibility, and composition over inheritance in Python. Use when designing a new service or component, refactoring a God class or monolithic function, evaluating a pull request for tight coupling, or choosing between inheritance and composition for a class hierarchy. Not for testing patterns (→ See `python-testing`) or project setup."
---

# Python Design Patterns

Write maintainable Python code using fundamental design principles. These patterns help you build systems that are easy to understand, test, and modify.

## When to Use This Skill

- Designing new components or services
- Refactoring complex or tangled code
- Deciding whether to create an abstraction
- Choosing between inheritance and composition
- Evaluating code complexity and coupling
- Planning modular architectures

## Core Concepts

### 1. KISS (Keep It Simple)

Choose the simplest solution that works. Complexity must be justified by concrete requirements.

### 2. Single Responsibility (SRP)

Each unit should have one reason to change. Separate concerns into focused components.

### 3. Composition Over Inheritance

Build behavior by combining objects, not extending classes.

### 4. Rule of Three

Wait until you have three instances before abstracting. Duplication is often better than premature abstraction.

## Quick Start

```python
# Simple beats clever
# Instead of a factory/registry pattern:
FORMATTERS = {"json": JsonFormatter, "csv": CsvFormatter}

def get_formatter(name: str) -> Formatter:
    return FORMATTERS[name]()
```

## Detailed patterns and worked examples

Detailed pattern documentation lives in `references/details.md`. Read that file when the navigation tier above is insufficient.

## Best Practices Summary

1. **Keep it simple** - Choose the simplest solution that works
2. **Single responsibility** - Each unit has one reason to change
3. **Separate concerns** - Distinct responsibilities with clear boundaries. Prefer feature-vertical over horizontal layers when agent-maintained (OQ6: deviation risks training-distribution hallucination — qualify, don't reverse).
4. **Compose, don't inherit** - Combine objects for flexibility
5. **Rule of three** - Wait before abstracting
6. **Keep functions small** - 20-50 lines signals complexity; the real limit is one task per function.
7. **Ceremony-to-logic ratio** - Minimise boilerplate relative to business logic. High ratios predict agent navigation cost; keep files under ~500 lines of business logic (provisional, OQ1).
8. **Test each concern in isolation** - Test components independently using their injected boundaries
9. **Inject dependencies** - Constructor injection for testability
10. **Delete before abstracting** - Remove dead code, then consider patterns
11. **Explicit over clever** - Readable code beats elegant code

## Troubleshooting

**A class is growing and seems to have multiple responsibilities, but splitting it feels wrong.**
Apply the "reason to change" test: list every change that could require editing this class. If the list has items from different domains (e.g., HTTP parsing AND business rules AND formatting), split it. If all changes stem from the same domain concern, the class may be appropriately sized.

**Injecting all dependencies through the constructor is producing constructors with 7+ parameters.**
Sign of too many responsibilities, not a DI problem. Split the class; each constructor naturally shrinks.

**Composition is producing deeply nested wrapper objects that are hard to trace.**
Keep composition shallow (2-3 levels). Consider a Protocol-based approach or function composition over a deep decorator chain.

**The rule of three says not to abstract yet, but the duplication is causing bugs when one copy is updated but not the other.**
Duplication that diverges in dangerous ways should be abstracted sooner. The rule of three is a heuristic, not a law. If the copies are already diverging incorrectly, extract immediately and add a test that exercises the shared behavior.

**A service layer is importing from the API layer, breaking the dependency direction.**
This is a layering violation. The service layer must not import from handlers. Introduce a shared types/models layer that both can import from, keeping the dependency arrow pointing downward (API → Service → Repository). For agent-maintained codebases, consider a feature-vertical slice instead: co-locate a feature's route, schema, and logic in one file or feature directory, reducing agent traversal cost (OQ6: deviates from framework convention — qualify, don't reverse).

## Related Skills

- [python-testing-patterns](../python-testing-patterns/SKILL.md) — Test each concern in isolation using the dependency injection structure established here
- [python-project-setup](../python-project-setup/SKILL.md) — Set up project structure and tooling that enforces layer boundaries from the start
