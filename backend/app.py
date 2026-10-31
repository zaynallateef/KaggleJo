"""JSON API and same-origin production frontend."""
import csv
import hashlib
import io
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException
from backend.db import CATEGORIES, CITIES, ROOT, connect, initialize, metadata
from backend.ranking import leaderboard, overview, ranked_members, public_achievement
from backend.directory import directory


def create_app(config=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(DB_PATH=os.getenv("KAGGLEJO_DB", str(ROOT / "data/kagglejo.db")),
                      DEMO=os.getenv("KAGGLEJO_MODE", "demo") == "demo", MAX_CONTENT_LENGTH=8192)
    if config:
        app.config.update(config)
    initialize(app.config["DB_PATH"], app.config["DEMO"])

    @app.after_request
    def headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
            "font-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'")
        origin = os.getenv("KAGGLEJO_ALLOWED_ORIGIN")
        if origin and request.headers.get("Origin") == origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Vary"] = "Origin"
        if request.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    def filters():
        category = request.args.get("category", "competitions")
        if category not in CATEGORIES:
            return None, (jsonify(error="Choose a valid ranking category."), 400)
        return category, None

    @app.get("/api/health")
    def health():
        with connect(app.config["DB_PATH"]) as db:
            db.execute("SELECT 1")
        return jsonify(status="ok", service="KaggleJo")

    @app.get("/api/overview")
    def get_overview():
        category, error = filters()
        if error:
            return error
        with connect(app.config["DB_PATH"]) as db:
            return jsonify(overview(db, category))

    @app.get("/api/leaderboard")
    def get_leaderboard():
        category, error = filters()
        if error:
            return error
        try:
            page, page_size = int(request.args.get("page", 1)), int(request.args.get("page_size", 10))
            if page < 1 or not 1 <= page_size <= 100:
                raise ValueError
        except ValueError:
            return jsonify(error="Page must be positive and page size must be between 1 and 100."), 400
        query = request.args.get("q", "").strip()[:80]
        city, tier = request.args.get("city", ""), request.args.get("tier", "")
        with connect(app.config["DB_PATH"]) as db:
            city_known = city in CITIES or db.execute("SELECT 1 FROM members WHERE city=?", (city,)).fetchone()
        if (city and not city_known) or (tier and tier not in ("Expert", "Master", "Grandmaster")):
            return jsonify(error="Choose a valid city and tier."), 400
        with connect(app.config["DB_PATH"]) as db:
            return jsonify(leaderboard(db, category, query, city, tier, page, page_size))

    @app.get("/api/members")
    def get_directory():
        try:
            page, size = int(request.args.get("page", 1)), int(request.args.get("page_size", 24))
            if page < 1 or not 1 <= size <= 100:
                raise ValueError
        except ValueError:
            return jsonify(error="Choose a positive page and a page size from 1 to 100."), 400
        query, city, tier = request.args.get("q", "").strip()[:80], request.args.get("city", ""), request.args.get("tier", "")
        status, sort = request.args.get("status", ""), request.args.get("sort", "name")
        if (tier and tier not in ("Novice", "Contributor", "Expert", "Master", "Grandmaster", "Unspecified")) or status not in ("", "ranked", "unranked") or sort not in ("name", "newest", "tier"):
            return jsonify(error="Choose valid directory filters."), 400
        with connect(app.config["DB_PATH"]) as db:
            if city and not db.execute("SELECT 1 FROM members WHERE city=?", (city,)).fetchone() and city not in CITIES:
                return jsonify(error="Choose a city from the community directory."), 400
            return jsonify(directory(db, query, city, tier, status, sort, page, size))

    @app.get("/api/members/<username>")
    def member(username):
        with connect(app.config["DB_PATH"]) as db:
            row = db.execute("SELECT * FROM members WHERE username = ? COLLATE NOCASE", (username,)).fetchone()
            if not row:
                return jsonify(error="This profile was not found."), 404
            achievements = []
            if not row["progression_opt_out"]:
                for raw in db.execute("SELECT * FROM achievements WHERE member_id=? ORDER BY category", (row["id"],)):
                    achievement = public_achievement(dict(raw))
                    ranked = next((r for r in ranked_members(db, raw["category"]) if r["id"] == row["id"]), None)
                    achievement["local_rank"] = ranked["local_rank"] if ranked else None
                    achievements.append(achievement)
            history = [] if row["progression_opt_out"] else [dict(r) for r in db.execute(
                "SELECT category, recorded_at, points, local_rank, global_rank FROM history "
                "WHERE username=? ORDER BY recorded_at DESC LIMIT 120", (row["username"],))]
            return jsonify(member=dict(row), achievements=achievements, history=history, meta=metadata(db))

    @app.get("/api/export")
    def export():
        category, error = filters()
        if error:
            return error
        with connect(app.config["DB_PATH"]) as db:
            result = leaderboard(db, category, request.args.get("q", "").strip()[:80],
                                 request.args.get("city", ""), request.args.get("tier", ""), 1, 1000000)
        output = io.StringIO(newline="")
        fields = ["local_rank", "display_name", "username", "city", "tier", "global_rank", "points", "gold", "silver", "bronze", "is_demo"]
        writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in result["items"]:
            safe = {k: ("'" + v if isinstance(v, str) and (re.match(r"^[\s\ufeff]*[=+\-@]", v) or v.startswith(("\t", "\r", "\n"))) else v)
                    for k, v in row.items()}
            writer.writerow(safe)
        return app.response_class(output.getvalue(), mimetype="text/csv", headers={
            "Content-Disposition": f'attachment; filename="kagglejo-{category}.csv"'})

    @app.post("/api/nominations")
    def nominate():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify(error="Send a JSON object."), 400
        username, city, evidence = (payload.get(k, "") for k in ("username", "city", "evidence_url"))
        if not all(isinstance(v, str) for v in (username, city, evidence)):
            return jsonify(error="Profile fields must be text."), 400
        username, evidence = username.strip(), evidence.strip()
        if not re.fullmatch(r"[a-zA-Z0-9_]{3,50}", username):
            return jsonify(error="Use a Kaggle username of 3–50 letters, numbers, or underscores."), 400
        parsed = urlparse(evidence)
        if (city not in CITIES or parsed.scheme != "https" or
                parsed.netloc not in ("kaggle.com", "www.kaggle.com") or
                parsed.path.rstrip("/").casefold() != f"/{username}".casefold() or parsed.query or parsed.fragment or
                payload.get("confirmed") is not True):
            return jsonify(error="Choose a city, use the matching https://www.kaggle.com/username profile link, and confirm the public Jordan connection."), 400
        # Do not trust X-Forwarded-For. No raw IP addresses are persisted.
        client = hashlib.sha256((request.remote_addr or "unknown").encode()).hexdigest()
        now = time.time()
        with connect(app.config["DB_PATH"]) as db:
            db.execute("DELETE FROM rate_limits WHERE window_start < ?", (now - 3600,))
            rate = db.execute("SELECT * FROM rate_limits WHERE client=?", (client,)).fetchone()
            if rate and rate["count"] >= 10:
                return jsonify(error="Submission limit reached. Try again in an hour."), 429
            db.execute("INSERT INTO rate_limits VALUES (?, ?, 1) ON CONFLICT(client) DO UPDATE SET count=count+1", (client, now))
            if db.execute("SELECT 1 FROM members WHERE username=?", (username,)).fetchone():
                return jsonify(error="This profile is already in the community."), 409
            if db.execute("SELECT 1 FROM nominations WHERE username=?", (username,)).fetchone():
                return jsonify(error="This profile is already awaiting review."), 409
            db.execute("INSERT INTO nominations (username, city, evidence_url, created_at) VALUES (?, ?, ?, ?)",
                       (username, city, evidence, datetime.now(timezone.utc).isoformat()))
        return jsonify(message="Profile submitted for review. Rankings will appear after location review and the next data import."), 201

    @app.get("/api/<path:unknown>")
    def unknown_api(unknown):
        return jsonify(error="API endpoint not found."), 404

    @app.get("/")
    @app.get("/<path:path>")
    def frontend(path="index.html"):
        dist = ROOT / "dist"
        if not (dist / "index.html").exists():
            return jsonify(message="KaggleJo API is running. Start the Vite frontend on port 5173."), 200
        if (dist / path).is_file() and (dist / path).resolve().is_relative_to(dist.resolve()):
            return send_from_directory(dist, path)
        if Path(path).suffix:
            return jsonify(error="Asset not found."), 404
        return send_from_directory(dist, "index.html")

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=int(os.getenv("PORT", "8000")))
