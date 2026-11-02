"""Literal, Unicode-aware people search shared by directory and rankings."""
import re
import unicodedata


def normalize_text(value):
    value = unicodedata.normalize("NFKD", value).lower()
    return " ".join("".join(c for c in value if not unicodedata.category(c).startswith("M")).split())


def search_terms(query):
    query = query.strip()
    profile = re.fullmatch(r"(?:https?://)?(?:www\.)?kaggle\.com/([a-zA-Z0-9_]{3,50})/?(?:[?#].*)?", query, re.I)
    if profile:
        query = profile.group(1)
    elif query.startswith("@"):
        query = query[1:]
    return normalize_text(query).split()


def matches_person(row, terms):
    fields = [normalize_text(row.get(key) or "") for key in ("display_name", "username", "organization")]
    return all(any(term in field for field in fields) for term in terms)
