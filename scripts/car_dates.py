#!/usr/bin/env python3
"""Date de dernière mise à jour des fiches : seul un changement de valeur compte.

Sans argument : recalcule chaque date depuis l'historique git (à la mise en place).
Avec un commit : date les fiches dont les valeurs ont changé depuis ce commit.
"""
from __future__ import annotations

import datetime
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARS_DIR = "data/cars"


def now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def values_of(car: dict) -> dict:
    """Ce que la fiche affirme, sans son format : ajouter une métadonnée n'est pas une mise à jour."""
    return {
        "name": car.get("name"),
        "brand": car.get("brand"),
        "variant": car.get("variant"),
        "summary": car.get("summary"),
        "specs": {key: (spec or {}).get("value") for key, spec in (car.get("specs") or {}).items()},
        "overrides": {key: value for key, value in (car.get("overrides") or {}).items() if value not in (None, "")},
        "photos": sorted(photo.get("file", "") for photo in car.get("photos") or []),
    }


def with_updated(car: dict, date: str) -> dict:
    """Range la date juste après celle de l'ajout, pour que les fichiers restent lisibles."""
    rest = {key: value for key, value in car.items() if key != "updated"}
    result = {}
    for key, value in rest.items():
        result[key] = value
        if key == "added":
            result["updated"] = date
    result.setdefault("updated", date)
    return result


def last_change(versions: list) -> str:
    """Date de la dernière version qui change une valeur. `versions` va de la plus ancienne à la plus récente."""
    date, previous = "", None
    for when, car in versions:
        values = values_of(car)
        if values != previous:
            date, previous = when, values
    return date


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def write(path: Path, car: dict) -> None:
    path.write_text(json.dumps(car, ensure_ascii=False, indent=2) + "\n", "utf-8")


def backfill() -> int:
    count = 0
    for path in sorted((ROOT / CARS_DIR).glob("*.json")):
        relative = f"{CARS_DIR}/{path.name}"
        versions = []
        for line in reversed(git("log", "--format=%H %cI", "--", relative).splitlines()):
            sha, when = line.split(" ", 1)
            try:
                versions.append((when, json.loads(git("show", f"{sha}:{relative}"))))
            except (subprocess.CalledProcessError, ValueError):
                continue  # Version supprimée ou illisible : elle ne dit rien des valeurs.
        car = json.loads(path.read_text("utf-8"))
        date = last_change(versions) or car.get("added") or ""
        if date:
            write(path, with_updated(car, date))
            count += 1
    return count


def stamp_since(commit: str) -> int:
    count = 0
    for relative in git("diff", "--name-only", commit, "HEAD", "--", CARS_DIR).splitlines():
        path = ROOT / relative
        if not relative.endswith(".json") or not path.exists():
            continue
        car = json.loads(path.read_text("utf-8"))
        try:
            old = json.loads(git("show", f"{commit}:{relative}"))
        except subprocess.CalledProcessError:
            old = None
        if old is None and car.get("updated"):
            continue
        if old is not None and values_of(old) == values_of(car) and car.get("updated"):
            continue
        write(path, with_updated(car, now()))
        count += 1
    return count


if __name__ == "__main__":
    print(stamp_since(sys.argv[1]) if len(sys.argv) > 1 else backfill())
