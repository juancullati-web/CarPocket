import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import wiki


class PhotoTokensTest(unittest.TestCase):
    def test_generic_generation_uses_the_model_name(self):
        self.assertEqual(wiki.photo_tokens("Ford GT", "Ford", "First generation"), ["gt"])
        self.assertEqual(wiki.photo_tokens("Toyota RAV4", "Toyota", "Fifth generation"), ["rav4"])

    def test_named_generation_keeps_its_name(self):
        self.assertEqual(wiki.photo_tokens("Porsche 911 GT3", "Porsche", "991 GT3"), ["991", "gt3"])

    def test_scale_models_are_excluded(self):
        self.assertRegex("File:Bburago 1 18 Bugatti Divo.jpg", wiki.EXCLUDED_NAME)


if __name__ == "__main__":
    unittest.main()
