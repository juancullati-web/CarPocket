import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import edit_car  # noqa: E402


def car():
    return {"name": "Renault NN", "updated": "2026-01-01", "overrides": {"weight": "900 kg"},
            "specs": {"power": {"value": "6 CV", "from_text": False}, "weight": {"value": "1000 kg"}}}


class CleanChanges(unittest.TestCase):
    def test_refuses_an_unknown_field(self):
        with self.assertRaises(edit_car.Refused):
            edit_car.clean_changes({"overrides": "x"})

    def test_refuses_a_long_value_or_a_line_break(self):
        for value in ("x" * 201, "a\nb", 12):
            with self.assertRaises(edit_car.Refused):
                edit_car.clean_changes({"power": value})

    def test_refuses_nothing_to_do(self):
        for value in ({}, [], None):
            with self.assertRaises(edit_car.Refused):
                edit_car.clean_changes(value)

    def test_trims(self):
        self.assertEqual(edit_car.clean_changes({"power": " 20 hp "}), {"power": "20 hp"})


class ApplyChanges(unittest.TestCase):
    def test_a_value_goes_in_overrides_and_keeps_the_source(self):
        c = car()
        self.assertTrue(edit_car.apply_changes(c, {"power": "20 hp"}))
        self.assertEqual(c["overrides"]["power"], "20 hp")
        self.assertEqual(c["specs"]["power"]["value"], "6 CV")
        self.assertNotEqual(c["updated"], "2026-01-01")

    def test_an_empty_value_erases_the_field(self):
        c = car()
        self.assertTrue(edit_car.apply_changes(c, {"weight": ""}))
        self.assertNotIn("weight", c["overrides"])
        self.assertNotIn("weight", c["specs"])

    def test_the_same_value_changes_nothing_not_even_the_date(self):
        c = car()
        self.assertFalse(edit_car.apply_changes(c, {"weight": "900 kg", "torque": ""}))
        self.assertEqual(c["updated"], "2026-01-01")


class AddPhoto(unittest.TestCase):
    def test_refuses_an_odd_title(self):
        for title in ("Tesla.jpg", "File:a|b.jpg", "File:../x.svg", "File:a.gif"):
            with self.assertRaises(edit_car.Refused):
                edit_car.add_photo({"name": "x"}, "x", title)

    def test_refuses_a_sheet_that_has_a_photo(self):
        with self.assertRaises(edit_car.Refused):
            edit_car.add_photo({"name": "x", "photos": [{"file": "a"}]}, "x", "File:a.jpg")

    def test_tells_an_exact_photo_from_a_model_photo(self):
        self.assertTrue(edit_car.cites_exact_name("Tesla Model 3", "File:2023 Tesla Model 3 RWD.jpg"))
        self.assertTrue(edit_car.cites_exact_name("Peugeot e-2008 (57Kw)", "File:Peugeot e-2008 (57Kw) front.jpg"))
        self.assertFalse(edit_car.cites_exact_name("Peugeot e-2008 (57Kw)", "File:Peugeot e-2008 GT.jpg"))
        self.assertFalse(edit_car.cites_exact_name("Tesla Model 3 Standard RWD", "File:2023 Tesla Model 3 RWD.jpg"))


class Upload(unittest.TestCase):
    good = {"url": "https://abc.supabase.co/storage/v1/object/sign/user-photos/u/catalogue/a.jpg?token=x",
            "author": "Juan", "license": "CC BY 4.0", "source": ""}

    def test_accepts_a_complete_credit(self):
        self.assertEqual(edit_car.clean_upload(self.good)["author"], "Juan")

    def test_refuses_another_address(self):
        for url in ("https://example.com/a.jpg", "http://abc.supabase.co/storage/v1/object/sign/user-photos/a", "file:///etc/passwd"):
            with self.assertRaises(edit_car.Refused):
                edit_car.clean_upload({**self.good, "url": url})

    def test_refuses_an_incomplete_or_odd_credit(self):
        for change in ({"author": ""}, {"author": "<b>"}, {"license": "Tous droits réservés"}, {"source": "javascript:x"}):
            with self.assertRaises(edit_car.Refused):
                edit_car.clean_upload({**self.good, **change})

    def test_stores_a_jpeg_with_its_credit(self):
        with tempfile.TemporaryDirectory() as folder:
            saved = edit_car.add_car.PHOTOS_DIR
            edit_car.add_car.PHOTOS_DIR = Path(folder)
            try:
                car = {"name": "x", "photos": []}
                edit_car.store_upload(car, "essai", edit_car.clean_upload(self.good), fetch=lambda url: b"\xff\xd8\xff123")
                self.assertTrue((Path(folder) / "essai" / "1.jpg").exists())
            finally:
                edit_car.add_car.PHOTOS_DIR = saved
        self.assertEqual(car["photos"][0]["origin"], "upload")
        self.assertEqual(car["photos"][0]["author"], "Juan")

    def test_refuses_a_file_that_is_not_a_jpeg_and_a_sheet_with_a_photo(self):
        with self.assertRaises(edit_car.Refused):
            edit_car.store_upload({"photos": []}, "x", self.good, fetch=lambda url: b"<html>")
        with self.assertRaises(edit_car.Refused):
            edit_car.store_upload({"photos": [{"file": "a"}]}, "x", self.good, fetch=lambda url: b"\xff\xd8\xff")


class Edit(unittest.TestCase):
    def test_refuses_an_unknown_reserve_kind(self):
        with self.assertRaises(edit_car.Refused):
            edit_car.edit("ferrari-f40", {}, "", None, "autre")

    def test_needs_a_change_or_a_photo(self):
        with self.assertRaises(edit_car.Refused):
            edit_car.edit("ferrari-f40", {}, "")

    def test_a_slug_never_serves_as_a_path(self):
        for slug in ("../../etc/passwd", "", "a/b", "Ferrari F40"):
            with self.assertRaises(edit_car.Refused):
                edit_car.edit(slug, {"power": "1 hp"})

    def test_an_unknown_sheet_is_refused(self):
        with self.assertRaises(edit_car.Refused):
            edit_car.edit("cette-fiche-n-existe-pas", {"power": "1 hp"})


if __name__ == "__main__":
    unittest.main()
