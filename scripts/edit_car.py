#!/usr/bin/env python3
"""Corrige une fiche du catalogue. Les valeurs modifiées dans une collection ne sont jamais touchées.

Le nom et les valeurs arrivent par des variables d'environnement, jamais par la commande.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys

import build_index
import infobox
import requests_common as common

CARS_DIR = build_index.CARS_DIR
MAX_VALUE = 200
SLUG = re.compile(r"^[a-z0-9-]{1,120}$")


class Refused(ValueError):
    """Une demande de correction invalide : rien n'est écrit."""


def clean_changes(changes) -> dict:
    if not isinstance(changes, dict) or not changes:
        raise Refused("Aucune correction reçue.")
    cleaned = {}
    for key, value in changes.items():
        if key not in infobox.SPEC_KEYS:
            raise Refused(f"Champ inconnu : {key}")
        if not isinstance(value, str) or len(value) > MAX_VALUE or re.search(r"[\x00-\x1f\x7f]", value):
            raise Refused(f"Valeur invalide pour {key}")
        cleaned[key] = value.strip()
    return cleaned


def apply_changes(car: dict, changes: dict) -> bool:
    """Une valeur remplace celle du robot ; une valeur vide efface le champ. Renvoie True si la fiche change."""
    overrides = car.setdefault("overrides", {})
    specs = car.setdefault("specs", {})
    changed = False
    for key, value in changes.items():
        if value:
            if overrides.get(key) != value:
                overrides[key] = value
                changed = True
        elif key in overrides or key in specs:
            overrides.pop(key, None)
            specs.pop(key, None)
            changed = True
    if changed:
        car["updated"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    return changed


def edit(slug: str, changes) -> dict:
    if not SLUG.match(slug or ""):
        raise Refused("Fiche invalide.")
    # Le nom reçu ne sert jamais de chemin : il doit désigner un fichier existant.
    path = next((p for p in CARS_DIR.glob("*.json") if p.stem == slug), None)
    if not path:
        raise Refused(f"Aucune fiche {slug}.")
    car = json.loads(path.read_text("utf-8"))
    if apply_changes(car, clean_changes(changes)):
        path.write_text(json.dumps(car, ensure_ascii=False, indent=2) + "\n", "utf-8")
        build_index.build()
        return {"changed": True, "name": car["name"]}
    return {"changed": False, "name": car["name"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comment-file")
    args = parser.parse_args()
    try:
        result = edit(os.environ.get("CAR_SLUG", ""), json.loads(os.environ.get("CAR_CHANGES", "{}")))
    except (Refused, ValueError) as error:
        common.write_comment(args.comment_file, f"Correction refusée : {error}")
        return 1
    common.write_comment(args.comment_file, f"{result['name']} : " + ("fiche corrigée." if result["changed"] else "rien à changer."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
