import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from backend.app import create_app
from backend.db import connect
from backend.kaggle_source import apply_snapshot, fetch_snapshot, normalize_person


def document(identifier, username, location="Amman, Amman Governorate, Jordan", tier="CONTRIBUTOR", ranked=False, opted_out=False):
    return {"id": identifier, "documentType": "USER", "title": username, "isPrivate": False,
            "createTime": "2024-01-01T00:00:00Z",
            "ownerUser": {"userName": username, "displayName": username.replace('_', ' ').title(),
                          "tier": tier, "progressionOptOut": opted_out},
            "userDocument": {"userLocation": location, "occupationOrganizationName": "Jordan University",
                             "competitionPoints": 1200 if ranked else 0,
                             "competitionRanking": 42 if ranked else 0,
                             "kernelPoints": 0, "datasetPoints": 0}}


class DirectoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = str(Path(self.temp.name) / "directory.db")
        self.app = create_app({"DB_PATH": self.db, "DEMO": True, "TESTING": True})
        docs = [document(901, "new_contributor"), document(902, "ranked_person", tier="EXPERT", ranked=True),
                document(903, "private_progression", opted_out=True, ranked=True),
                document(904, "country_only", location="Jordan"),
                document(905, "jordan_by_name", location="New York, New York, United States")]
        self.snapshot = fetch_snapshot(lambda _: {"documents": docs, "totalDocuments": len(docs)}, pause=0)
        self.result = apply_snapshot(self.snapshot, self.db)
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def test_import_includes_unranked_and_excludes_names_without_location(self):
        self.assertEqual(self.result["members"], 4)
        self.assertEqual(self.result["ranked_members"], 1)
        body = self.client.get('/api/members').json
        self.assertEqual(body['total'], 4)
        self.assertEqual(body['community']['ranked_members'], 1)
        self.assertEqual(body['community']['unranked_members'], 3)
        self.assertNotIn('jordan_by_name', [r['username'] for r in body['items']])
        self.assertTrue(all(r['is_demo'] == 0 for r in body['items']))

    def test_unranked_profile_remains_accessible_without_fake_ranks(self):
        profile = self.client.get('/api/members/new_contributor').json
        self.assertEqual(profile['member']['overall_tier'], 'Contributor')
        self.assertEqual(len(profile['achievements']), 3)
        for achievement in profile['achievements']:
            self.assertIsNone(achievement['local_rank'])
            self.assertIsNone(achievement['global_rank'])
            self.assertIsNone(achievement['tier'])
            self.assertIsNone(achievement['gold'])

    def test_kaggle_ranks_are_usable_without_category_tier_inference(self):
        body = self.client.get('/api/leaderboard').json
        self.assertEqual(body['total'], 1)
        member = body['items'][0]
        self.assertEqual(member['global_rank'], 42)
        self.assertEqual(member['local_rank'], 1)
        self.assertIsNone(member['tier'])
        self.assertIsNone(member['gold'])
        overview = self.client.get('/api/overview').json
        self.assertIsNone(overview['medals'])
        self.assertEqual(overview['total_members'], 4)
        self.assertEqual(overview['unranked_members'], 3)

    def test_opt_out_profile_shares_no_statistics_or_history(self):
        body = self.client.get('/api/members/private_progression').json
        self.assertEqual(body['achievements'], [])
        self.assertEqual(body['history'], [])
        self.assertEqual(body['member']['overall_tier'], 'Unspecified')

    def test_directory_filters_all_tiers_and_statuses(self):
        self.assertEqual(self.client.get('/api/members?status=unranked').json['total'], 3)
        self.assertEqual(self.client.get('/api/members?status=ranked').json['total'], 1)
        self.assertEqual(self.client.get('/api/members?tier=Contributor').json['total'], 2)
        self.assertEqual(self.client.get('/api/members?city=Not%20specified').json['total'], 1)
        self.assertEqual(self.client.get('/api/members?q=JORDAN%20UNIVERSITY').json['total'], 4)
        self.assertEqual(self.client.get('/api/members?q=%25').json['total'], 0)

    def test_directory_pagination_has_no_duplicate_members(self):
        first = self.client.get('/api/members?page_size=2').json
        second = self.client.get('/api/members?page_size=2&page=2').json
        self.assertEqual(first['pages'], 2)
        self.assertFalse({r['id'] for r in first['items']} & {r['id'] for r in second['items']})
        self.assertEqual(self.client.get('/api/members?sort=newest').status_code, 200)
        self.assertEqual(self.client.get('/api/members?sort=tier').json['items'][0]['overall_tier'], 'Expert')

    def test_directory_rejects_invalid_queries(self):
        for query in ['page=0', 'page_size=101', 'status=admin', 'sort=password', 'tier=Administrator', 'city=Paris']:
            with self.subTest(query=query):
                self.assertEqual(self.client.get('/api/members?' + query).status_code, 400)

    def test_failed_snapshot_is_atomic(self):
        bad = deepcopy(self.snapshot)
        bad['users'][0]['achievements'][0]['points'] = float('nan')
        with self.assertRaises(ValueError):
            apply_snapshot(bad, self.db)
        self.assertEqual(self.client.get('/api/members').json['total'], 4)

    def test_source_does_not_invent_missing_points(self):
        raw = document(999, 'missing_points')
        raw['userDocument'] = {'userLocation': 'Jordan'}
        self.assertEqual(normalize_person(raw)['achievements'], [])

    def test_public_location_is_required_even_with_country_search(self):
        self.assertIsNone(normalize_person(document(990, 'hidden_location', location='')))
        self.assertIsNone(normalize_person(document(991, 'elsewhere', location='Jordan, Minnesota, United States')))
        private = document(992, 'private_user'); private['isPrivate'] = True
        self.assertIsNone(normalize_person(private))

    def test_incomplete_or_repeated_pages_are_rejected(self):
        first = {'documents': [document(991, 'first_person')], 'totalDocuments': 2, 'nextPageToken': 'next'}
        with self.assertRaises(ValueError):
            fetch_snapshot(lambda _: first, pause=0)
        with self.assertRaises(ValueError):
            fetch_snapshot(lambda _: {**first, 'nextPageToken': ''}, pause=0)

    def test_members_without_any_achievements_still_appear(self):
        snapshot = deepcopy(self.snapshot)
        snapshot['users'][0]['achievements'] = []
        apply_snapshot(snapshot, self.db)
        self.assertEqual(self.client.get('/api/members/new_contributor').json['achievements'], [])
        self.assertEqual(self.client.get('/api/members').json['total'], 4)

    def test_schema_migration_preserves_existing_nominations(self):
        with connect(self.db) as db:
            db.execute("INSERT INTO nominations (username,city,evidence_url,created_at) VALUES ('pending_member','Amman','https://www.kaggle.com/pending_member','2025-01-01')")
        apply_snapshot(self.snapshot, self.db)
        with connect(self.db) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM nominations').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
