"""SQLite storage for the single admin, sessions, sources, and servers."""

from __future__ import annotations

import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

_SCHEMA = """
CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until REAL
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    root_path TEXT,
    host TEXT,
    port INTEGER,
    username TEXT,
    remote_path TEXT,
    password_enc TEXT,
    private_key_enc TEXT,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS host_keys (
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    PRIMARY KEY (host, port)
);
"""


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.execute("PRAGMA busy_timeout=5000")
            self._conn.executescript(_SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield self._conn
            except Exception:
                self._conn.execute("ROLLBACK")
                raise
            else:
                self._conn.execute("COMMIT")

    def fetchone(self, sql: str, params: tuple = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, params).fetchone()

    def fetchall(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self._conn.execute(sql, params).fetchall())

    def ensure_admin(self, password_hash: str) -> None:
        with self.transaction() as conn:
            row = conn.execute("SELECT id FROM admin WHERE id = 1").fetchone()
            if row is None:
                conn.execute(
                    """
                    INSERT INTO admin (id, password_hash, failed_attempts, locked_until)
                    VALUES (1, ?, 0, NULL)
                    """,
                    (password_hash,),
                )

    def purge_expired_sessions(self, now: float | None = None) -> None:
        moment = time.time() if now is None else now
        with self.transaction() as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (moment,))

    def remember_host_key(self, host: str, port: int, fingerprint: str) -> str:
        """Store a host key the first time it is seen. Return the stored fingerprint."""
        with self.transaction() as conn:
            conn.execute(
                """
                INSERT INTO host_keys (host, port, fingerprint)
                VALUES (?, ?, ?)
                ON CONFLICT(host, port) DO NOTHING
                """,
                (host, int(port), fingerprint),
            )
            row = conn.execute(
                "SELECT fingerprint FROM host_keys WHERE host = ? AND port = ?",
                (host, int(port)),
            ).fetchone()
        if row is None:
            raise RuntimeError("host key was not stored")
        return str(row["fingerprint"])
