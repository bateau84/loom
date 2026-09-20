# golang-safety Reviewer Assessment

Reviewer-only domain contract. It does not create Loom authority, product meaning, or proof.

## Review criteria

Reviewer focuses on runtime/data/process hazards not fully covered by ordinary style review:

- untrusted sizes/counts/depths are bounded before allocation/iteration/recursion; integer conversion/overflow cannot turn validation into bypass/resource exhaustion;
- nil/index/type assertions/panics cannot be triggered by expected external data without controlled error handling;
- file/path/temp/process/network operations preserve intended root/permissions and avoid traversal/symlink/race/command-injection hazards;
- parsing/serialization limits protect against oversized/malformed/decompression-bomb input;
- `unsafe`, cgo, memory aliasing, atomics, and zero-copy techniques have an explicit necessity/invariant and targeted tests;
- resources/goroutines are bounded under adversarial load/failure;
- destructive operations identify target and fail safely under partial error/retry.
