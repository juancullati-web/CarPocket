#!/usr/bin/env python3
"""Prépare la réserve des boosters : des fiches complètes, dans un dossier séparé du catalogue.

Rien n'est écrit dans le dépôt : le résultat est relu avant d'y entrer. Le travail reprend
là où il s'est arrêté si on relance la même commande.

    python3 scripts/build_reserve.py DOSSIER [--minutes 360]
    python3 scripts/build_reserve.py --into-repo --total 100 --minutes 300   (renouvellement)
"""
from __future__ import annotations

import argparse
import datetime
import json
import random
import re
import sys
import tempfile
import time
from pathlib import Path

import add_car
import build_index
import infobox
import requests_common as common
import wiki

ROOT = build_index.ROOT
REFERENCE_DIR = ROOT / "site" / "reference"
DISCOVERY_QUOTA = {"1920": 10, "1930": 10, "1940": 10, "1950": 30, "1960": 30, "1970": 30, "1980": 30, "1990": 20, "2000": 10, "2010": 10, "2020": 10}
REMARKABLE_TOTAL, REMARKABLE_PER_DECADE = 100, 20
MAX_PER_MAKE = 6
RARE_BELOW = 5000

OUT_OF_SCOPE = re.compile(r"\[\[category:[^\]]*(concept|prototype|truck|bus\b|buses|motorcycle|tractor|\bvans?\b|military|armou?red)", re.I)
BAD_TITLE = re.compile(r"concept|\bseries$|vehicles|list of", re.I)
RACE_LEAD = re.compile(r"racing car|race car|racecar|racing sports car|sports racing|grand prix car|formula (one|two|three|1|2|3)|track[- ](only|focused|car|day)|sports prototype|le mans prototype|rally car|competition car|concept car|prototype|show car", re.I)
BAD_YEARS = re.compile(r"\d{4}[A-Za-z]")
FISCAL = re.compile(r"^\s*\d{1,2}\s*(cv|ch fiscaux)\b|fiscal|\btax\b|\brac\b", re.I)
BAD_POWER = re.compile(r"^\s*\d\s*,\s")
BUILT = re.compile(r"(\d[\d,. ]*)\s*(?:units?\s+)?(built|made|produced|manufactured|exemplaires|units|cars)\b", re.I)
SPORTY_BODY = re.compile(r"coup[eé]|cabriolet|convertible|roadster|spider|spyder|targa|barchetta", re.I)
NOT_SPORTY = re.compile(r"utility|pick-?up|van\b", re.I)
SPORTY_LEAD = re.compile(r"sports? car|grand tourer|gran turismo|roadster|supercar|hypercar|muscle car|coachbuilt|hand-?built", re.I)
TALL = re.compile(r"suv|crossover|mpv|minivan|pickup|pick-up", re.I)


def cites(file_name: str, text: str) -> bool:
    """Le mot doit apparaître entier : « 2 » ne vaut pas pour « 2019 », ni « S7 » pour « S70 »."""
    letters = re.sub(r"[^a-z0-9]", "", text.lower())
    pattern = "[^a-z0-9]*".join(map(re.escape, letters))
    return bool(letters) and re.search(rf"(?<![a-z0-9]){pattern}(?![a-z0-9])", file_name.lower()) is not None


def strict_photo(file_name: str, title: str, make: str) -> bool:
    name = re.sub(r"^File:", "", file_name)
    words = re.sub(r"\s*\(.*?\)", "", title)
    if words.lower().startswith(make.lower()):
        words = words[len(make):]
    words = words.split()
    return bool(words) and cites(name, make) and all(cites(name, word) for word in words)


def built_count(production: str):
    match = BUILT.search(production)
    if not match:
        return None
    digits = re.sub(r"[^0-9]", "", match.group(1))
    return int(digits) if digits else None


def reasons_for(specs: dict, year, lead: str) -> list:
    """Rien d'inventé : chaque point vient de ce que la fiche ou l'article dit. La rareté compte double."""
    reasons = []
    count = built_count(specs["production"]["value"])
    if count and count < RARE_BELOW:
        reasons += [f"{count} exemplaires", "rare"]
    first_body = specs.get("body", {}).get("value", "").split(" · ")[0]
    if SPORTY_BODY.search(first_body) and not NOT_SPORTY.search(first_body):
        reasons.append(first_body)
    if year and int(year) < 1970:
        reasons.append("avant 1970")
    if SPORTY_LEAD.search(lead[:400]):
        reasons.append("décrite comme sportive ou de prestige")
    return reasons


def clean_power(specs: dict) -> None:
    """Une puissance fiscale ou mal lue n'est pas une puissance : le champ reste vide."""
    power = specs.get("power", {}).get("value")
    if power and (FISCAL.search(power) or BAD_POWER.search(power)):
        del specs["power"]


def choose_kind(reasons: list, specs: dict, decade: str, state: dict):
    """Renvoie « remarkable », « discovery », ou None si la case est déjà remplie."""
    tall = bool(TALL.search(specs.get("body", {}).get("value", "")))
    strong = len(reasons) >= 2 and not tall and "power" in specs
    if strong:
        if state["remarkable"] < REMARKABLE_TOTAL and state["remarkable_decades"].get(decade, 0) < REMARKABLE_PER_DECADE:
            return "remarkable"
        return None
    return "discovery" if state["need"].get(decade) else None


def candidates(known: set, seed=300) -> list:
    older, recent = [], []
    makes = json.loads((REFERENCE_DIR / "makes.json").read_text("utf-8"))
    for make in makes:
        data = json.loads((REFERENCE_DIR / f"{make['f']}.json").read_text("utf-8"))
        for model in data["models"]:
            title = model.get("w")
            if title and title not in known and not BAD_TITLE.search(title):
                (recent if model.get("v") else older).append((make["n"], title))
    random.seed(seed)
    random.shuffle(older)
    random.shuffle(recent)
    mixed = []
    while older or recent:
        if older:
            mixed.append(older.pop())
        if recent:
            mixed.append(recent.pop())
    return mixed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", nargs="?")
    parser.add_argument("--minutes", type=int, default=360)
    parser.add_argument("--into-repo", action="store_true", help="écrit directement dans le catalogue (renouvellement)")
    parser.add_argument("--total", type=int, default=300)
    args = parser.parse_args()
    if not args.into_repo and not args.folder:
        parser.error("indique un dossier, ou --into-repo")
    if args.into_repo:
        out = Path(tempfile.mkdtemp())
        cars_dir = build_index.CARS_DIR
    else:
        out = Path(args.folder)
        cars_dir = out / "cars"
        cars_dir.mkdir(parents=True, exist_ok=True)
        add_car.PHOTOS_DIR = out / "photos"
        add_car.PHOTOS_DIR.mkdir(exist_ok=True)
    share = args.total / 300
    quota = {decade: max(1, round(count * share)) for decade, count in DISCOVERY_QUOTA.items()}
    global REMARKABLE_TOTAL, REMARKABLE_PER_DECADE
    REMARKABLE_TOTAL = max(1, round(REMARKABLE_TOTAL * share))
    REMARKABLE_PER_DECADE = max(1, round(REMARKABLE_PER_DECADE * share))
    state_file = out / "state.json"
    state = json.loads(state_file.read_text("utf-8")) if state_file.exists() else {
        "done": [], "need": quota, "remarkable": 0, "remarkable_decades": {},
        "discovery": 0, "makes": {}, "bases": [], "rejected": {}, "finished": False,
    }
    done, bases = set(state["done"]), set(state["bases"])
    known = {json.loads(path.read_text("utf-8")).get("wikipedia_title") for path in build_index.CARS_DIR.glob("*.json")}

    def save():
        state["done"], state["bases"] = sorted(done), sorted(bases)
        state_file.write_text(json.dumps(state, ensure_ascii=False, indent=1), "utf-8")

    def reject(why):
        state["rejected"][why] = state["rejected"].get(why, 0) + 1

    deadline = time.time() + args.minutes * 60
    failures = 0
    for make, title in candidates(known, seed=None if args.into_repo else 300):
        if time.time() > deadline or (not any(state["need"].values()) and state["remarkable"] >= REMARKABLE_TOTAL):
            break
        base = re.sub(r"\s*\(.*?\)", "", title)
        if title in done or base in bases or state["makes"].get(make, 0) >= MAX_PER_MAKE:
            continue
        done.add(title)
        try:
            page = wiki.fetch_page(title)
            if not page:
                reject("page absente"); continue
            if OUT_OF_SCOPE.search(page["wikitext"]):
                reject("hors sujet (concept, utilitaire)"); continue
            found = infobox.extract_specs(page["wikitext"])
            specs = found["specs"]
            if len(specs) < 8 or "production" not in specs or not ("power" in specs or "engine" in specs):
                reject("trop peu d'informations"); continue
            if BAD_YEARS.search(specs["production"]["value"]):
                reject("années mal lues"); continue
            year = infobox.first_year(specs["production"]["value"])
            if not year:
                reject("années mal lues"); continue
            decade = f"{int(year) // 10 * 10}"
            lead = wiki.summary(page["title"], None)
            if RACE_LEAD.search(lead["text"][:400]):
                reject("voiture de course ou prototype"); continue
            clean_power(specs)
            reasons = reasons_for(specs, year, lead["text"])
            kind = choose_kind(reasons, specs, decade, state)
            if not kind:
                reject("case déjà remplie"); continue
            files = wiki.choose_photos(page["title"], make, found["image"], page["wikidata"])
            if not files:
                reject("pas de photo"); continue
            if not strict_photo(files[0]["name"], title, make):
                reject("photo sans le nom exact"); continue
            slug = common.slugify(title)
            if (build_index.CARS_DIR / f"{slug}.json").exists():
                reject("déjà au catalogue"); continue
            photos = add_car.save_photos(files[:1], slug)
            if not photos:
                reject("photo non téléchargée"); continue
            text = wiki.summary(page["title"], page["fr_title"])
            now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
            car = {
                "slug": slug, "name": title, "brand": make, "variant": None, "example": False,
                "added": now, "updated": now, "summary": text["text"], "summary_lang": text["lang"], "summary_url": text["url"],
                "wikipedia_title": page["title"], "specs": specs, "overrides": {}, "photos": photos,
                "reserve": True, "reserve_kind": kind, "reserve_reasons": [r for r in reasons if r != "rare"],
            }
            (cars_dir / f"{slug}.json").write_text(json.dumps(car, ensure_ascii=False, indent=2) + "\n", "utf-8")
            bases.add(base)
            state["makes"][make] = state["makes"].get(make, 0) + 1
            if kind == "remarkable":
                state["remarkable"] += 1
                state["remarkable_decades"][decade] = state["remarkable_decades"].get(decade, 0) + 1
            else:
                state["discovery"] += 1
                state["need"][decade] -= 1
            failures = 0
        except Exception as error:  # une page ratée n'arrête pas tout, mais une panne si
            reject(type(error).__name__)
            failures += 1
            print(f"{title} : {error!r}", file=sys.stderr, flush=True)
            if failures >= 8:
                save()
                print("Arrêt : trop d'erreurs à la suite.", file=sys.stderr)
                return 1
        finally:
            save()
    state["finished"] = True
    save()
    if args.into_repo:
        build_index.build()
    print(f"Fini : {state['discovery']} découvertes, {state['remarkable']} remarquables")
    return 0


if __name__ == "__main__":
    sys.exit(main())
