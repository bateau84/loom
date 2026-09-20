# python-fastapi Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic cancels/disconnects mid-request, fails a yield dependency, supplies coercible-but-wrong values, bypasses auth through alternate routes/docs, restarts lifespan, and tests a background task failure. Probe green TestClient tests that omit real async/lifecycle behavior.

Block public API/security/resource-lifecycle defects or when documented response/auth semantics diverge materially from runtime. Framework style preference is non-blocking.

## QA depth

Increase depth with async DB/external clients, auth, lifespan resources, streaming/websockets, background work, custom middleware/handlers, and public API compatibility.
