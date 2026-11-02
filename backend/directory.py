"""The community directory includes every imported member, regardless of ranking."""
import math
from backend.db import metadata
from backend.search import search_terms

RANKED = """EXISTS (SELECT 1 FROM achievements a WHERE a.member_id=m.id
             AND a.global_rank > 0 AND a.tier IN ('Expert','Master','Grandmaster','Unknown'))
             AND m.progression_opt_out=0"""


def directory(db, query="", city="", tier="", status="", sort="name", page=1, page_size=24):
    conditions, args = [], []
    for term in search_terms(query):
        # instr is literal (including % and _) and SQLite LOWER is ASCII-only.
        conditions.append("(instr(search_text(m.username), ?) > 0 OR instr(search_text(m.display_name), ?) > 0 OR instr(search_text(m.organization), ?) > 0)")
        args.extend([term] * 3)
    if city:
        conditions.append("m.city=?"); args.append(city)
    if tier:
        conditions.append("m.overall_tier=?"); args.append(tier)
    if status:
        conditions.append(f"({RANKED})" if status == "ranked" else f"NOT ({RANKED})")
    where = " WHERE " + " AND ".join(conditions) if conditions else ""
    order = {"name": "m.display_name COLLATE NOCASE, m.username COLLATE NOCASE",
             "newest": "m.joined DESC, m.username COLLATE NOCASE",
             "tier": "CASE m.overall_tier WHEN 'Grandmaster' THEN 4 WHEN 'Master' THEN 3 WHEN 'Expert' THEN 2 WHEN 'Contributor' THEN 1 ELSE 0 END DESC, m.display_name COLLATE NOCASE"}[sort]
    total = db.execute("SELECT COUNT(*) FROM members m" + where, args).fetchone()[0]
    rows = [dict(r) for r in db.execute(f"SELECT m.*, ({RANKED}) AS has_ranking FROM members m" + where + " ORDER BY " + order + " LIMIT ? OFFSET ?", [*args, page_size, (page - 1) * page_size])]
    for row in rows:
        row["ranked_categories"] = [r[0] for r in db.execute("SELECT category FROM achievements WHERE member_id=? AND global_rank>0 AND tier IN ('Expert','Master','Grandmaster','Unknown') ORDER BY category", (row["id"],))] if row["has_ranking"] else []
    city_counts = {r["city"]: r["count"] for r in db.execute("SELECT city, COUNT(*) AS count FROM members GROUP BY city ORDER BY count DESC, city")}
    tier_counts = {r["overall_tier"]: r["count"] for r in db.execute("SELECT overall_tier, COUNT(*) AS count FROM members GROUP BY overall_tier")}
    ranked = db.execute(f"SELECT COUNT(*) FROM members m WHERE {RANKED}").fetchone()[0]
    all_total = sum(city_counts.values())
    return {"items": rows, "total": total, "page": page, "page_size": page_size,
            "pages": max(1, math.ceil(total / page_size)), "meta": metadata(db),
            "community": {"total_members": all_total, "ranked_members": ranked,
                          "unranked_members": all_total - ranked, "cities": city_counts, "tiers": tier_counts}}
