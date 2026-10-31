"""Publish an allowlisted public snapshot for static hosting; never export SQLite itself."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from backend.db import CATEGORIES, connect, metadata
from backend.directory import directory
from backend.ranking import overview, public_achievement, ranked_members

PERSON_FIELDS = {"id", "username", "display_name", "city", "joined", "location_source", "is_demo",
                 "overall_tier", "organization", "location", "progression_opt_out", "checked_at"}
ACHIEVEMENT_FIELDS = {"category", "tier", "points", "global_rank", "gold", "silver", "bronze", "local_rank"}
META_FIELDS = {"mode", "updated_at", "source", "available_categories", "medals_available",
               "category_tiers_available", "discovery", "reported_total"}


def build_snapshot(db_path=None):
    with connect(db_path) as db:
        meta = {k: v for k, v in metadata(db).items() if k in META_FIELDS}
        if meta.get("mode") != "live" or not meta.get("updated_at"):
            raise ValueError("Static publication requires an imported real-data snapshot.")
        result = directory(db, page_size=1000000)
        if not result["items"] or any(row["is_demo"] for row in result["items"]):
            raise ValueError("Refusing to publish an empty or demonstration directory.")
        members = [{k: row[k] for k in PERSON_FIELDS | {"has_ranking", "ranked_categories"} if k in row}
                   for row in result["items"]]
        rankings = {category: ranked_members(db, category) for category in CATEGORIES}
        positions = {(row["id"], category): row["local_rank"] for category, rows in rankings.items() for row in rows}
        clean_rankings = {category: [{k: v for k, v in row.items() if k in PERSON_FIELDS | ACHIEVEMENT_FIELDS} for row in rows]
                          for category, rows in rankings.items()}
        profiles = {person["username"].casefold(): {"achievements": [], "history": []} for person in members}
        identities = {person["id"]: person for person in members if not person["progression_opt_out"]}
        for raw in db.execute("SELECT * FROM achievements"):
            person = identities.get(raw["member_id"])
            if person:
                achievement = public_achievement(dict(raw))
                achievement["local_rank"] = positions.get((person["id"], achievement["category"]))
                profiles[person["username"].casefold()]["achievements"].append({k: v for k, v in achievement.items() if k in ACHIEVEMENT_FIELDS})
        for raw in db.execute("""SELECT h.username, h.category, h.recorded_at, h.points, h.local_rank, h.global_rank
                                 FROM history h JOIN members m ON h.username=m.username
                                 WHERE m.progression_opt_out=0 ORDER BY h.recorded_at DESC"""):
            profile = profiles.get(raw["username"].casefold())
            if profile and len(profile["history"]) < 120:
                profile["history"].append({k: raw[k] for k in raw.keys() if k != "username"})
        overviews = {}
        for category in CATEGORIES:
            stats = overview(db, category)
            stats["meta"] = meta
            stats["top"] = clean_rankings[category][:3]
            overviews[category] = stats
        return {"schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(), "meta": meta,
                "community": result["community"], "members": members, "profiles": profiles,
                "rankings": clean_rankings, "overviews": overviews}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=None)
    parser.add_argument("--output", default="public/data/snapshot.json")
    args = parser.parse_args()
    snapshot = build_snapshot(args.db)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    temporary.replace(output)
    print(f"Exported {len(snapshot['members'])} public profiles to {output}")


if __name__ == "__main__":
    main()
