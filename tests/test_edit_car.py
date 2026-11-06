import sys
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


class Edit(unittest.TestCase):
    def test_a_slug_never_serves_as_a_path(self):
        for slug in ("../../etc/passwd", "", "a/b", "Ferrari F40"):
            with self.assertRaises(edit_car.Refused):
                edit_car.edit(slug, {"power": "1 hp"})

    def test_an_unknown_sheet_is_refused(self):
        with self.assertRaises(edit_car.Refused):
            edit_car.edit("cette-fiche-n-existe-pas", {"power": "1 hp"})


if __name__ == "__main__":
    unittest.main()
