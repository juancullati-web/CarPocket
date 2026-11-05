import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_reference
import vehicle_reference as reference
import wiki


class PhotoTokensTest(unittest.TestCase):
    def test_generic_generation_uses_the_model_name(self):
        self.assertEqual(wiki.photo_tokens("Ford GT", "Ford", "First generation"), ["gt"])
        self.assertEqual(wiki.photo_tokens("Toyota RAV4", "Toyota", "Fifth generation"), ["rav4"])

    def test_named_generation_keeps_its_name(self):
        self.assertEqual(wiki.photo_tokens("Porsche 911 GT3", "Porsche", "991 GT3"), ["991", "gt3"])

    def test_scale_models_are_excluded(self):
        self.assertRegex("File:Bburago 1 18 Bugatti Divo.jpg", wiki.EXCLUDED_NAME)


class CarNameTest(unittest.TestCase):
    def test_generic_generation_keeps_the_model(self):
        self.assertEqual(wiki.car_name("Ford GT", "Ford", "First generation"), "Ford GT (First generation)")

    def test_generation_with_a_code_keeps_the_model(self):
        self.assertEqual(
            wiki.car_name("Nissan Skyline GT-R", "Nissan", "Fifth generation (R34)"),
            "Nissan Skyline GT-R Fifth generation (R34)",
        )

    def test_named_generation_keeps_its_name(self):
        self.assertEqual(wiki.car_name("Porsche 911 GT3", "Porsche", "991 GT3"), "Porsche 991 GT3")

    def test_without_generation_uses_the_title(self):
        self.assertEqual(wiki.car_name("Ferrari F40", "Ferrari"), "Ferrari F40")


class ReferenceTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.directory = Path(self.folder.name)
        (self.directory / "makes.json").write_text(json.dumps([
            {"n": "Ferrari", "f": "ferrari", "c": 1}, {"n": "Alfa Romeo", "f": "alfa-romeo", "c": 0},
        ]), "utf-8")
        (self.directory / "ferrari.json").write_text(json.dumps({"make": "Ferrari", "models": [
            {"n": "488", "w": "Ferrari 488", "v": [{"n": "488 Pista", "y": "2019", "src": "EPA", "s": {}}]},
        ]}), "utf-8")
        (self.directory / "alfa-romeo.json").write_text(json.dumps({"make": "Alfa Romeo", "models": []}), "utf-8")

    def tearDown(self):
        self.folder.cleanup()

    def test_finds_a_listed_version_whatever_the_spacing(self):
        make, version = reference.find_version("ferrari 488pista", self.directory)
        self.assertEqual(make["n"], "Ferrari")
        self.assertEqual(version["n"], "488 Pista")

    def test_unlisted_version_keeps_the_make_only(self):
        make, version = reference.find_version("Ferrari 488 Speciale", self.directory)
        self.assertEqual(make["n"], "Ferrari")
        self.assertIsNone(version)

    def test_two_word_make(self):
        make, _ = reference.find_version("Alfa Romeo GTA", self.directory)
        self.assertEqual(make["n"], "Alfa Romeo")

    def test_unknown_make(self):
        self.assertEqual(reference.find_version("Inconnue X1", self.directory), (None, None))

    def test_free_name_is_checked(self):
        make = {"n": "Ferrari"}
        self.assertTrue(reference.valid_free_name("Ferrari 488 Pista", make))
        self.assertFalse(reference.valid_free_name("Ferrari", make))
        self.assertFalse(reference.valid_free_name("Ferrari <script>", make))


class BuildReferenceTest(unittest.TestCase):
    def test_groups_numbered_models_but_not_series(self):
        self.assertEqual(build_reference.model_of("488 Pista"), "488")
        self.assertEqual(build_reference.model_of("3 Series"), "3 Series")
        self.assertEqual(build_reference.model_of("Grand Cherokee"), "Grand Cherokee")

    def test_a_value_is_kept_only_if_all_lines_agree(self):
        rows = [
            {"make": "Ferrari", "baseModel": "488 GTB", "model": "488 GTB", "year": "2016", "displ": "3.9", "cylinders": "8",
             "trany": "Automatic (AM7)", "drive": "Rear-Wheel Drive"},
            {"make": "Ferrari", "baseModel": "488 GTB", "model": "488 GTB", "year": "2019", "displ": "3.9", "cylinders": "8",
             "trany": "Manual 6-spd", "drive": "Rear-Wheel Drive"},
        ]
        entry = build_reference.epa_entries(rows)[0]
        self.assertEqual(entry["model"], "488")
        self.assertEqual(entry["specs"]["engine"], "3,9 L, 8 cylindres")
        self.assertNotIn("transmission", entry["specs"])
        self.assertEqual(entry["years"], "2016–2019")

    def test_coachbuilders_are_not_makes(self):
        self.assertIsNone(build_reference.clean_make("Superior Coaches Div E.p. Dutton"))
        self.assertEqual(build_reference.clean_make("B.M.W."), "BMW")
        self.assertEqual(build_reference.clean_make("PEUGEOT"), "Peugeot")

    def test_ademe_names_lose_their_capitals(self):
        self.assertEqual(build_reference.smart_case("MACAN GTS II"), "Macan GTS II")


if __name__ == "__main__":
    unittest.main()
