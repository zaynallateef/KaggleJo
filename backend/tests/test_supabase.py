import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from urllib.error import HTTPError

from backend.app import create_app
from backend.auto_approve import process_submissions
from backend.export_static import build_snapshot
from backend.kaggle_source import apply_snapshot, fetch_snapshot, merge_discovery
from backend.membership import validate_memberships
from backend.supabase_admin import approve
from backend.supabase_store import SupabaseStore
from test_directory import document


def membership(username='loplop05', identifier=902):
    return {'username': username, 'kaggle_id': identifier, 'display_name': 'A Public Member',
            'city': 'Not specified', 'evidence_url': f'https://www.kaggle.com/{username}',
            'review_basis': 'public_profile', 'reviewed_at': '2026-01-01T00:00:00Z'}


class ReviewedMembershipTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = str(Path(self.temp.name) / 'review.db')
        self.client = create_app({'DB_PATH': self.db, 'DEMO': False, 'TESTING': True}).test_client()
        self.original = fetch_snapshot(lambda _: {'documents': [document(901, 'automatic_member')], 'totalDocuments': 1}, pause=0)
        apply_snapshot(self.original, self.db)

    def tearDown(self):
        self.temp.cleanup()

    def search(self, query, location, token):
        docs = ([document(902, 'loplop05', location='', ranked=True), document(903, 'loplop050', location='')]
                if query else [document(901, 'automatic_member')] if location == 'Jordan' else [])
        return {'documents': docs, 'totalDocuments': len(docs)}

    def test_approved_account_with_missing_location_is_included_without_inventing_location(self):
        rows = [membership()]
        snapshot = merge_discovery(self.search, memberships=rows)
        apply_snapshot(snapshot, self.db, rows)
        person = self.client.get('/api/members/loplop05').json
        self.assertEqual(person['member']['location'], '')
        self.assertEqual(person['member']['city'], 'Not specified')
        self.assertEqual(person['member']['membership_source'], 'community_review')
        self.assertEqual(person['achievements'][0]['global_rank'], 42)
        self.assertEqual(self.client.get('/api/members').json['total'], 2)
        exported = build_snapshot(self.db)
        reviewed = next(row for row in exported['members'] if row['username'] == 'loplop05')
        self.assertEqual(reviewed['membership_source'], 'community_review')
        self.assertNotIn('review_note', json.dumps(exported))

    def test_cache_cannot_approve_a_person_without_active_registry_and_failure_is_atomic(self):
        snapshot = merge_discovery(self.search, memberships=[membership()])
        with self.assertRaisesRegex(ValueError, 'active Supabase approval'):
            apply_snapshot(snapshot, self.db)
        self.assertEqual(self.client.get('/api/members').json['total'], 1)

    def test_approvals_recheck_identity_and_do_not_include_private_profiles(self):
        with self.assertRaisesRegex(ValueError, 'identity'):
            merge_discovery(self.search, memberships=[membership(identifier=999)])
        def private(query, location, token):
            result = self.search(query, location, token)
            if query:
                result['documents'][0]['isPrivate'] = True
            return result
        snapshot = merge_discovery(private, memberships=[membership()])
        self.assertEqual([u['username'] for u in snapshot['users']], ['automatic_member'])

    def test_revocation_removes_only_community_members_on_next_full_sync(self):
        rows = [membership()]
        apply_snapshot(merge_discovery(self.search, memberships=rows), self.db, rows)
        apply_snapshot(merge_discovery(self.search), self.db)
        self.assertEqual(self.client.get('/api/members/loplop05').status_code, 404)
        self.assertEqual(self.client.get('/api/members/automatic_member').status_code, 200)

    def test_registry_rejects_fabricated_evidence_identity_and_timestamps(self):
        for changes in ({'kaggle_id': True}, {'city': 'Paris'}, {'evidence_url': 'https://example.com'},
                        {'review_basis': 'unverified'}, {'reviewed_at': '2999-01-01T00:00:00Z'}, {'reviewed_at': '2026-01-01'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_memberships([{**membership(), **changes}])

    def test_operator_approval_verifies_exact_public_identity_before_writing(self):
        store = Mock()
        result = approve(store, 'LOPLOP05', 'Not specified', 'public_profile', 'Reviewed public Jordan connection.', self.search)
        row = store.request.call_args_list[0].args[1]
        self.assertEqual(row['kaggle_id'], 902)
        self.assertEqual(row['username'], 'loplop05')
        self.assertEqual(result['status'], 'approved')
        store.reset_mock()
        with self.assertRaises(ValueError):
            approve(store, 'unknown_member', 'Not specified', 'public_profile', 'Reviewed connection.', self.search)
        store.request.assert_not_called()


class SupabaseTransportTests(unittest.TestCase):
    def test_server_key_is_only_in_headers_and_transport_has_timeout(self):
        transport = Mock(return_value=io.BytesIO(b'[]'))
        store = SupabaseStore('https://example.supabase.co', 'sb_secret_test', transport)
        self.assertEqual(store.memberships(), [])
        request = transport.call_args.args[0]
        self.assertEqual(request.get_header('Apikey'), 'sb_secret_test')
        self.assertNotIn('sb_secret_test', request.full_url)
        self.assertEqual(transport.call_args.kwargs['timeout'], 60)

    def test_transport_hides_errors_and_rejects_invalid_configuration(self):
        transport = Mock(side_effect=HTTPError('https://example.supabase.co', 403, 'PRIVATE_SENTINEL', {}, None))
        with self.assertRaises(ValueError) as caught:
            SupabaseStore('https://example.supabase.co', 'sb_secret_test', transport).memberships()
        self.assertNotIn('PRIVATE_SENTINEL', str(caught.exception))
        for url, key in [('http://example.com', 'sb_secret_test'), ('https://example.com?secret=value', 'sb_secret_test'),
                         ('https://example.com', 'sb_publishable_test')]:
            with self.assertRaises(ValueError):
                SupabaseStore(url, key)

    def test_registry_fetch_refuses_truncation(self):
        transport = Mock(return_value=io.BytesIO(json.dumps([membership()] * 1001).encode()))
        with self.assertRaisesRegex(ValueError, 'truncated'):
            SupabaseStore('https://example.supabase.co', 'sb_secret_test', transport).memberships()


class AutomaticSubmissionTests(unittest.TestCase):
    def test_queue_uses_exact_public_identity_and_leaves_unknown_accounts_for_retry(self):
        store = Mock()
        store.request.side_effect = [[{'username': 'loplop05'}, {'username': 'missing_user'}], {'status': 'approved'}]
        def search(query, location, token):
            docs = [document(902, 'loplop05', location=''), document(903, 'loplop050', location='')] if query == 'loplop05' else []
            return {'documents': docs, 'totalDocuments': len(docs)}
        result = process_submissions(store, search)
        self.assertEqual(result, {'approved': 1, 'awaiting_public_account': 1, 'blocked': 0})
        self.assertEqual(store.request.call_args_list[1].args, ('rpc/kagglejo_accept_submission', {
            'p_username': 'loplop05', 'p_kaggle_id': 902, 'p_display_name': 'Loplop05'}))

    def test_private_accounts_are_never_accepted(self):
        store = Mock()
        store.request.return_value = [{'username': 'private_user'}]
        doc = {**document(902, 'private_user'), 'isPrivate': True}
        result = process_submissions(store, lambda *_: {'documents': [doc], 'totalDocuments': 1})
        self.assertEqual(result['awaiting_public_account'], 1)
        store.request.assert_called_once()

    def test_automatic_membership_basis_is_valid_without_claiming_owner_consent(self):
        row = {**membership(), 'review_basis': 'automatic_submission'}
        self.assertEqual(validate_memberships([row])['loplop05']['review_basis'], 'automatic_submission')
