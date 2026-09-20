# opentelemetry Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer checks OTel semantics at propagation, sampling and exporter boundaries:

- resource attributes (`service.name`, environment/namespace/version etc.) are stable and correctly scoped; high-cardinality request data is not resource identity;
- trace context propagates across inbound/outbound HTTP/RPC/messaging/async boundaries and does not leak between unrelated work;
- span kind, name, attributes, events, status/error recording and parentage follow semantic conventions closely enough for downstream RED/service-map/query behavior;
- sampling decision/context is propagated consistently; head/tail sampling implications and dropped-error visibility are understood;
- baggage is bounded and contains no sensitive/high-cardinality data inappropriate for propagation;
- metric instruments/units/temporality/histogram aggregation match the measured quantity and backend expectations;
- exporter batching/queue/retry/drop behavior is observable and bounded; shutdown flush cannot hang indefinitely;
- collector processors (batch, memory limiter, resource/attributes, tail sampling) cannot silently rewrite/drop required telemetry;
- semantic-convention/SDK/exporter versions are compatible with backend queries/dashboards.
