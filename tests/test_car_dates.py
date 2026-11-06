import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import car_dates  # noqa: E402

CAR = {
    "name": "Ferrari F40",
    "added": "2026-01-01",
    "summary": "Texte",
    "specs": {"power": {"value": "478 PS", "from_text": False}},
    "overrides": {},
    "photos": [{"file": "photos/f40/1.jpg", "author": "A"}],
}


def changed(**fields):
    return {**CAR, **fields}


class LastChange(unittest.TestCase):
    def test_a_new_value_counts(self):
        new = changed(specs={"power": {"value": "480 PS"}})
        self.assertEqual(car_dates.last_change([("d1", CAR), ("d2", new)]), "d2")

    def test_metadata_on_a_value_does_not_count(self):
        new = changed(specs={"power": {"value": "478 PS", "from_text": True, "source": "EPA"}})
        self.assertEqual(car_dates.last_change([("d1", CAR), ("d2", new)]), "d1")

    def test_a_new_photo_counts_but_not_its_credit(self):
        credit = changed(photos=[{"file": "photos/f40/1.jpg", "author": "B"}])
        photo = changed(photos=[{"file": "photos/f40/2.jpg"}])
        self.assertEqual(car_dates.last_change([("d1", CAR), ("d2", credit)]), "d1")
        self.assertEqual(car_dates.last_change([("d1", CAR), ("d2", photo)]), "d2")

    def test_an_override_counts_and_an_empty_one_does_not(self):
        self.assertEqual(car_dates.last_change([("d1", CAR), ("d2", changed(overrides={"power": "500 PS"}))]), "d2")
        self.assertEqual(car_dates.last_change([("d1", CAR), ("d2", changed(overrides={"power": ""}))]), "d1")

    def test_the_date_follows_the_last_real_change(self):
        new = changed(summary="Autre")
        self.assertEqual(car_dates.last_change([("d1", CAR), ("d2", new), ("d3", new)]), "d2")


class WithUpdated(unittest.TestCase):
    def test_placed_after_added_and_replaced(self):
        car = car_dates.with_updated(car_dates.with_updated(CAR, "d1"), "d2")
        keys = list(car)
        self.assertEqual(keys[keys.index("added") + 1], "updated")
        self.assertEqual(car["updated"], "d2")


if __name__ == "__main__":
    unittest.main()
