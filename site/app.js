"use strict";

const SPEC_GROUPS = [
  ["Moteur", [["engine", "Moteur"], ["power", "Puissance"], ["torque", "Couple"], ["transmission", "Boîte"], ["layout", "Architecture"]]],
  ["Performances", [["top_speed", "Vitesse maximale"], ["zero_100", "Accélération"]]],
  ["Gabarit", [["weight", "Poids"], ["length", "Longueur"], ["width", "Largeur"], ["height", "Hauteur"], ["wheelbase", "Empattement"], ["body", "Carrosserie"]]],
  ["Histoire", [["production", "Production"], ["designer", "Design"], ["assembly", "Assemblage"]]],
];
const MAX_COMPARE = 3;
const POLL_MS = 15000;
const RELAUNCH_MS = 90000;
const TIMEOUT_MS = 20 * 60 * 1000;

const el = (id) => document.getElementById(id);
const state = { catalog: [], cars: [], items: [], user: null, viewing: null, brand: "", compare: [], failed: new Set(), starting: new Set(), relaunched: new Set(), accounts: [], people: [], ownTitles: new Set(), compareInfo: {}, signed: {} };

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Seuls les liens http(s) des données sont rendus cliquables. */
const safeUrl = (url) => (/^https?:\/\//i.test(url || "") ? url : "");
const ratioOf = (car) =>
  car.power_ch && car.weight_kg ? Math.round((car.power_ch / car.weight_kg) * 1000) : null;
/** Les identifiants sont stockés en minuscules : on les affiche comme des prénoms. */
const displayName = (username = "") => username.replace(/(^|[-_])([a-z])/g, (_, separator, letter) => separator + letter.toUpperCase());
const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
const STAR = `<abbr class="mark" title="Extrait du texte de l'article : à vérifier">*</abbr>`;
const specMark = (spec) => (spec?.edited ? `<span class="edited-mark">Modifié</span>` : spec?.from_text ? STAR : "");
const carBySlug = (slug) => state.cars.find((c) => c.slug === slug);
const catalogCar = (slug) => state.catalog.find((c) => c.slug === slug);
const inOwnDeck = (car) => state.ownTitles.has(titleOf(car));
const titleOf = (car) => car.wikipedia_title || car.name;
/** Une génération précise s'écrit « Page#Génération » dans les données. */
const displayTitle = (title) => title.replace("#", " · ");

function tagline(car) {
  return [car.year, car.power_ch && `${car.power_ch} ch`, car.weight_kg && `${car.weight_kg} kg`]
    .filter(Boolean)
    .join(" · ");
}

/* Mémoire de cet appareil : tout est facultatif, le site fonctionne sans. */
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(`carpocket.${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    if (value === null) localStorage.removeItem(`carpocket.${key}`);
    else localStorage.setItem(`carpocket.${key}`, JSON.stringify(value));
  } catch { /* navigation privée : rien n'est mémorisé */ }
}

/* Comptes et données */
const SUPABASE_URL = "https://rrdexsaqgzwsqphmrtgk.supabase.co";
const SUPABASE_KEY = "sb_publishable_zhNyHSEJORbLdKBK8hLlng_3SHFwxO5";
const LOGIN_DOMAIN = "users.carpocket.example";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const isAdmin = () => state.user?.role === "admin";
const owner = () => state.viewing || state.user;
const canEdit = () => Boolean(state.user) && !state.viewing;

/** Appelle la fonction serveur, seule à détenir la clé GitHub et les droits d'administration. */
async function server(action, input = {}) {
  const { data } = await db.auth.getSession();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/carpocket`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${data.session?.access_token}`,
    },
    body: JSON.stringify({ action, ...input }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Le serveur ne répond pas. Réessaie dans un instant.");
  return body;
}

const ITEM_FIELDS = "title, thumb, main_photo, added_at, custom_photos, hidden_photos, notes, custom_specs";
const PHOTO_BUCKET = "user-photos";
const SIGNED_SECONDS = 6 * 60 * 60;

/** Les valeurs changées par la personne priment dans sa collection, sans toucher au catalogue. */
function withEditedSpecs(car, custom) {
  const specs = { ...car.specs };
  const known = new Set(SPEC_GROUPS.flatMap(([, rows]) => rows.map(([key]) => key)));
  const edited = Object.entries(custom || {}).filter(([key, value]) => known.has(key) && typeof value === "string");
  if (!edited.length) return car;
  edited.forEach(([key, value]) => { specs[key] = { value, from_text: false, edited: true }; });
  const result = { ...car, specs, customSpecs: Object.fromEntries(edited) };
  if (result.customSpecs.power) result.power_ch = Math.round(numberIn(result.customSpecs.power)) || null;
  if (result.customSpecs.weight) result.weight_kg = Math.round(numberIn(result.customSpecs.weight)) || null;
  if (result.customSpecs.production) {
    result.year = Number(result.customSpecs.production.match(/\b(?:18|19|20)\d{2}\b/)?.[0]) || null;
  }
  return result;
}

/** Les photos personnelles sont privées : on demande une adresse temporaire pour les afficher. */
async function signPhotos(paths) {
  const missing = [...new Set(paths)].filter((path) => !state.signed[path]);
  if (!missing.length) return;
  const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(missing, SIGNED_SECONDS);
  (data || []).forEach((entry) => {
    if (entry.signedUrl) state.signed[entry.path] = entry.signedUrl;
  });
}

/** Les photos d'une voiture dans une collection : les siennes, puis le catalogue sans celles masquées. */
function itemPhotos(item, car) {
  const owner = state.viewing ? displayName(state.viewing.username) : null;
  const custom = (item.custom_photos || []).filter((path) => state.signed[path]).map((path) => ({
    key: path,
    file: state.signed[path],
    custom: true,
    author: owner || "toi",
  }));
  const hidden = new Set(item.hidden_photos || []);
  const shared = car.photos.filter((photo) => !hidden.has(photo.file)).map((photo) => ({ ...photo, key: photo.file }));
  const photos = [...custom, ...shared];
  const chosen = photos.find((photo) => photo.key === item.main_photo);
  return chosen ? [chosen, ...photos.filter((photo) => photo !== chosen)] : photos;
}

/** La collection affichée : la fiche partagée, plus les choix de la personne. */
function rebuildDeck() {
  if (!state.viewing) state.ownTitles = new Set(state.items.map((item) => item.title));
  const byTitle = new Map(state.catalog.map((car) => [titleOf(car), car]));
  state.cars = state.items.flatMap((item) => {
    const car = byTitle.get(item.title);
    if (!car) return [];
    return [{ ...withEditedSpecs(car, item.custom_specs), notes: item.notes || "", added: item.added_at, hiddenCount: car.photos.filter((photo) => (item.hidden_photos || []).includes(photo.file)).length, photos: itemPhotos(item, car) }];
  });
}

function pendingItems() {
  if (state.viewing) return [];
  const known = new Set(state.catalog.map(titleOf));
  return state.items.filter((item) => !known.has(item.title)).map((item) => {
    const failed = state.failed.has(item.title);
    const slow = Date.now() - Date.parse(item.added_at) > TIMEOUT_MS;
    return { name: item.title, thumb: item.thumb, status: failed ? "failed" : slow ? "slow" : "running" };
  });
}

async function loadItems() {
  const { data, error } = await db.from("deck_items")
    .select(ITEM_FIELDS)
    .eq("user_id", owner().id);
  if (error) throw error;
  state.items = data;
  await signPhotos(data.flatMap((item) => item.custom_photos || []));
  rebuildDeck();
}

/* Cartes */
const backLabel = () => (state.viewing ? `‹ Collection de ${esc(displayName(state.viewing.username))}` : "‹ Mon deck");

/** Sur la collection d'un ami : ajouter la voiture à la sienne, sans attente. */
const CARD_ICONS = {
  sheet: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
  compare: '<path d="M4 8h13M13 4l4 4-4 4M20 16H7M11 12l-4 4 4 4"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4M5 12v8h14v-8"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
};

function cardActions(car, { sheet = true } = {}) {
  const name = esc(car.name);
  const title = titleOf(car);
  const selected = state.compare.includes(car.slug);
  const compareLabel = selected ? "Retirer cette voiture de la comparaison" : "Ajouter cette voiture à la comparaison";
  const actions = [
    sheet ? `<a class="theme-toggle" href="#${esc(car.slug)}" aria-label="Voir la fiche de ${name}" data-tip="Voir la fiche">${photoIcon(CARD_ICONS.sheet)}</a>` : "",
    `<button type="button" class="theme-toggle" data-compare="${esc(car.slug)}" aria-pressed="${selected}" aria-label="${compareLabel} : ${name}" data-tip="${compareLabel}">${photoIcon(CARD_ICONS.compare)}</button>`,
    `<button type="button" class="theme-toggle" data-share="${esc(car.slug)}" aria-label="Partager ${name} avec un ami" data-tip="Partager avec un ami">${photoIcon(CARD_ICONS.share)}</button>`,
  ];
  if (canEdit() && inOwnDeck(car)) {
    actions.push(`<button type="button" class="theme-toggle card-remove" data-delete="${esc(car.slug)}" aria-label="Retirer ${name} de ma collection" data-tip="Retirer de ma collection">${photoIcon(CARD_ICONS.trash)}</button>`);
  } else if (state.ownTitles.has(title)) {
    actions.push(`<span class="theme-toggle card-owned" role="img" aria-label="Déjà dans mon deck" data-tip="Déjà dans mon deck">${photoIcon(CARD_ICONS.check)}</span>`);
  } else if (state.user) {
    actions.push(`<button type="button" class="theme-toggle" data-add-title="${esc(title)}" aria-label="Ajouter ${name} à mon deck" data-tip="Ajouter à mon deck">${photoIcon(CARD_ICONS.add)}</button>`);
  }
  return actions.join("");
}

/** Partage le lien de la fiche : le menu du téléphone, sinon une copie du lien. */
async function shareCar(car, button) {
  const url = `${location.origin}${location.pathname}#${encodeURIComponent(car.slug)}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: car.name, text: `${car.name} sur CarPocket`, url });
    } catch (error) {
      if (error.name !== "AbortError") flashTip(button, "Le partage n'a pas abouti. Réessaie.");
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    flashTip(button, "Lien copié : colle-le à ton ami");
  } catch {
    flashTip(button, "Le lien n'a pas pu être copié.");
  }
}

function cardHtml(car) {
  const photo = car.photos[0];
  return `<div class="model-card">
    <a class="model-photo" href="#${esc(car.slug)}" tabindex="-1" aria-hidden="true">
      ${photo ? `<img src="${esc(photo.file)}" alt="" loading="lazy">` : `<div class="no-photo">Pas de photo libre trouvée</div>`}
      ${car.example ? `<span class="badge">Exemple</span>` : ""}
    </a>
    <div class="model-body">
      <h3><a href="#${esc(car.slug)}">${esc(car.name)}</a></h3>
      <p>${esc(tagline(car))}</p>
      <div class="model-actions">${cardActions(car)}</div>
    </div>
  </div>`;
}

function pendingCardHtml(item) {
  const failed = item.status === "failed";
  const slow = item.status === "slow";
  const text = failed
    ? "L'ajout n'a pas abouti."
    : slow ? "Plus long que prévu, GitHub est peut-être ralenti." : "Ajout en cours, fiche et photos en préparation…";
  return `<div class="model-card">
    <div class="model-photo pending-photo">
      ${safeUrl(item.thumb) ? `<img src="${esc(item.thumb)}" alt="">` : `<div class="no-photo">Photos en préparation</div>`}
    </div>
    <div class="model-body">
      <h3>${esc(displayTitle(item.name))}</h3>
      <p class="pending-state${failed ? " failed" : ""}">${text}</p>
      ${failed || slow ? `<div class="pending-actions">
        ${failed ? `<button type="button" class="text-link" data-retry="${esc(item.name)}">Réessayer</button>` : ""}
        <button type="button" class="text-link quiet" data-dismiss="${esc(item.name)}">Retirer</button>
      </div>` : ""}
    </div>
  </div>`;
}

const SORTERS = {
  added: (a, b) => (b.added || "").localeCompare(a.added || "") || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name, "fr"),
  power: (a, b) => (b.power_ch ?? -1) - (a.power_ch ?? -1),
  ratio: (a, b) => (ratioOf(b) ?? -1) - (ratioOf(a) ?? -1),
  year: (a, b) => (b.year ?? -1) - (a.year ?? -1),
};

const deck = () => state.cars;

/* Le showroom d'accueil : les voitures du deck défilent, dans un ordre différent à chaque visite. */
const SHOWROOM_MAX = 8;
const showroom = { key: "", cars: [], index: 0, paused: false, touchX: null };
const calmMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function showroomStats(car) {
  const stats = [];
  if (car.power_ch) stats.push({ value: car.power_ch, unit: "ch", label: "Puissance", star: car.specs.power });
  const ratio = ratioOf(car);
  if (ratio) stats.push({ value: ratio, unit: "ch/t", label: "Poids/puissance", star: car.specs.power });
  const speed = car.specs.top_speed;
  const kmh = speed && parseInt(speed.value, 10);
  if (kmh) stats.push({ value: kmh, unit: "km/h", label: "Vitesse maximale", star: speed });
  else if (car.weight_kg) stats.push({ value: car.weight_kg, unit: "kg", label: "Poids", star: car.specs.weight });
  return stats;
}

function showroomCompareButton(car) {
  const selected = state.compare.includes(car.slug);
  return `<button type="button" class="button button-on-dark" data-compare="${esc(car.slug)}" data-tip="${selected ? "Retirer cette voiture de la comparaison" : "Ajouter cette voiture à la comparaison"}" aria-pressed="${selected}">${selected ? "Sélectionnée ✓" : "Comparer"}</button>`;
}

function showroomCopy(car) {
  const eyebrow = [car.brand, car.year].filter(Boolean).join(" · ");
  return `<p class="label">${esc(eyebrow)}</p>
    <h1 class="display-xl">${esc(car.name)}</h1>
    <dl class="showroom-stats">${showroomStats(car).map((stat) => `<div>
      <dd><span data-count="${stat.value}">${stat.value}</span> ${stat.unit}${specMark(stat.star)}</dd>
      <dt>${stat.label}</dt>
    </div>`).join("")}</dl>
    <div class="showroom-actions">
      <a class="button button-primary" href="#${esc(car.slug)}">Voir la fiche</a>
      <span id="showroom-compare">${showroomCompareButton(car)}</span>
    </div>`;
}

/** Les chiffres montent comme un compteur à l'arrivée de chaque voiture. */
function countUp(root) {
  if (calmMotion()) return;
  const started = performance.now();
  const targets = [...root.querySelectorAll("[data-count]")].map((node) => ({ node, end: Number(node.dataset.count) }));
  const tick = (now) => {
    const progress = Math.min((now - started) / 900, 1);
    const eased = 1 - (1 - progress) ** 3;
    targets.forEach(({ node, end }) => { node.textContent = Math.round(end * eased); });
    if (progress < 1 && root.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function showSlide(index) {
  const { cars } = showroom;
  if (!cars.length) return;
  showroom.index = (index + cars.length) % cars.length;
  const car = cars[showroom.index];
  el("hero").querySelectorAll(".showroom-photo").forEach((photo, i) => {
    const active = i === showroom.index;
    photo.classList.toggle("is-active", active);
    photo.alt = active ? car.name : "";
  });
  const copy = el("showroom-copy");
  copy.innerHTML = showroomCopy(car);
  copy.classList.remove("is-entering");
  void copy.offsetWidth;
  copy.classList.add("is-entering");
  countUp(copy);
  el("hero").querySelectorAll(".showroom-segment").forEach((segment, i) => {
    segment.classList.toggle("is-done", i < showroom.index);
    segment.setAttribute("aria-current", String(i === showroom.index));
    const fill = segment.firstElementChild;
    fill.remove();
    segment.append(fill);
  });
}

function setShowroomPaused(paused) {
  showroom.paused = paused;
  el("hero").classList.toggle("is-paused", paused);
  const button = el("showroom-pause");
  if (button) {
    button.textContent = paused ? "▶" : "❚❚";
    button.setAttribute("aria-label", paused ? "Reprendre le défilement" : "Mettre le défilement en pause");
  }
}

function renderHero() {
  const available = deck().filter((c) => c.photos.length);
  const hero = el("hero");
  hero.hidden = !available.length;
  const key = available.map((c) => `${c.slug}:${c.photos[0].file}`).sort().join(",");
  if (key === showroom.key) {
    const current = showroom.cars[showroom.index];
    const slot = el("showroom-compare");
    if (current && slot) slot.innerHTML = showroomCompareButton(current);
    return;
  }
  showroom.key = key;
  if (!available.length) return;
  showroom.cars = shuffled(available).slice(0, SHOWROOM_MAX);
  const several = showroom.cars.length > 1;
  hero.innerHTML = `${showroom.cars.map((car) => `<img class="showroom-photo" src="${esc(car.photos[0].file)}" alt="">`).join("")}
    <div class="showroom-scrim"></div>
    <div class="wrap showroom-inner">
      <div class="showroom-copy" id="showroom-copy"></div>
      ${several ? `<div class="showroom-controls">
        <div class="showroom-segments">${showroom.cars.map((car, i) => `<button type="button" class="showroom-segment" data-slide="${i}" aria-label="Voir ${esc(car.name)}"><span class="showroom-fill"></span></button>`).join("")}</div>
        <div class="showroom-buttons">
          <button type="button" class="showroom-button" id="showroom-pause"></button>
          <button type="button" class="showroom-button" data-step="-1" aria-label="Voiture précédente">‹</button>
          <button type="button" class="showroom-button" data-step="1" aria-label="Voiture suivante">›</button>
        </div>
      </div>` : ""}
    </div>`;
  setShowroomPaused(calmMotion());
  showSlide(0);
}

el("hero").addEventListener("animationend", (event) => {
  if (event.target.classList.contains("showroom-fill")) showSlide(showroom.index + 1);
});
el("hero").addEventListener("click", (event) => {
  const segment = event.target.closest("[data-slide]");
  if (segment) showSlide(Number(segment.dataset.slide));
  const step = event.target.closest("[data-step]");
  if (step) showSlide(showroom.index + Number(step.dataset.step));
  if (event.target.closest("#showroom-pause")) setShowroomPaused(!showroom.paused);
});
el("hero").addEventListener("touchstart", (event) => {
  showroom.touchX = event.touches[0].clientX;
}, { passive: true });
el("hero").addEventListener("touchend", (event) => {
  if (showroom.touchX === null) return;
  const moved = event.changedTouches[0].clientX - showroom.touchX;
  showroom.touchX = null;
  if (Math.abs(moved) > 50) showSlide(showroom.index + (moved < 0 ? 1 : -1));
}, { passive: true });

function renderBrands() {
  const brands = [...new Set(deck().map((car) => car.brand))].sort((a, b) => a.localeCompare(b, "fr"));
  if (!brands.includes(state.brand)) state.brand = "";
  const chip = (value, label) =>
    `<button type="button" class="chip" data-brand="${esc(value)}" aria-pressed="${state.brand === value}">${esc(label)}</button>`;
  el("brands").innerHTML = chip("", "Toutes les marques") + brands.map((b) => chip(b, b)).join("");
}

function renderLibrary() {
  renderGauges();
  const all = deck();
  const query = el("search").value.trim().toLowerCase();
  const visible = all
    .filter((car) => !state.brand || car.brand === state.brand)
    .filter((car) => {
      if (!query) return true;
      const specs = Object.values(car.specs).map((s) => s.value).join(" ");
      return `${car.name} ${car.brand} ${specs}`.toLowerCase().includes(query);
    })
    .sort(SORTERS[el("sort").value]);

  const pending = pendingItems();
  el("grid").innerHTML = pending.map(pendingCardHtml).join("") + visible.map(cardHtml).join("");
  el("count").textContent = visible.length === all.length
    ? plural(all.length, "voiture")
    : `${visible.length} sur ${plural(all.length, "voiture")}`;

  const empty = el("empty");
  empty.hidden = visible.length + pending.length > 0;
  empty.textContent = all.length
    ? "Aucune voiture ne correspond à cette recherche."
    : canEdit() ? "Ta collection est vide. Ajoute ta première voiture avec le bouton en haut." : "Cette collection est vide.";
}

function renderSession() {
  const signedIn = Boolean(state.user);
  el("login-view").hidden = signedIn;
  el("app").hidden = !signedIn;
  el("open-add").hidden = !canEdit();
  el("profile-menu").hidden = !signedIn;
  el("friends-link").hidden = !signedIn;
  if (!signedIn) closeProfileMenu();
  el("profile-initial").innerHTML = signedIn ? avatarHtml(state.user.avatar, state.user.username) : "";
  el("profile-name").textContent = signedIn ? displayName(state.user.username) : "";
  el("cta-band").hidden = !canEdit();
  el("accounts-link").hidden = !isAdmin();
  el("library-title").textContent = state.viewing ? `Collection de ${displayName(state.viewing.username)}` : "Mon deck";
  el("app-intro").hidden = Boolean(state.viewing);
  el("search-label").textContent = state.viewing ? "Rechercher dans cette collection" : "Rechercher dans mon deck";
  const note = el("viewing-note");
  note.hidden = !state.viewing;
}

function renderAll() {
  rebuildDeck();
  saveOfflineCopy();
  renderSession();
  renderHero();
  renderBrands();
  renderLibrary();
  renderCompareBar();
  renderRoute();
}

/* Compteurs du deck */
const GAUGE_SWEEP = 240;

function gaugePoint(radius, angle) {
  const radians = (angle - 90) * Math.PI / 180;
  return `${(60 + radius * Math.cos(radians)).toFixed(2)} ${(60 + radius * Math.sin(radians)).toFixed(2)}`;
}

function gaugeHtml({ value, unit, max, label, detail, tip, mark = "" }) {
  const start = -GAUGE_SWEEP / 2;
  const share = value === null ? 0 : Math.min(value / max, 1);
  const arc = `M ${gaugePoint(50, start)} A 50 50 0 1 1 ${gaugePoint(50, -start)}`;
  const ticks = Array.from({ length: 9 }, (_, i) => {
    const angle = start + GAUGE_SWEEP * i / 8;
    return `<path d="M ${gaugePoint(43, angle)} L ${gaugePoint(i % 2 ? 40 : 37, angle)}"/>`;
  }).join("");
  const reading = value === null ? "Non renseigné" : `${value} ${unit}`;
  return `<div class="gauge" data-tip="${esc(tip)}">
    <svg viewBox="0 0 120 112" role="img" aria-label="${esc(`${label} : ${reading}. ${detail}`)}">
      <path class="gauge-track" d="${arc}" pathLength="100"/>
      <path class="gauge-fill" d="${arc}" pathLength="100" data-share="${share * 100}" stroke-dasharray="0 100"/>
      <g class="gauge-ticks">${ticks}</g>
      <text class="gauge-scale" x="${gaugePoint(35, start).split(" ")[0]}" y="104" text-anchor="middle">0</text>
      <text class="gauge-scale" x="${gaugePoint(35, -start).split(" ")[0]}" y="104" text-anchor="middle">${max}</text>
      <g class="gauge-needle" data-angle="${start + GAUGE_SWEEP * share}" style="transform: rotate(${start}deg)">
        <path d="M 58.5 66 L 60 22 L 61.5 66 Z"/>
      </g>
      <circle class="gauge-hub" cx="60" cy="60" r="4"/>
      <text class="gauge-value" x="60" y="89" text-anchor="middle">${value === null ? "–" : value}</text>
      <text class="gauge-unit" x="60" y="101" text-anchor="middle">${esc(unit)}</text>
    </svg>
    <p class="gauge-label">${esc(label)}${mark}</p>
    <p class="gauge-detail">${esc(detail)}</p>
  </div>`;
}

/** La graduation suit la taille du deck : 25, 50, 100, 200… */
function countScale(count) {
  let max = 25;
  while (count > max) max *= 2;
  return max;
}

function deckGauges() {
  const cars = deck();
  const powers = cars.map((car) => car.power_ch).filter(Boolean);
  const average = powers.length ? Math.round(powers.reduce((sum, power) => sum + power, 0) / powers.length) : null;
  const fastest = cars
    .map((car) => ({ car, speed: parseInt(car.specs.top_speed?.value, 10) }))
    .filter(({ speed }) => speed)
    .sort((a, b) => b.speed - a.speed)[0];
  return [
    {
      value: cars.length, unit: "voitures", max: countScale(cars.length), label: "Mon deck",
      detail: plural(new Set(cars.map((car) => car.brand)).size, "marque"),
      tip: "Nombre de voitures dans mon deck",
    },
    {
      value: average, unit: "ch", max: 1500, label: "Puissance moyenne",
      detail: powers.length ? `sur ${plural(powers.length, "voiture")}` : "Non renseigné",
      tip: "Moyenne des voitures dont la puissance est connue",
    },
    {
      value: fastest?.speed ?? null, unit: "km/h", max: 500, label: "Vitesse record",
      detail: fastest?.car.name ?? "Non renseigné",
      tip: "La voiture la plus rapide de mon deck",
      mark: specMark(fastest?.car.specs.top_speed),
    },
  ];
}

let gaugesKey = "";

function renderGauges() {
  const root = el("deck-gauges");
  const gauges = deck().length ? deckGauges() : [];
  root.hidden = !gauges.length;
  const key = JSON.stringify(gauges);
  if (key === gaugesKey) return;
  gaugesKey = key;
  root.innerHTML = gauges.map(gaugeHtml).join("");
  const settle = () => {
    root.querySelectorAll(".gauge-needle").forEach((needle) => {
      needle.style.transform = `rotate(${needle.dataset.angle}deg)`;
    });
    root.querySelectorAll(".gauge-fill").forEach((fill) => {
      fill.setAttribute("stroke-dasharray", `${fill.dataset.share} 100`);
    });
  };
  if (calmMotion()) settle();
  else requestAnimationFrame(() => requestAnimationFrame(settle));
}

/* Fiche */
function specRow(car, key, label) {
  const spec = car.specs[key];
  if (!spec) {
    return `<div class="spec-row"><dt>${label}</dt><dd class="unknown">Non renseigné</dd></div>`;
  }
  return `<div class="spec-row"><dt>${label}</dt><dd>${esc(spec.value)}${specMark(spec)}</dd></div>`;
}

function specCells(car) {
  const cell = (value, label, spec) =>
    `<div class="spec-cell"><div class="spec-value">${esc(value)}${specMark(spec)}</div><span class="label">${esc(label)}</span></div>`;
  const cells = [];
  if (car.power_ch) cells.push(cell(`${car.power_ch} ch`, "Puissance", car.specs.power));
  const ratio = ratioOf(car);
  if (ratio) cells.push(cell(`${ratio} ch/t`, "Poids/puissance", car.specs.power));
  const speed = car.specs.top_speed;
  if (speed) cells.push(cell(speed.value, "Vitesse maximale", speed));
  const sprint = car.specs.zero_100;
  if (sprint) {
    const [label, value] = sprint.value.includes(" : ") ? sprint.value.split(" : ") : ["Accélération", sprint.value];
    cells.push(cell(value, label, sprint));
  }
  if (car.weight_kg) cells.push(cell(`${car.weight_kg} kg`, "Poids", car.specs.weight));
  return cells.join("");
}

const photoTag = (photo) => (photo.custom
  ? (photo.author === "toi" ? "Ma photo" : `Photo de ${photo.author}`)
  : "");

function setPhotoTag(id, photo) {
  const tag = el(id);
  if (!tag) return;
  tag.textContent = photoTag(photo);
  tag.hidden = !photo.custom;
}

const creditText = (photo) => (photo.custom
  ? `Photo de ${photo.author}`
  : `Photo : ${photo.author}, ${photo.license}`);

/** Actions sur la photo affichée, puis ajout de photos. */
function mainPhotoControl(car, index) {
  const photo = car.photos[index];
  const buttons = [`<label class="add-icon photo-add" data-tip="Ajouter une photo">
    ${photoIcon('<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><path d="M12 10v6M9 13h6"/>')}
    <input type="file" accept="image/*" aria-label="Ajouter une photo" data-add-photo>
  </label>`];
  if (photo) {
    buttons.push(photo.custom
      ? iconButton("Supprimer cette photo", `data-delete-photo="${index}"`, '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>')
      : iconButton("Masquer cette photo", `data-hide-photo="${index}"`, '<path d="M3 3l18 18M10 6a9 9 0 0 1 12 6 12 12 0 0 1-3 4M6 7a13 13 0 0 0-4 5 10 10 0 0 0 14 5M10 10a3 3 0 0 0 4 4"/>'));
    buttons.push(index === 0
      ? `<span class="photo-icon is-main" role="img" aria-label="Photo principale" data-tip="C'est la photo principale">${photoIcon(STAR_PATH, "currentColor")}</span>`
      : iconButton("Choisir comme photo principale", `data-main-photo="${index}"`, STAR_PATH));
  }
  if (car.hiddenCount) {
    const label = car.hiddenCount > 1 ? `Rétablir ${car.hiddenCount} photos masquées` : "Rétablir 1 photo masquée";
    buttons.push(`<button type="button" class="photo-icon" data-restore-photos aria-label="${label}" data-tip="${label}">
      ${photoIcon('<path d="M2 12a11 11 0 0 1 20 0 11 11 0 0 1-20 0z"/><circle cx="12" cy="12" r="3"/>')}
      <span class="photo-count" aria-hidden="true">${car.hiddenCount}</span>
    </button>`);
  }
  return buttons.join("");
}

const STAR_PATH = '<path d="M12 3l2.8 5.9 6.2.8-4.5 4.4 1.1 6.4-5.6-3.1-5.6 3.1 1.1-6.4L3 9.7l6.2-.8z"/>';
const photoIcon = (paths, fill = "none") => `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true">${paths}</svg>`;
const iconButton = (label, attribute, paths) => `<button type="button" class="photo-icon" ${attribute} aria-label="${label}" data-tip="${label}">${photoIcon(paths)}</button>`;

function notesHtml(car) {
  if (canEdit() && inOwnDeck(car)) {
    return `<section class="car-notes">
      <h2 class="display-sm"><label for="car-notes">Mes notes</label></h2>
      <textarea id="car-notes" data-slug="${esc(car.slug)}" rows="4" maxlength="${MAX_NOTES}" placeholder="Un souvenir, un prix payé, un point à surveiller…">${esc(itemOf(car)?.notes || "")}</textarea>
      <p class="notes-help"><span id="notes-status" role="status"></span> Tes amis peuvent les lire tant que ta collection est partagée.</p>
    </section>`;
  }
  if (!car.notes) return "";
  const author = state.viewing ? `Notes de ${esc(displayName(state.viewing.username))}` : "Mes notes";
  return `<section class="car-notes"><h2 class="display-sm">${author}</h2><p class="notes-text">${esc(car.notes)}</p></section>`;
}

function detailHtml(car) {
  const hasTextValues = Object.values(car.specs).some((s) => s.from_text);
  const photos = car.photos;
  const cells = specCells(car);

  return `<section class="detail-hero">
      <div class="wrap detail-title">
        <a class="back" href="#" data-tip="Revenir à la liste">${backLabel()}</a>
        <div class="detail-eyebrow">
          <span class="label">${esc(car.brand)}</span>
          ${car.example ? `<span class="badge">Exemple</span>` : ""}
        </div>
        <h1 class="display-xl">${esc(car.name)}</h1>
      </div>
      <div class="stage">
        ${photos.length ? `<button type="button" class="stage-zoom" data-zoom aria-label="Agrandir la photo" data-tip="Agrandir la photo"><img id="hero-photo" src="${esc(photos[0].file)}" alt="${esc(car.name)}"></button><span class="photo-tag" id="hero-tag"${photos[0].custom ? "" : " hidden"}>${esc(photoTag(photos[0]))}</span>` : `<div class="no-photo">Pas de photo libre trouvée</div>`}
      </div>
      <div class="thumbs-band"><div class="wrap">
        ${photos.length > 1 ? `<div class="thumbs">${photos.map((photo, i) => `
          <button type="button" data-photo="${i}" aria-label="Voir la photo ${i + 1}" data-tip="Voir la photo ${i + 1}" aria-current="${i === 0}">
            <img src="${esc(photo.file)}" alt="" loading="lazy">
            ${photo.custom ? `<span class="thumb-tag" aria-label="Photo personnelle">${photoIcon('<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3"/>')}</span>` : ""}
          </button>`).join("")}</div>` : ""}
        ${photos.length ? `<div class="photo-bar">
          <p class="photo-credit" id="hero-credit">${esc(creditText(photos[0]))}</p>
          </div>` : ""}
        ${canEdit() && inOwnDeck(car) ? `<div class="photo-actions" id="main-photo-slot">${mainPhotoControl(car, 0)}</div><p class="main-photo-state" id="photo-notice" role="status"></p>` : ""}
      </div></div>
    </section>
    ${cells ? `<div class="wrap"><div class="spec-strip">${cells}</div></div>` : ""}
    <section class="section">
      <div class="wrap detail-body">
        <div>
          ${car.summary ? `<h2 class="display-md">Présentation</h2>
            <p class="summary">${esc(car.summary)}</p>
            <p class="summary-source">Source : <a href="${esc(safeUrl(car.summary_url))}" target="_blank" rel="noopener" data-tip="Lire l'article sur Wikipédia">Wikipédia${car.summary_lang === "en" ? " (en anglais)" : ""}</a></p>` : ""}
          ${notesHtml(car)}
          <div class="model-actions sheet-actions">${cardActions(car, { sheet: false })}</div>
          ${isAdmin() ? `<div class="actions"><a class="text-link" href="https://github.com/juancullati-web/CarPocket/edit/main/data/cars/${esc(car.slug)}.json" target="_blank" rel="noopener" data-tip="Corriger cette fiche sur GitHub">Corriger cette fiche ›</a>
            <button type="button" class="text-link quiet" data-remove-sheet="${esc(titleOf(car))}" data-tip="Effacer cette fiche pour tous les comptes">Supprimer la fiche pour tout le monde</button></div>` : ""}
        </div>
        <div>
          ${canEdit() && inOwnDeck(car) ? `<div class="spec-tools">
            <button type="button" class="theme-toggle" data-edit-specs aria-label="Modifier les informations" data-tip="Modifier les informations">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M4 20l1-5L16 4l4 4L9 19z"/></svg>
            </button>
            ${car.customSpecs ? `<button type="button" class="theme-toggle" data-reset-specs aria-label="Réinitialiser toutes les informations" data-tip="Réinitialiser toutes les informations">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M4 5v5h5M5 10a8 8 0 1 1-1 5"/></svg>
            </button>` : ""}
          </div>` : ""}
          ${car.variant ? `<p class="note">Ce modèle a plusieurs générations. Cette fiche décrit la version <strong>${esc(car.variant)}</strong>.</p>` : ""}
          ${SPEC_GROUPS.map(([title, rows]) => `<section class="spec-group">
            <h3>${title}</h3>
            <dl>${rows.map(([key, label]) => specRow(car, key, label)).join("")}</dl>
          </section>`).join("")}
          ${hasTextValues ? `<p class="legend">* Valeur extraite du texte de l'article, à vérifier. Elle peut concerner une autre version du modèle.</p>` : ""}
          ${car.customSpecs ? `<p class="legend">« Modifié » : valeur changée dans cette collection. Le catalogue n'a pas changé.</p>` : ""}
        </div>
      </div>
    </section>
    ${photos.some((photo) => !photo.custom) ? `<section class="credits"><div class="wrap">
      <h2>Crédits photos</h2>
      <ol>${photos.filter((photo) => !photo.custom).map((photo) => `<li>${esc(photo.author)}, ${safeUrl(photo.license_url)
        ? `<a href="${esc(photo.license_url)}" target="_blank" rel="noopener" data-tip="Lire la licence de cette photo">${esc(photo.license)}</a>`
        : esc(photo.license)}${safeUrl(photo.source_url)
        ? ` (<a href="${esc(photo.source_url)}" target="_blank" rel="noopener" data-tip="Voir la photo sur Wikimedia Commons">Wikimedia Commons</a>)` : ""}</li>`).join("")}</ol>
    </div></section>` : ""}`;
}

/* Comparaison */
function numberIn(text) {
  const match = String(text || "").match(/\d+(?:[.,]\d+)?/);
  return match ? parseFloat(match[0].replace(",", ".")) : null;
}

/** Temps d'accélération : comparables seulement sur le même exercice (0-100 ou 0-60). */
function sprintParts(car) {
  const value = car.specs.zero_100?.value || "";
  const [target, time] = value.includes(" : ") ? value.split(" : ") : ["", value];
  return { target, time: numberIn(time) };
}

function compareRow(label, cars, read) {
  const cells = cars.map(read);
  const numbers = cells.map((c) => c.num).filter((n) => n !== null && n !== undefined);
  const direction = cells.find((c) => c.better)?.better;
  let best = null;
  if (direction && numbers.length >= 2 && new Set(numbers).size > 1) {
    best = direction === "high" ? Math.max(...numbers) : Math.min(...numbers);
  }
  return `<tr><th scope="row">${esc(label)}</th>${cells.map((c) => {
    if (!c.text) return `<td class="unknown">Non renseigné</td>`;
    return `<td class="${c.num === best && best !== null ? "best" : ""}">${esc(c.text)}${specMark(c.star)}</td>`;
  }).join("")}</tr>`;
}

/** Une voiture comparée garde les valeurs de la collection d'où elle vient. */
function compareCar(slug) {
  const car = catalogCar(slug);
  if (!car) return null;
  const info = state.compareInfo[slug];
  const own = !info?.owner && !state.viewing && state.items.find((item) => item.title === titleOf(car));
  return withEditedSpecs(car, own ? own.custom_specs : info?.specs);
}

function comparePhoto(car) {
  return state.compareInfo[car.slug]?.photo || car.photos[0]?.file || "";
}

function compareOwner(car) {
  const owner = state.compareInfo[car.slug]?.owner;
  return owner ? `Collection de ${owner}` : inOwnDeck(car) ? "Mon deck" : "";
}

function compareHtml(cars) {
  const sameSprint = new Set(cars.map((c) => sprintParts(c).target).filter(Boolean)).size === 1;
  const specCell = (key, better) => (car) => {
    const spec = car.specs[key];
    return { text: spec?.value, star: spec, num: better ? numberIn(spec?.value) : null, better };
  };
  const key = [
    compareRow("Année", cars, (c) => ({ text: c.year })),
    compareRow("Puissance", cars, (c) => ({ text: c.power_ch && `${c.power_ch} ch`, num: c.power_ch, star: c.specs.power, better: "high" })),
    compareRow("Poids/puissance", cars, (c) => ({ text: ratioOf(c) && `${ratioOf(c)} ch/t`, num: ratioOf(c), star: c.specs.power, better: "high" })),
    compareRow("Vitesse maximale", cars, specCell("top_speed", "high")),
    compareRow("Accélération", cars, (c) => ({
      text: c.specs.zero_100?.value,
      star: c.specs.zero_100,
      num: sameSprint ? sprintParts(c).time : null,
      better: sameSprint ? "low" : undefined,
    })),
    compareRow("Poids", cars, (c) => ({ text: c.weight_kg && `${c.weight_kg} kg`, num: c.weight_kg, star: c.specs.weight, better: "low" })),
  ].join("");
  const shown = new Set(["top_speed", "zero_100", "weight", "power"]);
  const groups = SPEC_GROUPS.map(([title, rows]) => {
    const rest = rows.filter(([k]) => !shown.has(k));
    if (!rest.length) return "";
    return `<tr class="group"><th colspan="${cars.length + 1}" scope="colgroup">${title}</th></tr>`
      + rest.map(([k, label]) => compareRow(label, cars, specCell(k))).join("");
  }).join("");

  return `<section class="compare-head"><div class="wrap">
      <a class="back" href="#" data-tip="Revenir à la liste">${backLabel()}</a>
      <h1 class="display-xl">Comparaison</h1>
    </div></section>
    <section class="section"><div class="wrap">
      <div class="compare-scroll"><table class="compare-table">
        <thead><tr>
          <td></td>
          ${cars.map((car) => `<th scope="col" class="compare-car">
            ${comparePhoto(car) ? `<img src="${esc(comparePhoto(car))}" alt="">` : ""}
            <a href="#${esc(car.slug)}">${esc(car.name)}</a>
            <span class="compare-owner">${esc(compareOwner(car))}</span>
            <button type="button" class="text-link quiet" data-uncompare="${esc(car.slug)}">Retirer</button>
          </th>`).join("")}
        </tr></thead>
        <tbody>${key}${groups}</tbody>
      </table></div>
      <p class="legend">En bleu : la meilleure valeur. * Valeur extraite du texte de l'article, à vérifier. « Modifié » : valeur changée dans la collection.</p>
    </div></section>`;
}

function renderCompareBar() {
  const count = state.compare.length;
  const onCompare = location.hash.startsWith("#comparer:");
  const bar = el("compare-bar");
  bar.hidden = count === 0 || onCompare;
  document.body.classList.toggle("has-compare-bar", !bar.hidden);
  if (bar.hidden) return;
  el("compare-thumbs").innerHTML = state.compare.map((slug) => {
    const car = catalogCar(slug);
    if (!car) return "";
    const photo = comparePhoto(car);
    return `<button type="button" class="compare-thumb" data-unselect="${esc(slug)}" aria-label="Retirer ${esc(car.name)} de la comparaison" data-tip="Retirer ${esc(car.name)} de la comparaison">
      ${photo ? `<img src="${esc(photo)}" alt="">` : ""}<span aria-hidden="true">×</span>
    </button>`;
  }).join("");
  el("compare-count").textContent = state.compareFull
    ? `${MAX_COMPARE} voitures maximum : retires-en une pour en ajouter une autre.`
    : count < 2
      ? "1 voiture sélectionnée. Choisis-en au moins une autre."
      : `${count} voitures sélectionnées.`;
  const go = el("compare-go");
  go.setAttribute("href", `#comparer:${state.compare.join(",")}`);
  go.setAttribute("aria-disabled", String(count < 2));
}

function setCompare(list) {
  state.compare = list;
  state.compareFull = false;
  if (state.user) {
    save(`compare.${state.user.id}`, list);
    save(`compareInfo.${state.user.id}`, state.compareInfo);
  }
}

function toggleCompare(slug) {
  if (state.compare.includes(slug)) {
    setCompare(state.compare.filter((s) => s !== slug));
    return false;
  }
  if (state.compare.length >= MAX_COMPARE) {
    state.compareFull = true;
    return false;
  }
  {
    const car = carBySlug(slug) || catalogCar(slug);
    state.compareInfo[slug] = {
      owner: state.viewing ? displayName(state.viewing.username) : null,
      photo: car?.photos[0] && !car.photos[0].custom ? car.photos[0].file : null,
      specs: car?.customSpecs || null,
    };
    setCompare([...state.compare, slug]);
  }
  return true;
}

/** La photo que le visiteur regarde quand il clique sur « Comparer ». */
function comparisonSource(button) {
  return button.closest(".model-card")?.querySelector(".model-photo img")
    || (button.closest("#hero") && el("hero").querySelector(".showroom-photo.is-active"))
    || (button.closest("#detail") && el("hero-photo"))
    || null;
}

/** La photo se réduit en suivant une courbe, puis rejoint sa miniature dans la barre. */
function flyToCompareBar(source, from, slug) {
  const target = [...el("compare-thumbs").children].find((thumb) => thumb.dataset.unselect === slug);
  if (!target) return;
  const pop = () => target.animate(
    [{ transform: "scale(1)" }, { transform: "scale(1.2)" }, { transform: "scale(1)" }],
    { duration: 240, easing: "ease-out" },
  );
  if (!source || !from || calmMotion()) {
    if (!calmMotion()) pop();
    return;
  }
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) return;
  const clone = document.createElement("img");
  clone.src = source.currentSrc || source.src;
  clone.alt = "";
  clone.className = "compare-flyer";
  document.body.append(clone);
  target.style.visibility = "hidden";
  const frame = (rect, radius, opacity = 1) => ({
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: radius, opacity,
  });
  const middle = {
    left: from.left + (to.left - from.left) * 0.55,
    top: Math.min(from.top, to.top) + (to.top - from.top) * 0.35,
    width: Math.max(to.width * 2.2, from.width * 0.42),
    height: Math.max(to.height * 2.2, from.height * 0.42),
  };
  const flight = clone.animate(
    [frame(from, "0"), { ...frame(middle, "24%"), offset: 0.55 }, frame(to, "50%")],
    { duration: 620, easing: "cubic-bezier(.45, .05, .25, 1)", fill: "forwards" },
  );
  const land = () => {
    clone.remove();
    target.style.visibility = "";
    pop();
  };
  flight.onfinish = land;
  flight.oncancel = land;
}

/* Navigation */
function renderRoute() {
  const hash = decodeURIComponent(location.hash.slice(1));
  let compareCars = null;
  if (hash.startsWith("comparer:")) {
    compareCars = hash.slice(9).split(",").map(compareCar).filter(Boolean).slice(0, MAX_COMPARE);
    if (compareCars.length < 2) compareCars = null;
  }
  const accounts = hash === "comptes" && isAdmin();
  const profile = hash === "profil" && Boolean(state.user);
  const discover = hash === "decouvrir" && Boolean(state.user);
  // Une voiture ouverte depuis une comparaison peut venir de la collection d'un ami.
  const car = carBySlug(hash) || compareCar(hash) || null;
  el("library").hidden = Boolean(car || compareCars || accounts || profile || discover);
  el("discover").hidden = !discover;
  el("profile").hidden = !profile;
  el("detail").hidden = !car;
  el("compare").hidden = !compareCars;
  el("accounts").hidden = !accounts;
  document.title = car ? `${car.name} · CarPocket` : compareCars ? "Comparaison · CarPocket" : accounts ? "Comptes · CarPocket" : profile ? "Mon profil · CarPocket" : discover ? "Collections de mes amis · CarPocket" : "CarPocket";
  // Une actualisation ne doit pas effacer une note en cours de saisie.
  const typing = document.activeElement?.id === "car-notes" && document.activeElement.dataset.slug === car?.slug;
  if (car && !typing) el("detail").innerHTML = detailHtml(car);
  if (compareCars) el("compare").innerHTML = compareHtml(compareCars);
  if (accounts) renderAccounts();
  if (profile) renderProfile();
  if (discover) renderDiscover();
}

function route() {
  renderRoute();
  renderCompareBar();
  window.scrollTo(0, 0);
}

/* Ajout, retrait et photo principale */
async function fetchCatalog() {
  const response = await fetch(`cars.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

let pollTimer = null;
function schedulePoll() {
  clearTimeout(pollTimer);
  if (state.user && pendingItems().some((item) => item.status !== "failed")) pollTimer = setTimeout(poll, POLL_MS);
}

async function poll() {
  try {
    state.catalog = await fetchCatalog();
    const running = pendingItems().filter((item) => item.status !== "failed" && !state.starting.has(item.name));
    await Promise.all(running.map(async (item) => {
      const { failed, found } = await server("car-status", { title: item.name });
      if (failed) state.failed.add(item.name);
      // Le lancement a pu se perdre (page fermée, GitHub lent) : on le relance une fois.
      const row = state.items.find((entry) => entry.title === item.name);
      const waited = row ? Date.now() - Date.parse(row.added_at) : 0;
      if (found === false && waited > RELAUNCH_MS && !state.relaunched.has(item.name)) {
        state.relaunched.add(item.name);
        await startRobot(item.name);
      }
    }));
  } catch { /* on réessaiera au prochain passage */ }
  state.compare = state.compare.filter((slug) => catalogCar(slug));
  renderAll();
  schedulePoll();
}

async function startRobot(name) {
  state.failed.delete(name);
  state.starting.add(name);
  try {
    await server("request-car", { title: name });
  } catch {
    state.failed.add(name);
  } finally {
    state.starting.delete(name);
  }
  renderLibrary();
  schedulePoll();
}

async function addCar(name, thumb) {
  const row = { user_id: state.user.id, title: name, thumb: safeUrl(thumb) || null };
  const { data, error } = await db.from("deck_items").insert(row).select(ITEM_FIELDS).single();
  if (error) {
    el("add-dialog").showModal();
    setSuggestStatus("Cette voiture n'a pas pu être ajoutée. Réessaie dans un instant.");
    return;
  }
  state.items = [data, ...state.items];
  el("search").value = "";
  state.brand = "";
  if (location.hash) location.hash = "";
  renderAll();
  el("library-title").scrollIntoView();
  // Déjà dans le catalogue : rien à préparer, l'ajout est immédiat.
  if (!state.catalog.some((car) => titleOf(car) === name)) startRobot(name);
}

function photoNotice(text) {
  const notice = el("photo-notice");
  if (notice) notice.textContent = text;
}

/** Enregistre une modification des photos, puis met l'écran à jour. */
async function updateItem(car, changes) {
  const title = titleOf(car);
  const { error } = await db.from("deck_items").update(changes).eq("user_id", state.user.id).eq("title", title);
  if (error) return false;
  state.items = state.items.map((item) => (item.title === title ? { ...item, ...changes } : item));
  renderAll();
  return true;
}

const itemOf = (car) => state.items.find((item) => item.title === titleOf(car));

/** Réduit la photo et efface ses métadonnées, dont la position GPS du téléphone. */
async function preparePhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("photo"))), "image/jpeg", 0.85);
  });
}

async function addPhoto(car, file) {
  const item = itemOf(car);
  if (!item || !file) return;
  if ((item.custom_photos || []).length >= 20) {
    photoNotice("20 photos maximum par voiture : supprimes-en une pour en ajouter une autre.");
    return;
  }
  photoNotice("Envoi de la photo…");
  let path = null;
  try {
    const blob = await preparePhoto(file);
    path = `${state.user.id}/${crypto.randomUUID()}.jpg`;
    const { error } = await db.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    if (error) throw error;
    await signPhotos([path]);
    const saved = await updateItem(car, {
      custom_photos: [path, ...(item.custom_photos || [])],
      main_photo: path,
    });
    if (!saved) {
      await db.storage.from(PHOTO_BUCKET).remove([path]);
      throw new Error("enregistrement");
    }
    photoNotice("Photo ajoutée.");
  } catch {
    photoNotice("La photo n'a pas pu être ajoutée. Vérifie ta connexion et réessaie.");
  }
}

async function hidePhoto(car, index) {
  const photo = car.photos[index];
  const item = itemOf(car);
  if (!photo || !item) return;
  const changes = { hidden_photos: [...(item.hidden_photos || []), photo.key] };
  if (item.main_photo === photo.key) changes.main_photo = null;
  photoNotice(await updateItem(car, changes) ? "Photo masquée." : "La photo n'a pas pu être masquée. Réessaie.");
}

async function deletePhoto(car, index) {
  const photo = car.photos[index];
  const item = itemOf(car);
  if (!photo?.custom || !item) return;
  const changes = { custom_photos: (item.custom_photos || []).filter((path) => path !== photo.key) };
  if (item.main_photo === photo.key) changes.main_photo = null;
  if (!(await updateItem(car, changes))) throw new Error("Cette photo n'a pas pu être supprimée. Réessaie.");
  await db.storage.from(PHOTO_BUCKET).remove([photo.key]);
}

async function chooseMainPhoto(car, index) {
  const file = car.photos[index]?.key;
  if (!file) return;
  const title = titleOf(car);
  const { error } = await db.from("deck_items").update({ main_photo: file })
    .eq("user_id", state.user.id).eq("title", title);
  if (error) {
    photoNotice("Le choix n'a pas pu être enregistré. Réessaie.");
    return;
  }
  state.items = state.items.map((item) => (item.title === title ? { ...item, main_photo: file } : item));
  renderAll();
  photoNotice("Photo principale choisie.");
}

/* Suggestions pendant la frappe */
const suggestCache = new Map();
let suggestTimer = null;
let suggestAbort = null;
let suggestItems = [];
let suggestIndex = -1;
let suggestParents = null;

async function searchCars(query) {
  const key = query.toLowerCase();
  if (suggestCache.has(key)) return suggestCache.get(key);
  suggestAbort?.abort();
  suggestAbort = new AbortController();
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    generator: "search",
    gsrsearch: `${query}* hastemplate:"Infobox automobile"`,
    gsrnamespace: "0",
    gsrlimit: "30",
    prop: "pageimages|description",
    piprop: "thumbnail",
    pithumbsize: "240",
    pilimit: "30",
  });
  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal: suggestAbort.signal });
  if (!response.ok) throw new Error(String(response.status));
  const data = await response.json();
  const results = (data.query?.pages || [])
    .sort((a, b) => a.index - b.index)
    .map((p) => ({ name: p.title, description: p.description || "", thumb: p.thumbnail?.source || "" }));
  suggestCache.set(key, results);
  return results;
}

function inDeck(name) {
  return state.items.some((item) => item.title === name);
}

function renderSuggestions() {
  const list = el("suggestions");
  list.innerHTML = suggestItems.map((item, i) => {
    const taken = inDeck(item.name);
    return `<li class="suggestion" id="suggestion-${i}" role="option" data-index="${i}" aria-selected="${i === suggestIndex}" aria-disabled="${taken}">
      <div class="suggestion-photo">${safeUrl(item.thumb) ? `<img src="${esc(item.thumb)}" alt="">` : ""}</div>
      <div><strong>${esc(item.label || item.name)}</strong><small>${taken ? "Déjà dans ton deck" : esc(item.description)}</small></div>
    </li>`;
  }).join("");
  const input = el("add-name");
  input.setAttribute("aria-expanded", String(suggestItems.length > 0));
  if (suggestIndex >= 0) input.setAttribute("aria-activedescendant", `suggestion-${suggestIndex}`);
  else input.removeAttribute("aria-activedescendant");
  el("suggest-back").hidden = !suggestParents;
}

/** Les générations décrites sur une page : chacune a son encadré technique. */
async function pageVariants(title) {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", origin: "*",
    titles: title, redirects: "1", prop: "revisions", rvprop: "content", rvslots: "main",
  });
  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
  if (!response.ok) throw new Error(String(response.status));
  const data = await response.json();
  const text = (data.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref\b[^>]*\/>/gi, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, "");
  const variants = new Map();
  for (const match of text.matchAll(/\{\{\s*infobox[ _]+(?:automobile|car)\b/gi)) {
    let depth = 0;
    let end = match.index;
    while (end < text.length - 1) {
      const pair = text.slice(end, end + 2);
      if (pair === "{{") { depth += 1; end += 2; }
      else if (pair === "}}") { depth -= 1; end += 2; if (depth === 0) break; }
      else end += 1;
    }
    const box = text.slice(match.index, end);
    if (!/\|\s*engine\s*=\s*\S/i.test(box)) continue;
    const name = (box.match(/\|\s*name\s*=\s*([^\n]*)/i)?.[1] || "")
      .split(/<br\s*\/?>/i)[0]
      .replace(/\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]/g, "$1")
      .replace(/'{2,}/g, "")
      .replace(/\s*\|.*$/, "")
      .trim();
    if (!name || /[{}<>#]/.test(name) || variants.has(name)) continue;
    const image = (box.match(/\|\s*image\s*=\s*([^\n|]*)/i)?.[1] || "").trim();
    const thumb = image && !/[{}<>[\]]/.test(image)
      ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image.replace(/^(file|image):/i, ""))}?width=240`
      : "";
    variants.set(name, thumb);
  }
  return [...variants].map(([name, thumb]) => ({ name, thumb }));
}

function setSuggestStatus(text) {
  el("suggest-status").textContent = text;
  el("suggest-status").hidden = !text;
}

el("add-name").addEventListener("input", () => {
  clearTimeout(suggestTimer);
  const query = el("add-name").value.trim();
  suggestIndex = -1;
  suggestParents = null;
  el("suggest-back").hidden = true;
  if (query.length < 2) {
    suggestAbort?.abort();
    suggestItems = [];
    renderSuggestions();
    setSuggestStatus("Tape au moins deux lettres.");
    return;
  }
  setSuggestStatus("Recherche…");
  suggestTimer = setTimeout(async () => {
    try {
      const results = await searchCars(query);
      if (el("add-name").value.trim() !== query) return;
      suggestItems = results;
      renderSuggestions();
      setSuggestStatus(results.length ? "" : "Aucune voiture trouvée. Essaie un autre nom, souvent en anglais sur Wikipédia.");
    } catch (error) {
      if (error.name !== "AbortError") setSuggestStatus("La recherche ne répond pas. Réessaie dans un instant.");
    }
  }, 350);
});

async function pickSuggestion(index) {
  const item = suggestItems[index];
  if (!item || inDeck(item.name)) return;
  if (!item.final) {
    setSuggestStatus("Recherche des générations…");
    const variants = await pageVariants(item.name).catch(() => []);
    if (suggestItems[index] !== item) return;
    if (variants.length >= 2) {
      suggestParents = suggestItems;
      suggestItems = variants.map((variant) => ({
        name: `${item.name}#${variant.name}`,
        label: variant.name,
        description: item.name,
        thumb: variant.thumb || item.thumb,
        final: true,
      }));
      suggestIndex = -1;
      renderSuggestions();
      setSuggestStatus(`${variants.length} générations sur cette page. Laquelle veux-tu ?`);
      return;
    }
  }
  el("add-dialog").close();
  addCar(item.name, item.thumb);
}

el("add-name").addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!suggestItems.length) return;
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    suggestIndex = (suggestIndex + step + suggestItems.length) % suggestItems.length;
    renderSuggestions();
    el(`suggestion-${suggestIndex}`)?.scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter") {
    event.preventDefault();
    pickSuggestion(suggestIndex >= 0 ? suggestIndex : 0);
  }
});
el("suggest-back").addEventListener("click", () => {
  suggestItems = suggestParents || [];
  suggestParents = null;
  suggestIndex = -1;
  renderSuggestions();
  setSuggestStatus("");
  el("add-name").focus();
});
el("suggestions").addEventListener("error", (event) => {
  if (event.target.tagName === "IMG") event.target.remove();
}, true);
el("suggestions").addEventListener("click", (event) => {
  const item = event.target.closest("[data-index]");
  if (item) pickSuggestion(Number(item.dataset.index));
});
el("add-form").addEventListener("submit", (event) => event.preventDefault());
el("add-cancel").addEventListener("click", () => el("add-dialog").close());

function openAdd() {
  el("add-name").value = "";
  suggestParents = null;
  suggestItems = [];
  suggestIndex = -1;
  renderSuggestions();
  setSuggestStatus("Tape au moins deux lettres.");
  el("add-dialog").showModal();
  el("add-name").focus();
}
el("open-add").addEventListener("click", openAdd);
el("open-add-cta").addEventListener("click", openAdd);
el("open-add-intro").addEventListener("click", openAdd);

/* Thème clair ou sombre : suit l'appareil tant qu'aucun choix n'a été fait. */
const themeQuery = window.matchMedia("(prefers-color-scheme: dark)");

function savedTheme() {
  try {
    return localStorage.getItem("carpocket.theme");
  } catch {
    return null;
  }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre";
  const button = el("theme-toggle");
  button.setAttribute("aria-label", label);
  button.dataset.tip = label;
}

el("theme-toggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("carpocket.theme", next);
  } catch { /* le choix vaut alors pour cette visite */ }
});
themeQuery.addEventListener("change", (event) => {
  if (!savedTheme()) applyTheme(event.matches ? "dark" : "light");
});
applyTheme(document.documentElement.dataset.theme || "light");

/* Connexion */
// « Noémie », « noemie » et « NOEMIE » désignent le même compte.
const toLogin = (username) => username.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const toEmail = (username) => `${toLogin(username)}@${LOGIN_DOMAIN}`;

/** Hors connexion, on retrouve la dernière collection enregistrée sur cet appareil. */
function saveOfflineCopy() {
  if (state.user && !state.viewing) save(`offline.${state.user.id}`, { user: state.user, items: state.items });
}

async function enterOffline(session) {
  const copy = load(`offline.${session.user.id}`, null);
  if (!copy) return false;
  state.catalog = await fetchCatalog();
  state.user = copy.user;
  state.items = copy.items;
  state.viewing = null;
  el("offline-note").hidden = false;
  rebuildDeck();
  state.compareInfo = load(`compareInfo.${state.user.id}`, {});
  state.compare = load(`compare.${state.user.id}`, []).filter((slug) => catalogCar(slug)).slice(0, MAX_COMPARE);
  showroom.key = "";
  profileRendered = false;
  renderAll();
  return true;
}

async function enterApp(session) {
  const { data: profile, error } = await db.from("profiles")
    .select("id, username, avatar, shared").eq("id", session.user.id).single();
  if (error) throw error;
  const { data: admin } = await db.rpc("is_admin");
  state.user = { ...profile, role: admin ? "admin" : "member" };
  state.viewing = null;
  state.catalog = await fetchCatalog();
  await loadItems();
  el("offline-note").hidden = true;
  saveOfflineCopy();
  state.compareInfo = load(`compareInfo.${profile.id}`, {});
  state.compare = load(`compare.${profile.id}`, []).filter((slug) => catalogCar(slug)).slice(0, MAX_COMPARE);
  showroom.key = "";
  profileRendered = false;
  renderAll();
  if (pendingItems().length) poll();
}

el("session-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorBox = el("session-error");
  errorBox.hidden = true;
  el("session-submit").disabled = true;
  try {
    const { data, error } = await db.auth.signInWithPassword({
      email: toEmail(el("session-username").value),
      password: el("session-password").value,
    });
    if (error) throw error;
    el("session-password").value = "";
    await enterApp(data.session);
  } catch (error) {
    errorBox.textContent = error.status === 400
      ? "Identifiant ou mot de passe incorrect."
      : "La connexion n'a pas abouti. Si le problème continue, le projet est peut-être en pause.";
    errorBox.hidden = false;
  } finally {
    el("session-submit").disabled = false;
  }
});

el("session-button").addEventListener("click", async () => {
  clearTimeout(pollTimer);
  if (state.user) save(`offline.${state.user.id}`, null);
  await db.auth.signOut();
  Object.assign(state, { user: null, viewing: null, items: [], cars: [], compare: [], accounts: [], people: [], ownTitles: new Set() });
  profileRendered = false;
  state.failed.clear();
  showroom.key = "";
  if (location.hash) location.hash = "";
  renderSession();
  renderCompareBar();
});

/* Avatars : logos Simple Icons (CC0), personnages et objets Fluent Emoji (MIT). */
const AVATAR_CHARACTERS = {
  superheros: "Super-héros", superheroine: "Super-héroïne", supervilain: "Super-vilain", supervilaine: "Super-vilaine",
  ninja: "Ninja", magicien: "Magicien", magicienne: "Magicienne", vampire: "Vampire", vampirefemme: "Vampire (femme)",
  zombie: "Zombie", genie: "Génie", elfe: "Elfe", fee: "Fée", astronaute: "Astronaute",
  detective: "Détective", pilote: "Pilote", mecano: "Mécano", pompier: "Pompier", policier: "Policier", chef: "Chef",
  prince: "Prince", princesse: "Princesse", robot: "Robot", alien: "Extraterrestre", monstre: "Petit monstre",
  fantome: "Fantôme", ogre: "Ogre", lutin: "Lutin", clown: "Clown", renard: "Renard", ours: "Ours", lion: "Lion",
  tigre: "Tigre", loup: "Loup", panda: "Panda", dragon: "Dragon", licorne: "Licorne", aigle: "Aigle",
};
const AVATAR_BRANDS = {
  alpine: "Alpine", mercedes: "Mercedes-Benz", ferrari: "Ferrari", porsche: "Porsche", lamborghini: "Lamborghini", bugatti: "Bugatti", koenigsegg: "Koenigsegg",
  mclaren: "McLaren", astonmartin: "Aston Martin", maserati: "Maserati", bmw: "BMW", audi: "Audi", tesla: "Tesla",
  volkswagen: "Volkswagen", peugeot: "Peugeot", renault: "Renault", dacia: "Dacia", citroen: "Citroën", toyota: "Toyota",
  honda: "Honda", nissan: "Nissan", mazda: "Mazda", subaru: "Subaru", suzuki: "Suzuki", hyundai: "Hyundai", kia: "Kia",
  ford: "Ford", chevrolet: "Chevrolet", cadillac: "Cadillac", jeep: "Jeep", fiat: "Fiat", mini: "Mini", volvo: "Volvo",
  seat: "SEAT", opel: "Opel",
};
const AVATAR_EMOJIS = {
  bolide: "Bolide", voiture: "Voiture", suv: "SUV", drapeau: "Drapeau à damier", roue: "Roue", cle: "Clé",
  flamme: "Flamme", eclair: "Éclair", etoile: "Étoile", trophee: "Trophée", fusee: "Fusée", couronne: "Couronne",
};
const AVATAR_ALIASES = { "marque:aston": "marque:astonmartin" };

function avatarHtml(avatarValue, username = "") {
  const avatar = AVATAR_ALIASES[avatarValue] || avatarValue;
  const [kind, id] = String(avatar || "").split(":");
  const image = (folder, file) => `<img src="avatars/${folder}/${file}" alt="" loading="lazy">`;
  if (kind === "perso" && AVATAR_CHARACTERS[id]) {
    return `<span class="avatar avatar-picture" aria-hidden="true">${image("perso", `${id}.png`)}</span>`;
  }
  if (kind === "emoji" && AVATAR_EMOJIS[id]) {
    return `<span class="avatar avatar-picture" aria-hidden="true">${image("emoji", `${id}.png`)}</span>`;
  }
  if (kind === "marque" && AVATAR_BRANDS[id]) {
    return `<span class="avatar avatar-logo" aria-hidden="true">${image("marques", `${id}.svg`)}</span>`;
  }
  return `<span class="avatar avatar-initial" aria-hidden="true">${esc(username.charAt(0).toUpperCase())}</span>`;
}

function avatarChoices() {
  const current = AVATAR_ALIASES[state.user.avatar] || state.user.avatar || "";
  const button = (value, label) => `<button type="button" class="avatar-choice" data-avatar="${value}" aria-label="${esc(label)}" title="${esc(label)}" aria-pressed="${current === value}">${avatarHtml(value, state.user.username)}</button>`;
  const group = (title, items) => `<h3 class="avatar-group">${title}</h3><div class="avatar-grid">${items}</div>`;
  const list = (prefix, table) => Object.entries(table).map(([id, label]) => button(`${prefix}:${id}`, label)).join("");
  return group("Par défaut", button("", "Mon initiale"))
    + group("Personnages", list("perso", AVATAR_CHARACTERS))
    + group("Marques", list("marque", AVATAR_BRANDS))
    + group("Objets", list("emoji", AVATAR_EMOJIS));
}

/* Menu et page du profil */
function closeProfileMenu() {
  el("profile-dropdown").hidden = true;
  el("profile-button").setAttribute("aria-expanded", "false");
}

el("profile-button").addEventListener("click", (event) => {
  event.stopPropagation();
  const opening = el("profile-dropdown").hidden;
  el("profile-dropdown").hidden = !opening;
  el("profile-button").setAttribute("aria-expanded", String(opening));
  if (opening) el("profile-dropdown").querySelector("a").focus();
});
el("profile-dropdown").addEventListener("click", closeProfileMenu);
document.addEventListener("click", (event) => {
  if (!el("profile-menu").contains(event.target)) closeProfileMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !el("profile-dropdown").hidden) {
    closeProfileMenu();
    el("profile-button").focus();
  }
});

let profileRendered = false;
function renderProfile() {
  // Ne pas effacer une saisie en cours quand la page se rafraîchit.
  if (profileRendered && el("profile-form")) {
    el("profile-count").textContent = plural(state.ownTitles.size, "voiture");
    return;
  }
  profileRendered = true;
  el("profile").innerHTML = `<section class="compare-head"><div class="wrap">
      <a class="back" href="#">‹ Mon deck</a>
      <h1 class="display-xl">Mon profil</h1>
    </div></section>
    <section class="section"><div class="wrap profile-layout">
      <dl class="profile-facts">
        <div class="spec-row"><dt>Identifiant</dt><dd>${esc(displayName(state.user.username))}</dd></div>
        <div class="spec-row"><dt>Rôle</dt><dd>${isAdmin() ? "Administrateur" : "Membre"}</dd></div>
        <div class="spec-row"><dt>Collection</dt><dd id="profile-count">${plural(state.ownTitles.size, "voiture")}</dd></div>
      </dl>
      <section class="profile-sharing">
        <h2 class="display-sm">Partage</h2>
        <label class="sharing-toggle">
          <input type="checkbox" id="profile-shared" ${state.user.shared ? "checked" : ""}>
          <span>Rendre ma collection visible par les autres comptes connectés</span>
        </label>
        <p class="notice" id="shared-notice" role="status"></p>
      </section>
      <section class="profile-avatar">
        <h2 class="display-sm">Mon avatar</h2>
        <div id="avatar-picker">${avatarChoices()}</div>
        <p class="notice" id="avatar-notice" role="status"></p>
      </section>
      <form class="profile-form" id="profile-form" novalidate>
        <h2 class="display-sm">Changer mon mot de passe</h2>
        <label class="field"><span class="label">Mot de passe actuel</span><input id="profile-current" type="password" autocomplete="current-password"></label>
        <label class="field"><span class="label">Nouveau mot de passe (10 caractères minimum)</span><input id="profile-new" type="password" autocomplete="new-password"></label>
        <label class="field"><span class="label">Confirme le nouveau mot de passe</span><input id="profile-confirm" type="password" autocomplete="new-password"></label>
        <button type="submit" class="button button-primary" id="profile-submit">Changer le mot de passe</button>
        <p class="notice" id="profile-notice" role="status"></p>
      </form>
    </div></section>`;
}

el("profile").addEventListener("click", async (event) => {
  const choice = event.target.closest("[data-avatar]");
  if (!choice) return;
  const avatar = choice.dataset.avatar || null;
  const previous = state.user.avatar;
  state.user.avatar = avatar;
  el("avatar-picker").innerHTML = avatarChoices();
  renderSession();
  const { error } = await db.from("profiles").update({ avatar }).eq("id", state.user.id);
  const notice = el("avatar-notice");
  if (error) {
    state.user.avatar = previous;
    el("avatar-picker").innerHTML = avatarChoices();
    renderSession();
    notice.textContent = "L'avatar n'a pas pu être enregistré. Réessaie.";
    notice.classList.add("failed");
    return;
  }
  notice.textContent = "Avatar enregistré.";
  notice.classList.remove("failed");
});

el("profile").addEventListener("change", async (event) => {
  if (event.target.id !== "profile-shared") return;
  const shared = event.target.checked;
  const notice = el("shared-notice");
  const { error } = await db.from("profiles").update({ shared }).eq("id", state.user.id);
  if (error) {
    event.target.checked = !shared;
    notice.textContent = "Ce réglage n'a pas pu être enregistré. Réessaie.";
    notice.classList.add("failed");
    return;
  }
  state.user.shared = shared;
  notice.textContent = shared ? "Ta collection est visible par les autres comptes." : "Ta collection est masquée.";
  notice.classList.remove("failed");
});

function profileNotice(text, failed = false) {
  el("profile-notice").textContent = text;
  el("profile-notice").classList.toggle("failed", failed);
}

el("profile").addEventListener("submit", async (event) => {
  event.preventDefault();
  const current = el("profile-current").value;
  const next = el("profile-new").value;
  if (!current) return profileNotice("Saisis ton mot de passe actuel.", true);
  if (next.length < 10) return profileNotice("Le nouveau mot de passe doit faire au moins 10 caractères.", true);
  if (next !== el("profile-confirm").value) return profileNotice("Les deux nouveaux mots de passe ne sont pas identiques.", true);
  if (next === current) return profileNotice("Le nouveau mot de passe doit être différent de l'actuel.", true);
  el("profile-submit").disabled = true;
  profileNotice("Modification en cours…");
  try {
    // Vérifie le mot de passe actuel, pour protéger une session restée ouverte.
    const check = await db.auth.signInWithPassword({ email: toEmail(state.user.username), password: current });
    if (check.error) return profileNotice("Le mot de passe actuel est incorrect.", true);
    const { error } = await db.auth.updateUser({ password: next });
    if (error) {
      return profileNotice(error.code === "weak_password"
        ? "Ce mot de passe est trop faible. Choisis-en un plus long ou moins courant."
        : "Le mot de passe n'a pas pu être changé. Réessaie.", true);
    }
    ["profile-current", "profile-new", "profile-confirm"].forEach((id) => { el(id).value = ""; });
    profileNotice("Ton mot de passe a été changé.");
  } catch {
    profileNotice("Le serveur ne répond pas. Réessaie dans un instant.", true);
  } finally {
    el("profile-submit").disabled = false;
  }
});

/* Comptes (administrateur) */
async function renderAccounts() {
  const box = el("accounts");
  const [{ data: rows, error }, { data: roles }] = await Promise.all([
    db.from("profiles").select("id, username, avatar, shared").order("username"),
    db.rpc("account_roles"),
  ]);
  const roleOf = new Map((roles || []).map((entry) => [entry.id, entry.role]));
  const profiles = (rows || []).map((p) => ({ ...p, role: roleOf.get(p.id) || "member" }));
  if (error) {
    box.innerHTML = `<section class="section"><div class="wrap"><p class="notice failed">Les comptes n'ont pas pu être chargés.</p></div></section>`;
    return;
  }
  state.accounts = profiles;
  box.innerHTML = `<section class="compare-head"><div class="wrap">
      <a class="back" href="#">‹ Mon deck</a>
      <h1 class="display-xl">Comptes</h1>
    </div></section>
    <section class="section"><div class="wrap">
      <div class="compare-scroll"><table class="accounts-table">
        <thead><tr><th>Identifiant</th><th>Rôle</th><th>Actions</th></tr></thead>
        <tbody>${profiles.map((p) => `<tr>
          <td><span class="account-name"><span class="account-avatar">${avatarHtml(p.avatar, p.username)}</span>${esc(displayName(p.username))}</span></td>
          <td>${p.role === "admin" ? "Administrateur" : "Membre"}${p.shared ? "" : " · collection masquée"}</td>
          <td><div class="account-actions">
            <button type="button" class="text-link" data-view-user="${esc(p.id)}">Voir la collection</button>
            <button type="button" class="text-link quiet" data-password-user="${esc(p.id)}">Changer le mot de passe</button>
            ${p.id === state.user.id ? "" : `<button type="button" class="text-link quiet" data-delete-user="${esc(p.id)}">Supprimer</button>`}
          </div></td>
        </tr>`).join("")}</tbody>
      </table></div>
      <h2 class="display-sm" style="margin-top:48px">Créer un compte</h2>
      <form class="account-form" id="account-form" novalidate>
        <label class="field"><span class="label">Identifiant</span><input id="account-username" required autocomplete="off" autocapitalize="none" spellcheck="false"></label>
        <label class="field"><span class="label">Mot de passe (10 caractères minimum)</span><input id="account-password" type="password" required minlength="10" autocomplete="new-password"></label>
        <button type="submit" class="button button-primary">Créer</button>
      </form>
      <p class="notice" id="account-notice" role="status"></p>
    </div></section>`;
}

function accountNotice(text, failed = false) {
  const notice = el("account-notice");
  if (!notice) return;
  notice.textContent = text;
  notice.classList.toggle("failed", failed);
}

el("accounts").addEventListener("submit", async (event) => {
  if (event.target.id !== "account-form") return;
  event.preventDefault();
  // Accepte « Thibault » ou « Noémie » : l'identifiant s'écrit sans majuscule ni accent.
  const username = toLogin(el("account-username").value);
  const password = el("account-password").value;
  if (!/^[a-z0-9_-]{2,30}$/.test(username)) {
    accountNotice("L'identifiant doit faire 2 à 30 caractères : lettres, chiffres, - ou _, sans espace.", true);
    return;
  }
  if (password.length < 10) {
    accountNotice("Le mot de passe doit faire au moins 10 caractères.", true);
    return;
  }
  accountNotice("Création du compte…");
  try {
    await server("create-user", { username, password });
    await renderAccounts();
    accountNotice(`Compte créé. Identifiant de connexion : ${displayName(username)}`);
  } catch (error) {
    accountNotice(error.message, true);
  }
});

/* Fenêtre de confirmation commune */
let confirmAction = null;
function askConfirm({ title, text, label, action, password = false }) {
  confirmAction = action;
  el("delete-title").textContent = title;
  el("delete-text").textContent = text;
  el("delete-submit").textContent = label;
  el("delete-submit").disabled = false;
  el("delete-error").hidden = true;
  el("delete-password-field").hidden = !password;
  el("delete-password").required = password;
  el("delete-password").value = "";
  el("delete-dialog").showModal();
}

el("delete-cancel").addEventListener("click", () => el("delete-dialog").close());
el("delete-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!confirmAction) return;
  el("delete-submit").disabled = true;
  try {
    await confirmAction(el("delete-password").value);
    el("delete-dialog").close();
  } catch (error) {
    el("delete-error").textContent = error.message || "L'action n'a pas abouti. Réessaie.";
    el("delete-error").hidden = false;
  } finally {
    el("delete-submit").disabled = false;
  }
});

async function removeFromDeck(car) {
  const title = titleOf(car);
  const { error } = await db.from("deck_items").delete().eq("user_id", state.user.id).eq("title", title);
  if (error) throw new Error("Cette voiture n'a pas pu être retirée. Réessaie.");
  const ownPhotos = itemOf(car)?.custom_photos || [];
  if (ownPhotos.length) await db.storage.from(PHOTO_BUCKET).remove(ownPhotos);
  state.items = state.items.filter((item) => item.title !== title);
  setCompare(state.compare.filter((slug) => slug !== car.slug));
  if (location.hash.slice(1) === car.slug) location.hash = "";
  renderAll();
}

/* Actions sur les cartes */
document.addEventListener("click", (event) => {
  const del = event.target.closest("[data-delete]");
  if (del) {
    const car = carBySlug(del.dataset.delete);
    if (!car) return;
    askConfirm({
      title: `Retirer ${car.name} ?`,
      text: "Elle disparaît de ta collection. Tu pourras l'ajouter de nouveau, mais tes photos, tes notes et tes modifications seront perdues.",
      label: "Retirer",
      action: () => removeFromDeck(car),
    });
    return;
  }
  const sheet = event.target.closest("[data-remove-sheet]");
  if (sheet) {
    const title = sheet.dataset.removeSheet;
    askConfirm({
      title: `Supprimer la fiche ${title} ?`,
      text: "Elle disparaît de toutes les collections, avec ses photos. C'est irréversible.",
      label: "Supprimer pour tout le monde",
      action: async () => {
        await server("remove-sheet", { title });
        state.catalog = state.catalog.filter((car) => titleOf(car) !== title);
        state.items = state.items.filter((item) => item.title !== title);
        location.hash = "";
        renderAll();
      },
    });
    return;
  }
  const view = event.target.closest("[data-view-user]");
  if (view) {
    viewCollection(view.dataset.viewUser);
    return;
  }
  const pass = event.target.closest("[data-password-user]");
  if (pass) {
    const account = state.accounts.find((p) => p.id === pass.dataset.passwordUser);
    askConfirm({
      title: `Nouveau mot de passe pour ${displayName(account.username)}`,
      text: "10 caractères minimum.",
      label: "Changer",
      password: true,
      action: async (password) => {
        await server("set-password", { user_id: account.id, password });
        accountNotice("Mot de passe changé.");
      },
    });
    return;
  }
  const removeUser = event.target.closest("[data-delete-user]");
  if (removeUser) {
    const account = state.accounts.find((p) => p.id === removeUser.dataset.deleteUser);
    askConfirm({
      title: `Supprimer le compte ${displayName(account.username)} ?`,
      text: "Le compte et sa collection seront effacés. C'est irréversible. Les fiches partagées restent.",
      label: "Supprimer",
      action: async () => {
        await server("delete-user", { user_id: account.id });
        await renderAccounts();
      },
    });
    return;
  }
  const leave = event.target.closest("#viewing-leave, .wordmark, [data-leave-viewing]");
  if (leave && state.viewing) {
    viewCollection(null);
    return;
  }
  const addTitle = event.target.closest("[data-add-title]");
  if (addTitle) {
    addFromCollection(addTitle.dataset.addTitle);
    return;
  }
  const share = event.target.closest("[data-share]");
  if (share) {
    const car = carBySlug(share.dataset.share) || catalogCar(share.dataset.share);
    if (car) shareCar(car, share);
    return;
  }
  const compare = event.target.closest("[data-compare]");
  if (compare) {
    const source = comparisonSource(compare);
    const from = source?.getBoundingClientRect();
    const added = toggleCompare(compare.dataset.compare);
    renderHero();
    renderLibrary();
    renderRoute();
    renderCompareBar();
    if (added) flyToCompareBar(source, from, compare.dataset.compare);
    return;
  }
  const unselect = event.target.closest("[data-unselect]");
  if (unselect) {
    setCompare(state.compare.filter((slug) => slug !== unselect.dataset.unselect));
    renderHero();
    renderLibrary();
    renderRoute();
    renderCompareBar();
    return;
  }
  const uncompare = event.target.closest("[data-uncompare]");
  if (uncompare) {
    const list = state.compare.filter((s) => s !== uncompare.dataset.uncompare);
    setCompare(list);
    const shown = decodeURIComponent(location.hash.slice(10)).split(",").filter((s) => s !== uncompare.dataset.uncompare);
    location.hash = shown.length >= 2 ? `comparer:${shown.join(",")}` : "";
    return;
  }
  const retry = event.target.closest("[data-retry]");
  if (retry) {
    startRobot(retry.dataset.retry);
    return;
  }
  const dismiss = event.target.closest("[data-dismiss]");
  if (dismiss) {
    const title = dismiss.dataset.dismiss;
    db.from("deck_items").delete().eq("user_id", state.user.id).eq("title", title).then(({ error }) => {
      if (error) return;
      state.items = state.items.filter((item) => item.title !== title);
      state.failed.delete(title);
      renderLibrary();
    });
  }
});

async function addFromCollection(title) {
  const { error } = await db.from("deck_items").insert({ user_id: state.user.id, title });
  // Déjà présente (ajout depuis un autre appareil) : le résultat voulu est atteint.
  if (error && error.code !== "23505") return;
  state.ownTitles.add(title);
  if (!state.viewing) await loadItems().catch(() => {});
  renderLibrary();
  renderRoute();
}

async function viewCollection(userId) {
  const account = state.people.find((p) => p.id === userId) || state.accounts.find((p) => p.id === userId);
  const leaving = !account || account.id === state.user.id;
  state.viewing = leaving ? null : account;
  el("viewing-name").textContent = state.viewing ? `Tu regardes la collection de ${displayName(state.viewing.username)}.` : "";
  try {
    await loadItems();
  } catch { /* la liste reste vide : le message de collection vide s'affiche */ }
  showroom.key = "";
  state.compareFull = false;
  if (location.hash) location.hash = "";
  renderAll();
  window.scrollTo(0, 0);
}

/* Découvrir les collections des autres */
async function renderDiscover() {
  const box = el("discover");
  box.innerHTML = `<section class="compare-head"><div class="wrap">
      <a class="back" href="#" data-leave-viewing>‹ Mon deck</a>
      <h1 class="display-xl">Les collections de mes amis</h1>
    </div></section>
    <section class="section"><div class="wrap"><p class="count" id="discover-status">Chargement des collections…</p><div class="people-grid" id="people-grid"></div></div></section>`;
  const [{ data: people, error }, { data: items, error: itemsError }] = await Promise.all([
    db.from("profiles").select("id, username, avatar, shared").eq("shared", true).neq("id", state.user.id).order("username"),
    db.from("deck_items").select("user_id, title, main_photo, added_at, hidden_photos").order("added_at", { ascending: false }),
  ]);
  if (el("discover").hidden) return;
  if (error || itemsError) {
    el("discover-status").textContent = "Les collections n'ont pas pu être chargées. Réessaie dans un instant.";
    return;
  }
  state.people = people;
  const catalog = new Map(state.catalog.map((car) => [titleOf(car), car]));
  // Une collection vide n'a rien à montrer, comme celle du compte administrateur.
  const visible = people.filter((person) => items.some((item) => item.user_id === person.id && catalog.has(item.title)));
  el("discover-status").textContent = visible.length
    ? `${plural(visible.length, "collection")} à découvrir`
    : "Aucun ami n'a encore de collection visible.";
  await signPhotos(items.map((item) => item.main_photo).filter((path) => path && !path.startsWith("photos/")));
  if (el("discover").hidden) return;
  el("people-grid").innerHTML = visible.map((person) => {
    const cars = items.filter((item) => item.user_id === person.id && catalog.has(item.title));
    const photos = cars.slice(0, 3).map((item) => {
      const car = catalog.get(item.title);
      const hidden = new Set(item.hidden_photos || []);
      const file = state.signed[item.main_photo]
        || car.photos.find((p) => p.file === item.main_photo)?.file
        || car.photos.find((p) => !hidden.has(p.file))?.file;
      return file ? `<img src="${esc(file)}" alt="" loading="lazy">` : "";
    }).join("");
    return `<button type="button" class="person-card" data-view-user="${esc(person.id)}">
      <span class="person-photos" data-count="${Math.min(cars.length, 3)}">${photos}</span>
      <span class="person-info">
        <span class="person-avatar">${avatarHtml(person.avatar, person.username)}</span>
        <span><strong>${esc(displayName(person.username))}</strong><small>${plural(cars.length, "voiture")}</small></span>
      </span>
    </button>`;
  }).join("");
}

el("compare-clear").addEventListener("click", () => {
  setCompare([]);
  renderHero();
  renderLibrary();
  renderRoute();
  renderCompareBar();
});

el("detail").addEventListener("change", (event) => {
  if (!event.target.matches("[data-add-photo]")) return;
  const slug = decodeURIComponent(location.hash.slice(1));
  const car = carBySlug(slug);
  if (car) addPhoto(car, event.target.files[0]);
  event.target.value = "";
});

el("detail").addEventListener("click", (event) => {
  const slug = decodeURIComponent(location.hash.slice(1));
  const car = carBySlug(slug) || catalogCar(slug);
  const main = event.target.closest("[data-main-photo]");
  if (main && car) {
    chooseMainPhoto(car, Number(main.dataset.mainPhoto));
    return;
  }
  if (event.target.closest("[data-edit-specs]") && car) {
    openSpecsEditor(car);
    return;
  }
  if (event.target.closest("[data-reset-specs]") && car) {
    askConfirm({
      title: "Tout réinitialiser ?",
      text: "Toutes les valeurs que tu as modifiées sur cette fiche reprendront leur valeur d'origine.",
      label: "Réinitialiser",
      action: async () => {
        if (!(await saveSpecs(car, {}))) throw new Error("La fiche n'a pas pu être réinitialisée. Réessaie.");
      },
    });
    return;
  }
  const hide = event.target.closest("[data-hide-photo]");
  if (hide && car) {
    hidePhoto(car, Number(hide.dataset.hidePhoto));
    return;
  }
  const remove = event.target.closest("[data-delete-photo]");
  if (remove && car) {
    const index = Number(remove.dataset.deletePhoto);
    askConfirm({
      title: "Supprimer cette photo ?",
      text: "Elle sera effacée définitivement de ta collection.",
      label: "Supprimer",
      action: () => deletePhoto(car, index),
    });
    return;
  }
  if (event.target.closest("[data-restore-photos]") && car) {
    updateItem(car, { hidden_photos: [] }).then((saved) => {
      photoNotice(saved ? "Photos rétablies." : "Les photos n'ont pas pu être rétablies. Réessaie.");
    });
    return;
  }
  if (event.target.closest("[data-zoom]") && car) {
    openViewer(car, Number(el("hero-photo").dataset.index || 0));
    return;
  }
  const button = event.target.closest("[data-photo]");
  if (!button) return;
  const photo = car.photos[Number(button.dataset.photo)];
  el("hero-photo").src = photo.file;
  el("hero-photo").dataset.index = button.dataset.photo;
  setPhotoTag("hero-tag", photo);
  el("hero-credit").textContent = creditText(photo);
  const slot = el("main-photo-slot");
  if (slot) slot.innerHTML = mainPhotoControl(car, Number(button.dataset.photo));
  el("detail").querySelectorAll("[data-photo]").forEach((b) => b.setAttribute("aria-current", String(b === button)));
});

["search", "sort"].forEach((id) => el(id).addEventListener("input", renderLibrary));
el("brands").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-brand]");
  if (!chip) return;
  state.brand = chip.dataset.brand;
  renderBrands();
  renderLibrary();
});
window.addEventListener("hashchange", () => { flushNotes(); route(); });

/* Notes d'une voiture */
const MAX_NOTES = 2000;
const notesDraft = { title: null, value: "", timer: null };

async function flushNotes() {
  clearTimeout(notesDraft.timer);
  const { title, value } = notesDraft;
  if (title === null) return;
  notesDraft.title = null;
  const { error } = await db.from("deck_items").update({ notes: value }).eq("user_id", state.user.id).eq("title", title);
  const status = el("notes-status");
  if (status) status.textContent = error ? "Note non enregistrée : vérifie ta connexion et réessaie." : "Enregistré.";
}

el("detail").addEventListener("input", (event) => {
  if (event.target.id !== "car-notes") return;
  const car = carBySlug(event.target.dataset.slug);
  if (!car) return;
  const title = titleOf(car);
  const value = event.target.value;
  state.items = state.items.map((item) => (item.title === title ? { ...item, notes: value } : item));
  car.notes = value;
  // Une note d'une autre voiture encore en attente part avant celle-ci.
  if (notesDraft.title !== null && notesDraft.title !== title) flushNotes();
  notesDraft.title = title;
  notesDraft.value = value;
  el("notes-status").textContent = "";
  clearTimeout(notesDraft.timer);
  notesDraft.timer = setTimeout(flushNotes, 800);
});
el("detail").addEventListener("focusout", (event) => {
  if (event.target.id === "car-notes") flushNotes();
});
window.addEventListener("pagehide", flushNotes);

/* Modification des informations */
const NUMERIC_SPECS = {
  power: "ch",
  torque: "N·m",
  top_speed: "km/h",
  zero_100: "s",
  weight: "kg",
  length: "mm",
  width: "mm",
  height: "mm",
  wheelbase: "mm",
};
const specsEditor = { car: null };

const editedNumber = (key, value) => (key === "zero_100" ? value.split(" : ").pop() : value).match(/\d+(?:[.,]\d+)?/)?.[0] || "";

function specField(car, key, label) {
  const unit = NUMERIC_SPECS[key];
  const edited = car.customSpecs?.[key];
  const original = catalogCar(car.slug)?.specs[key]?.value || "Non renseigné";
  const current = edited ? (unit ? editedNumber(key, edited) : edited) : "";
  const title = key === "zero_100" ? "Accélération 0-100 km/h" : label;
  return `<div class="spec-field">
    <label class="label" for="spec-${key}">${esc(title)}${unit ? ` (${esc(unit)})` : ""}</label>
    <div class="spec-input">
      <input id="spec-${key}" data-spec="${key}" type="text" ${unit ? `inputmode="decimal"` : `maxlength="200"`} autocomplete="off" value="${esc(current)}">
      <button type="button" class="text-link quiet" data-clear-spec="${key}"${edited ? "" : " hidden"} aria-label="Réinitialiser : ${esc(title)}">Réinitialiser</button>
    </div>
    <p class="spec-origin">D'origine : ${esc(original)}</p>
  </div>`;
}

function openSpecsEditor(car) {
  specsEditor.car = car;
  el("specs-error").hidden = true;
  el("specs-fields").innerHTML = SPEC_GROUPS.map(([title, rows]) => `<fieldset>
    <legend>${title}</legend>
    ${rows.map(([key, label]) => specField(car, key, label)).join("")}
  </fieldset>`).join("");
  el("specs-dialog").showModal();
}

/** Enregistre les valeurs de la personne ; la comparaison suit ses changements. */
async function saveSpecs(car, specs) {
  const saved = await updateItem(car, { custom_specs: specs });
  if (saved && state.compareInfo[car.slug]) {
    state.compareInfo[car.slug].specs = Object.keys(specs).length ? specs : null;
    if (state.user) save(`compareInfo.${state.user.id}`, state.compareInfo);
  }
  return saved;
}

el("specs-fields").addEventListener("click", (event) => {
  const key = event.target.closest("[data-clear-spec]")?.dataset.clearSpec;
  if (!key) return;
  el(`spec-${key}`).value = "";
  el(`spec-${key}`).focus();
  event.target.hidden = true;
});
el("specs-fields").addEventListener("input", (event) => {
  const key = event.target.dataset?.spec;
  if (key) el("specs-fields").querySelector(`[data-clear-spec="${key}"]`).hidden = !event.target.value;
});
el("specs-cancel").addEventListener("click", () => el("specs-dialog").close());
el("specs-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const specs = {};
  const invalid = [];
  el("specs-fields").querySelectorAll("[data-spec]").forEach((input) => {
    const key = input.dataset.spec;
    const value = input.value.trim();
    if (!value) return;
    const unit = NUMERIC_SPECS[key];
    if (!unit) {
      specs[key] = value;
    } else if (/^\d+([.,]\d+)?$/.test(value)) {
      const number = value.replace(".", ",");
      specs[key] = key === "zero_100" ? `0-100 km/h : ${number} s` : `${number} ${unit}`;
    } else {
      invalid.push(el(`spec-${key}`).closest(".spec-field").querySelector("label").textContent);
    }
  });
  const error = el("specs-error");
  if (invalid.length) {
    error.textContent = `Indique seulement un nombre pour : ${invalid.join(", ")}.`;
    error.hidden = false;
    return;
  }
  el("specs-submit").disabled = true;
  const saved = await saveSpecs(specsEditor.car, specs);
  el("specs-submit").disabled = false;
  if (!saved) {
    error.textContent = "Les informations n'ont pas pu être enregistrées. Réessaie.";
    error.hidden = false;
    return;
  }
  el("specs-dialog").close();
});

/* Photo en grand */
const viewer = { car: null, index: 0, swipe: null };

function showViewerPhoto(index) {
  const { photos } = viewer.car;
  viewer.index = (index + photos.length) % photos.length;
  const photo = photos[viewer.index];
  el("viewer-photo").src = photo.file;
  el("viewer-photo").alt = viewer.car.name;
  el("viewer-credit").textContent = creditText(photo);
  setPhotoTag("viewer-tag", photo);
  el("viewer-count").textContent = photos.length > 1 ? `${viewer.index + 1} / ${photos.length}` : "";
  // La photo suivante est prête avant qu'on la demande.
  new Image().src = photos[(viewer.index + 1) % photos.length].file;
}

function openViewer(car, index) {
  viewer.car = car;
  const several = car.photos.length > 1;
  el("viewer-prev").hidden = !several;
  el("viewer-next").hidden = !several;
  showViewerPhoto(index);
  el("photo-viewer").showModal();
}

el("viewer-close").addEventListener("click", () => el("photo-viewer").close());
el("viewer-prev").addEventListener("click", () => showViewerPhoto(viewer.index - 1));
el("viewer-next").addEventListener("click", () => showViewerPhoto(viewer.index + 1));
el("photo-viewer").addEventListener("click", (event) => {
  if (event.target === el("photo-viewer")) el("photo-viewer").close();
});
el("photo-viewer").addEventListener("keydown", (event) => {
  if (viewer.car.photos.length < 2) return;
  if (event.key === "ArrowLeft") showViewerPhoto(viewer.index - 1);
  if (event.key === "ArrowRight") showViewerPhoto(viewer.index + 1);
});
el("photo-viewer").addEventListener("touchstart", (event) => {
  viewer.swipe = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
}, { passive: true });
el("photo-viewer").addEventListener("touchend", (event) => {
  const start = viewer.swipe;
  viewer.swipe = null;
  // Une photo zoomée aux doigts se déplace : ce n'est pas un changement de photo.
  if (!start || viewer.car.photos.length < 2 || (window.visualViewport?.scale || 1) > 1.01) return;
  const dx = event.changedTouches[0].clientX - start.x;
  const dy = event.changedTouches[0].clientY - start.y;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) showViewerPhoto(viewer.index + (dx < 0 ? 1 : -1));
}, { passive: true });
// En refermant, la fiche montre la dernière photo regardée.
el("photo-viewer").addEventListener("close", () => {
  if (decodeURIComponent(location.hash.slice(1)) !== viewer.car.slug) return;
  el("detail").querySelector(`[data-photo="${viewer.index}"]`)?.click();
});
window.addEventListener("hashchange", () => {
  if (el("photo-viewer").open) el("photo-viewer").close();
});

/* Info-bulles : l'action de chaque bouton au survol à la souris ou au clavier. */
const tooltip = el("tooltip");
const hideTip = () => { tooltip.hidden = true; };

function flashTip(target, text) {
  showTip(target, text);
  setTimeout(hideTip, 2500);
}

function showTip(target, text = target.dataset.tip) {
  tooltip.textContent = text;
  tooltip.hidden = false;
  const box = target.getBoundingClientRect();
  const { width, height } = tooltip.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(Math.max(margin, box.left + box.width / 2 - width / 2), innerWidth - width - margin);
  const below = box.bottom + margin;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(margin, below + height > innerHeight ? box.top - height - margin : below)}px`;
}

document.addEventListener("pointerover", (event) => {
  if (event.pointerType !== "mouse") return;
  const target = event.target.closest("[data-tip]");
  if (target) showTip(target);
  else hideTip();
});
document.addEventListener("focusin", (event) => {
  const target = event.target.closest("[data-tip]");
  if (target && event.target.matches(":focus-visible")) showTip(target);
});
document.addEventListener("focusout", hideTip);
document.addEventListener("pointerdown", hideTip);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideTip();
});
window.addEventListener("scroll", hideTip, { passive: true, capture: true });
window.addEventListener("hashchange", hideTip);

/* Application installable */
let installPrompt = null;
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isAppleMobile = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function updateInstallButton() {
  el("install-button").hidden = isInstalled() || !(installPrompt || isAppleMobile() || /android/i.test(navigator.userAgent));
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  updateInstallButton();
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  updateInstallButton();
});
el("install-button").addEventListener("click", async () => {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    updateInstallButton();
    return;
  }
  el("install-steps").innerHTML = isAppleMobile()
    ? "<li>Ouvre ce site dans Safari.</li><li>Touche le bouton <strong>Partager</strong>.</li><li>Choisis <strong>Sur l'écran d'accueil</strong>, puis <strong>Ajouter</strong>.</li>"
    : "<li>Ouvre le menu du navigateur.</li><li>Choisis <strong>Installer l'application</strong> ou <strong>Ajouter à l'écran d'accueil</strong>.</li>";
  el("install-dialog").showModal();
});
el("install-close").addEventListener("click", () => el("install-dialog").close());
updateInstallButton();

window.addEventListener("online", () => {
  if (!el("offline-note").hidden) location.reload();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* le site marche aussi sans */ });
  });
}

async function start() {
  // Efface la clé GitHub et les données de l'ancienne version du site.
  ["token", "pending", "removing", "mainPhotos", "compare"].forEach((key) => save(key, null));
  const { data } = await db.auth.getSession();
  if (data.session) {
    try {
      await enterApp(data.session);
      return;
    } catch {
      // Sans réseau, on rouvre la copie locale plutôt que la page de connexion.
      const opened = !navigator.onLine && await enterOffline(data.session).catch(() => false);
      if (opened) return;
    }
  }
  renderSession();
  fetchCatalog().then((catalog) => {
    const photos = catalog.flatMap((car) => car.photos.slice(0, 1).map((photo) => photo.file));
    if (!photos.length) return;
    const image = el("login-photo");
    image.src = photos[Math.floor(Math.random() * photos.length)];
    image.hidden = false;
  }).catch(() => {});
}

start();
