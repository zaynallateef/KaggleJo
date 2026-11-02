"""Operator-only Supabase REST integration. Never send the secret key to Vite."""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


class SupabaseStore:
    def __init__(self, url=None, key=None, transport=urlopen):
        self.url = (url or os.getenv('SUPABASE_URL', '')).rstrip('/')
        self.key = key or os.getenv('SUPABASE_SECRET_KEY', '')
        parsed = urlparse(self.url)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment or not self.key):
            raise ValueError('Set SUPABASE_URL to the HTTPS project origin and SUPABASE_SECRET_KEY on the operator/server only.')
        if self.key.startswith('sb_publishable_'):
            raise ValueError('Operator actions require a Supabase secret key, not a publishable key.')
        self.transport = transport

    def request(self, path, payload=None, method=None, prefer='return=representation'):
        body = None if payload is None else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        request = Request(self.url + '/rest/v1/' + path, data=body, method=method or ('POST' if body is not None else 'GET'),
                          headers={'apikey': self.key, 'Content-Type': 'application/json', 'Prefer': prefer})
        # Legacy service_role JWTs require the Authorization header as well.
        if not self.key.startswith('sb_secret_'):
            request.add_header('Authorization', 'Bearer ' + self.key)
        try:
            with self.transport(request, timeout=60) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except HTTPError as error:
            # Do not expose response bodies, request headers, or secret-bearing URLs.
            raise ValueError(f'Supabase request failed (HTTP {error.code}). Check the migration, permissions, and server configuration.') from None
        except (URLError, OSError, json.JSONDecodeError):
            raise ValueError('Supabase is unavailable or returned invalid data. Existing published data was preserved.') from None

    def memberships(self):
        rows = self.request('kagglejo_memberships?revoked_at=is.null&select=username,kaggle_id,display_name,city,evidence_url,review_basis,reviewed_at&order=username&limit=1001')
        if not isinstance(rows, list) or len(rows) > 1000:
            raise ValueError('Expected at most 1,000 approved Supabase memberships; refusing a truncated registry.')
        return rows

    def publish(self, snapshot, checks=None):
        return self.request('rpc/kagglejo_publish', {'p_snapshot': snapshot, 'p_checks': checks or []})
