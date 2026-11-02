"""Category-specific ranks. Filters never renumber Jordan-wide positions."""
import math
from backend.db import metadata
from backend.search import matches_person, search_terms


def ranked_members(db, category):
    rows = db.execute("""
      SELECT m.*, a.category, a.tier, a.points, a.global_rank, a.gold, a.silver, a.bronze, a.medals_known,
        RANK() OVER (ORDER BY a.points DESC) AS local_rank
      FROM members m JOIN achievements a ON m.id = a.member_id
      WHERE a.category = ? AND a.tier IN ('Expert','Master','Grandmaster','Unknown')
        AND a.global_rank IS NOT NULL AND a.global_rank > 0 AND m.progression_opt_out = 0
      ORDER BY a.points DESC, m.username COLLATE NOCASE
    """, (category,)).fetchall()
    return [public_achievement(dict(row)) for row in rows]


def public_achievement(row):
    if row.get("tier") == "Unknown":
        row["tier"] = None
    if not row.get("medals_known", 1):
        row.update(gold=None, silver=None, bronze=None)
    return row


def leaderboard(db, category, query="", city="", tier="", page=1, page_size=10):
    all_rows = ranked_members(db, category)
    terms = search_terms(query)
    filtered = [row for row in all_rows if
                matches_person(row, terms)
                and (not city or row["city"] == city)
                and (not tier or row["tier"] == tier)]
    total = len(filtered)
    return {"items": filtered[(page - 1) * page_size:page * page_size], "total": total,
            "page": page, "page_size": page_size, "pages": max(1, math.ceil(total / page_size)),
            "category": category, "meta": metadata(db)}


def overview(db, category):
    rows = ranked_members(db, category)
    members = db.execute("SELECT city FROM members").fetchall()
    cities = {}
    for member in members:
        cities[member["city"]] = cities.get(member["city"], 0) + 1
    tiers = {}
    for row in rows:
        if row["tier"]:
            tiers[row["tier"]] = tiers.get(row["tier"], 0) + 1
    medals_known = all(row["medals_known"] for row in rows) and metadata(db).get("medals_available") != "false"
    return {"ranked_members": len(rows),
            "total_members": len(members), "unranked_members": len(members) - len(rows),
            "medals": sum(r["gold"] + r["silver"] + r["bronze"] for r in rows) if medals_known else None,
            "gold_medals": sum(r["gold"] for r in rows) if medals_known else None,
            "cities": cities, "tiers": tiers, "top": rows[:3], "meta": metadata(db)}
