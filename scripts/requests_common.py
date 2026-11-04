"""Outils partagés par les scripts d'ajout et de retrait."""
from __future__ import annotations

import os
import re
import unicodedata
from pathlib import Path


def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def name_from_issue(body: str) -> str:
    """Lit le champ « Nom de la voiture » d'un formulaire d'issue GitHub."""
    match = re.search(r"###\s*Nom de la voiture\s*\n+(.+)", body or "")
    name = match.group(1).strip() if match else ""
    return "" if name == "_No response_" else name[:120]


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
