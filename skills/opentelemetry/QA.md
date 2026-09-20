# opentelemetry Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence without creating new authority.

## QA criteria

Critic traces one request across process boundaries, cancels it, triggers an error, forces exporter/backend outage and sampling, then checks parentage/attributes/drop counters. Probe baggage/attribute PII and a service map built from wrong span kinds.

Block when required correlation/SLI/security evidence is materially false or exporter behavior can seriously destabilize the app. Cosmetic convention differences are non-blocking unless consumers rely on them.

## QA depth

Increase depth with cross-service propagation, async messaging, sampling, collector pipelines, high volume, sensitive baggage/attributes, and backend semantic-convention coupling.
