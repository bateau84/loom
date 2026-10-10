---
name: golang-testing
description: "Go testing mechanics: testing and t.Run, t.Parallel, httptest, synctest, race detection, fuzzing, goleak, fixtures, integration tests, benchmarks and coverage tools. Use when implementing/reviewing Go tests or diagnosing Go test failures. test-driven-development owns which tests to write, their regression value, and when to stop; this skill explains applicable Go-specific techniques."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
  adapted-from: samber/cc-skills-golang@golang-testing
---

> **House skill.** Adapted from `samber/cc-skills-golang@golang-testing` for this workspace. Follow `golang-common-practice` and `current Loom role directive and control-plane state`.

**Scope:** `test-driven-development` owns test selection, behavioral proof, realism, proportionality, and stopping/deleting tests. **This skill owns Go-specific mechanics only.** Apply a technique when it solves a concrete Go test problem; examples are options, not required coverage, dependencies, or scaffolding. Prefer the project's existing tools and conventions.

**Modes:**

- **Write mode** — implement the smallest set of Go tests selected under `test-driven-development`. Use `gotests` scaffolding only when it saves work; do not generate extra scenarios to fill a template.
- **Review mode** — check whether new tests prove their claimed Go behavior, are deterministic, and add distinct regression value. Do not demand a table, mock, or parallelism for style alone.
- **Audit mode** — inspect relevant suites for false greens, nondeterminism, material uncovered behavior, redundant tests, and costly scaffolding. Check races and goroutine lifecycle only where that risk exists.
- **Debug mode** — a test is failing or flaky. Work sequentially: reproduce reliably, isolate the failing assertion, trace the root cause in production code or test setup.

> **Community default.** A company skill that explicitly supersedes `golang-testing` skill takes precedence.

**Optional tool:** `gotests` can scaffold table-driven tests if already available; do not install tools merely to generate boilerplate.

# Go testing mechanics

Use `testing` and the repository's established framework. Relevant choices:

- Named `t.Run` subtests make table-driven cases diagnosable when each represents a distinct useful behavior; a single straightforward test need not become a table.
- Use `t.Parallel()` only when isolation is sound and there is meaningful throughput benefit. No parallelism quota.
- Use `go test -race` for concurrency-sensitive behavior and in CI where practical. It detects races, not higher-level ordering or lifecycle correctness.
- Use `goleak` when a component owns goroutine shutdown and a leak is a credible regression; do not install it or add global `TestMain` merely because a package uses goroutines.
- Use `testing/synctest` or a fake clock when time affects correctness; avoid flaky real sleeps. Do not redesign production APIs to inject clocks when a smaller faithful test suffices.
- Use build tags for integration tests when they need explicit dependency/setup isolation; `testing.Short()` or separate CI jobs may be suitable under existing repository policy.
- Keep tests reasonably fast and deterministic; no universal per-test millisecond limit.
- Use testify, fuzzing, benchmarks, and Example functions when they help prove a real behavior or answer a measurement/documentation need, not as mandatory checklist items.

## Refactoring: Audit All Call Sites on Signature Changes

NEVER finalize a refactor plan that changes a function or test-fixture signature without grepping for **every** call site — production code, test files, and test helpers — and updating them first. A missed helper (e.g. `main_test.go`) breaks the build phase, not just a test.

## Test Structure and Organization

### File Conventions

```go
// package_test.go - tests in same package (white-box, access unexported)
package mypackage

// mypackage_test.go - tests in test package (black-box, public API only)
package mypackage_test
```

### Naming Conventions

```go
func TestAdd(t *testing.T) { ... }               // function test
func TestMyStruct_MyMethod(t *testing.T) { ... } // method test
func BenchmarkAdd(b *testing.B) { ... }          // benchmark
func ExampleAdd() { ... }                        // example
func FuzzAdd(f *testing.F) { ... }               // fuzz test
```

## Table-Driven Tests

Table-driven tests are the idiomatic Go way to test multiple scenarios. Always name each test case.

```go
func TestCalculatePrice(t *testing.T) {
    tests := []struct {
        name     string
        quantity int
        unitPrice float64
        expected  float64
    }{
        {
            name:      "single item",
            quantity:  1,
            unitPrice: 10.0,
            expected:  10.0,
        },
        {
            name:      "bulk discount - 100 items",
            quantity:  100,
            unitPrice: 10.0,
            expected:  900.0, // 10% discount
        },
        {
            name:      "zero quantity",
            quantity:  0,
            unitPrice: 10.0,
            expected:  0.0,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := CalculatePrice(tt.quantity, tt.unitPrice)
            if got != tt.expected {
                t.Errorf("CalculatePrice(%d, %.2f) = %.2f, want %.2f",
                    tt.quantity, tt.unitPrice, got, tt.expected)
            }
        })
    }
}
```

## Unit Tests

Unit tests should be fast (< 1ms), isolated (no external dependencies), and deterministic.

## Testing HTTP Handlers

Use `httptest` for handler tests with table-driven patterns. See [HTTP Testing](./references/http-testing.md) for examples with request/response bodies, query parameters, headers, and status code assertions.

## Goroutine Leak Detection with goleak

Use `go.uber.org/goleak` when verifying that a component actually shuts down its owned goroutines. It adds a dependency and may be noisy around unrelated library goroutines; package-wide `TestMain` is optional, not a default:

```go
import (
    "testing"
    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

To exclude specific goroutine stacks (for known leaks or library goroutines):

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m,
        goleak.IgnoreCurrent(),
    )
}
```

Or per-test:

```go
func TestWorkerPool(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ... test code ...
}
```

## testing/synctest for Deterministic Goroutine Testing

`testing/synctest` (Go 1.25+) provides deterministic tests for goroutines, timers, deadlines, and context cancellation. Time advances only when all goroutines are blocked, making ordering predictable.

When to use `synctest` instead of real time:

- Testing concurrent code with time-based operations (time.Sleep, time.After, time.Ticker)
- When race conditions need to be reproducible
- When tests are flaky due to timing issues

```go
import (
    "context"
    "testing"
    "testing/synctest"
    "time"
)

func TestContextTimeout(t *testing.T) {
    synctest.Test(t, func(t *testing.T) {
        const timeout = 5 * time.Second

        ctx, cancel := context.WithTimeout(t.Context(), timeout)
        defer cancel()

        time.Sleep(timeout - time.Nanosecond)
        synctest.Wait()
        if err := ctx.Err(); err != nil {
            t.Fatalf("before timeout: %v", err)
        }

        time.Sleep(time.Nanosecond)
        synctest.Wait()
        if err := ctx.Err(); err != context.DeadlineExceeded {
            t.Fatalf("after timeout: got %v, want DeadlineExceeded", err)
        }
    })
}
```

Use `synctest.Test` in Go 1.25+ and Go 1.26+. Do not use the old Go 1.24 experimental `synctest.Run` API in Go 1.25+ or Go 1.26+ code. If a module explicitly targets Go 1.24 and opts into `GOEXPERIMENT=synctest`, use the old API only as a compatibility fallback.

Key differences in `synctest`:

- `time.Sleep` advances synthetic time instantly when the goroutine blocks
- `time.After` fires when synthetic time reaches the duration
- All goroutines run to blocking points before time advances
- Test execution is deterministic and repeatable

## Test Timeouts

For tests that may hang, prefer Go's built-in `go test -timeout` and cancellation through an existing context-aware API. Do not add a goroutine-based panic watchdog just for test setup. See [Helpers](./references/helpers.md).

## Benchmarks

→ See `golang-benchmark` skill for advanced benchmarking: `b.Loop()` (Go 1.24+), `benchstat`, profiling from benchmarks, and CI regression detection.

Write benchmarks to measure performance and detect regressions:

```go
func BenchmarkStringConcatenation(b *testing.B) {
    b.Run("plus-operator", func(b *testing.B) {
        for b.Loop() {
            result := "a" + "b" + "c"
            _ = result
        }
    })

    b.Run("strings.Builder", func(b *testing.B) {
        for b.Loop() {
            var builder strings.Builder
            builder.WriteString("a")
            builder.WriteString("b")
            builder.WriteString("c")
            _ = builder.String()
        }
    })
}
```

Benchmarks with different input sizes:

```go
func BenchmarkFibonacci(b *testing.B) {
    sizes := []int{10, 20, 30}
    for _, size := range sizes {
        b.Run(fmt.Sprintf("n=%d", size), func(b *testing.B) {
            b.ReportAllocs()
            for b.Loop() {
                Fibonacci(size)
            }
        })
    }
}
```

For Go 1.24+, new benchmarks should use `b.Loop()`. Use legacy `b.N` loops only when the module targets Go <1.24 or when preserving old benchmark code intentionally.

### Go 1.26+: test artifacts

When a test, benchmark, or fuzz target needs to persist files for inspection, use `ArtifactDir()` instead of ad-hoc paths or repo-local output.

```go
func TestRenderGoldenArtifact(t *testing.T) {
    dir := t.ArtifactDir()

    out := filepath.Join(dir, "rendered.json")
    if err := os.WriteFile(out, renderedBytes, 0o644); err != nil {
        t.Fatal(err)
    }

    t.Logf("artifact written: %s", out)
}
```

Available on `*testing.T`, `*testing.B`, and `*testing.F` in Go 1.26+.

## Parallel Tests

Use `t.Parallel()` for independent tests only when parallel execution is useful and all shared state is isolated:

```go
func TestParallelOperations(t *testing.T) {
    tests := []struct {
        name string
        data []byte
    }{
        {"small data", make([]byte, 1024)},
        {"medium data", make([]byte, 1024*1024)},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel()
            is := assert.New(t)

            result := Process(tt.data)
            is.NotNil(result)
        })
    }
}
```

## Fuzzing

When a parser, decoder, or security boundary processes broad/untrusted input, fuzzing can find failures that examples miss. It is optional and should check a meaningful property, not a tautology:

```go
func FuzzReverse(f *testing.F) {
    f.Add("hello")
    f.Add("")
    f.Add("a")

    f.Fuzz(func(t *testing.T, input string) {
        reversed := Reverse(input)
        doubleReversed := Reverse(reversed)
        if input != doubleReversed {
            t.Errorf("Reverse(Reverse(%q)) = %q, want %q", input, doubleReversed, input)
        }
    })
}
```

## Examples as Documentation

Add Example functions when executable examples materially improve public API documentation; they are not required for every package or function:

```go
func ExampleCalculatePrice() {
    price := CalculatePrice(100, 10.0)
    fmt.Printf("Price: %.2f\n", price)
    // Output: Price: 900.00
}

func ExampleCalculatePrice_singleItem() {
    price := CalculatePrice(1, 25.50)
    fmt.Printf("Price: %.2f\n", price)
    // Output: Price: 25.50
}
```

## Code Coverage

Coverage is a diagnostic to locate potential gaps, not a target or test-generation instruction. Investigate uncovered code only when it contains meaningful behavior or credible failure risk.

```bash
# Generate coverage file
go test -coverprofile=coverage.out ./...

# View coverage in HTML
go tool cover -html=coverage.out

# Coverage by function
go tool cover -func=coverage.out

# Total coverage percentage
go tool cover -func=coverage.out | grep total
```

## Integration Tests

Build tags are one way to isolate tests requiring external setup; follow existing repository conventions. Choose them when normal `go test` must not invoke those dependencies:

```go
//go:build integration

package mypackage

func TestDatabaseIntegration(t *testing.T) {
    db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
    if err != nil {
        t.Fatal(err)
    }
    defer db.Close()

    // Test real database operations
}
```

Run integration tests separately:

```bash
go test -tags=integration ./...
```

For Docker Compose fixtures, SQL schemas, and integration test suites, see [Integration Testing](./references/integration-testing.md).

## Mocking

When mocking is justified, substitute an existing consumer-facing interface or a real boundary; do not create production interfaces solely to accommodate tests. Use real cheap collaborators where possible.

For mock patterns, test fixtures, and time mocking, see [Mocking](./references/mocking.md).

## Enforce with Linters

Linters such as `thelper` and `testifylint` can catch mechanical mistakes. Enable only checks appropriate to the repository; do not introduce `paralleltest` merely to force `t.Parallel()`. See `golang-lint` for mechanics.

## Cross-References

- For the detailed testify API (assert, require, mock, suite), consult the testify documentation (→ See `golang-pkg-go-dev` skill)
- -> See `golang-database` skill (testing.md) for database integration test patterns
- -> See `golang-concurrency` skill for goroutine leak detection with goleak
- -> See `golang-continuous-integration` skill for CI test configuration and GitHub Actions workflows
- -> See `golang-lint` skill for testifylint and paralleltest configuration
- -> See `golang-continuous-integration` skill for automated AI-driven code review in CI using these guidelines

## Quick Reference

```bash
go test ./...                          # all tests
go test -run TestName ./...            # specific test by exact name
go test -run TestName/subtest ./...    # subtests within a test
go test -run 'Test(Add|Sub)' ./...     # multiple tests (regexp OR)
go test -run 'Test[A-Z]' ./...         # tests starting with capital letter
go test -run 'TestUser.*' ./...        # tests matching prefix
go test -run '.*Validation.*' ./...    # tests containing substring
go test -run TestName/. ./...          # all subtests of TestName
go test -run '/(unit|integration)' ./... # filter by subtest name
go test -race ./...                    # race detection
go test -cover ./...                   # coverage summary
go test -bench=. -benchmem ./...       # benchmarks
go test -fuzz=FuzzName ./...           # fuzzing
go test -tags=integration ./...        # integration tests
```
