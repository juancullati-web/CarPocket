#!/usr/bin/env python3
"""Ajoute une voiture : fiche technique et photos, depuis Wikipédia et Commons."""
from __future__ import annotations

import argparse
import datetime
import json
import re
import shutil
import sys
from pathlib import Path

import build_index
import infobox
import requests_common as common
import vehicle_reference as reference
import wiki

ROOT = build_index.ROOT
CARS_DIR = build_index.CARS_DIR
PHOTOS_DIR = ROOT / "site" / "photos"
CARD_WIDTH = 500
MAGIC = {b"\xff\xd8\xff": "jpg", b"\x89PNG": "png", b"RIFF": "webp"}
LABELS = {
    "engine": "moteur", "power": "puissance", "torque": "couple", "transmission": "boîte",
    "layout": "architecture", "top_speed": "vitesse maximale", "zero_100": "0-100 km/h",
    "weight": "poids", "length": "longueur", "width": "largeur", "height": "hauteur",
    "wheelbase": "empattement", "body": "carrosserie", "production": "production",
    "designer": "design", "assembly": "lieu d'assemblage",
}


def has_car_infobox(page, wanted=None) -> bool:
    if not page:
        return False
    boxes = infobox.find_infoboxes(infobox.strip_noise(page["wikitext"]))
    return bool(infobox.choose_infobox(boxes, wanted))


def resolve(query: str):
    """Trouve la page : titre exact d'abord, puis meilleur résultat de recherche.

    « Page#Génération » demande une génération précise : pas de recherche approchée.
    """
    title, _, wanted = query.partition("#")
    page = wiki.fetch_page(title)
    if has_car_infobox(page, wanted or None):
        return page, []
    if wanted:
        return None, []
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


def save_thumbnail(url: str, folder: Path, number: int):
    """Une image légère pour les cartes. Sans elle, la carte garde simplement la grande photo."""
    small = re.sub(r"/\d+px-", f"/{CARD_WIDTH}px-", url)
    if small == url:
        return None
    try:
        content = wiki.download(small)
    except Exception as error:
        print(f"Miniature ignorée : {error}", file=sys.stderr)
        return None
    extension = next((e for magic, e in MAGIC.items() if content.startswith(magic)), None)
    if not extension:
        return None
    filename = f"{number}-thumb.{extension}"
    (folder / filename).write_bytes(content)
    return filename


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
        thumb = save_thumbnail(file["thumb"], folder, len(photos) + 1)
        photos.append({
            "file": f"photos/{slug}/{filename}",
            **({"thumb": f"photos/{slug}/{thumb}"} if thumb else {}),
            "author": file["author"],
            "license": file["license"],
            "license_url": file["license_url"],
            "source_url": file["page"],
        })
    return photos


def exact_page(title: str):
    """La page qui porte exactement ce nom : une redirection décrirait une autre version."""
    page = wiki.fetch_page(title)
    if page and reference.compact(page["title"]) == reference.compact(title) and has_car_infobox(page):
        return page
    return None


def add_precise(query: str, make: dict, version, page, example: bool) -> dict:
    """Une version précise : son nom, et seulement les valeurs qui la concernent bien."""
    slug = common.slugify(query)
    found = existing_car(slug, query)
    if found:
        return {"status": "duplicate", "name": found["name"], "slug": found["slug"]}
    specs, summary, files = {}, {"text": "", "lang": "", "url": ""}, []
    if page:
        extracted = infobox.extract_specs(page["wikitext"])
        specs = extracted["specs"]
        summary = wiki.summary(page["title"], page["fr_title"])
        files = wiki.choose_photos(page["title"], make["n"], extracted["image"], page["wikidata"])
    if version:
        for origin in [{"src": version["src"], "s": version["s"]}, *version.get("x", [])]:
            for key, value in origin["s"].items():
                if not specs.get(key, {}).get("source"):
                    specs[key] = {"value": value, "from_text": False, "source": origin["src"]}
    if not files:
        files = wiki.exact_photo(query)
    photos = save_photos(files, slug)
    car = {
        "slug": slug,
        "name": query,
        "brand": make["n"],
        "variant": None,
        "example": example,
        "added": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "summary": summary["text"],
        "summary_lang": summary["lang"],
        "summary_url": summary["url"],
        "wikipedia_title": query,
        "specs": specs,
        "overrides": {},
        "photos": photos,
    }
    CARS_DIR.mkdir(parents=True, exist_ok=True)
    (CARS_DIR / f"{slug}.json").write_text(json.dumps(car, ensure_ascii=False, indent=2) + "\n", "utf-8")
    build_index.build()
    missing = [key for key in infobox.SPEC_KEYS if key not in specs]
    return {"status": "ok", "name": query, "slug": slug, "variant": None, "photos": len(photos), "missing": missing}


def add(query: str, example: bool = False) -> dict:
    if "#" not in query:
        # Une marque seule n'est pas une voiture : la recherche approchée en choisirait une au hasard.
        if any(reference.compact(item["n"]) == reference.compact(query) for item in reference.load_makes()):
            return {"status": "not_found", "query": query, "candidates": []}
        make, version = reference.find_version(query)
        if make:
            page = exact_page(query)
            if version:
                return add_precise(query, make, version, page, example)
            if not page:
                if reference.valid_free_name(query, make):
                    return add_precise(query, make, None, None, example)
                return {"status": "not_found", "query": query, "candidates": []}
    page, candidates = resolve(query)
    if not page:
        return {"status": "not_found", "query": query, "candidates": candidates}

    title = page["title"]
    wanted = query.partition("#")[2] or None
    key = f"{title}#{wanted}" if wanted else title
    slug = common.slugify(key)
    found = existing_car(slug, key)
    if found:
        return {"status": "duplicate", "name": found["name"], "slug": found["slug"]}

    extracted = infobox.extract_specs(page["wikitext"], wanted)
    boxes = infobox.find_infoboxes(infobox.strip_noise(page["wikitext"]))
    manufacturer = boxes[0]["fields"].get("manufacturer", "")
    brand = infobox.brand_from(title, manufacturer)
    text = wiki.summary(title, page["fr_title"])
    files = wiki.choose_photos(title, brand, extracted["image"], page["wikidata"], extracted["variant"])
    photos = save_photos(files, slug)
    name = wiki.car_name(title, brand, wanted)
    # Dès la création : ce que Wikipédia ne donne pas, si la liste ouverte décrit la même voiture.
    # Une fiche qui décrit une seule génération reste à part : la liste couvre tout le modèle.
    if not wanted and not extracted["variant"]:
        production = (extracted["specs"].get("production") or {}).get("value", "")
        for spec, value in reference.open_values(title, production).items():
            extracted["specs"].setdefault(spec, {"value": value, "from_text": False, "source": "OVD"})

    car = {
        "slug": slug,
        "name": name,
        "brand": brand,
        "variant": extracted["variant"],
        "example": example,
        "added": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "summary": text["text"],
        "summary_lang": text["lang"],
        "summary_url": text["url"],
        "wikipedia_title": key,
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
        "status": "ok", "name": name, "slug": slug, "variant": extracted["variant"],
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
