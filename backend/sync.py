"""Import official Meta Kaggle CSVs for an explicitly reviewed Jordan registry.

Run from the repository root with `python -m backend.sync --help`.
"""
import argparse
import csv
import io
import json
import math
import re
import shutil
import subprocess
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from backend.db import CATEGORIES, CITIES, TIERS, connect, initialize
from backend.ranking import ranked_members

TYPE_MAP = {"competitions": "competitions", "competition": "competitions",
            "datasets": "datasets", "dataset": "datasets", "scripts": "notebooks",
            "kernels": "notebooks", "notebooks": "notebooks", "discussion": "discussions",
            "discussions": "discussions"}


@contextmanager
def read_csv(path, columns):
    path = Path(path)
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
            if len(names) != 1:
                raise ValueError(f"Expected one CSV in {path.name}.")
            with archive.open(names[0]) as raw, io.TextIOWrapper(raw, encoding="utf-8-sig") as stream:
                reader = csv.DictReader(stream)
                if not set(columns).issubset(reader.fieldnames or []):
                    raise ValueError(f"{path.name} is missing required columns: {columns}")
                yield reader
    else:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            if not set(columns).issubset(reader.fieldnames or []):
                raise ValueError(f"{path.name} is missing required columns: {columns}")
            yield reader


def load_registry(path):
    members = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(members, list) or not members:
        raise ValueError("The reviewed registry must contain at least one member.")
    result = {}
    for member in members:
        username = member.get("username", "")
        source = urlparse(member.get("location_source", ""))
        if (not re.fullmatch(r"[a-zA-Z0-9_]{3,50}", username) or member.get("city") not in CITIES
                or source.scheme != "https" or source.netloc not in ("www.kaggle.com", "kaggle.com")
                or source.path.rstrip("/").casefold() != f"/{username}".casefold()
                or source.query or source.fragment or not member.get("reviewed_at")):
            raise ValueError(f"Invalid reviewed member: {username!r}. See data/members.example.json.")
        datetime.fromisoformat(member["reviewed_at"])
        key = username.casefold()
        if key in result:
            raise ValueError(f"Duplicate registry username: {username}")
        result[key] = member
    return result


def number(value, integer=False):
    result = float(value or 0)
    if not math.isfinite(result) or result < 0:
        raise ValueError("Meta Kaggle contains an invalid negative or non-finite statistic.")
    if integer and not result.is_integer():
        raise ValueError("Expected an integer Meta Kaggle statistic.")
    return int(result) if integer else result


def import_snapshot(db_path, registry_path, users_path, achievements_path, as_of):
    stamp = datetime.fromisoformat(as_of.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        raise ValueError("--as-of must include a timezone, for example 2026-10-31T00:00:00Z.")
    if stamp > datetime.now(timezone.utc):
        raise ValueError("The snapshot date cannot be in the future.")
    registry = load_registry(registry_path)
    users = {}
    with read_csv(users_path, ["Id", "UserName", "DisplayName", "RegisterDate"]) as reader:
        for row in reader:
            username = row["UserName"].casefold()
            if username in registry:
                users[row["Id"]] = {**registry[username], "id": int(row["Id"]),
                                     "username": row["UserName"], "display_name": row["DisplayName"] or row["UserName"],
                                     "joined": row["RegisterDate"]}
    missing = set(registry) - {u["username"].casefold() for u in users.values()}
    if missing:
        raise ValueError("Registry members missing from Users.csv: " + ", ".join(sorted(missing)))
    achievements = []
    with read_csv(achievements_path, ["UserId", "AchievementType", "Tier", "Points", "CurrentRanking", "TotalGold", "TotalSilver", "TotalBronze"]) as reader:
        for row in reader:
            if row["UserId"] not in users:
                continue
            raw_type = row["AchievementType"].casefold()
            if raw_type not in TYPE_MAP:
                raise ValueError(f"Unsupported achievement type {row['AchievementType']!r}; check the upstream schema.")
            tier = TIERS.get(number(row["Tier"], True))
            if tier is None:
                raise ValueError("Unknown Kaggle tier. Check the upstream schema.")
            rank = number(row["CurrentRanking"], True) or None
            achievements.append((int(row["UserId"]), TYPE_MAP[raw_type], tier, number(row["Points"]), rank,
                                 number(row["TotalGold"], True), number(row["TotalSilver"], True), number(row["TotalBronze"], True)))
    initialize(db_path)
    recorded = stamp.astimezone(timezone.utc).isoformat()
    with connect(db_path) as db:
        previous = db.execute("SELECT value FROM metadata WHERE key='updated_at'").fetchone()
        is_demo = db.execute("SELECT value FROM metadata WHERE key='mode'").fetchone()
        if previous and (not is_demo or is_demo[0] != "demo") and recorded < previous[0]:
            raise ValueError("Refusing to replace a newer snapshot with older data.")
        # A validated full snapshot replaces old membership atomically; never mix sample and real people.
        if is_demo and is_demo[0] == "demo":
            db.execute("DELETE FROM history")
        db.execute("DELETE FROM achievements")
        db.execute("DELETE FROM members")
        for user in users.values():
            db.execute("INSERT INTO members (id, username, display_name, city, joined, location_source, is_demo) VALUES (?, ?, ?, ?, ?, ?, 0)",
                       (user["id"], user["username"], user["display_name"], user["city"], user["joined"], user["location_source"]))
        db.executemany("INSERT INTO achievements (member_id, category, tier, points, global_rank, gold, silver, bronze) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", achievements)
        for user in users.values():
            member_achievements = [a for a in achievements if a[0] == user["id"]]
            tier_order = list(TIERS.values())
            highest = max((a[2] for a in member_achievements), key=lambda t: tier_order.index(t), default="Unspecified")
            db.execute("UPDATE members SET overall_tier=?, location=?, checked_at=? WHERE id=?",
                       (highest, f"{user['city']}, Jordan", recorded, user["id"]))
        for category in ("competitions", "datasets", "notebooks", "discussions"):
            for row in ranked_members(db, category):
                db.execute("INSERT OR REPLACE INTO history VALUES (?, ?, ?, ?, ?, ?)",
                           (row["username"], category, recorded, row["points"], row["local_rank"], row["global_rank"]))
        db.executemany("INSERT OR REPLACE INTO metadata VALUES (?, ?)",
                       [("mode", "live"), ("updated_at", recorded), ("source", "Meta Kaggle · reviewed Jordan registry"),
                        ("available_categories", ",".join(CATEGORIES)), ("medals_available", "true"),
                        ("category_tiers_available", "true")])
    return {"members": len(users), "achievements": len(achievements), "as_of": recorded}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=None)
    parser.add_argument("--registry", default="data/members.json")
    parser.add_argument("--directory", default="data/meta-kaggle")
    parser.add_argument("--download", action="store_true", help="Fetch the two CSVs with the authenticated official Kaggle CLI.")
    parser.add_argument("--as-of", required=True, help="Actual dataset snapshot date as an ISO timestamp with timezone.")
    args = parser.parse_args()
    directory = Path(args.directory)
    load_registry(args.registry)  # Fail before a potentially large download.
    if args.download:
        executable = shutil.which("kaggle")
        if not executable:
            parser.error("Install and authenticate the official Kaggle CLI first: pip install kaggle")
        directory.mkdir(parents=True, exist_ok=True)
        for filename in ("Users.csv", "UserAchievements.csv"):
            subprocess.run([executable, "datasets", "download", "-d", "kaggle/meta-kaggle",
                            "-f", filename, "-p", str(directory), "--force"], check=True, timeout=1800)
    paths = []
    for filename in ("Users.csv", "UserAchievements.csv"):
        plain, zipped = directory / filename, directory / (filename + ".zip")
        paths.append(max((p for p in (plain, zipped) if p.exists()), key=lambda p: p.stat().st_mtime))
    print(json.dumps(import_snapshot(args.db, args.registry, *paths, args.as_of), indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit(f"Sync failed: {error}") from error
