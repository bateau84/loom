# Test Helpers

## Test Timeout

Prefer the built-in `go test -timeout` for suite-level hang protection, and `context.WithTimeout` or `t.Deadline()` when the operation itself supports cancellation. A detached watchdog that panics can abruptly abort unrelated tests. The legacy helper below is an illustration, not a default test utility:

```go
// https://github.com/stretchr/testify/issues/1101
func testWithTimeout(t *testing.T, timeout time.Duration) {
    t.Helper()

    testFinished := make(chan struct{})
    t.Cleanup(func() {
        close(testFinished)
    })

    var pc [1]uintptr
    n := runtime.Callers(2, pc[:])
    line, funcName := "", ""
    if n > 0 {
        frames := runtime.CallersFrames(pc[:])
        frame, _ := frames.Next()
        line = frame.File + ":" + strconv.Itoa(frame.Line)
        funcName = frame.Function
    }

    go func() {
        select {
        case <-testFinished:
        case <-time.After(timeout):
            panic(fmt.Sprintf("%s: Test timed out after: %v\n%s", funcName, timeout, line))
        }
    }()
}

// Usage
func TestLongRunningOperation(t *testing.T) {
    testWithTimeout(t, 2*time.Second)
    result := LongRunningOperation()
    // If this takes longer than 2 seconds, the test panics with location info
}
```
