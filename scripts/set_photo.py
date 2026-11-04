#!/usr/bin/env python3
"""Choisit la photo principale d'une voiture : elle passe en tête de liste."""
from __future__ import annotations

import argparse
import json
import sys

import build_index

CARS_DIR = build_index.CARS_DIR


def move_first(photos: list, file: str):
    """Renvoie la liste avec cette photo en tête, ou None si elle n'existe pas."""
    chosen = [photo for photo in photos if photo.get("file") == file]
    if not chosen:
        return None
    return chosen + [photo for photo in photos if photo.get("file") != file]


def set_main(slug: str, file: str) -> bool:
    """Ne cherche que parmi les fiches existantes : le nom reçu ne sert jamais de chemin."""
    for path in CARS_DIR.glob("*.json"):
        if path.stem != slug:
            continue
        car = json.loads(path.read_text("utf-8"))
        photos = move_first(car.get("photos") or [], file)
        if photos is None:
            return False
        car["photos"] = photos
        path.write_text(json.dumps(car, ensure_ascii=False, indent=2) + "\n", "utf-8")
        build_index.build()
        return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slug")
    parser.add_argument("file")
    args = parser.parse_args()
    if not set_main(args.slug, args.file):
        print(f"Photo introuvable pour cette voiture : {args.slug}, {args.file}")
        return 1
    print(f"Photo principale de {args.slug} : {args.file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
