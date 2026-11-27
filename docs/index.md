# Loom documentation

This `docs/` directory is Loom's OKF documentation bundle. Each non-reserved Markdown
file in this directory is a documented concept, not an exempt "supporting" file.
Use this index to find the relevant contract and its evidence; a document's
historical status does not imply current runtime support.

## Documentation areas

- [Anchors](anchors/index.md) — Product purpose and first principles; no standalone concepts yet.
- [Requirements](requirements/index.md) — Behavioral requirements, obligation contracts, and quality scenarios.
- [Product design](design/index.md) — Design specifications, user stories, and scenarios; no standalone concepts yet.
- [Architecture](architecture/index.md) — Architectural designs, decisions, specifications, qualifications, and historical references.
- [User documentation](user-docs/index.md) — Tool reference, workflows, operation, recovery, testing, and migration.
- [Documentation change log](log.md) — Shared history and this reorganization.

## Navigation and document identity

Each area maintains its own index and change log. Nested indexes inventory their
own documents. Existing requirement identifiers remain scoped to their topic;
ARD, ADR, and ARS filename identifiers classify the existing architecture documents
without changing their acceptance or implementation status.

The repository-root [OKF profile](../.okf-profile.yaml) declares concept types and
relationships grounded in existing headings. It is a scanner configuration asset,
not a corpus concept document. Start `okf-mcp` with this repository as its scan root
so the profile is discovered. It declares no mandatory link counts.
