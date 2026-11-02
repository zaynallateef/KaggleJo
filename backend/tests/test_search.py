import unittest

from backend.search import matches_person, search_terms


class PeopleSearchTests(unittest.TestCase):
    def test_handles_usernames_and_profile_links(self):
        person = {"username": "loplop05", "display_name": "A Friend"}
        for query in ("@LOPLOP05", "https://www.kaggle.com/loplop05/", "kaggle.com/loplop05?tab=activity"):
            self.assertTrue(matches_person(person, search_terms(query)))

    def test_unicode_and_reordered_terms(self):
        person = {"username": "new_member", "display_name": "SÁRA   خَالِد", "organization": "Jordan University"}
        for query in ("sara", "خالد", "خالد sara", "University sara"):
            self.assertTrue(matches_person(person, search_terms(query)))
        self.assertFalse(matches_person(person, search_terms("sara nobody")))

    def test_special_characters_are_literal_and_fields_are_separate(self):
        person = {"username": "new_member", "display_name": "New Person"}
        self.assertTrue(matches_person(person, search_terms("_member")))
        self.assertFalse(matches_person(person, search_terms("%")))
        self.assertFalse(matches_person(person, search_terms("personnew")))
