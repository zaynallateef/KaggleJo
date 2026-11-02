"""Validate the private operator-reviewed membership registry."""
import re
from datetime import datetime, timezone

COMMUNITY_CITIES = ('Amman', 'Irbid', 'Zarqa', 'Aqaba', 'Salt', 'Madaba', 'Karak', 'Mafraq',
                    'Ajloun', 'Jerash', 'Tafilah', 'Maan', 'Other', 'Not specified')


def validate_memberships(rows):
    if not isinstance(rows, list) or len(rows) > 1000:
        raise ValueError('Expected a list of at most 1,000 reviewed memberships.')
    by_name, ids = {}, set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('Invalid reviewed membership.')
        name, identifier = row.get('username', ''), row.get('kaggle_id')
        if (not isinstance(name, str) or not re.fullmatch(r'[a-z0-9_]{3,50}', name)
                or type(identifier) is not int or identifier <= 0 or identifier in ids or name in by_name
                or row.get('city') not in COMMUNITY_CITIES
                or row.get('evidence_url') != f'https://www.kaggle.com/{name}'
                or row.get('review_basis') not in ('public_profile', 'owner_opt_in', 'automatic_submission')):
            raise ValueError('Invalid or duplicate reviewed membership identity or evidence.')
        try:
            stamp = datetime.fromisoformat(row['reviewed_at'].replace('Z', '+00:00'))
        except (ValueError, TypeError, KeyError, AttributeError):
            raise ValueError('Reviewed memberships require a valid review timestamp.') from None
        if stamp.tzinfo is None or stamp > datetime.now(timezone.utc):
            raise ValueError('Invalid membership review timestamp.')
        by_name[name] = row
        ids.add(identifier)
    return by_name
