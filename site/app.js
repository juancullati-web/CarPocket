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
const state = { catalog: [], cars: [], items: [], user: null, viewing: null, brand: "", compare: [], failed: new Set(), starting: new Set(), relaunched: new Set(), accounts: [] };

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Seuls les liens http(s) des données sont rendus cliquables. */
const safeUrl = (url) => (/^https?:\/\//i.test(url || "") ? url : "");
const ratioOf = (car) =>
  car.power_ch && car.weight_kg ? Math.round((car.power_ch / car.weight_kg) * 1000) : null;
const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
const STAR = `<abbr class="mark" title="Extrait du texte de l'article : à vérifier">*</abbr>`;
const carBySlug = (slug) => state.cars.find((c) => c.slug === slug);
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

/** La collection affichée : la fiche partagée, plus les choix de la personne. */
function rebuildDeck() {
  const byTitle = new Map(state.catalog.map((car) => [titleOf(car), car]));
  state.cars = state.items.flatMap((item) => {
    const car = byTitle.get(item.title);
    if (!car) return [];
    const chosen = car.photos.find((photo) => photo.file === item.main_photo);
    return [{
      ...car,
      added: item.added_at,
      photos: chosen ? [chosen, ...car.photos.filter((photo) => photo !== chosen)] : car.photos,
    }];
  });
}

function pendingItems() {
  const known = new Set(state.catalog.map(titleOf));
  return state.items.filter((item) => !known.has(item.title)).map((item) => {
    const failed = state.failed.has(item.title);
    const slow = Date.now() - Date.parse(item.added_at) > TIMEOUT_MS;
    return { name: item.title, thumb: item.thumb, status: failed ? "failed" : slow ? "slow" : "running" };
  });
}

async function loadItems() {
  const { data, error } = await db.from("deck_items")
    .select("title, thumb, main_photo, added_at")
    .eq("user_id", owner().id);
  if (error) throw error;
  state.items = data;
  rebuildDeck();
}

/* Cartes */
function compareButton(car) {
  const selected = state.compare.includes(car.slug);
  return `<button type="button" class="text-link" data-compare="${esc(car.slug)}" aria-pressed="${selected}">${selected ? "Sélectionnée ✓" : "Comparer"}</button>`;
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
      <div class="model-actions">
        ${compareButton(car)}
        <a class="text-link" href="#${esc(car.slug)}">Fiche ›</a>
        ${canEdit() ? `<button type="button" class="text-link quiet" data-delete="${esc(car.slug)}" aria-label="Retirer ${esc(car.name)} de ma collection">Retirer</button>` : ""}
      </div>
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
  if (car.power_ch) stats.push({ value: car.power_ch, unit: "ch", label: "Puissance", star: car.specs.power?.from_text });
  const ratio = ratioOf(car);
  if (ratio) stats.push({ value: ratio, unit: "ch/t", label: "Poids/puissance", star: car.specs.power?.from_text });
  const speed = car.specs.top_speed;
  const kmh = speed && parseInt(speed.value, 10);
  if (kmh) stats.push({ value: kmh, unit: "km/h", label: "Vitesse maximale", star: speed.from_text });
  else if (car.weight_kg) stats.push({ value: car.weight_kg, unit: "kg", label: "Poids", star: car.specs.weight?.from_text });
  return stats;
}

function showroomCompareButton(car) {
  const selected = state.compare.includes(car.slug);
  return `<button type="button" class="button button-on-dark" data-compare="${esc(car.slug)}" aria-pressed="${selected}">${selected ? "Sélectionnée ✓" : "Comparer"}</button>`;
}

function showroomCopy(car) {
  const eyebrow = [car.brand, car.year].filter(Boolean).join(" · ");
  return `<p class="label">${esc(eyebrow)}</p>
    <h1 class="display-xl">${esc(car.name)}</h1>
    <dl class="showroom-stats">${showroomStats(car).map((stat) => `<div>
      <dd><span data-count="${stat.value}">${stat.value}</span> ${stat.unit}${stat.star ? STAR : ""}</dd>
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
  if (!signedIn) closeProfileMenu();
  el("profile-initial").innerHTML = signedIn ? avatarHtml(state.user.avatar, state.user.username) : "";
  el("profile-name").textContent = signedIn ? state.user.username : "";
  el("cta-band").hidden = !canEdit();
  el("accounts-link").hidden = !isAdmin();
  el("library-title").textContent = state.viewing ? `Collection de ${state.viewing.username}` : "Mon deck";
  el("app-intro").hidden = Boolean(state.viewing);
  el("search-label").textContent = state.viewing ? "Rechercher dans cette collection" : "Rechercher dans mon deck";
  const note = el("viewing-note");
  note.hidden = !state.viewing;
}

function renderAll() {
  rebuildDeck();
  renderSession();
  renderHero();
  renderBrands();
  renderLibrary();
  renderCompareBar();
  renderRoute();
}

/* Fiche */
function specRow(car, key, label) {
  const spec = car.specs[key];
  if (!spec) {
    return `<div class="spec-row"><dt>${label}</dt><dd class="unknown">Non renseigné</dd></div>`;
  }
  return `<div class="spec-row"><dt>${label}</dt><dd>${esc(spec.value)}${spec.from_text ? STAR : ""}</dd></div>`;
}

function specCells(car) {
  const cell = (value, label, fromText) =>
    `<div class="spec-cell"><div class="spec-value">${esc(value)}${fromText ? STAR : ""}</div><span class="label">${esc(label)}</span></div>`;
  const cells = [];
  if (car.power_ch) cells.push(cell(`${car.power_ch} ch`, "Puissance", car.specs.power?.from_text));
  const ratio = ratioOf(car);
  if (ratio) cells.push(cell(`${ratio} ch/t`, "Poids/puissance", car.specs.power?.from_text));
  const speed = car.specs.top_speed;
  if (speed) cells.push(cell(speed.value, "Vitesse maximale", speed.from_text));
  const sprint = car.specs.zero_100;
  if (sprint) {
    const [label, value] = sprint.value.includes(" : ") ? sprint.value.split(" : ") : ["Accélération", sprint.value];
    cells.push(cell(value, label, sprint.from_text));
  }
  if (car.weight_kg) cells.push(cell(`${car.weight_kg} kg`, "Poids", car.specs.weight?.from_text));
  return cells.join("");
}

const creditText = (photo) => `Photo : ${photo.author}, ${photo.license}`;

function mainPhotoControl(car, index) {
  if (index === 0) return `<span class="main-photo-state">Photo principale ✓</span>`;
  return `<button type="button" class="button button-on-dark main-photo-button" data-main-photo="${index}">Choisir comme photo principale</button>`;
}

function detailHtml(car) {
  const hasTextValues = Object.values(car.specs).some((s) => s.from_text);
  const photos = car.photos;
  const cells = specCells(car);

  return `<section class="detail-hero">
      <div class="wrap detail-title">
        <a class="back" href="#">‹ Mon deck</a>
        <div class="detail-eyebrow">
          <span class="label">${esc(car.brand)}</span>
          ${car.example ? `<span class="badge">Exemple</span>` : ""}
        </div>
        <h1 class="display-xl">${esc(car.name)}</h1>
      </div>
      <div class="stage">
        ${photos.length ? `<img id="hero-photo" src="${esc(photos[0].file)}" alt="${esc(car.name)}">` : `<div class="no-photo">Pas de photo libre trouvée</div>`}
      </div>
      <div class="thumbs-band"><div class="wrap">
        ${photos.length > 1 ? `<div class="thumbs">${photos.map((photo, i) => `
          <button type="button" data-photo="${i}" aria-label="Voir la photo ${i + 1}" aria-current="${i === 0}">
            <img src="${esc(photo.file)}" alt="" loading="lazy">
          </button>`).join("")}</div>` : ""}
        ${photos.length ? `<div class="photo-bar">
          <p class="photo-credit" id="hero-credit">${esc(creditText(photos[0]))}</p>
          ${canEdit() && photos.length > 1 ? `<div id="main-photo-slot">${mainPhotoControl(car, 0)}</div>` : ""}
        </div>` : ""}
      </div></div>
    </section>
    ${cells ? `<div class="wrap"><div class="spec-strip">${cells}</div></div>` : ""}
    <section class="section">
      <div class="wrap detail-body">
        <div>
          ${car.summary ? `<h2 class="display-md">Présentation</h2>
            <p class="summary">${esc(car.summary)}</p>
            <p class="summary-source">Source : <a href="${esc(safeUrl(car.summary_url))}" target="_blank" rel="noopener">Wikipédia${car.summary_lang === "en" ? " (en anglais)" : ""}</a></p>` : ""}
          <div class="actions">
            ${compareButton(car)}
            ${canEdit() ? `<button type="button" class="text-link quiet" data-delete="${esc(car.slug)}">Retirer de ma collection</button>` : ""}
            ${isAdmin() ? `<a class="text-link" href="https://github.com/juancullati-web/CarPocket/edit/main/data/cars/${esc(car.slug)}.json" target="_blank" rel="noopener">Corriger cette fiche ›</a>
            <button type="button" class="text-link quiet" data-remove-sheet="${esc(titleOf(car))}">Supprimer la fiche pour tout le monde</button>` : ""}
          </div>
        </div>
        <div>
          ${car.variant ? `<p class="note">Ce modèle a plusieurs générations. Cette fiche décrit la version <strong>${esc(car.variant)}</strong>.</p>` : ""}
          ${SPEC_GROUPS.map(([title, rows]) => `<section class="spec-group">
            <h3>${title}</h3>
            <dl>${rows.map(([key, label]) => specRow(car, key, label)).join("")}</dl>
          </section>`).join("")}
          ${hasTextValues ? `<p class="legend">* Valeur extraite du texte de l'article, à vérifier. Elle peut concerner une autre version du modèle.</p>` : ""}
        </div>
      </div>
    </section>
    ${photos.length ? `<section class="credits"><div class="wrap">
      <h2>Crédits photos</h2>
      <ol>${photos.map((photo) => `<li>${esc(photo.author)}, ${safeUrl(photo.license_url)
        ? `<a href="${esc(photo.license_url)}" target="_blank" rel="noopener">${esc(photo.license)}</a>`
        : esc(photo.license)}${safeUrl(photo.source_url)
        ? ` (<a href="${esc(photo.source_url)}" target="_blank" rel="noopener">Wikimedia Commons</a>)` : ""}</li>`).join("")}</ol>
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
    return `<td class="${c.num === best && best !== null ? "best" : ""}">${esc(c.text)}${c.star ? STAR : ""}</td>`;
  }).join("")}</tr>`;
}

function compareHtml(cars) {
  const sameSprint = new Set(cars.map((c) => sprintParts(c).target).filter(Boolean)).size === 1;
  const specCell = (key, better) => (car) => {
    const spec = car.specs[key];
    return { text: spec?.value, star: spec?.from_text, num: better ? numberIn(spec?.value) : null, better };
  };
  const key = [
    compareRow("Année", cars, (c) => ({ text: c.year })),
    compareRow("Puissance", cars, (c) => ({ text: c.power_ch && `${c.power_ch} ch`, num: c.power_ch, star: c.specs.power?.from_text, better: "high" })),
    compareRow("Poids/puissance", cars, (c) => ({ text: ratioOf(c) && `${ratioOf(c)} ch/t`, num: ratioOf(c), star: c.specs.power?.from_text, better: "high" })),
    compareRow("Vitesse maximale", cars, specCell("top_speed", "high")),
    compareRow("Accélération", cars, (c) => ({
      text: c.specs.zero_100?.value,
      star: c.specs.zero_100?.from_text,
      num: sameSprint ? sprintParts(c).time : null,
      better: sameSprint ? "low" : undefined,
    })),
    compareRow("Poids", cars, (c) => ({ text: c.weight_kg && `${c.weight_kg} kg`, num: c.weight_kg, star: c.specs.weight?.from_text, better: "low" })),
  ].join("");
  const shown = new Set(["top_speed", "zero_100", "weight", "power"]);
  const groups = SPEC_GROUPS.map(([title, rows]) => {
    const rest = rows.filter(([k]) => !shown.has(k));
    if (!rest.length) return "";
    return `<tr class="group"><th colspan="${cars.length + 1}" scope="colgroup">${title}</th></tr>`
      + rest.map(([k, label]) => compareRow(label, cars, specCell(k))).join("");
  }).join("");

  return `<section class="compare-head"><div class="wrap">
      <a class="back" href="#">‹ Mon deck</a>
      <h1 class="display-xl">Comparaison</h1>
    </div></section>
    <section class="section"><div class="wrap">
      <div class="compare-scroll"><table class="compare-table">
        <thead><tr>
          <td></td>
          ${cars.map((car) => `<th scope="col" class="compare-car">
            ${car.photos[0] ? `<img src="${esc(car.photos[0].file)}" alt="">` : ""}
            <a href="#${esc(car.slug)}">${esc(car.name)}</a>
            <button type="button" class="text-link quiet" data-uncompare="${esc(car.slug)}">Retirer</button>
          </th>`).join("")}
        </tr></thead>
        <tbody>${key}${groups}</tbody>
      </table></div>
      <p class="legend">En bleu : la meilleure valeur. * Valeur extraite du texte de l'article, à vérifier.</p>
    </div></section>`;
}

function renderCompareBar() {
  const count = state.compare.length;
  const onCompare = location.hash.startsWith("#comparer:");
  const bar = el("compare-bar");
  bar.hidden = count === 0 || onCompare;
  document.body.classList.toggle("has-compare-bar", !bar.hidden);
  if (bar.hidden) return;
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
  if (state.user && !state.viewing) save(`compare.${state.user.id}`, list);
}

function toggleCompare(slug) {
  if (state.compare.includes(slug)) {
    setCompare(state.compare.filter((s) => s !== slug));
  } else if (state.compare.length >= MAX_COMPARE) {
    state.compareFull = true;
  } else {
    setCompare([...state.compare, slug]);
  }
}

/* Navigation */
function renderRoute() {
  const hash = decodeURIComponent(location.hash.slice(1));
  let compareCars = null;
  if (hash.startsWith("comparer:")) {
    compareCars = hash.slice(9).split(",").map(carBySlug).filter(Boolean).slice(0, MAX_COMPARE);
    if (compareCars.length < 2) compareCars = null;
  }
  const accounts = hash === "comptes" && isAdmin();
  const profile = hash === "profil" && Boolean(state.user);
  const car = carBySlug(hash) || null;
  el("library").hidden = Boolean(car || compareCars || accounts || profile);
  el("profile").hidden = !profile;
  el("detail").hidden = !car;
  el("compare").hidden = !compareCars;
  el("accounts").hidden = !accounts;
  document.title = car ? `${car.name} · CarPocket` : compareCars ? "Comparaison · CarPocket" : accounts ? "Comptes · CarPocket" : profile ? "Mon profil · CarPocket" : "CarPocket";
  if (car) el("detail").innerHTML = detailHtml(car);
  if (compareCars) el("compare").innerHTML = compareHtml(compareCars);
  if (accounts) renderAccounts();
  if (profile) renderProfile();
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
  state.compare = state.compare.filter((slug) => carBySlug(slug));
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
  const { data, error } = await db.from("deck_items").insert(row).select("title, thumb, main_photo, added_at").single();
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

async function chooseMainPhoto(car, index) {
  const file = car.photos[index]?.file;
  if (!file) return;
  const title = titleOf(car);
  const { error } = await db.from("deck_items").update({ main_photo: file })
    .eq("user_id", state.user.id).eq("title", title);
  if (error) {
    const slot = el("main-photo-slot");
    if (slot) slot.innerHTML = `<span class="main-photo-state failed">Le choix n'a pas pu être enregistré. Réessaie.</span>`;
    return;
  }
  state.items = state.items.map((item) => (item.title === title ? { ...item, main_photo: file } : item));
  renderAll();
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
  button.title = label;
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
const toEmail = (username) => `${username.trim().toLowerCase()}@${LOGIN_DOMAIN}`;

async function enterApp(session) {
  const { data: profile, error } = await db.from("profiles")
    .select("id, username, role, avatar").eq("id", session.user.id).single();
  if (error) throw error;
  state.user = profile;
  state.viewing = null;
  state.catalog = await fetchCatalog();
  await loadItems();
  state.compare = load(`compare.${profile.id}`, []).slice(0, MAX_COMPARE);
  state.compare = state.compare.filter((slug) => carBySlug(slug));
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
  await db.auth.signOut();
  Object.assign(state, { user: null, viewing: null, items: [], cars: [], compare: [], accounts: [] });
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
    el("profile-count").textContent = plural(deck().length + pendingItems().length, "voiture");
    return;
  }
  profileRendered = true;
  el("profile").innerHTML = `<section class="compare-head"><div class="wrap">
      <a class="back" href="#">‹ Mon deck</a>
      <h1 class="display-xl">Mon profil</h1>
    </div></section>
    <section class="section"><div class="wrap profile-layout">
      <dl class="profile-facts">
        <div class="spec-row"><dt>Identifiant</dt><dd>${esc(state.user.username)}</dd></div>
        <div class="spec-row"><dt>Rôle</dt><dd>${isAdmin() ? "Administrateur" : "Membre"}</dd></div>
        <div class="spec-row"><dt>Collection</dt><dd id="profile-count">${plural(deck().length + pendingItems().length, "voiture")}</dd></div>
      </dl>
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
  const { data: profiles, error } = await db.from("profiles").select("id, username, role, avatar").order("username");
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
          <td><span class="account-name"><span class="account-avatar">${avatarHtml(p.avatar, p.username)}</span>${esc(p.username)}</span></td>
          <td>${p.role === "admin" ? "Administrateur" : "Membre"}</td>
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
  const username = el("account-username").value.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
    accountNotice(`Compte créé. Identifiant de connexion : ${username}`);
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
      text: "Elle disparaît de ta collection. Tu pourras l'ajouter de nouveau, mais ton choix de photo sera perdu.",
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
      title: `Nouveau mot de passe pour ${account.username}`,
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
      title: `Supprimer le compte ${account.username} ?`,
      text: "Le compte et sa collection seront effacés. C'est irréversible. Les fiches partagées restent.",
      label: "Supprimer",
      action: async () => {
        await server("delete-user", { user_id: account.id });
        await renderAccounts();
      },
    });
    return;
  }
  const leave = event.target.closest("#viewing-leave");
  if (leave) {
    viewCollection(null);
    return;
  }
  const compare = event.target.closest("[data-compare]");
  if (compare) {
    toggleCompare(compare.dataset.compare);
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

async function viewCollection(userId) {
  const account = state.accounts.find((p) => p.id === userId);
  state.viewing = account && account.id !== state.user.id ? account : null;
  el("viewing-name").textContent = state.viewing ? `Tu regardes la collection de ${state.viewing.username}, sans pouvoir la modifier.` : "";
  try {
    await loadItems();
  } catch { /* la liste reste vide : le message de collection vide s'affiche */ }
  showroom.key = "";
  setCompare([]);
  if (location.hash) location.hash = "";
  renderAll();
}

el("compare-clear").addEventListener("click", () => {
  setCompare([]);
  renderHero();
  renderLibrary();
  renderRoute();
  renderCompareBar();
});

el("detail").addEventListener("click", (event) => {
  const car = carBySlug(decodeURIComponent(location.hash.slice(1)));
  const main = event.target.closest("[data-main-photo]");
  if (main && car) {
    chooseMainPhoto(car, Number(main.dataset.mainPhoto));
    return;
  }
  const button = event.target.closest("[data-photo]");
  if (!button) return;
  const photo = car.photos[Number(button.dataset.photo)];
  el("hero-photo").src = photo.file;
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
window.addEventListener("hashchange", route);

async function start() {
  // Efface la clé GitHub et les données de l'ancienne version du site.
  ["token", "pending", "removing", "mainPhotos", "compare"].forEach((key) => save(key, null));
  const { data } = await db.auth.getSession();
  if (data.session) {
    try {
      await enterApp(data.session);
      return;
    } catch { /* on revient à la page de connexion */ }
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
