"""Private operator review commands. Credentials are read only from the environment."""
import argparse
import json
from datetime import datetime, timezone

from backend.kaggle_source import lookup_username, search_client, validate_usernames
from backend.membership import COMMUNITY_CITIES, validate_memberships
from backend.supabase_store import SupabaseStore


def approve(store, username, city, basis, note, fetch_search):
    username = validate_usernames([username])[0]
    if city not in COMMUNITY_CITIES or basis not in ('public_profile', 'owner_opt_in') or not 5 <= len(note.strip()) <= 2000:
        raise ValueError('Choose a city, a review basis, and a review note of 5–2000 characters.')
    _, diagnostic = lookup_username(fetch_search, username)
    if not diagnostic.get('kaggle_id'):
        raise ValueError('The exact public Kaggle account could not be verified. No membership was approved.')
    row = {'username': username, 'kaggle_id': diagnostic['kaggle_id'],
           'display_name': diagnostic['display_name'], 'city': city,
           'evidence_url': f'https://www.kaggle.com/{username}', 'review_basis': basis,
           'reviewed_at': datetime.now(timezone.utc).isoformat(), 'review_note': note.strip(), 'revoked_at': None,
           'search_available': True}
    validate_memberships([row])
    store.request('kagglejo_memberships?on_conflict=username', row,
                  prefer='resolution=merge-duplicates,return=representation')
    store.request(f'kagglejo_nominations?username=eq.{username}', {'status': 'approved'}, method='PATCH')
    return {'username': username, 'status': 'approved', 'message': 'Visible in the Supabase directory now; available Kaggle statistics update on the next sync.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    commands.add_parser('nominations')
    review = commands.add_parser('approve')
    review.add_argument('username')
    review.add_argument('--city', choices=COMMUNITY_CITIES, default='Not specified')
    review.add_argument('--basis', choices=('public_profile', 'owner_opt_in'), required=True)
    review.add_argument('--note', required=True, help='Private record of the evidence you actually reviewed, or how the owner opted in.')
    for action in ('revoke', 'reject'):
        commands.add_parser(action).add_argument('username')
    args = parser.parse_args()
    store = SupabaseStore()
    if args.action == 'nominations':
        print(json.dumps(store.request('kagglejo_nominations?status=eq.pending&select=username,city,evidence_url,created_at&order=created_at&limit=100'), indent=2))
    elif args.action == 'approve':
        with search_client() as fetch_search:
            print(json.dumps(approve(store, args.username, args.city, args.basis, args.note, fetch_search)))
    else:
        username = validate_usernames([args.username])[0]
        if args.action == 'revoke':
            rows = store.request(f'kagglejo_memberships?username=eq.{username}',
                                 {'revoked_at': datetime.now(timezone.utc).isoformat()}, method='PATCH')
        else:
            rows = store.request(f'kagglejo_nominations?username=eq.{username}', {'status': 'rejected'}, method='PATCH')
        if not rows:
            raise ValueError('No matching record was found; nothing was changed.')
        print(json.dumps({'username': username, 'status': args.action}))


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        raise SystemExit(str(error)) from None
    except Exception as error:
        raise SystemExit(f'Review failed ({type(error).__name__}). Inspect the stored membership before retrying.') from None
