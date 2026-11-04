#!/usr/bin/env python3
"""Régénère site/cars.json à partir des fiches de data/cars."""
from __future__ import annotations

import json
from pathlib import Path

import infobox

ROOT = Path(__file__).resolve().parent.parent
CARS_DIR = ROOT / "data" / "cars"
INDEX = ROOT / "site" / "cars.json"


def merged_specs(car: dict) -> dict:
    """Les corrections manuelles (overrides) priment toujours sur le robot."""
    specs = dict(car.get("specs") or {})
    for key, value in (car.get("overrides") or {}).items():
        if value in (None, ""):
            continue
        if key in infobox.SPEC_KEYS:
            specs[key] = {"value": str(value), "from_text": False, "corrected": True}
    return specs


def public_car(car: dict) -> dict:
    specs = merged_specs(car)
    value = lambda key: (specs.get(key) or {}).get("value", "")  # noqa: E731
    return {
        **{k: v for k, v in car.items() if k not in ("overrides", "specs", "wikitext_title")},
        "specs": specs,
        "missing": [key for key in infobox.SPEC_KEYS if key not in specs],
        "power_ch": infobox.power_in_ch(value("power")),
        "weight_kg": infobox.weight_in_kg(value("weight")),
        "year": infobox.first_year(value("production")),
    }


def build() -> list:
    cars = [json.loads(path.read_text("utf-8")) for path in sorted(CARS_DIR.glob("*.json"))]
    public = [public_car(car) for car in cars]
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(public, ensure_ascii=False, indent=1) + "\n", "utf-8")
    return public


if __name__ == "__main__":
    print(f"{len(build())} voiture(s) dans l'index")
