"""SQLite persistence. One connection per operation, with explicit transactions."""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = ("competitions", "datasets", "notebooks", "discussions")
TIERS = {0: "Novice", 1: "Contributor", 2: "Expert", 3: "Master", 4: "Grandmaster"}
CITIES = ("Amman", "Irbid", "Zarqa", "Aqaba", "Salt", "Madaba", "Other")


@contextmanager
def connect(path=None):
    target = Path(path or os.getenv("KAGGLEJO_DB", str(ROOT / "data/kagglejo.db")))
    target.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(target, timeout=15)
    db.row_factory = sqlite3.Row
    from backend.search import normalize_text
    db.create_function("search_text", 1, lambda value: normalize_text(value or ""), deterministic=True)
    db.execute("PRAGMA foreign_keys = ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize(path=None, demo=False):
    with connect(path) as db:
        db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS members (
          id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          display_name TEXT NOT NULL, city TEXT NOT NULL, joined TEXT,
          location_source TEXT NOT NULL, is_demo INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS achievements (
          member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
          category TEXT NOT NULL, tier TEXT NOT NULL, points REAL NOT NULL,
          global_rank INTEGER, gold INTEGER NOT NULL, silver INTEGER NOT NULL,
          bronze INTEGER NOT NULL, PRIMARY KEY (member_id, category)
        );
        CREATE TABLE IF NOT EXISTS history (
          username TEXT NOT NULL, category TEXT NOT NULL, recorded_at TEXT NOT NULL,
          points REAL NOT NULL, local_rank INTEGER NOT NULL, global_rank INTEGER,
          PRIMARY KEY(username, category, recorded_at)
        );
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS nominations (
          id INTEGER PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE NOT NULL,
          city TEXT NOT NULL, evidence_url TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rate_limits (
          client TEXT PRIMARY KEY, window_start REAL NOT NULL, count INTEGER NOT NULL
        );
        """)
        member_columns = {row["name"] for row in db.execute("PRAGMA table_info(members)")}
        for column, declaration in {
            "overall_tier": "TEXT NOT NULL DEFAULT 'Unspecified'",
            "organization": "TEXT NOT NULL DEFAULT ''", "location": "TEXT NOT NULL DEFAULT ''",
            "progression_opt_out": "INTEGER NOT NULL DEFAULT 0", "checked_at": "TEXT",
        }.items():
            if column not in member_columns:
                db.execute(f"ALTER TABLE members ADD COLUMN {column} {declaration}")
        if "medals_known" not in {row["name"] for row in db.execute("PRAGMA table_info(achievements)")}:
            db.execute("ALTER TABLE achievements ADD COLUMN medals_known INTEGER NOT NULL DEFAULT 1")
        if demo and not db.execute("SELECT 1 FROM metadata WHERE key='initialized'").fetchone():
            from backend.demo import seed
            seed(db)
        db.execute("INSERT OR IGNORE INTO metadata VALUES ('initialized', 'true')")


def metadata(db):
    return {row["key"]: row["value"] for row in db.execute("SELECT * FROM metadata")}
