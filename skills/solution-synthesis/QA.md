# Solution Synthesis QA

For Critic when the combined solution is under attack. Assume competent local work and normal review; test what can still fail between them.

## QA criteria

- **Locally true, globally false:** construct a plausible journey where every component satisfies its own contract but the accepted outcome fails across a boundary.
- **Time and ownership:** perturb ordering, restart, retry, concurrency, cancellation, or handover where material. Look for a guarantee that exists only while two owners implicitly agree about the same moment or identity.
- **Correlated premise:** trace a shared assumption repeated in several artifacts back to its evidence. Agreement is not independent support.
- **Seam-shaped proof gap:** determine whether component tests, mocks, or separate successful demonstrations omit the actual transition on which the end-to-end claim depends.
- **Stale agreement:** test whether a later valid local amendment breaks a previously coherent journey while the summary or downstream proof still cites the old result.

Give a concrete plausible counterexample, its source contracts/evidence, consequence, and actual correction owner. Do not invent stronger guarantees, redesign the solution, or reopen settled choices without material new evidence.
