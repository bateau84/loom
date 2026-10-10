# Test Timeouts

Use the Go test runner's built-in timeout when protecting against a hung suite:

```bash
go test -timeout=30s ./...
```

For an operation whose accepted contract includes cancellation or deadlines, test it through the real context-aware API. Use `context.WithTimeout` or `t.Context()` as appropriate to the module's Go version. If the test must prove timer ordering or deadline behavior, prefer `testing/synctest` or a controlled clock rather than waiting for real wall-clock time.

Do not add a detached goroutine that panics after a test-specific delay: the panic can terminate the entire test process and obscure the actual failing behavior. A test-specific deadline should justify its own cost by protecting a real hang or cancellation scenario.
