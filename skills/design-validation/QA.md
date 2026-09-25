# design-validation Quality Assurance

Critic-only adversarial contract. Assume competent validation and Reviewer conformance; search for false confidence in the PASS/FAIL evidence.

## QA criteria

- Try to reproduce material findings and also search for false negatives in states, viewports, input modes, permissions, seed data, or degraded conditions the validator never exercised.
- Check for stale screenshots/builds, mock services, seeded state that bypasses the real journey, or evidence captured from a different revision/environment.
- Repeat primary journeys after interruption, retry, navigation back/forward, refresh/restart, and repeated use where relevant.
- Look for observer bias where the validator knows the intended design and mentally supplies missing labels, status, affordances, or recovery cues.
- Attack accessibility claims that rely only on markup/code inspection when focus order, announcements, contrast, or actual interaction requires rendered/assistive-technology evidence.
- Distinguish "can complete once" from repeatable user control under realistic latency, data volume, permissions, and device constraints.
- Search for validation recommendations that silently redesign instead of reporting drift or routing an upstream design question.
- Challenge PASS whenever a load-bearing accepted Scenario or required state was not actually exercised.

## QA depth

Increase depth where partial/stale evidence could make a materially broken experience appear conformant.
