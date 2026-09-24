"""SQLite storage for the single admin, sessions, sources, and servers.

Existing volumes are migrated in place. New columns and the session id index are
added without deleting admin, session, source, server, or host-key rows.
"""

from __future__ import annotations

import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

_SCHEMA = """
CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until REAL,
    appearance TEXT CHECK (appearance IN ('light', 'dark')),
    first_run_appearance_done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    id TEXT NOT NULL,
    created_at REAL NOT NULL,
    last_seen_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    user_agent TEXT,
    ip TEXT
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


def _column_names(conn: sqlite3.Connection, table: str) -> set[str]:
    if table not in {"admin", "sessions"}:
        raise RuntimeError(f"unexpected table {table}")
    return {str(row["name"]) for row in conn.execute(f"PRAGMA table_info({table})")}


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
            self._migrate(self._conn)

    def _migrate(self, conn: sqlite3.Connection) -> None:
        """Add Draft 2.1.4 columns on databases created before them."""
        conn.execute("BEGIN IMMEDIATE")
        try:
            admin_cols = _column_names(conn, "admin")
            if "appearance" not in admin_cols:
                conn.execute("ALTER TABLE admin ADD COLUMN appearance TEXT")
            if "first_run_appearance_done" not in admin_cols:
                conn.execute(
                    """
                    ALTER TABLE admin
                    ADD COLUMN first_run_appearance_done INTEGER NOT NULL DEFAULT 0
                    """
                )

            session_cols = _column_names(conn, "sessions")
            if "id" not in session_cols:
                conn.execute("ALTER TABLE sessions ADD COLUMN id TEXT")
            if "last_seen_at" not in session_cols:
                conn.execute("ALTER TABLE sessions ADD COLUMN last_seen_at REAL")
            if "user_agent" not in session_cols:
                conn.execute("ALTER TABLE sessions ADD COLUMN user_agent TEXT")
            if "ip" not in session_cols:
                conn.execute("ALTER TABLE sessions ADD COLUMN ip TEXT")
            conn.execute(
                """
                UPDATE sessions
                SET last_seen_at = created_at
                WHERE last_seen_at IS NULL
                """
            )
            missing_ids = conn.execute(
                "SELECT token FROM sessions WHERE id IS NULL OR id = ''"
            ).fetchall()
            for row in missing_ids:
                conn.execute(
                    "UPDATE sessions SET id = ? WHERE token = ?",
                    (str(uuid.uuid4()), row["token"]),
                )
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS sessions_id_unique ON sessions(id)"
            )
        except Exception:
            conn.execute("ROLLBACK")
            raise
        else:
            conn.execute("COMMIT")

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
