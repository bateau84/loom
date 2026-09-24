# report-lifecycle Reviewer Assessment

## Review criteria

- A file report exists only when persistence has a real retrieval/audit/handoff purpose.
- Path matches `ephemeral-reports/<producer>/**`.
- OKF profile has the correct producer type plus non-empty title, description, and string tags.
- OKF validation succeeds before discovery is relied upon.
- Report content preserves the producer's actual verdict/evidence/uncertainty and does not become stronger authority.
- Durable conclusions are routed to their owning artifacts rather than treating a raw report as substitute authority.
- A specialist may surface a retention need, but only General owns `report-to-keep` / durable report promotion.
