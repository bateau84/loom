"""Custodian-owned stable ingress journal; no plugin imports or effect execution.

This is an internal trusted module, not a product-accessible database API. The
live/offline owner lock excludes cooperating custodians only. It is NOT physical
product confinement: a launcher must exclude this directory and all its handles.
Canonical import/transfer and generation activation are not intake operations.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import sqlite3
import stat
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path


class JournalError(Exception):
    """Stable, bounded failure classification; never an acknowledgement."""


class IdentityConflict(JournalError):
    """Same original identity has incompatible immutable inputs."""


class StorageUnavailable(JournalError):
    """Capacity/I/O remedy required; external outcome remains unknown."""


def identity(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9:._-]{0,255}", value):
        raise JournalError("invalid-identity")
    return value


@dataclass(frozen=True)
class Event:
    installation: str
    source: str
    event_id: str
    operation: str
    attempt: str
    epoch: int
    kind: str
    payload: bytes
    source_sequence: int | None = None
    predecessors: tuple[str, ...] = ()

    def __post_init__(self):
        for value in (self.installation, self.source, self.event_id, self.operation, self.attempt, self.kind):
            identity(value)
        if type(self.epoch) is not int:
            raise JournalError("invalid-source-context")
        for value in (self.epoch, self.source_sequence):
            if value is not None and (type(value) is not int or not 0 <= value < 2**63):
                raise JournalError("invalid-source-context")
        if type(self.payload) is not bytes or type(self.predecessors) is not tuple:
            raise JournalError("immutable-event-required")
        if len(self.predecessors) > 256 or len(set(self.predecessors)) != len(self.predecessors):
            raise JournalError("invalid-predecessors")
        for value in self.predecessors:
            identity(value)
        if self.event_id in self.predecessors:
            raise JournalError("self-predecessor")

    @property
    def digest(self) -> str:
        return hashlib.sha256(self.payload).hexdigest()

    @property
    def context(self) -> bytes:
        return json.dumps({"installation": self.installation, "source": self.source,
                           "eventId": self.event_id, "operation": self.operation,
                           "attempt": self.attempt, "epoch": self.epoch, "kind": self.kind,
                           "sourceSequence": self.source_sequence,
                           "predecessors": list(self.predecessors)},
                          sort_keys=True, separators=(",", ":")).encode("utf-8")


@dataclass(frozen=True)
class Receipt:
    sequence: int
    installation: str
    source: str
    event_id: str
    digest: str


@dataclass(frozen=True)
class Generation:
    id: str
    code_ref: str
    data_ref: str
    code_digest: str
    data_digest: str

    def __post_init__(self):
        for value in (self.id, self.code_ref, self.data_ref):
            identity(value)
        for value in (self.code_digest, self.data_digest):
            if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
                raise JournalError("invalid-generation-digest")


@dataclass(frozen=True)
class Selection:
    generation: Generation | None
    token: int
    admissions_open: bool

    def __post_init__(self):
        if (type(self.token) is not int or not 0 <= self.token < 2**63
                or type(self.admissions_open) is not bool
                or (self.generation is not None and type(self.generation) is not Generation)):
            raise JournalError("invalid-generation-selection")
        if (self.generation is None and (self.token != 0 or self.admissions_open)
                or self.generation is not None and self.token == 0):
            raise JournalError("inconsistent-generation-selection")


class Journal:
    """One synchronous live/offline owner. Returning Receipt follows FULL COMMIT.

    The caller supplies an already authorized protected directory. There is no
    ambient HOME/config discovery, default production path or auto-migration.
    All source bindings must be authenticated by the owning IPC layer before
    Event construction; claimed strings alone are not source authentication.
    """
    def __init__(self, root: Path, installation: str, *, create: bool = False):
        self.installation = identity(installation)
        self._lock_fd = None
        self._db = None
        self._healthy = True
        root = root.absolute()
        if root.resolve() != root:
            raise JournalError("symlink-custody-root")
        root_info = root.stat()
        if (not stat.S_ISDIR(root_info.st_mode) or root_info.st_uid != os.geteuid()
                or root_info.st_mode & 0o077):
            raise JournalError("private-owned-root-required")
        try:
            self._lock_fd = os.open(root / "owner.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
            info = os.fstat(self._lock_fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or info.st_uid != os.geteuid() or info.st_mode & 0o077):
                raise JournalError("invalid-owner-lock")
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise JournalError("custodian-already-owned") from error
            path = root / "journal.sqlite3"
            for name in ("journal.sqlite3", "journal.sqlite3-wal", "journal.sqlite3-shm"):
                target = root / name
                if target.exists() or target.is_symlink():
                    info = target.lstat()
                    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                            or info.st_uid != os.geteuid()):
                        raise JournalError("invalid-journal-file")
            if create and path.exists():
                raise JournalError("journal-already-exists")
            if create:
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
                os.close(fd)
            self._db = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, isolation_level=None)
            self._db.row_factory = sqlite3.Row
            self._db.execute("PRAGMA foreign_keys=ON")
            self._db.execute("PRAGMA trusted_schema=OFF")
            self._db.execute("PRAGMA synchronous=FULL")
            if self._db.execute("PRAGMA journal_mode=WAL").fetchone()[0] != "wal":
                raise JournalError("wal-unavailable")
            if self._db.execute("PRAGMA synchronous").fetchone()[0] != 2:
                raise JournalError("full-durability-unavailable")
            if create:
                with self._transaction():
                    self._db.execute("CREATE TABLE installation (id TEXT PRIMARY KEY, version INTEGER NOT NULL)")
                    self._db.execute("INSERT INTO installation VALUES (?, 2)", (self.installation,))
                    self._db.execute("""CREATE TABLE ingress (
                        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                        source TEXT NOT NULL, event_id TEXT NOT NULL,
                        digest TEXT NOT NULL, context BLOB NOT NULL, payload BLOB NOT NULL,
                        UNIQUE(source, event_id))""")
                    self._db.execute("""CREATE TABLE conflict (
                        ingress_sequence INTEGER NOT NULL REFERENCES ingress(sequence),
                        digest TEXT NOT NULL, context BLOB NOT NULL, payload BLOB NOT NULL,
                        UNIQUE(ingress_sequence, digest, context))""")
                    self._db.execute("""CREATE TABLE generation (
                        id TEXT PRIMARY KEY, code_ref TEXT NOT NULL, data_ref TEXT NOT NULL,
                        code_digest TEXT NOT NULL, data_digest TEXT NOT NULL)""")
                    self._db.execute("""CREATE TABLE selection_history (
                        token INTEGER PRIMARY KEY AUTOINCREMENT,
                        generation_id TEXT NOT NULL REFERENCES generation(id),
                        decision_ref TEXT NOT NULL)""")
                    self._db.execute("""CREATE TABLE current_selection (
                        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                        token INTEGER REFERENCES selection_history(token),
                        admissions_open INTEGER NOT NULL CHECK(admissions_open IN (0,1)))""")
                    self._db.execute("INSERT INTO current_selection VALUES (1, NULL, 0)")
                directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            metadata = self._db.execute("SELECT id, version FROM installation").fetchall()
            if len(metadata) != 1 or metadata[0]["id"] != self.installation or metadata[0]["version"] != 2:
                raise JournalError("installation-or-format-mismatch")
        except BaseException:
            self.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        try:
            if self._db is not None:
                self._db.close()
                self._db = None
        finally:
            if self._lock_fd is not None:
                os.close(self._lock_fd)
                self._lock_fd = None

    @contextmanager
    def _transaction(self):
        if self._db is None or not self._healthy:
            raise StorageUnavailable("journal-closed-or-write-uncertain")
        try:
            self._db.execute("BEGIN IMMEDIATE")
            yield
            self._db.execute("COMMIT")
        except BaseException as error:
            if self._db.in_transaction:
                try:
                    self._db.execute("ROLLBACK")
                except sqlite3.Error:
                    self._healthy = False
            if isinstance(error, sqlite3.Error):
                self._healthy = False
                raise StorageUnavailable("journal-write-unacknowledged") from error
            raise

    def receive(self, event: Event) -> Receipt:
        if event.installation != self.installation:
            raise JournalError("wrong-installation")
        conflicting = False
        with self._transaction():
            row = self._db.execute("SELECT * FROM ingress WHERE source=? AND event_id=?",
                                   (event.source, event.event_id)).fetchone()
            if row is not None:
                sequence = row["sequence"]
                if (row["digest"] != event.digest or row["context"] != event.context
                        or row["payload"] != event.payload):
                    self._db.execute("""INSERT OR IGNORE INTO conflict
                        (ingress_sequence, digest, context, payload) VALUES (?, ?, ?, ?)""",
                        (sequence, event.digest, event.context, event.payload))
                    conflicting = True
            else:
                sequence = self._db.execute("""INSERT INTO ingress
                    (source, event_id, digest, context, payload) VALUES (?, ?, ?, ?, ?)""",
                    (event.source, event.event_id, event.digest, event.context, event.payload)).lastrowid
        if conflicting:
            # Commit quarantine before refusal; never acknowledge a second
            # claimed outcome or overwrite the original event/receipt.
            raise IdentityConflict("ingress-identity-conflict")
        return Receipt(sequence, self.installation, event.source, event.event_id, event.digest)

    def read(self, sequence: int) -> Event:
        row = self._db.execute("SELECT * FROM ingress WHERE sequence=?", (sequence,)).fetchone()
        if row is None:
            raise JournalError("ingress-not-found")
        event = self._decode(row)
        if event.source != row["source"] or event.event_id != row["event_id"]:
            raise JournalError("ingress-integrity-failure")
        return event

    def _decode(self, row) -> Event:
        context = json.loads(row["context"])
        event = Event(context["installation"], context["source"], context["eventId"],
                      context["operation"], context["attempt"], context["epoch"], context["kind"],
                      row["payload"], context["sourceSequence"], tuple(context["predecessors"]))
        if (event.digest != row["digest"] or event.installation != self.installation
                or event.context != row["context"]):
            raise JournalError("ingress-integrity-failure")
        return event

    def conflicts(self, sequence: int) -> tuple[Event, ...]:
        original = self.read(sequence)
        events = tuple(self._decode(row) for row in self._db.execute(
            "SELECT * FROM conflict WHERE ingress_sequence=? ORDER BY rowid", (sequence,)))
        if any((event.source, event.event_id) != (original.source, original.event_id) for event in events):
            raise JournalError("conflict-integrity-failure")
        return events

    def selection(self) -> Selection:
        row = self._db.execute("""SELECT c.token, c.admissions_open, g.*
            FROM current_selection c LEFT JOIN selection_history h ON h.token=c.token
            LEFT JOIN generation g ON g.id=h.generation_id WHERE c.singleton=1""").fetchone()
        if row is None or row["admissions_open"] not in (0, 1):
            raise JournalError("selection-integrity-failure")
        if row["token"] is None:
            if row["admissions_open"]:
                raise JournalError("unselected-generation-cannot-admit")
            return Selection(None, 0, False)
        if row["id"] is None:
            raise JournalError("selected-generation-missing")
        return Selection(Generation(row["id"], row["code_ref"], row["data_ref"],
                                    row["code_digest"], row["data_digest"]),
                         row["token"], bool(row["admissions_open"]))

    def _select_generation(self, expected: Selection, pair: Generation, decision_ref: str) -> Selection:
        """Internal custodian transaction, NEVER a product IPC operation.

        Caller must hold the same admission gate as writes/invocation and have
        actually verified staged code/data closure, sync and old-domain/handle
        drainage. This repository proves atomic selection ONLY; an owner lock,
        digest-shaped string or SQL commit is not physical fencing/restore proof.
        No admission-open operation exists until that controlling seam is wired.
        Schema2 is explicit; old schema1 is not silently migrated or overwritten.
        """
        identity(decision_ref)
        if type(pair) is not Generation or type(expected) is not Selection:
            raise JournalError("generation-selection-contract")
        with self._transaction():
            before = self.selection()
            if before != expected:
                raise IdentityConflict("generation-selection-changed")
            if before.admissions_open:
                raise JournalError("generation-selection-needs-closed-admissions")
            existing = self._db.execute("SELECT * FROM generation WHERE id=?", (pair.id,)).fetchone()
            fields = (pair.id, pair.code_ref, pair.data_ref, pair.code_digest, pair.data_digest)
            if existing is not None:
                original = (existing["id"], existing["code_ref"], existing["data_ref"],
                            existing["code_digest"], existing["data_digest"])
                if original != fields:
                    raise IdentityConflict("generation-identity-conflict")
            else:
                self._db.execute("INSERT INTO generation VALUES (?, ?, ?, ?, ?)", fields)
            token = self._db.execute("INSERT INTO selection_history (generation_id, decision_ref) VALUES (?, ?)",
                                     (pair.id, decision_ref)).lastrowid
            self._db.execute("UPDATE current_selection SET token=?, admissions_open=0 WHERE singleton=1", (token,))
            selected = self.selection()
        return selected

    def inspect(self) -> dict:
        return {"installation": self.installation,
                "formatVersion": 2,
                "ingressCount": self._db.execute("SELECT count(*) FROM ingress").fetchone()[0],
                "conflictCount": self._db.execute("SELECT count(*) FROM conflict").fetchone()[0],
                "writeHealthy": self._healthy}
