---
name: golang-structs-interfaces
description: "Composition, embedding, type assertions, interface segregation, pointer vs value receivers, struct tags in Go. Use when designing Go types, defining or implementing interfaces, embedding structs, writing type assertions or type switches, choosing receivers, or adding struct field tags for JSON/YAML/DB serialization. Not for design patterns beyond type/interface design (→ See `golang-design-patterns`)."
license: MIT
metadata:
  author: Bateau
  version: "1.1.0"
  adapted-from: samber/cc-skills-golang@golang-structs-interfaces
---

> **House skill.** Adapted from `samber/cc-skills-golang@golang-structs-interfaces` for this workspace. Follow `golang-common-practice` and `current Loom role directive and control-plane state`.

**Persona:** You are a Go type system designer. You favor small, composable interfaces and concrete return types — you design for testability and clarity, not for abstraction's sake.

# Go Structs & Interfaces

## Interface Design Principles

### Keep Interfaces Small

> "The bigger the interface, the weaker the abstraction." — Go Proverbs

Interfaces SHOULD have 1-3 methods. Small interfaces are easier to implement, mock, and compose. If you need a larger contract, compose it from small interfaces:

→ See `golang-naming` skill for interface naming conventions (method + "-er" suffix, canonical names)

```go
type Reader interface {
    Read(p []byte) (n int, err error)
}

type Writer interface {
    Write(p []byte) (n int, err error)
}

// Composed from small interfaces
type ReadWriter interface {
    Reader
    Writer
}
```

### Define Interfaces Where They're Consumed

Interfaces Belong to Consumers.

Interfaces MUST be defined where consumed, not where implemented. This keeps the consumer in control of the contract and avoids importing a package just for its interface.

```go
// package notification — defines only what it needs
type Sender interface {
    Send(to, body string) error
}

type Service struct {
    sender Sender
}
```

The `email` package exports a concrete `Client` struct — it doesn't need to know about `Sender`.

### Accept Interfaces, Return Structs

Functions SHOULD accept interface parameters for flexibility and return concrete types for clarity. Callers get full access to the returned type's fields and methods; consumers upstream can still assign the result to an interface variable if needed.

```go
// Good — accepts interface, returns concrete
func NewService(store UserStore) *Service { ... }

// BAD — NEVER return interfaces from constructors
func NewService(store UserStore) ServiceInterface { ... }
```

### Don't Create Interfaces Prematurely

> "Don't design with interfaces, discover them."

NEVER create interfaces prematurely — wait for 2+ implementations or a testability requirement. A premature interface (single implementation, no second consumer) is a **zero-information token**: it increases the ceremony-to-logic ratio and adds cross-file navigation cost without any navigational value. Agents and humans alike must read through the interface layer to understand what the concrete type actually does. Start with concrete types; extract an interface when a second consumer or a test mock demands it.

```go
// Bad — premature interface with a single implementation
type UserRepository interface {
    FindByID(ctx context.Context, id string) (*User, error)
}
type userRepository struct { db *sql.DB }

// Good — start concrete, extract an interface later when needed
type UserRepository struct { db *sql.DB }
```

### Zero-Shot Usability

An interface is zero-shot usable when an agent (or a human unfamiliar with the codebase) can call it correctly from the **signature and a one-line docstring alone, with no additional context loaded**. Use this as your usability gate:

> "Can an agent call this interface correctly from the signature and a one-line docstring alone? If no, the interface is too complex."

**Parameter-count flag:** interfaces with 5+ methods or functions with 5+ parameters should be reviewed for zero-shot usability. Each method or parameter is a constraint the caller must satisfy correctly from the signature. When the count grows, the chance of a silent wrong call grows with it.

When a function crosses the 5-parameter threshold, reach for a config struct first:

```go
// Too many parameters — each must be satisfied from the signature alone
func Connect(host string, port int, user, pass string, tls bool, timeout time.Duration) (*Conn, error)

// Zero-shot usable — one well-named struct, compiler-checked fields
type ConnConfig struct {
    Host    string
    Port    int
    User    string
    Pass    string
    TLS     bool
    Timeout time.Duration
}
func Connect(cfg ConnConfig) (*Conn, error)
```

The same principle applies to interface method counts: if an interface has 5+ methods, split it into focused 1–3 method interfaces and compose if the full contract is needed.

## Make the Zero Value Useful

Design structs so they work without explicit initialization. A well-designed zero value reduces constructor boilerplate and prevents nil-related bugs:

```go
// Good — zero value is ready to use
var buf bytes.Buffer
buf.WriteString("hello")

var mu sync.Mutex
mu.Lock()

// Bad — zero value is broken, requires constructor
type Registry struct {
    items map[string]Item // nil map, panics on write
}

// Good — lazy initialization guards the zero value
func (r *Registry) Register(name string, item Item) {
    if r.items == nil {
        r.items = make(map[string]Item)
    }
    r.items[name] = item
}
```

## Avoid `any` / `interface{}` When a Specific Type Will Do

Since Go 1.18+, MUST prefer generics over `any` for type-safe operations. Use `any` only at true boundaries where the type is genuinely unknown (e.g., JSON decoding, reflection):

```go
// Bad — loses type safety
func Contains(slice []any, target any) bool { ... }

// Good — generic, type-safe
func Contains[T comparable](slice []T, target T) bool { ... }
```

## Key Standard Library Interfaces

| Interface     | Package         | Method                                |
| ------------- | --------------- | ------------------------------------- |
| `Reader`      | `io`            | `Read(p []byte) (n int, err error)`   |
| `Writer`      | `io`            | `Write(p []byte) (n int, err error)`  |
| `Closer`      | `io`            | `Close() error`                       |
| `Stringer`    | `fmt`           | `String() string`                     |
| `error`       | builtin         | `Error() string`                      |
| `Handler`     | `net/http`      | `ServeHTTP(ResponseWriter, *Request)` |
| `Marshaler`   | `encoding/json` | `MarshalJSON() ([]byte, error)`       |
| `Unmarshaler` | `encoding/json` | `UnmarshalJSON([]byte) error`         |

Canonical method signatures MUST be honored — if your type has a `String()` method, it must match `fmt.Stringer`. Don't invent `ToString()` or `ReadData()`.

## Compile-Time Interface Check

Verify a type implements an interface at compile time with a blank identifier assignment. Place it near the type definition:

```go
var _ io.ReadWriter = (*MyBuffer)(nil)
```

This costs nothing at runtime. If `MyBuffer` ever stops satisfying `io.ReadWriter`, the build fails immediately.

## Type Assertions & Type Switches

### Safe Type Assertion

Type assertions MUST use the comma-ok form to avoid panics:

```go
// Good — safe
s, ok := val.(string)
if !ok {
    // handle
}

// Bad — panics if val is not a string
s := val.(string)
```

### Type Switch

Discover the dynamic type of an interface value:

```go
switch v := val.(type) {
case string:
    fmt.Println(v)
case int:
    fmt.Println(v * 2)
case io.Reader:
    io.Copy(os.Stdout, v)
default:
    fmt.Printf("unexpected type %T\n", v)
}
```

### Optional Behavior with Type Assertions

Check if a value supports additional capabilities without requiring them upfront:

```go
type Flusher interface {
    Flush() error
}

func writeData(w io.Writer, data []byte) error {
    if _, err := w.Write(data); err != nil {
        return err
    }
    // Flush only if the writer supports it
    if f, ok := w.(Flusher); ok {
        return f.Flush()
    }
    return nil
}
```

This pattern is used extensively in the standard library (e.g., `http.Flusher`, `io.ReaderFrom`).

## Struct & Interface Embedding

### Struct Embedding

Embedding promotes the inner type's methods and fields to the outer type — composition, not inheritance:

```go
type Logger struct {
    *slog.Logger
}

type Server struct {
    Logger
    addr string
}

// s.Info(...) works — promoted from slog.Logger through Logger
s := Server{Logger: Logger{slog.Default()}, addr: ":8080"}
s.Info("starting", "addr", s.addr)
```

The receiver of promoted methods is the _inner_ type, not the outer. The outer type can override by defining its own method with the same name.

### When to Embed vs Named Field

| Use | When |
| --- | --- |
| **Embed** | You want to promote the full API of the inner type — the outer type "is a" enhanced version |
| **Named field** | You only need the inner type internally — the outer type "has a" dependency |

```go
// Embed — Server exposes all http.Handler methods
type Server struct {
    http.Handler
}

// Named field — Server uses the store but doesn't expose its methods
type Server struct {
    store *DataStore
}
```

## Dependency Injection via Interfaces

Accept dependencies as interfaces in constructors. This decouples components and makes testing straightforward:

```go
type UserStore interface {
    FindByID(ctx context.Context, id string) (*User, error)
}

type UserService struct {
    store UserStore
}

func NewUserService(store UserStore) *UserService {
    return &UserService{store: store}
}
```

In tests, pass a mock or stub that satisfies `UserStore` — no real database needed.

## Struct Field Tags

Use field tags for serialization control. Exported fields in serialized structs MUST have field tags:

```go
type Order struct {
    ID        string    `json:"id"         db:"id"`
    UserID    string    `json:"user_id"    db:"user_id"`
    Total     float64   `json:"total"      db:"total"`
    Items     []Item    `json:"items"      db:"-"`
    CreatedAt time.Time `json:"created_at" db:"created_at"`
    DeletedAt time.Time `json:"-"          db:"deleted_at"`
    Internal  string    `json:"-"          db:"-"`
}
```

| Directive               | Meaning                                     |
| ----------------------- | ------------------------------------------- |
| `json:"name"`           | Field name in JSON output                   |
| `json:"name,omitempty"` | Omit field if zero value                    |
| `json:"-"`              | Always exclude from JSON                    |
| `json:",string"`        | Encode number/bool as JSON string           |
| `db:"column"`           | Database column mapping (sqlx, etc.)        |
| `yaml:"name"`           | YAML field name                             |
| `xml:"name,attr"`       | XML attribute                               |
| `validate:"required"`   | Struct validation (go-playground/validator) |

## Pointer vs Value Receivers

| Use pointer `(s *Server)` | Use value `(s Server)` |
| --- | --- |
| Method modifies the receiver | Receiver is small and immutable |
| Receiver contains `sync.Mutex` or similar | Receiver is a basic type (int, string) |
| Receiver is a large struct | Method is a read-only accessor |
| Consistency: if any method uses a pointer, all should | Map and function values (already reference types) |

Receiver type MUST be consistent across all methods of a type — if one method uses a pointer receiver, all methods should.

## Preventing Struct Copies with `noCopy`

Some structs must never be copied after first use (e.g., those containing a mutex, a channel, or internal pointers). Embed a `noCopy` sentinel to make `go vet` catch accidental copies:

```go
// noCopy may be added to structs which must not be copied after first use.
// See https://pkg.go.dev/sync#noCopy
type noCopy struct{}

func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

type ConnPool struct {
    noCopy noCopy
    mu     sync.Mutex
    conns  []*Conn
}
```

`go vet` reports an error if a `ConnPool` value is copied (passed by value, assigned, etc.). This is the same technique the standard library uses for `sync.WaitGroup`, `sync.Mutex`, `strings.Builder`, and others.

Always pass these structs by pointer:

```go
// Good
func process(pool *ConnPool) { ... }

// Bad — go vet will flag this
func process(pool ConnPool) { ... }
```

## Cross-References

- → See `golang-naming` skill for interface naming conventions (Reader, Closer, Stringer)
- → See `golang-design-patterns` skill for functional options, constructors, and builder patterns
- → See `golang-dependency-injection` skill for DI patterns using interfaces
- → See `golang-code-style` skill for value vs pointer function parameters (distinct from receivers)

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Interface with 5+ methods or function with 5+ parameters | Apply the zero-shot usability test; split or use a config struct |
| Defining interfaces in the implementor package | Define where consumed |
| Returning interfaces from constructors | Return concrete types |
| Bare type assertions without comma-ok | Always use `v, ok := x.(T)` |
| Embedding when you only need a few methods | Use a named field and delegate explicitly |
| Missing field tags on serialized structs | Tag all exported fields in marshaled types |
| Mixing pointer and value receivers on a type | Pick one and be consistent |
| Forgetting compile-time interface check | Add `var _ Interface = (*Type)(nil)` |
| Using `ToString()` instead of `String()` | Honor canonical method names |
| Premature interface with a single implementation | Start concrete, extract interface when needed |
| Nil map/slice in zero value struct | Use lazy initialization in methods |
| Using `any` for type-safe operations | Use generics (`[T comparable]`) instead |
