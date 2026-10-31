import json
import tempfile
import unittest
from pathlib import Path

from backend.app import create_app
from backend.db import connect
from backend.export_static import build_snapshot
from backend.kaggle_source import apply_snapshot, fetch_snapshot
from test_directory import document


class StaticExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = str(Path(self.temp.name) / 'export.db')
        self.app = create_app({'DB_PATH': self.db, 'DEMO': False, 'TESTING': True})
        docs = [document(900, 'public_member'), document(901, 'ranked_member', ranked=True), document(902, 'hidden_progression', opted_out=True, ranked=True)]
        snapshot = fetch_snapshot(lambda _: {'documents': docs, 'totalDocuments': len(docs)}, pause=0)
        apply_snapshot(snapshot, self.db)

    def tearDown(self):
        self.temp.cleanup()

    def test_export_has_public_directory_and_consistent_rankings(self):
        snapshot = build_snapshot(self.db)
        self.assertEqual(snapshot['schema_version'], 1)
        self.assertEqual(snapshot['community']['total_members'], 3)
        self.assertEqual(len(snapshot['members']), 3)
        self.assertEqual(snapshot['rankings']['competitions'][0]['local_rank'], 1)
        self.assertEqual(snapshot['profiles']['ranked_member']['achievements'][0]['local_rank'], 1)
        self.assertIsNone(snapshot['profiles']['public_member']['achievements'][0]['local_rank'])
        self.assertEqual(snapshot['overviews']['competitions']['ranked_members'], 1)

    def test_private_tables_and_unknown_metadata_are_never_exported(self):
        with connect(self.db) as db:
            db.execute("INSERT INTO metadata VALUES ('future_private_setting', 'SECRET_SENTINEL')")
            db.execute("INSERT INTO nominations (username, city, evidence_url, created_at) VALUES ('PRIVATE_NOMINATION','Amman','https://www.kaggle.com/private','2025-01-01')")
            db.execute("INSERT INTO rate_limits VALUES ('PRIVATE_ADDRESS_HASH', 1, 1)")
        output = json.dumps(build_snapshot(self.db))
        for marker in ('SECRET_SENTINEL', 'PRIVATE_NOMINATION', 'PRIVATE_ADDRESS_HASH', 'future_private_setting'):
            self.assertNotIn(marker, output)

    def test_opt_out_hides_statistics_and_does_not_infer_medals(self):
        snapshot = build_snapshot(self.db)
        self.assertEqual(snapshot['profiles']['hidden_progression'], {'achievements': [], 'history': []})
        achievement = snapshot['profiles']['ranked_member']['achievements'][0]
        self.assertIsNone(achievement['tier'])
        self.assertIsNone(achievement['gold'])
        self.assertIsNone(snapshot['overviews']['competitions']['medals'])

    def test_empty_or_demo_data_cannot_be_published(self):
        other = str(Path(self.temp.name) / 'demo.db')
        create_app({'DB_PATH': other, 'DEMO': True, 'TESTING': True})
        with self.assertRaises(ValueError):
            build_snapshot(other)
        empty = str(Path(self.temp.name) / 'empty.db')
        create_app({'DB_PATH': empty, 'DEMO': False, 'TESTING': True})
        with self.assertRaises(ValueError):
            build_snapshot(empty)


if __name__ == '__main__':
    unittest.main()
