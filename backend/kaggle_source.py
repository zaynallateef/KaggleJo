"""Fetch opted-in public profiles in Jordan through Kaggle's official search SDK.

Operator command: python -m backend.kaggle_source
Kaggle credentials stay in the official CLI's local credential store.
"""
import argparse
import json
import math
import re
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from backend.db import CATEGORIES, ROOT, connect, initialize, metadata
from backend.ranking import ranked_members
from backend.membership import validate_memberships

SOURCE = "Kaggle public user search"
SEARCH_CATEGORIES = {"competitions": "competition", "datasets": "dataset", "notebooks": "kernel"}
TIER_NAMES = {"NOVICE": "Novice", "CONTRIBUTOR": "Contributor", "EXPERT": "Expert", "MASTER": "Master", "GRANDMASTER": "Grandmaster"}
CITY_NAMES = {"as salt": "Salt", "as-salt": "Salt", "al salt": "Salt", "as salţ": "Salt",
              "az zarqa": "Zarqa", "az zarqāʼ": "Zarqa", "az-zarqa": "Zarqa",
              "al aqabah": "Aqaba", "al-‘aqabah": "Aqaba", "al 'aqabah": "Aqaba",
              "kerak": "Karak", "al-karak": "Karak", "al karak": "Karak",
              "at-tafilah": "Tafilah", "al-mafraq": "Mafraq"}


def normalize_person(document, membership=None):
    if document.get("documentType") != "USER" or document.get("isPrivate") is True:
        return None
    details = document.get("userDocument") or {}
    location = details.get("userLocation", "").strip()
    parts = [part.strip() for part in location.split(",") if part.strip()]
    public_jordan = bool(parts and parts[-1].casefold() in ("jordan", "الأردن", "الاردن"))
    if not public_jordan and not membership:
        return None
    owner = document.get("ownerUser") or {}
    username = owner.get("userName", "")
    user_id = document.get("id")
    if not re.fullmatch(r"[a-zA-Z0-9_]{3,50}", username) or not isinstance(user_id, int) or user_id <= 0:
        raise ValueError("Kaggle returned an invalid public user identifier.")
    if membership and (membership['username'] != username.lower() or membership['kaggle_id'] != user_id):
        raise ValueError('The reviewed membership no longer matches the Kaggle account identity.')
    city = parts[0] if len(parts) > 1 else "Not specified"
    city = CITY_NAMES.get(city.casefold(), city)
    if not public_jordan:
        city = membership['city']
    opted_out = owner.get("progressionOptOut") is True
    achievements = []
    if not opted_out:
        for category, prefix in SEARCH_CATEGORIES.items():
            # Search supplies points/ranks, but not category tiers or medal counts.
            points = details.get(f"{prefix}Points")
            rank = details.get(f"{prefix}Ranking")
            if points is not None and (not isinstance(points, (int, float)) or not math.isfinite(points) or points < 0):
                raise ValueError("Kaggle returned an invalid point value.")
            if rank is not None and (not isinstance(rank, int) or rank < 0):
                raise ValueError("Kaggle returned an invalid rank.")
            # Do not turn absent statistics into zero points.
            if points is not None:
                achievements.append({"category": category, "points": points, "global_rank": rank or None})
    return {"id": user_id, "username": username,
            "display_name": (owner.get("displayName") or document.get("title") or username).strip() or username,
            "city": city, "location": location,
            "joined": document.get("createTime", ""),
            "location_source": f"https://www.kaggle.com/{username}",
            "overall_tier": "Unspecified" if opted_out else TIER_NAMES.get(owner.get("tier"), "Unspecified"),
            "organization": details.get("occupationOrganizationName", "").strip(),
            "progression_opt_out": opted_out, "achievements": achievements,
            "membership_source": "kaggle_location" if public_jordan else "community_review"}


def fetch_snapshot(fetch_page, progress=None, pause=.25, max_pages=100, allow_empty=False, normalizer=normalize_person):
    people, seen_tokens, seen_ids = {}, set(), set()
    token, reported, pages = "", 0, 0
    for page in range(1, max_pages + 1):
        response = fetch_page(token)
        documents = response.get("documents", [])
        if not isinstance(documents, list):
            raise ValueError("Kaggle returned an invalid search response.")
        reported = max(reported, response.get("totalDocuments", 0))
        for document in documents:
            identifier = document.get("id")
            if identifier in seen_ids:
                raise ValueError("Search pagination repeated a user. Existing data was preserved; retry the snapshot.")
            seen_ids.add(identifier)
            person = normalizer(document)
            if person:
                if person["username"].casefold() in people:
                    raise ValueError("Kaggle returned duplicate usernames.")
                people[person["username"].casefold()] = person
        pages = page
        if progress:
            progress(page, len(people), reported)
        next_token = response.get("nextPageToken", "")
        if not next_token:
            break
        if not documents or next_token in seen_tokens:
            raise ValueError("Kaggle search returned an invalid pagination token.")
        seen_tokens.add(next_token)
        token = next_token
        if pause:
            time.sleep(pause)
    else:
        raise ValueError("Search page limit reached; refusing to publish an incomplete snapshot.")
    if (not people and not allow_empty) or (reported and len(seen_ids) < reported):
        raise ValueError("Kaggle search was empty or incomplete. Existing data was preserved.")
    return {"schema_version": 1, "source": SOURCE, "country": "Jordan", "complete": True,
            "fetched_at": datetime.now(timezone.utc).isoformat(), "reported_total": reported,
            "pages": pages, "users": list(people.values())}


def merge_discovery(fetch_search, usernames=(), progress=None, memberships=None):
    """Union country aliases and exact-username searches, checking every public location.

    A failed search aborts the entire replacement. Empty supplementary searches
    are valid; an empty primary country search is still treated as a failure.
    """
    usernames = validate_usernames(usernames)
    reviewed = validate_memberships(memberships or [])
    primary = fetch_snapshot(lambda token: fetch_search("", "Jordan", token), progress)
    people = {user["username"].casefold(): user for user in primary["users"]}
    identities = {user["id"]: user["username"].casefold() for user in primary["users"]}
    checks = [{"location": "Jordan", "members": len(people), "pages": primary["pages"]}]

    def merge(users):
        for user in users:
            name = user["username"].casefold()
            if ((name in people and people[name]["id"] != user["id"]) or
                    (user["id"] in identities and identities[user["id"]] != name)):
                raise ValueError("Conflicting user identities across discovery searches.")
            people.setdefault(name, user)
            identities[user["id"]] = name

    for location in ("الأردن", "الاردن"):
        extra = fetch_snapshot(lambda token: fetch_search("", location, token), allow_empty=True)
        merge(extra["users"])
        checks.append({"location": location, "members": len(extra["users"]), "pages": extra["pages"]})
    unresolved = []
    for username in sorted(set(usernames) | set(reviewed)):
        if username in people:
            continue
        exact, diagnostic = lookup_username(fetch_search, username, reviewed.get(username))
        merge(exact)
        if not exact:
            unresolved.append(username)
        checks.append({**diagnostic, "members": len(exact)})
    return {**primary, "users": list(people.values()), "discovery_checks": checks,
            "unresolved_usernames": unresolved, "fetched_at": datetime.now(timezone.utc).isoformat()}


def validate_usernames(usernames):
    if not isinstance(usernames, (list, tuple)) or len(usernames) > 100:
        raise ValueError("Provide a list of at most 100 discovery usernames.")
    if any(not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z0-9_]{3,50}", name) for name in usernames):
        raise ValueError("Discovery usernames must contain 3–50 letters, numbers, or underscores.")
    return sorted({name.lower() for name in usernames})


def lookup_username(fetch_search, username, membership=None):
    username = validate_usernames([username])[0]
    documents = []

    def fetch_page(token):
        response = fetch_search(username, "", token)
        documents.extend(doc for doc in response.get("documents", [])
                         if (doc.get("ownerUser") or {}).get("userName", "").casefold() == username)
        return response

    def normalize(document):
        name = (document.get('ownerUser') or {}).get('userName', '').lower()
        return normalize_person(document, membership if name == username else None)

    snapshot = fetch_snapshot(fetch_page, allow_empty=True, normalizer=normalize)
    exact = [user for user in snapshot["users"] if user["username"].casefold() == username]
    diagnostic = {"username": username, "pages": snapshot["pages"], "status": "not_indexed"}
    public = next((doc for doc in documents if doc.get("isPrivate") is not True and doc.get("documentType") == "USER"), None)
    if public:
        diagnostic.update(kaggle_id=public.get('id'), display_name=(public.get('ownerUser') or {}).get('displayName') or username)
    if exact:
        diagnostic.update(status="included", location=exact[0]["location"])
    elif documents:
        location = ((public or {}).get("userDocument") or {}).get("userLocation", "").strip()
        diagnostic.update(status="outside_jordan" if location else "location_not_shared" if public else "private")
        if location:
            diagnostic["location"] = location
    return exact, diagnostic


@contextmanager
def search_client():
    try:
        from kaggle import api
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
        from kagglesdk.search.types.search_api_service import ListEntitiesRequest, ListEntitiesFilters, ApiSearchUsersFilters
        from kagglesdk.search.types.search_enums import DocumentType, PrivacyFilter
        from kagglesdk.users.types.search_users import SearchUsersOrderBy
    except ImportError as error:
        raise ValueError("Install backend/requirements-data.txt and run kaggle auth login first.") from error

    class TimedAdapter(HTTPAdapter):
        def send(self, request, **kwargs):
            kwargs["timeout"] = (15, 60)
            return super().send(request, **kwargs)

    with api.build_kaggle_client() as client:
        # The SDK owns authentication. Add bounded transport timeouts without reading tokens.
        session = client.http_client()._init_session()
        retries = Retry(total=3, connect=2, read=0, status=2, backoff_factor=1,
                        status_forcelist=[429, 500, 502, 503, 504], allowed_methods=["POST"])
        session.mount("https://", TimedAdapter(max_retries=retries))

        def fetch_search(query, location, token):
            request = ListEntitiesRequest()
            filters, users = ListEntitiesFilters(), ApiSearchUsersFilters()
            filters.document_types = [DocumentType.USER]
            filters.privacy = PrivacyFilter.PUBLIC
            filters.query = query
            if location:
                users.user_locations = [location]
                filters.user_filters = users
            request.filters, request.page_size, request.page_token = filters, 100, token
            request.users_order_by = SearchUsersOrderBy.SEARCH_USERS_ORDER_BY_DISPLAY_NAME
            response = client.search.search_api_client.list_entities(request)
            return type(response).to_dict(response)

        yield fetch_search


def download_snapshot(progress=None, usernames=(), memberships=None):
    with search_client() as fetch_search:
        return merge_discovery(fetch_search, usernames, progress, memberships)


def apply_snapshot(snapshot, db_path=None, memberships=None):
    if (snapshot.get("schema_version") != 1 or snapshot.get("complete") is not True
            or snapshot.get("country") != "Jordan" or not snapshot.get("users")):
        raise ValueError("Expected a complete Jordan search snapshot.")
    stamp = datetime.fromisoformat(snapshot["fetched_at"].replace("Z", "+00:00"))
    if stamp.tzinfo is None or stamp > datetime.now(timezone.utc):
        raise ValueError("Invalid snapshot timestamp.")
    recorded = stamp.astimezone(timezone.utc).isoformat()
    users = [{**user, "city": CITY_NAMES.get(user["city"].casefold(), user["city"])} for user in snapshot["users"]]
    # Revalidate persisted input before making any database changes.
    ids, names = set(), set()
    reviewed = validate_memberships(memberships or [])
    for user in users:
        parts = [p.strip().casefold() for p in user.get("location", "").split(",") if p.strip()]
        username = user.get("username", "")
        community_review = user.get('membership_source') == 'community_review'
        approval = reviewed.get(username.lower())
        if community_review and (not approval or approval['kaggle_id'] != user['id'] or approval['city'] != user['city']):
            raise ValueError('A community profile requires a matching active Supabase approval.')
        if ((not community_review and (not parts or parts[-1] not in ("jordan", "الأردن", "الاردن"))) or
                not re.fullmatch(r"[a-zA-Z0-9_]{3,50}", username) or
                user["id"] in ids or username.casefold() in names):
            raise ValueError("Snapshot contains invalid or duplicated Jordan profiles.")
        ids.add(user["id"]); names.add(username.casefold())
        if user.get("progression_opt_out") and user.get("achievements"):
            raise ValueError("Snapshot contains statistics for a progression opt-out profile.")
        for achievement in user.get("achievements", []):
            points, rank = achievement["points"], achievement["global_rank"]
            if (achievement["category"] not in SEARCH_CATEGORIES or not isinstance(points, (int, float))
                    or not math.isfinite(points) or points < 0 or
                    (rank is not None and (not isinstance(rank, int) or rank <= 0))):
                raise ValueError("Invalid achievement in the search snapshot.")
    initialize(db_path)
    with connect(db_path) as db:
        previous = metadata(db)
        if previous.get("mode") != "demo" and previous.get("updated_at", "") > recorded:
            raise ValueError("Refusing to overwrite a newer snapshot.")
        if previous.get("mode") == "demo":
            db.execute("DELETE FROM history")
        db.execute("DELETE FROM achievements")
        db.execute("DELETE FROM members")
        for user in users:
            db.execute("""INSERT INTO members
                (id, username, display_name, city, joined, location_source, is_demo,
                 overall_tier, organization, location, progression_opt_out, checked_at, membership_source)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)""",
                       (user["id"], user["username"], user["display_name"], user["city"], user["joined"],
                        f"https://www.kaggle.com/{user['username']}", user["overall_tier"], user["organization"],
                        user["location"], int(user["progression_opt_out"]), recorded,
                        'community_review' if user.get('membership_source') == 'community_review' else 'kaggle_location'))
            for achievement in user.get("achievements", []):
                db.execute("""INSERT INTO achievements
                    (member_id, category, tier, points, global_rank, gold, silver, bronze, medals_known)
                    VALUES (?, ?, 'Unknown', ?, ?, 0, 0, 0, 0)""",
                           (user["id"], achievement["category"], achievement["points"], achievement["global_rank"]))
        db.execute("DELETE FROM history WHERE username NOT IN (SELECT username FROM members WHERE progression_opt_out=0)")
        for category in CATEGORIES:
            for row in ranked_members(db, category):
                db.execute("INSERT OR REPLACE INTO history VALUES (?, ?, ?, ?, ?, ?)",
                           (row["username"], category, recorded, row["points"], row["local_rank"], row["global_rank"]))
        db.executemany("INSERT OR REPLACE INTO metadata VALUES (?, ?)", [
            ("mode", "live"), ("updated_at", recorded), ("source", SOURCE),
            ("discovery", "Public Jordan locations and reviewed community connections" if any(
                user.get('membership_source') == 'community_review' for user in users) else "Public profile location set to Jordan"),
            ("available_categories", ",".join(SEARCH_CATEGORIES)),
            ("medals_available", "false"), ("category_tiers_available", "false"),
            ("reported_total", str(snapshot["reported_total"]))])
    return {"members": len(users), "ranked_members": sum(any(a["global_rank"] for a in u["achievements"]) for u in users),
            "source": SOURCE, "as_of": recorded}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=None)
    parser.add_argument("--cache", default=str(ROOT / "data/kaggle-users.json"))
    parser.add_argument("--from-cache", action="store_true")
    parser.add_argument("--fetch-only", action="store_true")
    parser.add_argument('--with-supabase', action='store_true', help='Load active community approvals and publish the completed public snapshot to Supabase.')
    parser.add_argument("--username", action="append", default=[], help="Also check an exact missing username (repeatable).")
    parser.add_argument("--check-username", help="Diagnose one username without changing data or downloading the country directory.")
    parser.add_argument("--usernames-file", default=str(ROOT / "data/discovery-usernames.json"),
                        help="Persistent JSON list of usernames to check outside the country filter.")
    args = parser.parse_args()
    if args.check_username:
        username = validate_usernames([args.check_username])[0]
        with search_client() as fetch_search:
            _, diagnostic = lookup_username(fetch_search, username)
        print(json.dumps(diagnostic, ensure_ascii=True))
        return
    store = None
    memberships = []
    if args.with_supabase:
        from backend.supabase_store import SupabaseStore
        store = SupabaseStore()
        memberships = store.memberships()
    cache = Path(args.cache)
    if args.from_cache:
        snapshot = json.loads(cache.read_text(encoding="utf-8"))
    else:
        usernames_path = Path(args.usernames_file)
        registered = json.loads(usernames_path.read_text(encoding="utf-8")) if usernames_path.exists() else []
        usernames = validate_usernames([*validate_usernames(registered), *args.username])
        snapshot = download_snapshot(lambda page, count, total: print(
            f"Page {page}: {count} public Jordan profiles / {total} reported", flush=True), usernames, memberships)
        for check in snapshot.get("discovery_checks", []):
            print(json.dumps(check, ensure_ascii=True), flush=True)
        if snapshot.get("unresolved_usernames"):
            print("Not found with a public Jordan location: " + ", ".join(snapshot["unresolved_usernames"]), flush=True)
        cache.parent.mkdir(parents=True, exist_ok=True)
        temporary = cache.with_suffix(".tmp")
        temporary.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
        temporary.replace(cache)
    if args.fetch_only:
        print(json.dumps({"members": len(snapshot["users"]), "fetched_at": snapshot["fetched_at"], "cache": str(cache)}))
    else:
        with connect(args.db) as db:
            backup_dir = ROOT / "data/backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            filename = datetime.now(timezone.utc).strftime("before-search-%Y%m%d-%H%M%S-%f.db")
            with sqlite3.connect(backup_dir / filename) as backup:
                db.backup(backup)
        print(json.dumps(apply_snapshot(snapshot, args.db, memberships), indent=2))
        if store:
            from backend.export_static import build_snapshot
            found = {(user['username'].lower(), user['id']) for user in snapshot['users']}
            checks = [{'username': row['username'], 'kaggle_id': row['kaggle_id'], 'reviewed_at': row['reviewed_at'],
                       'available': (row['username'], row['kaggle_id']) in found} for row in memberships]
            print(json.dumps(store.publish(build_snapshot(args.db), checks), indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # HTTP exception messages can include authentication request details; log only safe diagnostics.
        if isinstance(error, (ValueError, OSError, sqlite3.Error)):
            raise SystemExit(f"Sync failed: {error}") from None
        raise SystemExit(f"Kaggle request failed ({type(error).__name__}). Check network access and Kaggle login; existing data is unchanged.") from None
