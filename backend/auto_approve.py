"""Verify queued public accounts and accept submissions without operator review."""
import json
import os

from backend.kaggle_source import lookup_username, search_client
from backend.supabase_store import SupabaseStore


def process_submissions(store, fetch_search):
    rows = store.request('kagglejo_nominations?status=eq.pending&select=username&order=created_at&limit=1000')
    if not isinstance(rows, list) or len(rows) >= 1000:
        raise ValueError('Automatic submission queue is too large or invalid.')
    approved, waiting, blocked = 0, 0, 0
    for row in rows:
        username = row['username']
        _, diagnostic = lookup_username(fetch_search, username)
        if not diagnostic.get('kaggle_id'):
            waiting += 1
            continue
        result = store.request('rpc/kagglejo_accept_submission', {
            'p_username': username, 'p_kaggle_id': diagnostic['kaggle_id'],
            'p_display_name': diagnostic['display_name']})
        if result.get('status') == 'approved':
            approved += 1
        else:
            blocked += 1
    return {'approved': approved, 'awaiting_public_account': waiting, 'blocked': blocked}


def main():
    store = SupabaseStore()
    token = os.getenv('KAGGLE_API_TOKEN', '').strip()
    if not token:
        raise ValueError('Set the operator Kaggle token before configuring automatic submissions.')
    # HTTPS only, service-only RPC, encrypted in Supabase Vault. Never log values.
    store.request('rpc/kagglejo_configure_automation', {'p_token': token})
    with search_client() as fetch_search:
        print(json.dumps(process_submissions(store, fetch_search)))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Automatic account checks failed. Existing memberships were preserved; inspect the job configuration and retry.') from None
