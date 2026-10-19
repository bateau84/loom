# Retired assignment/delivery protocol

This is a historical documentation address, not an operating guide. General
assignment, authorization, withdrawal, delivery/retry operations and their query
views have been retired. There is no startup sender, replay worker, consent
upgrade or retry opportunity. Do not run old examples against the current plugin.

Existing assignment, intent, event, authorization and withdrawal records remain
readable as inert ledger history. Their stored bytes, attribution and links are
not rewritten into new questions, blocking intent or current authorization.
Use exact ledger reads or `query view:full_thread`; references are not expanded.

The replacement is [durable questions and answers](collaboration.md): in the
separately qualified OpenCode 2.0.29 compatibility profile, questions are stored
without contacting the recipient. Only the first committed answer to a new
blocking question can qualify for one best-effort
resume of the exact asking Session. It is not the former answer-to-primary route.

Earlier sender qualification and comparison results concern that former protocol,
not acceptance of this replacement. See [qualification boundaries](sender-qualification.md).
Before changing versions, preserve originals with the [stopped-writers offline
procedure](manual-backup-restore.md). Never run an old sender on historical pending
intents or infer permission to activate from preserved historical consent.
