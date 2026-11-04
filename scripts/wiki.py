"""Appels en lecture aux API Wikipédia, Wikidata et Wikimedia Commons."""
from __future__ import annotations

import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "CarPocket/1.0 (personal car library; python-urllib)"
EN = "en.wikipedia.org"
FR = "fr.wikipedia.org"
COMMONS = "commons.wikimedia.org"
WIKIDATA = "www.wikidata.org"
THUMB_WIDTH = 1280
MIN_INTERVAL = 1.5
FREE_LICENSE = re.compile(r"^(cc[ -]?by|cc0|cc-zero|public domain|pd\b|pdm|fal\b|attribution)", re.I)
EXCLUDED_NAME = re.compile(
    r"logo|icon|badge|emblem|flag|diagram|schema|map\b|sketch|drawing|blueprint|"
    r"\.svg|commons-|wiki|poster|stamp|\bnew\b|replica|concept|tribute|homage|hommage|restomod|\btoy\b|lego|scale model|"
    r"bburago|diecast|die-cast|maquette|miniature|\b1[ _:]18\b|\b1[ _:]43\b",
    re.I,
)
DETAIL_NAME = re.compile(
    r"wheel|rim\b|lug|instrument|panel|fuel|\bcap\b|tank|sticker|engine|motor|interior|cockpit|dash|seat|steering|gear|detail|"
    r"tail ?light|headlight|exhaust|door|mirror|plate|close|nameplate|trunk|boot",
    re.I,
)


_last_call = 0.0


def _open(url: str, timeout: int = 60) -> bytes:
    """Requête polie : espacée, et qui respecte les demandes d'attente de Wikimedia."""
    global _last_call
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(6):
        wait = MIN_INTERVAL - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.monotonic()
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 5:
                raise
            header = error.headers.get("Retry-After", "")
            delay = int(header) if header.isdigit() else 15 * (attempt + 1)
            time.sleep(min(delay, 120))
        except urllib.error.URLError:
            if attempt == 5:
                raise
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"Échec du téléchargement : {url}")


def api(host: str, **params) -> dict:
    params.update(format="json", formatversion="2")
    url = f"https://{host}/w/api.php?{urllib.parse.urlencode(params)}"
    return json.loads(_open(url).decode("utf-8"))


def fetch_page(title: str):
    """Renvoie {title, wikitext, wikidata, fr_title} ou None si la page n'existe pas."""
    data = api(
        EN, action="query", titles=title, redirects="1",
        prop="revisions|pageprops|langlinks", rvprop="content", rvslots="main",
        ppprop="wikibase_item", lllang="fr",
    )
    pages = data["query"]["pages"]
    page = pages[0] if pages else None
    if not page or page.get("missing") or "revisions" not in page:
        return None
    links = page.get("langlinks") or []
    return {
        "title": page["title"],
        "wikitext": page["revisions"][0]["slots"]["main"]["content"],
        "wikidata": (page.get("pageprops") or {}).get("wikibase_item"),
        "fr_title": links[0]["title"] if links else None,
    }


def search_titles(query: str, limit: int = 6) -> list:
    data = api(EN, action="query", list="search", srsearch=query, srlimit=str(limit), srnamespace="0")
    return [hit["title"] for hit in data["query"]["search"]]


def summary(title: str, fr_title) -> dict:
    """Renvoie {text, lang, url} : le français d'abord, sinon l'anglais."""
    for host, page_title, lang in ((FR, fr_title, "fr"), (EN, title, "en")):
        if not page_title:
            continue
        data = api(
            host, action="query", titles=page_title, redirects="1",
            prop="extracts", exintro="1", explaintext="1",
        )
        text = (data["query"]["pages"][0].get("extract") or "").strip()
        if text:
            url = f"https://{host}/wiki/" + urllib.parse.quote(page_title.replace(" ", "_"))
            return {"text": _shorten(text), "lang": lang, "url": url}
    url = f"https://{EN}/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
    return {"text": "", "lang": "en", "url": url}


def _shorten(text: str, limit: int = 900) -> str:
    text = re.sub(r"\s+", " ", text)
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind(". "))
    return cut[:end + 1] if end > 200 else cut.rstrip() + "…"


def article_files(title: str) -> list:
    data = api(EN, action="query", titles=title, redirects="1", prop="images", imlimit="100")
    images = data["query"]["pages"][0].get("images") or []
    return [image["title"] for image in images]


def commons_category(wikidata_id) -> str | None:
    if not wikidata_id:
        return None
    data = api(WIKIDATA, action="wbgetclaims", entity=wikidata_id, property="P373")
    claims = data.get("claims", {}).get("P373") or []
    try:
        return claims[0]["mainsnak"]["datavalue"]["value"]
    except (KeyError, IndexError):
        return None


_INFO = dict(
    prop="imageinfo", iiprop="url|size|mime|extmetadata", iiurlwidth=str(THUMB_WIDTH),
    iiextmetadatafilter="Artist|LicenseShortName|LicenseUrl|NonFree",
)


def _parse_files(pages: list) -> list:
    """Ne garde que les fichiers réellement hébergés sur Commons sous licence libre."""
    files = []
    for page in pages:
        infos = page.get("imageinfo")
        if page.get("missing") or not infos:
            continue
        info = infos[0]
        meta = info.get("extmetadata") or {}
        license_name = (meta.get("LicenseShortName") or {}).get("value", "")
        non_free = (meta.get("NonFree") or {}).get("value", "")
        if non_free or not FREE_LICENSE.match(license_name.strip()):
            continue
        if info.get("mime") not in ("image/jpeg", "image/png", "image/webp"):
            continue
        author = re.sub(r"<[^>]+>", "", (meta.get("Artist") or {}).get("value", ""))
        files.append({
            "name": page["title"],
            "width": info.get("width", 0),
            "height": info.get("height", 0),
            "thumb": info.get("thumburl") or info["url"],
            "page": info.get("descriptionurl", ""),
            "author": re.sub(r"\s+", " ", html.unescape(author)).strip() or "Auteur non indiqué",
            "license": license_name.strip(),
            "license_url": (meta.get("LicenseUrl") or {}).get("value", ""),
        })
    return files


def commons_info(file_titles: list) -> list:
    files = []
    for i in range(0, len(file_titles), 40):
        batch = "|".join(file_titles[i:i + 40])
        data = api(COMMONS, action="query", titles=batch, **_INFO)
        files.extend(_parse_files(data["query"].get("pages") or []))
    return files


def category_files(category: str, limit: int = 150) -> list:
    data = api(
        COMMONS, action="query", generator="categorymembers",
        gcmtitle=f"Category:{category}", gcmtype="file", gcmlimit=str(limit), **_INFO,
    )
    return _parse_files((data.get("query") or {}).get("pages") or [])


def search_files(query: str, limit: int = 40) -> list:
    data = api(
        COMMONS, action="query", generator="search", gsrsearch=query,
        gsrnamespace="6", gsrlimit=str(limit), **_INFO,
    )
    pages = sorted((data.get("query") or {}).get("pages") or [], key=lambda p: p.get("index", 0))
    return _parse_files(pages)


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def model_tokens(title: str, brand: str) -> list:
    """Les mots du modèle : un fichier doit les citer pour être retenu."""
    name = re.sub(r"\s*\(.*?\)", "", title)
    if name.lower().startswith(brand.lower()):
        name = name[len(brand):]
    return [token for token in map(_normalize, name.split()) if token]


# « First generation » ne désigne aucune voiture : ces mots trouvent les photos d'autres modèles.
GENERIC_VARIANT = re.compile(
    r"\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(st|nd|rd|th)|generation|series)\b",
    re.I,
)


def is_generic_variant(variant: str) -> bool:
    return not GENERIC_VARIANT.sub("", variant).strip()


def photo_tokens(title: str, brand: str, variant=None) -> list:
    """Les mots qu'un fichier doit citer : ceux de la génération si elle a un vrai nom."""
    if variant and not is_generic_variant(variant):
        return model_tokens(variant, brand)
    return model_tokens(title, brand)


def car_name(title: str, brand: str, wanted=None) -> str:
    """Le nom affiché : « First generation » seul ne dit pas de quel modèle il s'agit."""
    if not wanted:
        return title
    if is_generic_variant(wanted):
        return f"{title} ({wanted})"
    return wanted if wanted.lower().startswith(brand.lower()) else f"{brand} {wanted}"


def _is_usable(file: dict, tokens: list) -> bool:
    if EXCLUDED_NAME.search(file["name"]):
        return False
    if file["width"] < 800:
        return False
    normalized = _normalize(file["name"])
    return all(token in normalized for token in tokens)


def _evenly(items: list, count: int) -> list:
    """Répartit le choix sur toute la liste pour éviter 6 vues de la même voiture."""
    if len(items) <= count:
        return items
    step = len(items) / count
    return [items[int(i * step)] for i in range(count)]


def choose_photos(
    title: str, brand: str, main_image, wikidata_id, variant=None, count: int = 1
) -> list:
    tokens = photo_tokens(title, brand, variant)
    chosen, seen = [], set()

    def add(file):
        if file["name"] not in seen and len(chosen) < count:
            seen.add(file["name"])
            chosen.append(file)

    if main_image:
        name = main_image if re.match(r"(file|image):", main_image, re.I) else f"File:{main_image}"
        name = re.sub(r"^image:", "File:", name, flags=re.I)
        for file in commons_info([name]):
            if not EXCLUDED_NAME.search(file["name"]):
                add(file)
    # L'image principale de l'article est la seule sûre de montrer la bonne voiture.
    if len(chosen) >= count:
        return chosen

    candidates = [f for f in commons_info(article_files(title)) if _is_usable(f, tokens)]
    category = commons_category(wikidata_id) or re.sub(r"\s*\(.*?\)", "", title)
    categories = [category]
    if variant:
        categories.append(f"{brand} {variant}")
    for name in categories:
        try:
            candidates += [f for f in category_files(name) if _is_usable(f, tokens)]
        except (KeyError, ValueError):
            pass

    # Pas assez de photos : on cherche directement dans les fichiers de Commons.
    if len({f["name"] for f in candidates}) < 6:
        name = f"{brand} {variant}" if variant else re.sub(r"\s*\(.*?\)", "", title)
        try:
            candidates += [f for f in search_files(name) if _is_usable(f, tokens)]
        except (KeyError, ValueError):
            pass

    def is_overview(file):
        return not DETAIL_NAME.search(file["name"]) and file["width"] >= file["height"]

    overview = [f for f in candidates if is_overview(f)]
    # Un fichier qui cite aussi la marque montre plus sûrement la bonne voiture.
    branded = [f for f in overview if _normalize(brand) in _normalize(f["name"])]
    if len(branded) >= 3:
        overview = branded
    details = [f for f in candidates if not is_overview(f)]
    unique = list({f["name"]: f for f in overview}.values())
    for file in _evenly(unique, count):
        add(file)
    for file in details:
        add(file)
    return chosen


def download(url: str) -> bytes:
    return _open(url, timeout=120)
