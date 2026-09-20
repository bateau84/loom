---
name: python-pydantic
description: "Data modeling and configuration with Pydantic v2 and pydantic-settings — BaseModel, Field constraints and defaults, validators (field_validator/model_validator), computed fields, model_config, serialization (model_dump/model_validate), and layered settings from env vars / .env / defaults with BaseSettings and env_prefix. Use when defining data models, validating input, shaping API schemas, or loading typed application configuration from the environment. Also use when the user mentions pydantic, BaseModel, BaseSettings, validators, or env-based config in Python."
license: MIT
metadata:
  author: Bateau
  version: "1.1.0"
---

> **House skill.** Follow `python-common-practice` and `current Loom role directive and control-plane state`. Pairs with `python-fastapi` (request/response models) and `python-type-checking`.

**Persona:** You are a Python engineer who pushes validation to the boundary. Once data is a validated model, the rest of the code trusts it.

# Pydantic v2 and pydantic-settings

Pydantic parses untrusted input into typed, validated objects at the system boundary. The interior of the program then works with guaranteed-valid data — no defensive `isinstance` checks scattered everywhere. This is the "parse, don't validate" posture.

This skill targets **Pydantic v2** (`model_dump`, `model_validate`, `model_config`). The v1 API (`.dict()`, `.parse_obj()`, `class Config`) is deprecated — don't mix them.

## Models with constrained fields

Put constraints in `Field`, not in hand-written `if` checks. The constraint becomes validation *and* OpenAPI documentation.

```python
from pydantic import BaseModel, Field
from typing import Literal

class MatchRule(BaseModel):
    pattern: str = Field(min_length=1, max_length=200)
    distance: int = Field(default=80, ge=0, le=100)   # bounded, like sortarr's compare_distance
    action: Literal["allow", "deny"] = "deny"
```

- `ge/le/gt/lt` for numeric bounds, `min_length/max_length` for strings/collections, `pattern` for regex.
- `Literal[...]` for closed sets — better than a free `str` plus a manual check.
- Mutable defaults are safe in Pydantic (`Field(default_factory=list)` for clarity); each instance gets its own.

## Validators — when a constraint isn't enough

Use `field_validator` for one field, `model_validator(mode="after")` for cross-field rules. Keep them pure; raise `ValueError` and Pydantic wraps it into a `ValidationError`.

```python
from pydantic import field_validator, model_validator

class Schedule(BaseModel):
    cron: str

    @field_validator("cron")
    @classmethod
    def valid_cron(cls, v: str) -> str:
        if len(v.split()) != 5:
            raise ValueError("cron must have 5 fields")
        return v
```

Prefer `mode="after"` (runs on the parsed/typed value); reach for `mode="before"` only to coerce raw input shapes.

## Serialization

```python
m.model_dump()                       # -> dict
m.model_dump(exclude_none=True)      # drop None fields
m.model_dump_json()                  # -> JSON str
Model.model_validate(some_dict)      # parse/validate a dict
Model.model_validate_json(raw)       # parse/validate JSON bytes/str
```

Don't reach into `__dict__` or build dicts by hand — `model_dump` honors aliases, exclusions, and serializers.

## Settings — layered config from the environment

`BaseSettings` reads typed config from env vars and `.env`, with code defaults as the floor. This is sortarr's `Settings` (prefix `SORTARR_`, `.env` file, bounded fields).

```python
from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    model_config = {"env_prefix": "SORTARR_", "env_file": ".env", "env_file_encoding": "utf-8"}

    database_file: str = Field(default="sortarr.db")
    api_port: int = Field(default=8080)
    compare_distance: int = Field(default=80, ge=0, le=100)   # validated at load
```

Precedence (highest first): explicit init args → environment variables → `.env` file → field defaults. So `SORTARR_API_PORT=9000` overrides the default, and an out-of-range value fails fast at startup instead of surfacing as a bug later.

- Load settings **once** at startup and pass the object down (dependency injection), rather than reading env vars throughout the code.
- Never bake secrets into defaults. Read them from the environment; for files use `SecretStr` so they don't print in logs/`model_dump()`.
- Validation runs at construction — a bad env var crashes startup loudly, which is what you want.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| v1 `.dict()`/`.parse_obj()`/`class Config` | Use v2 `model_dump()`/`model_validate()`/`model_config`. |
| Manual `if not 0 <= x <= 100` checks | Express bounds in `Field(ge=0, le=100)`. |
| Reading `os.environ` scattered through code | One `BaseSettings` loaded at startup, injected. |
| Secret in a field default | Read from env; wrap in `SecretStr`. |
| Free `str` for a closed set of values | Use `Literal[...]` or an `Enum`. |
| Building output dicts by hand | `model_dump()` — respects aliases/exclusions. |

**Diagnose:** 1- a type checker (→ See `python-type-checking`) — catches model field/type mismatches before runtime 2- start the app with a deliberately bad env var — a clean `ValidationError` at startup confirms config is validated, not silently accepted.

## References

- [Pydantic v2 documentation](https://docs.pydantic.dev/latest/)
- [Pydantic — Migration guide (v1 → v2)](https://docs.pydantic.dev/latest/migration/)
- [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/)
- [Alexis King — Parse, don't validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)
