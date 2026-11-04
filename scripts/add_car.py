#!/usr/bin/env python3
"""Ajoute une voiture : fiche technique et photos, depuis Wikipédia et Commons."""
from __future__ import annotations

import argparse
import datetime
import json
import shutil
import sys
from pathlib import Path

import build_index
import infobox
import requests_common as common
import wiki

ROOT = build_index.ROOT
CARS_DIR = build_index.CARS_DIR
PHOTOS_DIR = ROOT / "site" / "photos"
MAGIC = {b"\xff\xd8\xff": "jpg", b"\x89PNG": "png", b"RIFF": "webp"}
LABELS = {
    "engine": "moteur", "power": "puissance", "torque": "couple", "transmission": "boîte",
    "layout": "architecture", "top_speed": "vitesse maximale", "zero_100": "0-100 km/h",
    "weight": "poids", "length": "longueur", "width": "largeur", "height": "hauteur",
    "wheelbase": "empattement", "body": "carrosserie", "production": "production",
    "designer": "design", "assembly": "lieu d'assemblage",
}


def has_car_infobox(page) -> bool:
    return bool(page and infobox.find_infoboxes(infobox.strip_noise(page["wikitext"])))


def resolve(query: str):
    """Trouve la page : titre exact d'abord, puis meilleur résultat de recherche."""
    page = wiki.fetch_page(query)
    if has_car_infobox(page):
        return page, []
    candidates = wiki.search_titles(query)
    for title in candidates:
        page = wiki.fetch_page(title)
        if has_car_infobox(page):
            return page, candidates
    return None, candidates


def existing_car(slug: str, title: str):
    for path in CARS_DIR.glob("*.json"):
        car = json.loads(path.read_text("utf-8"))
        if path.stem == slug or car.get("wikipedia_title") == title:
            return car
    return None


def save_photos(files: list, slug: str) -> list:
    folder = PHOTOS_DIR / slug
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    photos = []
    for file in files:
        try:
            content = wiki.download(file["thumb"])
        except Exception as error:  # une photo ratée ne doit pas bloquer la fiche
            print(f"Photo ignorée ({file['name']}) : {error}", file=sys.stderr)
            continue
        extension = next((e for magic, e in MAGIC.items() if content.startswith(magic)), None)
        if not extension:
            print(f"Photo ignorée, format inattendu : {file['name']}", file=sys.stderr)
            continue
        filename = f"{len(photos) + 1}.{extension}"
        (folder / filename).write_bytes(content)
        photos.append({
            "file": f"photos/{slug}/{filename}",
            "author": file["author"],
            "license": file["license"],
            "license_url": file["license_url"],
            "source_url": file["page"],
        })
    return photos


def add(query: str, example: bool = False) -> dict:
    page, candidates = resolve(query)
    if not page:
        return {"status": "not_found", "query": query, "candidates": candidates}

    title = page["title"]
    slug = common.slugify(title)
    found = existing_car(slug, title)
    if found:
        return {"status": "duplicate", "name": found["name"], "slug": found["slug"]}

    extracted = infobox.extract_specs(page["wikitext"])
    boxes = infobox.find_infoboxes(infobox.strip_noise(page["wikitext"]))
    manufacturer = boxes[0]["fields"].get("manufacturer", "")
    brand = infobox.brand_from(title, manufacturer)
    text = wiki.summary(title, page["fr_title"])
    files = wiki.choose_photos(title, brand, extracted["image"], page["wikidata"], extracted["variant"])
    photos = save_photos(files, slug)

    car = {
        "slug": slug,
        "name": title,
        "brand": brand,
        "variant": extracted["variant"],
        "example": example,
        "added": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "summary": text["text"],
        "summary_lang": text["lang"],
        "summary_url": text["url"],
        "wikipedia_title": title,
        "specs": extracted["specs"],
        "overrides": {},
        "photos": photos,
    }
    CARS_DIR.mkdir(parents=True, exist_ok=True)
    (CARS_DIR / f"{slug}.json").write_text(
        json.dumps(car, ensure_ascii=False, indent=2) + "\n", "utf-8"
    )
    build_index.build()
    missing = [key for key in infobox.SPEC_KEYS if key not in extracted["specs"]]
    return {
        "status": "ok", "name": title, "slug": slug, "variant": extracted["variant"],
        "photos": len(photos), "missing": missing,
    }


def comment_for(result: dict) -> str:
    base = common.site_url()
    status = result["status"]
    if status == "not_found":
        lines = [f"Je n'ai pas trouvé de fiche technique pour « {result['query']} »."]
        if result["candidates"]:
            lines += ["", "Résultats proches sur Wikipédia. Refais une demande avec le titre exact :", ""]
            lines += [f"- {title}" for title in result["candidates"]]
        return "\n".join(lines)
    link = f"{base}#{result['slug']}" if base else result["slug"]
    if status == "duplicate":
        return f"**{result['name']}** est déjà dans la bibliothèque : {link}"
    lines = [f"**{result['name']}** est ajoutée : {link}", ""]
    lines.append(f"Photos trouvées : {result['photos']}.")
    if result["variant"]:
        lines.append(f"La fiche décrit la version : {result['variant']}.")
    if result["missing"]:
        names = ", ".join(LABELS[key] for key in result["missing"])
        lines.append(f"Non trouvé sur Wikipédia : {names}.")
    lines += ["", "Le site se met à jour dans une ou deux minutes."]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name", nargs="?", help="nom de la voiture")
    parser.add_argument("--example", action="store_true", help="marquer comme exemple")
    parser.add_argument("--comment-file", help="fichier où écrire la réponse à la demande")
    args = parser.parse_args()

    if not args.name:
        common.write_comment(args.comment_file, "Je n'ai pas trouvé de nom de voiture dans la demande.")
        return 1
    result = add(args.name, example=args.example)
    common.write_comment(args.comment_file, comment_for(result))
    return 1 if result["status"] == "not_found" else 0


if __name__ == "__main__":
    sys.exit(main())
