# opentelemetry Assessment Contract

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

## Adjudication criteria

Critic traces one request across process boundaries, cancels it, triggers an error, forces exporter/backend outage and sampling, then checks parentage/attributes/drop counters. Probe baggage/attribute PII and a service map built from wrong span kinds.

Block when required correlation/SLI/security evidence is materially false or exporter behavior can seriously destabilize the app. Cosmetic convention differences are non-blocking unless consumers rely on them.

## Scaling

Increase depth with cross-service propagation, async messaging, sampling, collector pipelines, high volume, sensitive baggage/attributes, and backend semantic-convention coupling.