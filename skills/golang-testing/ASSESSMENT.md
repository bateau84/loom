# golang-testing Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer checks whether tests prove the claimed behavior under Go’s execution model:

- table/subtests copy/capture loop variables correctly and use `t.Parallel` only with isolated state; package/global env/process state is restored with `t.Cleanup`;
- assertions target observable behavior/invariants and failure paths, not implementation trivia;
- temp files/dirs, clocks/randomness/network/database dependencies are deterministic enough without bypassing the behavior under proof;
- race-sensitive code has `-race`/stress or targeted concurrency evidence when applicable; sleeps are not the only synchronization proof;
- mocks/fakes sit beyond the intended test boundary; state is produced by the real upstream product behavior for integration/acceptance claims;
- `t.Fatal`/helper behavior, cleanup, goroutine failures, and error assertions cannot hide failures in background goroutines;
- skips/xfails/build tags are honest and do not remove the changed hard path from CI evidence.
