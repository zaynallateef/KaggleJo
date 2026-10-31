import csv
import io
import json
import tempfile
import unittest
from pathlib import Path

from backend.app import create_app
from backend.db import connect
from backend.ranking import ranked_members
from backend.sync import import_snapshot


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / "test.db")
        self.app = create_app({"DB_PATH": self.path, "DEMO": True, "TESTING": True})
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp.cleanup()

    def test_health_and_demo_metadata(self):
        self.assertEqual(self.client.get('/api/health').json['status'], 'ok')
        body = self.client.get('/api/overview').json
        self.assertEqual(body['meta']['mode'], 'demo')
        self.assertEqual(body['ranked_members'], 24)
        self.assertEqual(sum(body['cities'].values()), 24)

    def test_category_rankings_are_distinct(self):
        competition = self.client.get('/api/leaderboard?category=competitions').json
        datasets = self.client.get('/api/leaderboard?category=datasets').json
        self.assertNotEqual(competition['items'][0]['username'], datasets['items'][0]['username'])
        self.assertEqual(competition['items'][0]['local_rank'], 1)

    def test_filter_does_not_change_local_rank(self):
        body = self.client.get('/api/leaderboard?city=Irbid').json
        self.assertEqual(body['items'][0]['local_rank'], 2)
        self.assertTrue(all(row['city'] == 'Irbid' for row in body['items']))

    def test_search_and_pagination(self):
        result = self.client.get('/api/leaderboard?q=SARA').json
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['items'][0]['display_name'], 'Sara Al-Khatib')
        p1 = self.client.get('/api/leaderboard?page=1').json
        p2 = self.client.get('/api/leaderboard?page=2').json
        self.assertEqual(p1['pages'], 3)
        self.assertFalse({r['id'] for r in p1['items']} & {r['id'] for r in p2['items']})

    def test_invalid_queries(self):
        for query in ['category=wrong', 'page=0', 'page=abc', 'page_size=101', 'city=Paris', 'tier=Administrator']:
            with self.subTest(query=query):
                self.assertEqual(self.client.get('/api/leaderboard?' + query).status_code, 400)

    def test_empty_search(self):
        response = self.client.get('/api/leaderboard?q=not_a_member').json
        self.assertEqual(response['total'], 0)
        self.assertEqual(response['items'], [])

    def test_equal_points_share_rank(self):
        with connect(self.path) as db:
            db.execute("UPDATE achievements SET points=30000 WHERE member_id IN (1,2) AND category='competitions'")
            ranks = ranked_members(db, 'competitions')
        self.assertEqual([r['local_rank'] for r in ranks[:3]], [1, 1, 3])

    def test_unranked_members_excluded(self):
        with connect(self.path) as db:
            db.execute("UPDATE achievements SET tier='Contributor' WHERE member_id=1 AND category='competitions'")
            db.execute("UPDATE achievements SET global_rank=NULL WHERE member_id=2 AND category='competitions'")
        body = self.client.get('/api/leaderboard').json
        self.assertEqual(body['total'], 22)
        self.assertEqual(body['items'][0]['id'], 3)

    def test_profile_and_missing_profile(self):
        member = self.client.get('/api/leaderboard').json['items'][0]
        profile = self.client.get('/api/members/' + member['username']).json
        self.assertEqual(len(profile['achievements']), 4)
        self.assertEqual(len(profile['history']), 4)
        self.assertEqual(self.client.get('/api/members/missing').status_code, 404)

    def test_csv_respects_filter_and_blocks_formula_injection(self):
        with connect(self.path) as db:
            db.execute("UPDATE members SET display_name='=DANGEROUS()' WHERE id=1")
        response = self.client.get('/api/export?city=Amman')
        self.assertEqual(response.status_code, 200)
        self.assertIn('attachment;', response.headers['Content-Disposition'])
        rows = list(csv.DictReader(io.StringIO(response.text)))
        self.assertTrue(all(row['city'] == 'Amman' for row in rows))
        self.assertEqual(rows[0]['display_name'], "'=DANGEROUS()")
        self.assertTrue(all(row['is_demo'] == '1' for row in rows))

    def nomination(self, username='test_person'):
        return {'username': username, 'city': 'Amman', 'evidence_url': f'https://www.kaggle.com/{username}', 'confirmed': True}

    def test_csv_blocks_formulas_after_leading_whitespace(self):
        with connect(self.path) as db:
            db.execute("UPDATE members SET display_name='  =CMD()' WHERE id=1")
        rows = list(csv.DictReader(io.StringIO(self.client.get('/api/export').text)))
        self.assertEqual(rows[0]['display_name'], "'  =CMD()")

    def test_nomination_persists_without_publishing(self):
        body = self.nomination()
        self.assertEqual(self.client.post('/api/nominations', json=body).status_code, 201)
        with connect(self.path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM nominations').fetchone()[0], 1)
        self.assertEqual(self.client.get('/api/members/test_person').status_code, 404)
        self.assertEqual(self.client.post('/api/nominations', json=body).status_code, 409)

    def test_nomination_rejects_untrusted_input(self):
        variants = [{'city': 'Paris'}, {'evidence_url': 'https://www.kaggle.com.evil.com/test_person'},
                    {'evidence_url': 'https://www.kaggle.com/another_person'}, {'confirmed': False},
                    {'username': '<script>'}, {'username': 123}, {'evidence_url': 'http://www.kaggle.com/test_person'}]
        for patch in variants:
            with self.subTest(patch=patch):
                self.assertEqual(self.client.post('/api/nominations', json={**self.nomination(), **patch}).status_code, 400)
        self.assertEqual(self.client.post('/api/nominations', json=[]).status_code, 400)

    def test_submission_rate_limit(self):
        for i in range(10):
            self.assertEqual(self.client.post('/api/nominations', json=self.nomination(f'test_{i}')).status_code, 201)
        self.assertEqual(self.client.post('/api/nominations', json=self.nomination('test_11')).status_code, 429)

    def test_no_public_admin_route_and_unknown_api(self):
        self.assertEqual(self.client.post('/api/sync', json={}).status_code, 405)
        self.assertEqual(self.client.get('/api/unknown').status_code, 404)
        response = self.client.get('/api/health')
        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')

    def test_production_starts_without_sample_data(self):
        db = str(Path(self.temp.name) / 'production.db')
        client = create_app({'DB_PATH': db, 'DEMO': False, 'TESTING': True}).test_client()
        self.assertEqual(client.get('/api/overview').json['total_members'], 0)


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db = str(self.root / 'snapshot.db')
        self.registry = self.root / 'members.json'
        self.registry.write_text(json.dumps([{'username': 'real_member', 'city': 'Amman',
            'location_source': 'https://www.kaggle.com/real_member', 'reviewed_at': '2025-01-01'}]))
        self.users = self.root / 'Users.csv'
        self.users.write_text('Id,UserName,DisplayName,RegisterDate\n900,real_member,Real Member,01/01/2020\n901,unreviewed,Unreviewed Person,01/01/2020\n')
        self.achievements = self.root / 'UserAchievements.csv'
        self.achievements.write_text('UserId,AchievementType,Tier,Points,CurrentRanking,TotalGold,TotalSilver,TotalBronze\n900,Competitions,3,1000.5,500,1,2,3\n900,Scripts,2,900,800,0,2,4\n901,Competitions,4,2000,100,9,9,9\n')

    def tearDown(self):
        self.temp.cleanup()

    def sync(self, as_of='2025-01-01T00:00:00Z'):
        return import_snapshot(self.db, self.registry, self.users, self.achievements, as_of)

    def test_real_import_excludes_unreviewed_and_removes_demo(self):
        create_app({'DB_PATH': self.db, 'DEMO': True, 'TESTING': True})
        result = self.sync()
        self.assertEqual(result['members'], 1)
        client = create_app({'DB_PATH': self.db, 'DEMO': True, 'TESTING': True}).test_client()
        body = client.get('/api/overview').json
        self.assertEqual(body['meta']['mode'], 'live')
        self.assertEqual(body['total_members'], 1)
        self.assertEqual(body['top'][0]['username'], 'real_member')
        self.assertEqual(body['top'][0]['is_demo'], 0)

    def test_failed_import_preserves_previous_snapshot(self):
        self.sync()
        self.achievements.write_text(self.achievements.read_text().replace('1000.5', 'NaN'))
        with self.assertRaises(ValueError):
            self.sync('2025-01-02T00:00:00Z')
        with connect(self.db) as db:
            self.assertEqual(ranked_members(db, 'competitions')[0]['points'], 1000.5)

    def test_reimport_idempotent_and_history_retained(self):
        self.sync(); self.sync(); self.sync('2025-01-02T00:00:00Z')
        with connect(self.db) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM members').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM history').fetchone()[0], 4)

    def test_old_snapshot_rejected(self):
        self.sync('2025-01-02T00:00:00Z')
        with self.assertRaisesRegex(ValueError, 'newer snapshot'):
            self.sync()

    def test_unmatched_registry_and_bad_schema_rejected(self):
        self.users.write_text(self.users.read_text().replace('real_member', 'missing_member'))
        with self.assertRaisesRegex(ValueError, 'missing from Users'):
            self.sync()

    def test_snapshot_requires_timezone(self):
        with self.assertRaisesRegex(ValueError, 'timezone'):
            self.sync('2025-01-01')


if __name__ == '__main__':
    unittest.main()
