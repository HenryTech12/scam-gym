"""SQLite helpers. Stores study answers only: no IP addresses, user agents or names."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS study_sessions (
  participant_id TEXT PRIMARY KEY,
  pre_set TEXT, post_set TEXT,
  pre_json TEXT, post_json TEXT,
  drills_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


@contextmanager
def connect(path: str) -> Iterator[sqlite3.Connection]:
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db(path: str) -> None:
    with connect(path) as conn:
        conn.executescript(SCHEMA)


def insert_session(path: str, *, participant_id: str, pre_set: str, post_set: str,
                   pre: list[dict], post: list[dict], drills: list[str]) -> None:
    """Duplicate participant ids are ignored."""
    with connect(path) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO study_sessions "
            "(participant_id, pre_set, post_set, pre_json, post_json, drills_json) VALUES (?, ?, ?, ?, ?, ?)",
            (participant_id, pre_set, post_set, json.dumps(pre), json.dumps(post), json.dumps(drills)),
        )


def all_sessions(path: str) -> list[dict]:
    with connect(path) as conn:
        rows = conn.execute("SELECT * FROM study_sessions ORDER BY created_at, participant_id").fetchall()
    return [
        {
            "participant_id": r["participant_id"],
            "pre_set": r["pre_set"],
            "post_set": r["post_set"],
            "pre": json.loads(r["pre_json"]),
            "post": json.loads(r["post_json"]),
            "drills": json.loads(r["drills_json"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]
