---
name: python-database-orm
description: "PostgreSQL, MySQL, SQLAlchemy (sync + async), Django ORM, asyncpg, psycopg, databases, tortoise-orm, and other server-based Python databases. Use when setting up SQLAlchemy or Django ORM, configuring an asyncpg/psycopg connection pool, writing a repository over an ORM, running Alembic or Django migrations, choosing between sync and async drivers, or troubleshooting N+1 queries. Not for stdlib `sqlite3` (→ See `python-database`)."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

> **House skill.** Follow `python-common-practice` and `current Loom role directive and control-plane state`. Pairs with `python-error-handling` and `python-testing` (real-DB fixtures).

**Persona:** You are a Python engineer who works with server-side databases. SQLAlchemy and Django ORM are your default; raw SQL is the escape hatch, never the starting point.

# Server-side Python databases — SQLAlchemy, asyncpg, Django ORM

## When to use / scope

Load this skill for any server-based Python database work: ORM setup, async driver configuration, connection pool tuning, migration tooling, or N+1 debugging. This covers SQLAlchemy 2.x (sync and async), asyncpg, and Django ORM. For stdlib `sqlite3` and embedded-database patterns, see the `python-database` skill instead — it covers `sqlite3` module usage, WAL mode, and SQLite-specific pragmas. This skill is for databases that run as a separate process: PostgreSQL, MySQL, MariaDB, and their ecosystems.

## SQLAlchemy 2.x sync

SQLAlchemy 2.x uses a declarative base for models and a `Session` for all database interaction. The sync engine is the default for scripts, CLI tools, and synchronous web frameworks.

```python
from sqlalchemy import create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, Session

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]
    email: Mapped[str]

engine = create_engine("postgresql+psycopg://user:pass@localhost/mydb", echo=True)

# Schema creation (use Alembic in production)
Base.metadata.create_all(engine)

# CRUD via session.execute(select(...))
with Session(engine) as session:
    session.add(User(name="Alice", email="alice@example.com"))
    session.flush()  # assigns IDs without committing

    stmt = select(User).where(User.name == "Alice")
    user = session.execute(stmt).scalar_one()

    user.email = "alice_new@example.com"
    session.delete(user)
    session.commit()
```

The `select()` construct replaces the legacy `session.query()` API. Always prefer `session.execute(select(Model).where(...))` — it is the standard in 2.x and aligns with the async API. Transactions are implicit within `Session`: `commit()` ends the transaction; an exception before commit triggers automatic rollback when used as a context manager. For explicit control, use `session.begin()` as a nested context. Schema metadata lives on `Base.metadata` — use it for programmatic inspection, but prefer Alembic for production migrations.

## SQLAlchemy 2.x async

The async engine (`create_async_engine`) and `AsyncSession` mirror the sync API but run on an async event loop. This is the standard for FastAPI, Starlette, and any async web framework.

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select

engine = create_async_engine("postgresql+asyncpg://user:pass@localhost/mydb")
async_session = async_sessionmaker(engine, expire_on_commit=False)

async def get_user(user_id: int) -> User:
    async with async_session() as session:
        async with session.begin():
            stmt = select(User).where(User.id == user_id)
            return (await session.execute(stmt)).scalar_one()
```

**Key lifecycle rules:**

- Always use `async with session.begin()` for writes — it commits on success and rolls back on exception, keeping the session state clean.
- For reads that don't modify data, `async with session() as session:` (without `begin()`) is fine — it auto-rolls-back on exception.
- Set `expire_on_commit=False` on the session factory if you access attributes after commit — otherwise you get lazy-load errors in async context.

**`AsyncSession.run_sync`** — run synchronous code inside an async session. Essential for testing with transactional rollback: wrap your test in `async with session.begin()`, do work, then call `await session.run_sync(sync_fn)` for synchronous ORM operations. Also useful for Alembic migrations called from async code.

**The "async detector" footgun:** SQLAlchemy's async sessions raise a cryptic error if you access a lazy-loaded relationship synchronously (e.g., `user.profile` without `await`). This happens when code that works in sync mode is copy-pasted into an async path. The fix is `selectinload` or `joinedload` in your query, or setting `lazy="selectin"` on the relationship. Always eager-load relationships you know you'll access.

## asyncpg

asyncpg is a high-performance, pure-Python async PostgreSQL driver. Use it directly when you need raw speed without ORM overhead, or when SQLAlchemy's async engine is too heavy for your use case.

```python
import asyncpg

pool = await asyncpg.create_pool(
    "postgresql://user:pass@localhost/mydb",
    min_size=5,
    max_size=20,
)

async with pool.acquire() as conn:
    # Single row
    row = await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)

    # Multiple rows
    rows = await conn.fetch("SELECT * FROM users WHERE active = $1", True)

    # Transaction
    async with conn.transaction():
        await conn.execute("UPDATE users SET active = $1 WHERE id = $2", False, user_id)

    # Prepared statements (auto-cached by connection)
    stmt = await conn.prepare("SELECT * FROM users WHERE id = $1")
    user = await stmt.fetchrow(user_id)
```

**Pool configuration:** `min_size` / `max_size` control the pool bounds. `min_size=0` creates a lazy pool that connects on first use — useful for serverless/lambda where the process may never touch the DB.

**Prepared statements:** asyncpg automatically caches prepared statements per connection. For hot paths, explicitly prepare with `conn.prepare()` to avoid the round-trip on repeated queries. Use `$1`, `$2` positional parameters (not `?` or `%s`).

**Transaction context:** `async with conn.transaction()` gives you a transaction that commits on clean exit and rolls back on exception. Nested transactions use savepoints automatically.

## Django ORM

Django's ORM is the default for Django projects. It uses a class-based model definition and a QuerySet API for queries.

```python
from django.db import models

class User(models.Model):
    name = models.CharField(max_length=100)
    email = models.EmailField(unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
```

**QuerySet basics:**

```python
active_users = User.objects.filter(is_active=True)
staff = User.objects.exclude(role="user")
alice = User.objects.get(email="alice@example.com")  # raises DoesNotExist
```

**Solving N+1 — `select_related` and `prefetch_related`:**

```python
class Order(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    product = models.ForeignKey("Product", on_delete=models.CASCADE)

class Product(models.Model):
    name = models.CharField(max_length=200)
    category = models.ForeignKey("Category", on_delete=models.SET_NULL, null=True)

# N+1: each order triggers separate queries for user and product
orders = Order.objects.all()
for order in orders:
    print(order.user.name, order.product.name)  # 2N queries!

# Fixed with select_related (JOIN for FK):
orders = Order.objects.select_related("user", "product").all()

# For reverse or many-to-many, use prefetch_related:
products = Product.objects.prefetch_related("category").all()
```

Rule of thumb: `select_related` for `ForeignKey` and `OneToOneField` (SQL JOIN), `prefetch_related` for `ManyToManyField` and reverse FK (separate query, cached in Python).

**`F()` and `Q()` expressions:**

```python
from django.db.models import F, Q

User.objects.update(login_count=F("login_count") + 1)
users = User.objects.filter(Q(is_active=True) | Q(role="admin"))
```

**Migrations:**

```bash
python manage.py makemigrations   # generate migration from model changes
python manage.py migrate          # apply pending migrations
python manage.py showmigrations   # list migration status
```

Alembic (SQLAlchemy) and Django migrations serve the same purpose — never skip them in production.

## Connection pool tuning

Connection pools prevent the cost of establishing a new connection on every request. SQLAlchemy and asyncpg both expose pool knobs that matter in production.

**SQLAlchemy sync pool (`QueuePool`):**

- `pool_size` — number of persistent connections (default 5). Set this to match your typical concurrent-query count, not your total worker count.
- `max_overflow` — connections beyond `pool_size` created on demand and then closed (default 10). With 20 workers, `pool_size=10, max_overflow=10` is a common starting point.
- `pool_pre_ping` — sends `SELECT 1` before handing out a connection. Catches stale/broken connections from cloud PgBouncer or load-balanced Postgres. Enable it (`True`) unless you're certain your network is stable.
- `pool_recycle` — seconds before a connection is recycled (default -1, no recycle). Set to 1800 (30 min) behind PgBouncer or cloud DB proxies that drop idle connections.
- `pool_timeout` — seconds to wait for a connection before raising `QueuePool limit of size X overflow Y reached` (default 30). Lower it if your app should fail fast rather than queue.
- `pool_use_lifo` — use last-in-first-out so the same connections stay warm (default False). Set `True` to reduce connection churn.

**When to use `NullPool`:** serverless functions (AWS Lambda, Cloud Run) and per-request session patterns. `NullPool` creates and destroys a connection on every `engine.connect()` call — no pool overhead, no stale-connection risk, but higher latency per query.

```python
from sqlalchemy.pool import NullPool

# Serverless / per-request: no pool
engine = create_engine(url, poolclass=NullPool)

# Production web app: tuned pool
engine = create_engine(
    url,
    pool_size=10,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_timeout=30,
    pool_use_lifo=True,
)
```

## Repository pattern example

The repository abstracts data access behind an interface. Services depend on the repository, never on the ORM session directly. This makes it possible to swap ORM, database, or add caching without touching business logic.

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Generic, TypeVar, Type

ModelType = TypeVar("ModelType")

class Repository(Generic[ModelType]):
    def __init__(self, model: Type[ModelType], session: AsyncSession):
        self.model = model
        self.session = session

    async def get(self, id: int) -> ModelType | None:
        return await self.session.get(self.model, id)

    async def list(self, *, offset: int = 0, limit: int = 100) -> list[ModelType]:
        stmt = select(self.model).offset(offset).limit(limit)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def create(self, **kwargs) -> ModelType:
        obj = self.model(**kwargs)
        self.session.add(obj)
        await self.session.flush()
        return obj

    async def delete(self, id: int) -> bool:
        obj = await self.session.get(self.model, id)
        if obj is None:
            return False
        await self.session.delete(obj)
        return True
```

The session is injected, never created inside the repository — this keeps transaction control with the caller (the service layer or the web framework's dependency).

## Async session lifecycle in a web app

In FastAPI, the session lifecycle follows the request lifecycle. Create the session per-request, yield it to the handler, and ensure cleanup on exception.

```python
from collections.abc import AsyncIterator
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

engine = create_async_engine("postgresql+asyncpg://user:pass@localhost/mydb")
async_session = async_sessionmaker(engine, expire_on_commit=False)

async def get_session() -> AsyncIterator[AsyncSession]:
    async with async_session() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise

@app.post("/users/")
async def create_user(data: UserCreate, db: AsyncSession = Depends(get_session)):
    user = User(**data.model_dump())
    db.add(user)
    await db.commit()
    return user
```

**Why `try/except/rollback` instead of `try/finally`:** SQLAlchemy's `AsyncSession` already rolls back on `__aexit__` with an exception, but the explicit rollback makes the intent clear and avoids a subtle edge case where a `ProgrammingError` bypasses the automatic path. If the session is used with `session.begin()`, the context manager handles commit/rollback automatically and the explicit rollback is redundant. `expire_on_commit=False` is critical — without it, accessing any attribute after `commit()` triggers a lazy reload that fails in async context.

## Real-DB testing

Integration tests must run against a real PostgreSQL instance. `sqlite:///:memory:` is not a faithful substitute — it lacks PostgreSQL-specific types (`JSONB`, `ARRAY`, `UUID`), has different SQL dialect behavior (`ILIKE` vs `LIKE`), no `ON CONFLICT DO UPDATE` semantics, and different locking behavior. Tests that pass on SQLite will silently pass on wrong assumptions.

**testcontainers-python** spins up a real Postgres container per test session:

```python
import pytest
from testcontainers.postgres import PostgresContainer
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

@pytest.fixture(scope="session")
def postgres():
    with PostgresContainer("postgres:16") as pg:
        yield pg

@pytest.fixture(scope="session")
async def engine(postgres):
    url = postgres.get_connection_url().replace("psycopg2", "asyncpg")
    eng = create_async_engine(url)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()

@pytest.fixture
async def session(engine):
    async_session = async_sessionmaker(engine, expire_on_commit=False)
    async with async_session() as sess:
        async with sess.begin():
            yield sess
            await sess.rollback()
```

**Transactional rollback per test:** the `session` fixture wraps each test in a transaction and rolls back at the end. This gives each test a clean database state without re-creating tables or re-inserting fixtures. The `scope="session"` on `engine` and `postgres` ensures the container and schema are shared — only the transaction is per-test.
