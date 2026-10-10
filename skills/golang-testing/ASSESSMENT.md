# golang-testing Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer checks whether selected tests provide distinct, proportionate proof under Go’s execution model. `test-driven-development` owns test selection; the Go-specific checks below are conditional on techniques actually used:

- table/subtests copy/capture loop variables correctly and use `t.Parallel` only with isolated state; package/global env/process state is restored with `t.Cleanup`;
- assertions target observable behavior/invariants and failure paths, not implementation trivia;
- temp files/dirs, clocks/randomness/network/database dependencies are deterministic enough without bypassing the behavior under proof;
- concurrency-sensitive code has `-race`/stress or targeted concurrency evidence where needed; sleeps alone are not synchronization proof; do not require `goleak` or `t.Parallel()` without a relevant failure claim;
- mocks/fakes sit beyond the intended test boundary; state is produced by the real upstream product behavior for integration/acceptance claims;
- `t.Fatal`/helper behavior, cleanup, goroutine failures, and error assertions cannot hide failures in background goroutines;
- skips/xfails/build tags are honest and do not remove the changed hard path from CI evidence; equivalent proof is accepted regardless of stylistic choice.
