# python-testing Assessment Contract

## Review criteria

Reviewer checks pytest/unittest evidence for state isolation and claim fidelity:

- fixture scope matches resource/state ownership; mutable session/module fixtures cannot leak order-dependent state into supposedly isolated tests;
- `yield` fixture teardown runs under failure and does not mask the primary exception; monkeypatch/env/cwd/sys.path/global configuration is restored;
- parametrization spans semantic boundary cases rather than multiplying equivalent examples; IDs make failures diagnosable;
- async tests use the intended event-loop/backend/lifecycle and do not leave tasks pending across tests;
- `tmp_path`, frozen clocks/random seeds, network/DB fakes, and dependency overrides preserve the behavior under proof rather than bypass it;
- `xfail`/skip markers are specific/honest and unexpected pass/failure policy cannot turn regressions green;
- mocks use autospec/spec where helpful but do not overfit implementation or replace a product boundary in integration/acceptance claims;
- caplog/warnings/exceptions assert meaningful semantics, not only that “something happened”.

## Adjudication criteria

Critic randomizes/reverses order, reruns, parallelizes where supported, removes injected postcondition state, changes timing, and replaces a mock with the real boundary when the claim requires it. Probe session fixture contamination and xfail/skip false greens.

Block when cited tests can systematically pass despite the claimed mandatory behavior being broken. Test-style preferences are non-blocking when stronger evidence proves the same invariant.

## Scaling

Increase depth with shared fixtures/global state, async/concurrency, integration/product-acceptance claims, timing, external resources, and reliance on skips/mocks.