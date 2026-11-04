"""Lit une page Wikipédia (wikitext) et en extrait une fiche technique."""
from __future__ import annotations

import html
import re

SPEC_KEYS = [
    "engine", "power", "torque", "transmission", "layout", "top_speed", "zero_100",
    "weight", "length", "width", "height", "wheelbase", "body", "production",
    "designer", "assembly",
]

# Sections qui parlent d'une autre version que la voiture de base.
VARIANT_HEADING = re.compile(
    r"\b(variants?|versions?|models?|lm|competizione|gte|evo(lution)?|racing|motorsport|"
    r"competition|race|rally|concept|prototypes?|special|limited|derivatives?|tuned|"
    r"tuning|replicas?|aftermarket|electric|legacy|successor|references|notes|"
    r"popular culture|media|sales|external links|see also|bibliography)\b",
    re.I,
)

_REF = re.compile(r"<ref\b[^>]*?/>|<ref\b[^>]*?>.*?</ref>", re.S | re.I)
_COMMENT = re.compile(r"<!--.*?-->", re.S)
_LINK = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]")
_FILE_LINK = re.compile(r"\[\[(?:File|Image):[^\[\]]*(?:\[\[[^\]]*\]\][^\[\]]*)*\]\]", re.I)
_INNER_TEMPLATE = re.compile(r"\{\{([^{}]*)\}\}")
_RANGE_WORDS = {"-", "–", "—", "to", "and", "or", "x", "×"}
_LIST_TEMPLATES = {
    "ubl", "unbulleted list", "unbulleted", "plainlist", "plain list", "flatlist",
    "flat list", "hlist", "bulleted list", "ublist",
}
_TEXT_TEMPLATES = {"nowrap", "nobr", "nowrap begin", "small", "lang", "ill"}


def strip_noise(text: str) -> str:
    """Retire les références et les commentaires."""
    return _REF.sub("", _COMMENT.sub("", text))


def _expand_template(match: re.Match) -> str:
    parts = [p.strip() for p in match.group(1).split("|")]
    name = parts[0].lower().replace("_", " ")
    args = [p for p in parts[1:] if "=" not in p or p.startswith("*")]

    if name in ("cvt", "convert", "convinfobox"):
        if len(args) >= 4 and args[1].lower() in _RANGE_WORDS:
            return f"{args[0]}-{args[2]} {args[3]}"
        if len(args) >= 2:
            return f"{args[0]} {args[1]}"
        return ""
    if name in _LIST_TEMPLATES:
        items = []
        for arg in args:
            items.extend(line.lstrip("* ").strip() for line in arg.splitlines())
        return "\n".join(item for item in items if item)
    if name in _TEXT_TEMPLATES:
        return args[-1] if args else ""
    return ""


def clean(text: str) -> str:
    """Transforme du wikitext en texte simple."""
    text = strip_noise(text)
    text = _FILE_LINK.sub("", text)
    text = _LINK.sub(r"\1", text)
    previous = None
    while previous != text:
        previous = text
        text = _INNER_TEMPLATE.sub(_expand_template, text)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text).replace("\xa0", " ")
    text = re.sub(r"'{2,}", "", text)
    text = re.sub(r"^\s*\*\s*", "", text, flags=re.M)
    text = re.sub(r"[ \t]+", " ", text)
    return "\n".join(line.strip() for line in text.splitlines() if line.strip())


def _matching_end(text: str, start: int) -> int:
    """Renvoie la position qui suit le }} fermant le {{ situé à start."""
    depth = 0
    i = start
    while i < len(text) - 1:
        pair = text[i:i + 2]
        if pair == "{{":
            depth += 1
            i += 2
        elif pair == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return i
        else:
            i += 1
    return len(text)


def _split_fields(body: str) -> dict:
    fields, current, depth_t, depth_l = [], [], 0, 0
    i = 0
    while i < len(body):
        pair = body[i:i + 2]
        if pair == "{{":
            depth_t += 1
        elif pair == "}}":
            depth_t -= 1
        elif pair == "[[":
            depth_l += 1
        elif pair == "]]":
            depth_l -= 1
        if pair in ("{{", "}}", "[[", "]]"):
            current.append(pair)
            i += 2
            continue
        if body[i] == "|" and depth_t == 0 and depth_l == 0:
            fields.append("".join(current))
            current = []
        else:
            current.append(body[i])
        i += 1
    fields.append("".join(current))

    result = {}
    for field in fields[1:]:
        if "=" in field:
            key, value = field.split("=", 1)
            result[key.strip().lower()] = value.strip()
    return result


def find_infoboxes(wikitext: str) -> list:
    """Renvoie toutes les infobox automobile : {fields, start, end}."""
    boxes = []
    for match in re.finditer(r"\{\{\s*infobox[ _]+(?:automobile|car)\b", wikitext, re.I):
        end = _matching_end(wikitext, match.start())
        body = wikitext[match.start() + 2:end - 2]
        boxes.append({"fields": _split_fields(body), "start": match.start(), "end": end})
    return boxes


def _same_name(left: str, right: str) -> bool:
    return re.sub(r"[^a-z0-9]", "", left.lower()) == re.sub(r"[^a-z0-9]", "", right.lower())


def box_name(box: dict) -> str:
    return _first_line(clean(box["fields"].get("name", "")))


def choose_infobox(boxes: list, wanted=None):
    """Prend la génération demandée, sinon la première infobox qui décrit un moteur."""
    if wanted:
        for box in boxes:
            if _same_name(box_name(box), wanted):
                return box
        return None
    for box in boxes:
        if box["fields"].get("engine", "").strip():
            return box
    return boxes[0] if boxes else None


def _variant_free_text(wikitext: str, box: dict, boxes: list) -> str:
    """Texte dans lequel chercher les performances de la version retenue."""
    is_nested = box is not boxes[0]
    after = wikitext[box["end"]:]
    if is_nested:
        before = re.findall(r"(?m)^(={2,})[^=\n]+={2,}\s*$", wikitext[:box["start"]])
        level = len(before[-1]) if before else 2
        for heading in re.finditer(r"(?m)^(={2,})[^=\n]+={2,}\s*$", after):
            if len(heading.group(1)) <= level:
                return after[:heading.start()]
        return after

    kept, skip_level = [], None
    for chunk in re.split(r"(?m)^(?=={2,}[^=\n]+={2,}\s*$)", after):
        heading = re.match(r"(={2,})([^=\n]+)={2,}", chunk)
        if heading:
            level = len(heading.group(1))
            if skip_level is not None and level > skip_level:
                continue
            skip_level = level if VARIANT_HEADING.search(heading.group(2)) else None
        if skip_level is None:
            kept.append(chunk)
    return "".join(kept)


def _first_line(value: str) -> str:
    return value.split("\n")[0].strip() if value else ""


def _first_measure(value: str) -> str:
    """Première ligne qui contient un chiffre : ignore les intitulés comme « Standard : »."""
    for line in (value or "").split("\n"):
        if re.search(r"\d", line):
            return line.strip()
    return ""


def _power_and_torque(text: str) -> tuple:
    power = re.search(r"(\d[\d,. ]*\d(?:\s*[-–]\s*\d+)?|\d)\s*(PS|bhp|hp|kW|CV|ch)\b", text)
    torque = re.search(
        r"(\d[\d,. ]*\d|\d)\s*(N[·⋅.]?m|Nm|lb[-⋅· ]?ft|lbft|ft[-⋅· ]?lb|lbf[-⋅· ]?ft)", text, re.I
    )
    return (
        f"{power.group(1).strip()} {power.group(2)}" if power else "",
        f"{torque.group(1).strip()} {torque.group(2)}" if torque else "",
    )


def find_top_speed(text: str) -> str:
    match = re.search(
        r"top speed[^.\n]{0,70}?(\d{2,3}(?:\.\d)?)\s*(km/h|kph|mph|mi/h)", text, re.I
    )
    if not match:
        return ""
    unit = {"mi/h": "mph", "kph": "km/h"}.get(match.group(2).lower(), match.group(2).lower())
    return f"{match.group(1)} {unit}"


def find_acceleration(text: str) -> str:
    match = re.search(
        r"0\s*(?:-|–|—|to)\s*(100\s*km/h|62\s*mph|60\s*mph|97\s*km/h|96\s*km/h)"
        r"[^.\n]{0,70}?(\d{1,2}(?:\.\d{1,2})?)\s*(?:s\b|sec|seconds)",
        text,
        re.I,
    )
    if not match:
        return ""
    target = re.sub(r"\s+", " ", match.group(1)).lower()
    return f"0-{target} : {match.group(2)} s"


def _translate(value: str, table: list) -> str:
    for pattern, replacement in table:
        value = re.sub(pattern, replacement, value, flags=re.I)
    return value


def _transmission_fr(value: str) -> str:
    speed_kind = re.sub(
        r"(\d+)[- ]speed\s+([^\n,(]*?)(manual|automatic|dual[- ]clutch|sequential|cvt)\b",
        lambda m: {
            "manual": "Manuelle",
            "automatic": "Automatique",
            "sequential": "Séquentielle",
            "cvt": "Variation continue",
        }.get(m.group(3).lower(), "Double embrayage") + f" {m.group(1)} rapports",
        value,
        flags=re.I,
    )
    return speed_kind


_LAYOUT_TABLE = [
    (r"\b(?:longitudinally[- ]mounted|longitudinal engine),?\s*", "Moteur longitudinal, "),
    (r"\btransverse engine\b,?\s*|\btransverse\s+", "Moteur transversal, "),
    (r"rear mid[- ]engine,?\s*rear[- ]wheel[- ]drive(?: layout)?", "moteur central arrière, propulsion"),
    (r"mid[- ]engine,?\s*rear[- ]wheel[- ]drive(?: layout)?", "moteur central, propulsion"),
    (r"front[- ]engine,?\s*rear[- ]wheel[- ]drive(?: layout)?", "moteur avant, propulsion"),
    (r"front[- ]engine,?\s*front[- ]wheel[- ]drive(?: layout)?", "moteur avant, traction"),
    (r"front[- ]engine,?\s*all[- ]wheel[- ]drive(?: layout)?", "moteur avant, transmission intégrale"),
    (r"rear[- ]engine,?\s*rear[- ]wheel[- ]drive(?: layout)?", "moteur arrière, propulsion"),
    (r"rear[- ]engine,?\s*all[- ]wheel[- ]drive(?: layout)?", "moteur arrière, transmission intégrale"),
]
_BODY_TABLE = [
    (r"(\d)-door\s+(?:coup[eé]|berlinetta)", r"Coupé \1 portes"),
    (r"(\d)-door\s+(?:convertible|cabriolet|roadster)", r"Cabriolet \1 portes"),
    (r"(\d)-door\s+sedan|(\d)-door\s+saloon", r"Berline \1\2 portes"),
    (r"(\d)-door\s+hatchback", r"Compacte \1 portes"),
    (r"(\d)-door\s+(?:estate|station wagon|wagon)", r"Break \1 portes"),
    (r"(\d)-door\s+SUV", r"SUV \1 portes"),
]


def to_metric(text: str) -> str:
    """Convertit pouces, livres et mph en unités métriques."""
    match = re.match(r"\s*(\d[\d,]*(?:\.\d+)?)\s*(lb[-⋅· ]?ft|lbft|ft[-⋅· ]?lb|lbf[-⋅· ]?ft|in|inches|lb|lbs|mph)\b", text or "", re.I)
    if not match:
        return text
    number = float(match.group(1).replace(",", ""))
    unit = match.group(2).lower()
    if "ft" in unit:
        return f"{round(number * 1.35582)} Nm"
    if unit in ("in", "inches"):
        return f"{round(number * 25.4)} mm"
    if unit in ("lb", "lbs"):
        return f"{round(number * 0.453592)} kg"
    return f"{round(number * 1.609344)} km/h"


def _capitalize(value: str) -> str:
    return value[:1].upper() + value[1:] if value else value


def extract_specs(wikitext: str, wanted=None) -> dict:
    """Renvoie {specs: {clé: {value, from_text}}, variant}."""
    wikitext = strip_noise(wikitext)
    boxes = find_infoboxes(wikitext)
    box = choose_infobox(boxes, wanted)
    if not box:
        return {"specs": {}, "variant": None, "image": None}

    fields = box["fields"]
    parent = boxes[0]["fields"]

    def field(*names):
        for name in names:
            value = clean(fields.get(name, ""))
            if value:
                return value
        return ""

    def inherited(*names):
        """Carrosserie, architecture... : communes à toutes les générations."""
        for name in names:
            value = clean(fields.get(name, "")) or clean(parent.get(name, ""))
            if value:
                return value
        return ""

    power_block = field("powerout", "power")
    power, torque = _power_and_torque(power_block)
    if not torque:
        _, torque = _power_and_torque(field("torque"))

    prose = clean(_variant_free_text(wikitext, box, boxes))

    specs = {}

    def put(key, value, from_text=False):
        if value:
            specs[key] = {"value": value, "from_text": from_text}

    put("engine", field("engine").replace("\n", " · "))
    put("transmission", _transmission_fr(field("transmission").replace("\n", " · ")))
    put("layout", _capitalize(_translate(inherited("layout"), _LAYOUT_TABLE)))
    body = inherited("body_style")
    body = _first_line(body) if box is not boxes[0] else body.replace("\n", " · ")
    put("body", _capitalize(_translate(body, _BODY_TABLE)))
    put("production", re.sub(r"(?:units )?produced", "exemplaires", field("production").replace("\n", " · ")))
    put("designer", inherited("designer").replace("\n", ", "))
    put("assembly", inherited("assembly").replace("\n", " "))
    for key in ("weight", "length", "width", "height", "wheelbase"):
        names = (key, "curb_weight", "kerb_weight") if key == "weight" else (key,)
        put(key, to_metric(_first_measure(field(*names))))

    if power:
        put("power", power)
    else:
        text_power, _ = _power_and_torque(prose)
        put("power", text_power, from_text=True)
    put("torque", to_metric(torque))

    put("top_speed", to_metric(find_top_speed(prose)), from_text=True)
    put("zero_100", find_acceleration(prose).replace(".", ","), from_text=True)

    variant = wanted
    if not variant and box is not boxes[0]:
        variant = box_name(box) or None
    return {
        "specs": specs,
        "variant": variant,
        "image": fields.get("image", "").strip() or None,
    }


def brand_from(title: str, manufacturer_raw: str) -> str:
    """Devine la marque à partir du titre de la page."""
    words = re.sub(r"\s*\(.*?\)", "", title).split()
    haystack = manufacturer_raw.lower()
    for size in (3, 2, 1):
        prefix = " ".join(words[:size])
        if len(words) >= size and prefix.lower() in haystack:
            return prefix
    return words[0] if words else title


def to_number(text: str):
    if not text:
        return None
    match = re.search(r"\d[\d,. ]*", text)
    if not match:
        return None
    raw = match.group(0).strip().replace(" ", "")
    if re.fullmatch(r"\d{1,3}(,\d{3})+", raw):
        raw = raw.replace(",", "")
    raw = raw.replace(",", ".")
    try:
        return float(raw)
    except ValueError:
        return None


def power_in_ch(text: str):
    """Convertit une puissance en chevaux (ch)."""
    value = to_number(text)
    if value is None:
        return None
    lowered = text.lower()
    if "kw" in lowered:
        value *= 1.35962
    elif "hp" in lowered:
        value *= 1.01387
    return round(value)


def weight_in_kg(text: str):
    value = to_number(text)
    if value is None:
        return None
    if re.search(r"\blbs?\b", text, re.I):
        value *= 0.453592
    return round(value)


def first_year(text: str):
    match = re.search(r"\b(18|19|20)\d{2}\b", text or "")
    return int(match.group(0)) if match else None
