import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_reserve as reserve  # noqa: E402


def spec(value):
    return {"value": value}


def empty_state():
    return {"need": {"1980": 1, "1990": 0}, "remarkable": 0, "remarkable_decades": {}}


class StrictPhoto(unittest.TestCase):
    def test_needs_the_make_and_every_word(self):
        self.assertTrue(reserve.strict_photo("File:1985 Mitsubishi Cordia GSL.jpg", "Mitsubishi Cordia", "Mitsubishi"))
        self.assertFalse(reserve.strict_photo("File:Suzuki Baleno.jpg", "Toyota Glanza", "Toyota"))

    def test_a_word_must_be_whole(self):
        self.assertFalse(reserve.strict_photo("File:BYD S70 China.jpg", "BYD S7", "BYD"))
        self.assertFalse(reserve.strict_photo("File:2019 Polestar concept.jpg", "Polestar 2", "Polestar"))

    def test_ignores_punctuation_and_the_parenthesis(self):
        self.assertTrue(reserve.strict_photo("File:Mazda MX 5 NA.jpg", "Mazda MX-5 (NA)", "Mazda"))


class Reasons(unittest.TestCase):
    def test_rare_is_worth_two_points(self):
        self.assertEqual(reserve.reasons_for({"production": spec("1950–1957 · 88 exemplaires")}, "1995", ""), ["88 exemplaires", "rare"])

    def test_a_large_production_is_not_rare(self):
        self.assertEqual(reserve.reasons_for({"production": spec("1948–1951 · 55,409 made")}, "1995", ""), [])

    def test_a_utility_coupe_does_not_count(self):
        specs = {"production": spec("1978"), "body": spec("Coupé 2 portes utility")}
        self.assertEqual(reserve.reasons_for(specs, "1978", ""), [])

    def test_body_age_and_description_add_up(self):
        specs = {"production": spec("1958"), "body": spec("Coupé 2 portes · Berline")}
        self.assertEqual(len(reserve.reasons_for(specs, "1958", "The DB4 is a grand tourer.")), 3)


class CleanPower(unittest.TestCase):
    def test_removes_fiscal_and_misread_values(self):
        for value in ("6 CV", "4, 75 PS"):
            specs = {"power": spec(value)}
            reserve.clean_power(specs)
            self.assertNotIn("power", specs)

    def test_keeps_a_real_value(self):
        specs = {"power": spec("190 CV")}
        reserve.clean_power(specs)
        self.assertIn("power", specs)


class ChooseKind(unittest.TestCase):
    def test_a_strong_car_with_power_is_remarkable(self):
        self.assertEqual(reserve.choose_kind(["a", "b"], {"power": spec("1 hp")}, "1980", empty_state()), "remarkable")

    def test_without_power_it_stays_a_discovery(self):
        self.assertEqual(reserve.choose_kind(["a", "b"], {}, "1980", empty_state()), "discovery")

    def test_a_full_decade_is_refused(self):
        self.assertIsNone(reserve.choose_kind([], {}, "1990", empty_state()))

    def test_a_strong_car_never_falls_back_when_remarkable_is_full(self):
        state = {**empty_state(), "remarkable": reserve.REMARKABLE_TOTAL}
        self.assertIsNone(reserve.choose_kind(["a", "b"], {"power": spec("1 hp")}, "1980", state))


if __name__ == "__main__":
    unittest.main()
