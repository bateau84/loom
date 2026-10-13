# agent-eval Quality Assurance

Critic-only adversarial contract. Assume competent case authoring and normal Reviewer assessment already occurred.

## QA criteria

- Find a materially wrong role decision that still satisfies the rubric; attack vague expectations and missing negative space.
- Find a defensible correct decision that fails because the case requires magic wording, an incidental implementation, or unavailable tools.
- Attack mode substitution: a tool-less case that claims runtime proof, or an expensive runtime case whose claim could be isolated cheaply.
- Try the universal-safe strategies: always refuse, always escalate, always ask the user, always delegate. A healthy corpus must make those strategies fail ordinary in-scope cases.
- Check whether mocked or supplied context is being misrepresented as proof that upstream research, implementation, or workflow execution actually occurred.
- Attack action assertions for weak binding: right tool/wrong subject, tool mentioned only in prose, equivalent transport alias missed, or unrelated observed action satisfying a broad substring.
- Look for benchmark coupling to one repository incident, one file layout, one model's phrasing, or the implementation that happened to fix the bug.
- Check that the eval still verifies the original contract after prompt/agent refactors and does not merely reward the new wording.
- Separate provider timeout, routing failure, and harness defects from semantic failure; do not turn infrastructure noise into product evidence.
- Challenge any benchmark edit whose only justification is that the current model does not pass.

Increase QA depth for authority boundaries, completion truth, recovery behavior, and runtime tool contracts.
