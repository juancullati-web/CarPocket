#!/usr/bin/env python3
"""Corrige une fiche du catalogue, ou lui donne une photo choisie par l'admin.

Les valeurs et les photos d'une collection ne sont jamais touchées.

Le nom et les valeurs arrivent par des variables d'environnement, jamais par la commande.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys

import add_car
import build_index
import infobox
import requests_common as common
import wiki

CARS_DIR = build_index.CARS_DIR
MAX_VALUE = 200
SLUG = re.compile(r"^[a-z0-9-]{1,120}$")
UPLOAD_URL = re.compile(r"^https://[a-z0-9]+\.supabase\.co/storage/v1/object/sign/user-photos/[^\s]+$")
MAX_UPLOAD = 5 * 1024 * 1024
LICENSES = {
    "CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
}
PHOTO_TITLE = re.compile(r"^File:[^|#<>\[\]{}\n]{1,240}\.(jpe?g|png|webp)$", re.I)


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


def cites_exact_name(name: str, file_name: str) -> bool:
    """Le fichier cite le nom complet, parenthèses comprises. Sinon, c'est une photo du modèle, choisie par un humain."""
    return wiki._normalize(name) in wiki._normalize(file_name)


def add_photo(car: dict, slug: str, title: str) -> None:
    """La licence et l'auteur sont relus sur Commons : le navigateur ne les fournit pas."""
    if not PHOTO_TITLE.match(title):
        raise Refused("Photo invalide.")
    if car.get("photos"):
        raise Refused("Cette fiche a déjà une photo.")
    files = wiki.commons_info([title])
    if not files:
        raise Refused("Cette photo n'est pas sous licence libre sur Commons.")
    photos = add_car.save_photos(files[:1], slug)
    if not photos:
        raise Refused("La photo n'a pas pu être téléchargée.")
    if not cites_exact_name(car["name"], title):
        photos[0]["scope"] = "model"
    car["photos"] = photos
    car["updated"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def clean_upload(upload) -> dict:
    """Une photo envoyée par l'admin : Commons ne peut pas la vérifier, le crédit doit donc être complet."""
    if not isinstance(upload, dict) or not UPLOAD_URL.match(str(upload.get("url", ""))):
        raise Refused("Photo envoyée invalide.")
    author = str(upload.get("author", "")).strip()
    license_name = upload.get("license")
    source = str(upload.get("source", "")).strip()
    if not author or len(author) > 120 or re.search(r"[\x00-\x1f\x7f<>]", author):
        raise Refused("Auteur invalide.")
    if license_name not in LICENSES:
        raise Refused("Licence invalide.")
    if source and (len(source) > 500 or not re.match(r"^https://[^\s<>\"]+$", source)):
        raise Refused("Source invalide.")
    return {"url": upload["url"], "author": author, "license": license_name, "source": source}


def store_upload(car: dict, slug: str, upload: dict, fetch=wiki.download) -> None:
    if car.get("photos"):
        raise Refused("Cette fiche a déjà une photo.")
    content = fetch(upload["url"])
    if not content.startswith(b"\xff\xd8\xff") or len(content) > MAX_UPLOAD:
        raise Refused("Le fichier envoyé n'est pas une photo JPEG valide.")
    folder = add_car.PHOTOS_DIR / slug
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "1.jpg").write_bytes(content)
    car["photos"] = [{
        "file": f"photos/{slug}/1.jpg",
        "author": upload["author"],
        "license": upload["license"],
        "license_url": LICENSES[upload["license"]],
        "source_url": upload["source"],
        "origin": "upload",
    }]
    car["updated"] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def edit(slug: str, changes, photo: str = "", upload=None) -> dict:
    if not SLUG.match(slug or ""):
        raise Refused("Fiche invalide.")
    if not changes and not photo and not upload:
        raise Refused("Aucune correction reçue.")
    if photo and upload:
        raise Refused("Une seule photo à la fois.")
    # Le nom reçu ne sert jamais de chemin : il doit désigner un fichier existant.
    path = next((p for p in CARS_DIR.glob("*.json") if p.stem == slug), None)
    if not path:
        raise Refused(f"Aucune fiche {slug}.")
    car = json.loads(path.read_text("utf-8"))
    changed = apply_changes(car, clean_changes(changes)) if changes else False
    if photo:
        add_photo(car, slug, photo)
        changed = True
    if upload:
        store_upload(car, slug, clean_upload(upload))
        changed = True
    if changed:
        path.write_text(json.dumps(car, ensure_ascii=False, indent=2) + "\n", "utf-8")
        build_index.build()
        return {"changed": True, "name": car["name"]}
    return {"changed": False, "name": car["name"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comment-file")
    args = parser.parse_args()
    try:
        result = edit(os.environ.get("CAR_SLUG", ""), json.loads(os.environ.get("CAR_CHANGES") or "{}"), os.environ.get("CAR_PHOTO", ""), json.loads(os.environ.get("CAR_UPLOAD") or "null"))
    except (Refused, ValueError) as error:
        common.write_comment(args.comment_file, f"Correction refusée : {error}")
        return 1
    common.write_comment(args.comment_file, f"{result['name']} : " + ("fiche corrigée." if result["changed"] else "rien à changer."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
