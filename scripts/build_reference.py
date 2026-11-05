#!/usr/bin/env python3
"""Génère site/reference : marques, modèles et versions, depuis des sources ouvertes.

- EPA (États-Unis, fueleconomy.gov) : versions précises depuis 1984 ;
- ADEME (France, Car Labelling, Licence Ouverte) : modèles vendus en France, puissance et poids ;
- Wikidata et Wikipédia : modèles anciens ou rares, sans version.

Une caractéristique n'est gardée que si toutes les lignes d'une version donnent la même valeur.
"""
from __future__ import annotations

import csv
import io
import json
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

from vehicle_reference import REFERENCE_DIR, compact

EPA_URL = "https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip"
ADEME_URL = "https://data.ademe.fr/data-fair/api/v1/datasets/ademe-car-labelling/lines"
ADEME_FIELDS = "Marque,Modèle,Description_Commerciale,Puissance_maximale,Poids_à_vide,Cylindrée,Carrosserie,Type_de_boite,Nombre_rapports"
WIKIDATA_URL = "https://query.wikidata.org/sparql"
WIKIDATA_QUERY = """SELECT ?title ?makeLabel WHERE {
  ?item wdt:P31/wdt:P279* wd:Q3231690; wdt:P176 ?make.
  ?a schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title.
  MINUS { ?item wdt:P31 wd:Q850270 }
  ?make rdfs:label ?makeLabel. FILTER(LANG(?makeLabel)="en")
}"""
HEADERS = {"User-Agent": "CarPocketReference/1.0"}

MAKE_ALIASES = {
    "b.m.w.": "BMW", "mercedes": "Mercedes-Benz", "mercedes-benz group": "Mercedes-Benz", "citroen": "Citroën",
    "skoda": "Škoda", "škoda auto": "Škoda", "mclaren automotive": "McLaren", "bugatti rimac": "Bugatti",
    "ineos automotive": "INEOS", "tvr engineering ltd": "TVR", "ruf automobile": "RUF", "ruf automobile gmbh": "RUF",
    "saleen performance": "Saleen", "mini": "MINI", "smart": "Smart", "aston martin lagonda": "Aston Martin",
    "panoz auto-development": "Panoz", "byd auto": "BYD", "audi ag": "Audi", "volvo cars": "Volvo",
    "lamborghin": "Lamborghini", "rolls royc": "Rolls-Royce", "m.g.": "MG", "seat": "SEAT", "kia": "Kia", "coda automotive": "Coda", "roush performance": "Roush",
}
# Fabricants de moteurs, d'avions ou de poids lourds, cités par Wikidata pour quelques véhicules.
NOT_CARS = {
    "aeromobil", "allis-chalmers", "asia", "beechcraft", "bendix", "blue bird", "briggs & stratton", "cummins", "easymile",
    "general", "getrag", "higer", "hino", "jatco", "kawasaki", "king long", "kraz", "leyland", "liaz", "michelin",
    "mowag", "neoplan", "neorion", "oshkosh", "peterbilt", "plaxton", "polaris", "rumpler", "scania", "scania-vabis",
    "scottish aviation", "sony", "terrafugia", "w", "wrightspeed", "yamaha", "yandex", "zündapp",
}
# Carrossiers, importateurs et transformateurs : pas des marques de voitures de collection.
NOT_A_MAKE = re.compile(
    r"\b(inc|incorporated|limited|ltd|llc|lp|corp|corporation|company|gmbh|coach|coaches|imports?|technologies|dynamics|industries|"
    r"environmental|services|sales|div|associated|control|builders|systems|vpg|mobility|pas)\b|^(general motors|am general|grumman)",
    re.I,
)
WIKIDATA_SUFFIX = re.compile(
    r"\s+(motor company|motor corporation|motors|motor|automobiles|automobile|automotive|cars|car company|group|ag|s\.p\.a\.|spa|gmbh|corporation|north america)$",
    re.I,
)
BODIES = {"COUPE": "Coupé", "BERLINE": "Berline", "BREAK": "Break", "CABRIOLET": "Cabriolet", "MONOSPACE": "Monospace",
          "MONOSPACE COMPACT": "Monospace compact", "TS TERRAINS/CHEMINS": "SUV", "COMBISPACE": "Ludospace", "MINIBUS": "Minibus"}
DRIVES = {"Rear-Wheel Drive": "Propulsion", "Front-Wheel Drive": "Traction", "All-Wheel Drive": "Transmission intégrale",
          "4-Wheel Drive": "Transmission intégrale", "Part-time 4-Wheel Drive": "Transmission intégrale",
          "4-Wheel or All-Wheel Drive": "Transmission intégrale"}
NUMBERED_FIRST_WORD = re.compile(r"\d")
KEEP_WHOLE_NAME = re.compile(r"^\S+\s+(series|class|gran|coupe)\b", re.I)


def smart_case(text: str) -> str:
    """Les noms de l'ADEME sont en capitales : « MACAN GTS II » devient « Macan GTS II »."""
    if text != text.upper():
        return text
    words = []
    for word in text.split():
        words.append(word if len(word) <= 3 or re.search(r"\d", word) else word.capitalize())
    return " ".join(words)


def clean_make(name: str) -> str | None:
    name = re.sub(r"\s+", " ", name).strip()
    alias = MAKE_ALIASES.get(name.lower())
    if alias:
        return alias
    if NOT_A_MAKE.search(name) or name.lower() in NOT_CARS:
        return None
    return name if name != name.upper() or len(name) <= 3 else name.title()


def model_of(base_model: str) -> str:
    """Regroupe « 488 GTB » et « 488 Pista » sous 488, mais garde « 3 Series » entier."""
    first, _, rest = base_model.partition(" ")
    if rest and NUMBERED_FIRST_WORD.search(first) and not KEEP_WHOLE_NAME.match(base_model):
        return first
    return base_model


def french_gearbox(text: str) -> str | None:
    speeds = re.search(r"(\d+)(?:-spd)?\)?$", text or "")
    if text.startswith("Manual"):
        kind = "Manuelle"
    elif text.startswith("Automatic"):
        kind = "Automatique"
    else:
        return None
    return f"{kind} {speeds.group(1)} rapports" if speeds else kind


def only_value(values) -> str | None:
    distinct = {value for value in values if value}
    return distinct.pop() if len(distinct) == 1 else None


def years_label(years: set) -> str:
    low, high = min(years), max(years)
    return str(low) if low == high else f"{low}–{high}"


def epa_entries(rows) -> list:
    groups = defaultdict(list)
    for row in rows:
        make = clean_make(row["make"])
        if make:
            groups[(make, model_of(row["baseModel"] or row["model"]), row["model"])].append(row)
    entries = []
    for (make, model, version), lines in groups.items():
        engines = []
        for line in lines:
            if line["displ"] and line["cylinders"]:
                engines.append(f"{line['displ'].replace('.', ',')} L, {line['cylinders']} cylindres")
        years = {int(line["year"]) for line in lines}
        specs = {
            "engine": only_value(engines),
            "transmission": only_value(french_gearbox(line["trany"]) for line in lines),
            "layout": only_value(DRIVES.get(line["drive"]) for line in lines),
            "production": years_label(years),
        }
        entries.append({"make": make, "model": model, "version": version, "years": years_label(years), "source": "EPA",
                        "specs": {key: value for key, value in specs.items() if value}})
    return entries


def ademe_entries(rows) -> list:
    groups = defaultdict(list)
    for row in rows:
        make = clean_make(row.get("Marque", ""))
        model, version = row.get("Modèle"), row.get("Description_Commerciale")
        if make and model and version:
            groups[(make, smart_case(model.strip()), smart_case(version.strip()))].append(row)
    entries = []
    for (make, model, version), lines in groups.items():
        def field(name, unit):
            return only_value(f"{line[name]} {unit}" for line in lines if line.get(name))

        gearboxes = []
        for line in lines:
            kind = {"AUTOMATIQUE": "Automatique", "MECANIQUE": "Manuelle"}.get(line.get("Type_de_boite"))
            if kind:
                gearboxes.append(f"{kind} {line['Nombre_rapports']} rapports" if line.get("Nombre_rapports") else kind)
        specs = {
            "power": field("Puissance_maximale", "kW"),
            "weight": field("Poids_à_vide", "kg"),
            "engine": field("Cylindrée", "cm³"),
            "transmission": only_value(gearboxes),
            "body": only_value(BODIES.get(line.get("Carrosserie")) for line in lines),
        }
        entries.append({"make": make, "model": model, "version": version, "years": "", "source": "ADEME",
                        "specs": {key: value for key, value in specs.items() if value}})
    return entries


def wikipedia_models(bindings, makes: set) -> list:
    """Garde un modèle seulement si le titre de sa page commence par sa marque."""
    by_compact = {compact(make): make for make in makes}
    for binding in bindings:
        label = WIKIDATA_SUFFIX.sub("", binding["makeLabel"]["value"])
        make = clean_make(label)
        if make and binding["title"]["value"].lower().startswith(make.lower() + " "):
            by_compact.setdefault(compact(make), make)
    known = sorted(by_compact.values(), key=len, reverse=True)
    models = []
    for binding in bindings:
        title = binding["title"]["value"]
        for make in known:
            if title.lower().startswith(make.lower() + " "):
                models.append({"make": make, "model": title[len(make) + 1:], "title": title})
                break
    # Une marque citée pour une seule page, absente des sources officielles, est souvent une coquille.
    counts = defaultdict(set)
    for model in models:
        counts[model["make"]].add(model["title"])
    return [model for model in models if model["make"] in makes or len(counts[model["make"]]) >= 2]


def merge(entries: list, wiki_models: list) -> dict:
    catalogue = defaultdict(dict)
    for entry in entries:
        models = catalogue[entry["make"]]
        node = models.setdefault(compact(entry["model"]), {"n": entry["model"], "v": {}})
        key = compact(entry["version"])
        if key not in node["v"]:
            node["v"][key] = {"n": entry["version"], "y": entry["years"], "src": entry["source"], "s": entry["specs"]}
    for item in wiki_models:
        models = catalogue[item["make"]]
        node = models.setdefault(compact(item["model"]), {"n": item["model"], "v": {}})
        node.setdefault("w", item["title"])
    result = {}
    for make, models in catalogue.items():
        ordered = []
        for node in sorted(models.values(), key=lambda m: m["n"].lower()):
            versions = sorted(node.pop("v").values(), key=lambda v: v["n"].lower())
            if versions:
                node["v"] = versions
            ordered.append(node)
        result[make] = ordered
    return result


def fetch(url: str, timeout: int = 180, headers=None) -> bytes:
    request = urllib.request.Request(url, headers={**HEADERS, **(headers or {})})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def download_epa() -> list:
    archive = zipfile.ZipFile(io.BytesIO(fetch(EPA_URL)))
    text = archive.read("vehicles.csv").decode("utf-8", "replace")
    return list(csv.DictReader(io.StringIO(text)))


def download_ademe() -> list:
    rows = []
    url = f"{ADEME_URL}?size=1000&select={urllib.parse.quote(ADEME_FIELDS)}"
    while url:
        data = json.loads(fetch(url))
        rows += data["results"]
        url = data.get("next") if data["results"] else None
    return rows


def download_wikidata() -> list:
    url = f"{WIKIDATA_URL}?{urllib.parse.urlencode({'query': WIKIDATA_QUERY})}"
    # Le service limite parfois à une requête par minute : on patiente au lieu d'échouer.
    for attempt in range(5):
        try:
            return json.loads(fetch(url, 280, {"Accept": "application/sparql-results+json"}))["results"]["bindings"]
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 4:
                raise
            time.sleep(70)
    return []


def write(catalogue: dict, directory: Path = REFERENCE_DIR) -> None:
    fresh = directory.with_name(directory.name + ".new")
    shutil.rmtree(fresh, ignore_errors=True)
    fresh.mkdir(parents=True)
    makes = []
    used = set()
    for make in sorted(catalogue, key=str.lower):
        slug = re.sub(r"[^a-z0-9]+", "-", make.lower().replace("š", "s").replace("ë", "e")).strip("-")
        if not slug or slug in used or slug == "makes":
            continue
        used.add(slug)
        makes.append({"n": make, "f": slug, "c": len(catalogue[make])})
        (fresh / f"{slug}.json").write_text(
            json.dumps({"make": make, "models": catalogue[make]}, ensure_ascii=False, separators=(",", ":")), "utf-8"
        )
    (fresh / "makes.json").write_text(json.dumps(makes, ensure_ascii=False, separators=(",", ":")), "utf-8")
    shutil.rmtree(directory, ignore_errors=True)
    fresh.rename(directory)


def main() -> int:
    epa = epa_entries(download_epa())
    ademe = ademe_entries(download_ademe())
    bindings = download_wikidata()
    # Une source muette ne doit pas effacer la liste déjà publiée.
    if len(epa) < 3000 or len(ademe) < 500 or len(bindings) < 3000:
        print(f"Liste incomplète : EPA {len(epa)}, ADEME {len(ademe)}, Wikidata {len(bindings)}", file=sys.stderr)
        return 1
    entries = ademe + epa
    wiki_models = wikipedia_models(bindings, {entry["make"] for entry in entries})
    catalogue = merge(entries, wiki_models)
    write(catalogue)
    print(f"{len(catalogue)} marques, EPA {len(epa)}, ADEME {len(ademe)}, Wikipédia {len(wiki_models)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
