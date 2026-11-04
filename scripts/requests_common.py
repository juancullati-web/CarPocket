"""Outils partagés par les scripts d'ajout et de retrait."""
from __future__ import annotations

import os
import re
import unicodedata
from pathlib import Path


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def site_url() -> str:
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    if "/" not in repository:
        return ""
    owner, repo = repository.split("/", 1)
    return f"https://{owner.lower()}.github.io/{repo}/"


def write_comment(path: str | None, text: str) -> None:
    if path:
        Path(path).write_text(text, "utf-8")
    print(text)
