"""Local-only moderation; no publicly exposed administrative write endpoints."""
import argparse
import json
from backend.db import connect, initialize


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["nominations"])
    parser.add_argument("--db", default=None)
    args = parser.parse_args()
    initialize(args.db)
    with connect(args.db) as db:
        rows = [dict(row) for row in db.execute("SELECT * FROM nominations ORDER BY created_at")]
    print(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
