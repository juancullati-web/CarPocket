import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import infobox  # noqa: E402

F40 = """{{Infobox automobile
| name = Ferrari F40
| image = F40 Ferrari 20090509.jpg
| manufacturer = [[Ferrari|Ferrari S.p.A.]]
| production = 1987–1996<br />1,311 produced<ref name="a">{{cite web |url=http://x |title=y}}</ref>
| body_style = 2-door [[berlinetta]]
| layout = [[Longitudinal engine|Longitudinally-mounted]], [[Rear mid-engine, rear-wheel drive layout|rear mid-engine, rear-wheel drive]]<ref name="b"/>
| engine = {{cvt|2936|cc|L|sigfig=2}} [[twin-turbo]]charged ''[[Ferrari Dino engine#F120A|Tipo F120A/F120D]]'' 90° [[V8 engine|V8]]
| powerout = {{cvt|478|PS|kW hp|0}}<br>{{cvt|477|hp|PS kW hp|0|order=out}} US-spec
| transmission = 5-speed [[Manual transmission|manual]]
| weight = {{convert|1100|kg|0|abbr=on}}
}}
The car accelerates from {{cvt|0|-|100|km/h}} in 4.1 seconds and has a top speed of {{cvt|324|km/h|mph|0}}.

== Variants ==
=== F40 LM ===
The LM can reach a top speed of {{cvt|367|km/h|mph|0}}.
"""

ALPINE_POWER = """{{Infobox automobile
| engine = 1.8&nbsp;L turbo [[Straight-four engine|I4]]
| powerout = {{ubl
  | {{cvt|252|PS|hp kW|0}}, {{cvt|320|Nm|lbft|0}}
  | A110S: {{cvt|292|PS|hp kW|0}}, {{cvt|320|Nm|lbft|0}}
}}
}}
"""

NESTED = """{{Infobox automobile
| name = Porsche 911 GT3
| body_style = 2-door [[coupé]]
}}
Intro with top speed of 999 km/h.
== Road cars ==
=== 996 GT3 ===
{{Infobox automobile
| name = 996 GT3
| engine = 3.6L flat-6
| powerout = {{cvt|360|PS|hp kW|0}}
}}
It has a top speed of {{convert|306|km/h|mph|0|abbr=on}}.
=== 997 GT3 ===
It has a top speed of {{convert|310|km/h|mph|0|abbr=on}}.
"""


class Specs(unittest.TestCase):
    def setUp(self):
        self.f40 = infobox.extract_specs(F40)
        self.specs = self.f40["specs"]

    def test_engine_keeps_displacement_and_drops_refs(self):
        self.assertEqual(
            self.specs["engine"]["value"], "2936 cc twin-turbocharged Tipo F120A/F120D 90° V8"
        )

    def test_power_comes_from_infobox(self):
        self.assertEqual(self.specs["power"], {"value": "478 PS", "from_text": False})

    def test_text_values_are_flagged(self):
        self.assertEqual(self.specs["top_speed"], {"value": "324 km/h", "from_text": True})
        self.assertEqual(self.specs["zero_100"]["value"], "0-100 km/h : 4,1 s")

    def test_variant_section_is_not_read(self):
        self.assertNotIn("367", self.specs["top_speed"]["value"])

    def test_french_labels(self):
        self.assertEqual(self.specs["transmission"]["value"], "Manuelle 5 rapports")
        self.assertEqual(self.specs["body"]["value"], "Coupé 2 portes")
        self.assertIn("moteur central arrière, propulsion", self.specs["layout"]["value"])

    def test_weight_and_image(self):
        self.assertEqual(self.specs["weight"]["value"], "1100 kg")
        self.assertEqual(self.f40["image"], "F40 Ferrari 20090509.jpg")

    def test_list_template_gives_base_power_and_torque(self):
        specs = infobox.extract_specs(ALPINE_POWER)["specs"]
        self.assertEqual(specs["power"]["value"], "252 PS")
        self.assertEqual(specs["torque"]["value"], "320 Nm")

    def test_nested_infobox_is_scoped_to_its_section(self):
        result = infobox.extract_specs(NESTED)
        self.assertEqual(result["variant"], "996 GT3")
        self.assertEqual(result["specs"]["top_speed"]["value"], "306 km/h")

    def test_imperial_units_become_metric(self):
        self.assertEqual(infobox.to_metric("3,043 lb"), "1380 kg")
        self.assertEqual(infobox.to_metric("174.6 in"), "4435 mm")
        self.assertEqual(infobox.to_metric("116.8 mph"), "188 km/h")
        self.assertEqual(infobox.to_metric("1100 kg"), "1100 kg")
        self.assertEqual(infobox.to_metric("288 lbft"), "390 Nm")

    def test_nested_infobox_inherits_shared_fields(self):
        self.assertEqual(infobox.extract_specs(NESTED)["specs"]["body"]["value"], "Coupé 2 portes")

    def test_nested_section_includes_subsections(self):
        text = NESTED.replace("It has a top speed of {{convert|306", "==== Perf ====\nIt has a top speed of {{convert|306")
        self.assertEqual(infobox.extract_specs(text)["specs"]["top_speed"]["value"], "306 km/h")

    def test_power_range_is_kept(self):
        specs = infobox.extract_specs("{{Infobox automobile|engine=F6|powerout={{cvt|360-380|PS|kW hp|0}}}}")["specs"]
        self.assertEqual(specs["power"]["value"], "360-380 PS")

    def test_missing_infobox(self):
        self.assertEqual(infobox.extract_specs("Pas de fiche.")["specs"], {})

    def test_absent_values_are_not_invented(self):
        specs = infobox.extract_specs("{{Infobox automobile|engine=V8}}")["specs"]
        self.assertNotIn("top_speed", specs)
        self.assertNotIn("power", specs)


class Numbers(unittest.TestCase):
    def test_power_units(self):
        self.assertEqual(infobox.power_in_ch("478 PS"), 478)
        self.assertEqual(infobox.power_in_ch("190 hp"), 193)
        self.assertEqual(infobox.power_in_ch("100 kW"), 136)

    def test_weight(self):
        self.assertEqual(infobox.weight_in_kg("1,292 kg"), 1292)
        self.assertEqual(infobox.weight_in_kg("2000 lb"), 907)

    def test_year(self):
        self.assertEqual(infobox.first_year("1987–1996 · 1,311 produced"), 1987)
        self.assertIsNone(infobox.first_year("inconnu"))

    def test_brand(self):
        self.assertEqual(infobox.brand_from("Ferrari F40", "[[Ferrari|Ferrari S.p.A.]]"), "Ferrari")
        self.assertEqual(
            infobox.brand_from("Aston Martin DB5", "[[Aston Martin]]"), "Aston Martin"
        )
        self.assertEqual(
            infobox.brand_from("Alpine A110 (2017)", "[[Automobiles Alpine|Alpine]]"), "Alpine"
        )


if __name__ == "__main__":
    unittest.main()
