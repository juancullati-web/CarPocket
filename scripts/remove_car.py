#!/usr/bin/env python3
"""Retire une voiture : sa fiche et ses photos."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys

import build_index
import requests_common as common

CARS_DIR = build_index.CARS_DIR
PHOTOS_DIR = build_index.ROOT / "site" / "photos"


def find(name: str):
    """Ne cherche que parmi les fiches existantes : le nom reçu ne sert jamais de chemin."""
    wanted = common.slugify(name)
    for path in sorted(CARS_DIR.glob("*.json")):
        car = json.loads(path.read_text("utf-8"))
        if wanted in (path.stem, common.slugify(car.get("name", ""))):
            return path, car
    return None, None


def remove(name: str):
    """Supprime la fiche et les photos. Renvoie la voiture retirée, ou None."""
    path, car = find(name) if name else (None, None)
    if not path:
        return None
    path.unlink()
    shutil.rmtree(PHOTOS_DIR / path.stem, ignore_errors=True)
    build_index.build()
    return car


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", nargs="?")
    parser.add_argument("--comment-file")
    args = parser.parse_args()

    name = args.name or common.name_from_issue(os.environ.get("ISSUE_BODY", ""))
    car = remove(name)
    if not car:
        common.write_comment(
            args.comment_file,
            f"Aucune voiture nommée « {name} » dans la bibliothèque. Rien n'a été retiré.",
        )
        return 0
    common.write_comment(args.comment_file, f"**{car['name']}** est retirée de la bibliothèque.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
