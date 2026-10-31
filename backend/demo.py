"""Deterministic fictional fixtures, always identified as demo data in the API/UI."""
from datetime import datetime, timezone
from backend.db import CATEGORIES

PEOPLE = [
    ("Omar Haddad", "Amman"), ("Sara Al-Khatib", "Irbid"),
    ("Ahmad Nasser", "Amman"), ("Lina Mansour", "Zarqa"),
    ("Yousef Khalil", "Amman"), ("Noor Saleh", "Irbid"),
    ("Khaled Hamdan", "Amman"), ("Rania Awad", "Aqaba"),
    ("Ali Darwish", "Salt"), ("Dana Obeid", "Amman"),
    ("Zaid Faris", "Zarqa"), ("Hala Samir", "Irbid"),
    ("Tareq Amin", "Amman"), ("Reem Jaber", "Madaba"),
    ("Fadi Qasem", "Amman"), ("Aya Shaker", "Irbid"),
    ("Bashar Zayed", "Zarqa"), ("Salma Nabil", "Amman"),
    ("Nader Ismail", "Aqaba"), ("Maya Yasin", "Salt"),
    ("Saif Rabah", "Amman"), ("Leen Adnan", "Irbid"),
    ("Hani Murad", "Madaba"), ("Dima Issa", "Amman"),
]


def seed(db):
    now = datetime.now(timezone.utc).isoformat()
    for i, (name, city) in enumerate(PEOPLE):
        username = "demo_" + name.lower().replace(" ", "").replace("-", "")
        db.execute("INSERT INTO members (id, username, display_name, city, joined, location_source, is_demo) VALUES (?, ?, ?, ?, ?, ?, 1)",
                   (i + 1, username, name, city, f"{2017 + i % 7}-03-14", "Demonstration profile"))
        for j, category in enumerate(CATEGORIES):
            position = i if j == 0 else (i * (5 if j == 1 else 7) + j * 3) % len(PEOPLE)
            points = round(28460 / (1 + position * .34), 2)
            tier = "Grandmaster" if position < 2 else "Master" if position < 7 else "Expert"
            world = 142 + position * 137 + j * 31
            gold, silver, bronze = max(0, 9 - position // 2), max(1, 16 - position // 2), 5 + position % 13
            db.execute("INSERT INTO achievements (member_id, category, tier, points, global_rank, gold, silver, bronze) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                       (i + 1, category, tier, points, world, gold, silver, bronze))
            db.execute("INSERT INTO history VALUES (?, ?, ?, ?, ?, ?)",
                       (username, category, now, points, position + 1, world))
        best = "Grandmaster" if i < 2 else "Master" if i < 7 else "Expert"
        db.execute("UPDATE members SET overall_tier=?, location=? WHERE id=?", (best, f"{city}, Jordan", i + 1))
    db.executemany("INSERT OR REPLACE INTO metadata VALUES (?, ?)",
                   [("mode", "demo"), ("updated_at", now), ("source", "Fictional sample data")])
