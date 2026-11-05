"""Lit la liste de référence des véhicules (site/reference), générée par build_reference.py."""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REFERENCE_DIR = ROOT / "site" / "reference"
# Lettres, chiffres et ponctuation courante d'un nom de voiture : rien d'autre pour une saisie libre.
FREE_NAME = re.compile(r"^[^\W_][\w .,'’/()+&-]{1,79}$", re.UNICODE)


def compact(text: str) -> str:
    """« Ferrari F 40 » et « ferrari f40 » désignent la même voiture."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", text.lower())


def full_name(make: str, name: str) -> str:
    return name if compact(name).startswith(compact(make)) else f"{make} {name}"


def load_makes(directory: Path = REFERENCE_DIR) -> list:
    path = directory / "makes.json"
    return json.loads(path.read_text("utf-8")) if path.exists() else []


def make_of(title: str, makes=None) -> dict | None:
    """La marque par laquelle commence le nom, en préférant la plus longue."""
    makes = load_makes() if makes is None else makes
    words = title.split()
    matches = [
        make for make in makes
        if any(compact(" ".join(words[:count])) == compact(make["n"]) for count in range(1, len(words)))
    ]
    return max(matches, key=lambda make: len(compact(make["n"])), default=None)


def find_version(title: str, directory: Path = REFERENCE_DIR):
    """Renvoie (marque, version) si le nom figure dans la liste officielle."""
    make = make_of(title, load_makes(directory))
    if not make:
        return None, None
    data = json.loads((directory / f"{make['f']}.json").read_text("utf-8"))
    wanted = compact(title)
    for model in data["models"]:
        # Le nom d'une page Wikipédia désigne tout le modèle, pas sa version récente de même nom.
        if model.get("w") and compact(model["w"]) == wanted:
            return make, None
        for version in model.get("v", []):
            if compact(full_name(make["n"], version["n"])) == wanted:
                return make, version
    return make, None


def valid_free_name(title: str, make: dict) -> bool:
    return bool(FREE_NAME.match(title)) and compact(title) != compact(make["n"])


def _years(text: str) -> list:
    return [int(year) for year in re.findall(r"\b(?:19|20)\d{2}\b", text or "")]


def periods_overlap(first: str, second: str) -> bool:
    """Faux si l'une des périodes est inconnue : dans le doute, on n'ajoute rien."""
    a, b = _years(first), _years(second)
    if not a or not b:
        return False
    # « 2020–present » n'a pas de fin écrite : elle court jusqu'à aujourd'hui.
    end_a = 9999 if re.search(r"present|current", first or "", re.I) else max(a)
    end_b = 9999 if re.search(r"present|current", second or "", re.I) else max(b)
    return min(a) <= end_b and min(b) <= end_a


def open_values(title: str, production: str, directory: Path = REFERENCE_DIR) -> dict:
    """Les valeurs d'openvehicle-data pour une fiche créée depuis Wikipédia, à la même époque."""
    make = make_of(title, load_makes(directory))
    if not make:
        return {}
    data = json.loads((directory / f"{make['f']}.json").read_text("utf-8"))
    wanted = compact(re.sub(r"\s*\(.*?\)", "", title))
    for model in data["models"]:
        for version in model.get("v", []):
            if compact(full_name(make["n"], version["n"])) != wanted:
                continue
            origins = [{"src": version["src"], "s": version["s"], "y": version["y"]},
                       *[{**extra, "y": extra.get("y", version["y"])} for extra in version.get("x", [])]]
            for origin in origins:
                if origin["src"] == "OVD" and periods_overlap(production, origin["y"] or "2019-2025"):
                    return origin["s"]
    return {}
