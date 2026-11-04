"use strict";

const SPEC_GROUPS = [
  ["Moteur", [["engine", "Moteur"], ["power", "Puissance"], ["torque", "Couple"], ["transmission", "Boîte"], ["layout", "Architecture"]]],
  ["Performances", [["top_speed", "Vitesse maximale"], ["zero_100", "Accélération"]]],
  ["Gabarit", [["weight", "Poids"], ["length", "Longueur"], ["width", "Largeur"], ["height", "Hauteur"], ["wheelbase", "Empattement"], ["body", "Carrosserie"]]],
  ["Histoire", [["production", "Production"], ["designer", "Design"], ["assembly", "Assemblage"]]],
];
const MAX_COMPARE = 3;
const POLL_MS = 15000;
const TIMEOUT_MS = 20 * 60 * 1000;

const el = (id) => document.getElementById(id);
const state = { cars: [], brand: "", pending: [], removing: [], compare: [], mainPhotos: [] };

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

/* Où envoyer les changements */
const isLocal = () => ["localhost", "127.0.0.1"].includes(location.hostname);

/** Le dépôt se déduit de l'adresse GitHub Pages : <compte>.github.io/<dépôt>/. */
function repository() {
  const host = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const repo = location.pathname.split("/").filter(Boolean)[0];
  return host && repo ? { owner: host[1], name: repo } : null;
}
const token = () => load("token", null);
const canEdit = () => isLocal() || Boolean(token());

async function github(path, options = {}) {
  const repo = repository();
  return fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${options.tokenOverride || token()}`,
      ...(options.headers || {}),
    },
  });
}

/** Lance le robot. Renvoie false si la clé doit être redonnée. */
async function runRobot(workflow, name) {
  const response = await github(`/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { name } }),
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) return false;
  if (!response.ok) throw new Error(String(response.status));
  return true;
}

function requireLogin(message) {
  save("token", null);
  renderSession();
  openLogin(message);
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
        ${canEdit() ? `<button type="button" class="text-link quiet" data-delete="${esc(car.slug)}" aria-label="Supprimer ${esc(car.name)}">Supprimer</button>` : ""}
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
      <h3>${esc(item.name)}</h3>
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

/** Les voitures qu'on doit afficher : celles en cours de retrait sont déjà masquées. */
function deck() {
  const removing = new Set(state.removing.map((r) => r.name));
  return state.cars.filter((car) => !removing.has(car.name));
}

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

  el("grid").innerHTML = state.pending.map(pendingCardHtml).join("") + visible.map(cardHtml).join("");
  el("count").textContent = visible.length === all.length
    ? plural(all.length, "voiture")
    : `${visible.length} sur ${plural(all.length, "voiture")}`;

  const empty = el("empty");
  empty.hidden = visible.length + state.pending.length > 0;
  empty.textContent = all.length
    ? "Aucune voiture ne correspond à cette recherche."
    : "Ton deck est vide pour l'instant.";
}

function renderSession() {
  const edit = canEdit();
  el("open-add").hidden = !edit && !repository();
  el("open-add").textContent = edit ? "Ajouter une voiture" : "Connexion";
  el("cta-band").hidden = !edit;
  const button = el("session-button");
  button.hidden = isLocal() || !edit;
  button.textContent = "Déconnecter cet appareil";
}

function renderAll() {
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
  const repo = repository();
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
            ${repo && canEdit() ? `<a class="text-link" href="${esc(`https://github.com/${repo.owner}/${repo.name}/edit/main/data/cars/${car.slug}.json`)}" target="_blank" rel="noopener">Corriger cette fiche ›</a>` : ""}
            ${canEdit() ? `<button type="button" class="text-link quiet" data-delete="${esc(car.slug)}">Supprimer cette voiture</button>` : ""}
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
  save("compare", list);
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
  const removing = new Set(state.removing.map((r) => r.name));
  let compareCars = null;
  if (hash.startsWith("comparer:")) {
    compareCars = hash.slice(9).split(",").map(carBySlug).filter(Boolean).slice(0, MAX_COMPARE);
    if (compareCars.length < 2) compareCars = null;
  }
  const found = carBySlug(hash);
  const car = found && !removing.has(found.name) ? found : null;
  el("library").hidden = Boolean(car || compareCars);
  el("detail").hidden = !car;
  el("compare").hidden = !compareCars;
  document.title = car ? `${car.name} · CarPocket` : compareCars ? "Comparaison · CarPocket" : "CarPocket";
  if (car) el("detail").innerHTML = detailHtml(car);
  if (compareCars) el("compare").innerHTML = compareHtml(compareCars);
}

function route() {
  renderRoute();
  renderCompareBar();
  window.scrollTo(0, 0);
}

/* Ajout et suppression */
async function fetchCars() {
  const response = await fetch(`cars.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

function savePending() {
  save("pending", state.pending);
  save("removing", state.removing);
  save("mainPhotos", state.mainPhotos);
}

/** Affiche tout de suite la photo choisie, sans attendre la publication. */
function applyMainPhotos() {
  state.mainPhotos.forEach(({ slug, file }) => {
    const car = carBySlug(slug);
    const chosen = car?.photos.find((photo) => photo.file === file);
    if (chosen) car.photos = [chosen, ...car.photos.filter((photo) => photo !== chosen)];
  });
}

let pollTimer = null;
function schedulePoll() {
  clearTimeout(pollTimer);
  const running = state.pending.some((p) => p.status !== "failed") || state.removing.length || state.mainPhotos.length;
  if (running) pollTimer = setTimeout(poll, POLL_MS);
}

async function findFailedRuns() {
  if (isLocal() || !token()) return new Set();
  const response = await github("/actions/runs?event=workflow_dispatch&per_page=30");
  if (!response.ok) return new Set();
  const { workflow_runs: runs } = await response.json();
  // La tentative la plus récente pour chaque voiture fait foi.
  const latest = new Map();
  for (const run of runs) {
    if (!latest.has(run.display_title)) latest.set(run.display_title, run);
  }
  const failed = new Set();
  for (const item of state.pending) {
    const run = latest.get(`Ajout de ${item.name}`);
    if (run && Date.parse(run.created_at) >= item.at - 60000 && run.status === "completed" && run.conclusion === "failure") {
      failed.add(item.name);
    }
  }
  return failed;
}

async function findFailedPhotoRuns() {
  if (isLocal() || !token() || !state.mainPhotos.length) return new Set();
  const response = await github("/actions/runs?event=workflow_dispatch&per_page=30");
  if (!response.ok) return new Set();
  const { workflow_runs: runs } = await response.json();
  const failed = new Set();
  for (const { slug, at } of state.mainPhotos) {
    const run = runs.find((r) => r.display_title === `Photo de ${slug}`);
    if (run && Date.parse(run.created_at) >= at - 60000 && run.status === "completed" && run.conclusion === "failure") {
      failed.add(slug);
    }
  }
  return failed;
}

async function chooseMainPhoto(car, index) {
  const file = car.photos[index]?.file;
  if (!file) return;
  const slot = el("main-photo-slot");
  try {
    if (isLocal()) {
      const response = await fetch("/api/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: car.slug, file }),
      });
      if (!response.ok) throw new Error(String(response.status));
      state.cars = await fetchCars();
    } else {
      const response = await github("/actions/workflows/set-photo.yml/dispatches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main", inputs: { slug: car.slug, file } }),
      });
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        requireLogin("Cette clé n'est plus valable. Donne-en une nouvelle.");
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      state.mainPhotos = [...state.mainPhotos.filter((m) => m.slug !== car.slug), { slug: car.slug, file, at: Date.now() }];
      savePending();
      applyMainPhotos();
      schedulePoll();
    }
    renderAll();
  } catch {
    if (slot) slot.innerHTML = `<span class="main-photo-state failed">Le choix n'a pas pu être enregistré. Réessaie.</span>`;
  }
}

async function poll() {
  try {
    state.cars = await fetchCars();
  } catch { /* on réessaiera au prochain passage */ }
  // Une photo reste affichée jusqu'à sa publication, ou abandonnée si le robot a échoué.
  const failedPhotos = await findFailedPhotoRuns().catch(() => new Set());
  state.mainPhotos = state.mainPhotos.filter(({ slug, file, at }) => {
    const car = carBySlug(slug);
    return car && car.photos[0]?.file !== file && !failedPhotos.has(slug) && Date.now() - at < TIMEOUT_MS;
  });
  applyMainPhotos();
  const titles = new Set(state.cars.map(titleOf));
  const names = new Set(state.cars.map((c) => c.name));
  const failed = await findFailedRuns().catch(() => new Set());
  const now = Date.now();
  state.pending = state.pending
    .filter((p) => !titles.has(p.name))
    .map((p) => {
      if (failed.has(p.name)) return { ...p, status: "failed" };
      if (p.status === "failed") return p;
      return now - p.at > TIMEOUT_MS ? { ...p, status: "slow" } : p;
    });
  state.removing = state.removing.filter((r) => names.has(r.name) && now - r.at < TIMEOUT_MS);
  state.compare = state.compare.filter((s) => carBySlug(s));
  savePending();
  renderAll();
  schedulePoll();
}

async function addCar(name, thumb) {
  state.pending = [{ name, thumb, at: Date.now(), status: "running" }, ...state.pending.filter((p) => p.name !== name)];
  savePending();
  el("search").value = "";
  state.brand = "";
  if (location.hash) location.hash = "";
  renderAll();
  el("library-title").scrollIntoView();

  if (isLocal()) {
    try {
      const response = await fetch("/api/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(String(response.status));
      await poll();
    } catch {
      markFailed(name);
    }
    return;
  }
  try {
    if (!(await runRobot("add-car.yml", name))) {
      state.pending = state.pending.filter((p) => p.name !== name);
      savePending();
      renderLibrary();
      requireLogin("Cette clé n'est plus valable. Donne-en une nouvelle.");
      return;
    }
    schedulePoll();
  } catch {
    markFailed(name);
  }
}

function markFailed(name) {
  state.pending = state.pending.map((p) => (p.name === name ? { ...p, status: "failed" } : p));
  savePending();
  renderLibrary();
  schedulePoll();
}

/* Suggestions pendant la frappe */
const suggestCache = new Map();
let suggestTimer = null;
let suggestAbort = null;
let suggestItems = [];
let suggestIndex = -1;

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
    gsrlimit: "10",
    prop: "pageimages|description",
    piprop: "thumbnail",
    pithumbsize: "240",
    pilimit: "10",
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
  return deck().some((car) => titleOf(car) === name) || state.pending.some((p) => p.name === name);
}

function renderSuggestions() {
  const list = el("suggestions");
  list.innerHTML = suggestItems.map((item, i) => {
    const taken = inDeck(item.name);
    return `<li class="suggestion" id="suggestion-${i}" role="option" data-index="${i}" aria-selected="${i === suggestIndex}" aria-disabled="${taken}">
      <div class="suggestion-photo">${safeUrl(item.thumb) ? `<img src="${esc(item.thumb)}" alt="">` : ""}</div>
      <div><strong>${esc(item.name)}</strong><small>${taken ? "Déjà dans ton deck" : esc(item.description)}</small></div>
    </li>`;
  }).join("");
  const input = el("add-name");
  input.setAttribute("aria-expanded", String(suggestItems.length > 0));
  if (suggestIndex >= 0) input.setAttribute("aria-activedescendant", `suggestion-${suggestIndex}`);
  else input.removeAttribute("aria-activedescendant");
}

function setSuggestStatus(text) {
  el("suggest-status").textContent = text;
  el("suggest-status").hidden = !text;
}

el("add-name").addEventListener("input", () => {
  clearTimeout(suggestTimer);
  const query = el("add-name").value.trim();
  suggestIndex = -1;
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

function pickSuggestion(index) {
  const item = suggestItems[index];
  if (!item || inDeck(item.name)) return;
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
el("suggestions").addEventListener("click", (event) => {
  const item = event.target.closest("[data-index]");
  if (item) pickSuggestion(Number(item.dataset.index));
});
el("add-form").addEventListener("submit", (event) => event.preventDefault());
el("add-cancel").addEventListener("click", () => el("add-dialog").close());

function openAdd() {
  if (!canEdit()) {
    openLogin();
    return;
  }
  el("add-name").value = "";
  suggestItems = [];
  suggestIndex = -1;
  renderSuggestions();
  setSuggestStatus("Tape au moins deux lettres.");
  el("add-dialog").showModal();
  el("add-name").focus();
}
el("open-add").addEventListener("click", openAdd);
el("open-add-cta").addEventListener("click", openAdd);

/* Connexion de l'appareil */
function openLogin(message) {
  const repo = repository();
  if (!repo) return;
  const params = new URLSearchParams({
    name: "CarPocket",
    description: "Ajouter et supprimer des voitures depuis le site CarPocket",
    target_name: repo.owner,
    expires_in: "365",
    actions: "write",
  });
  el("login-link").href = `https://github.com/settings/personal-access-tokens/new?${params}`;
  el("login-error").hidden = !message;
  el("login-error").textContent = message || "";
  el("login-token").value = "";
  el("login-dialog").showModal();
}
el("login-cancel").addEventListener("click", () => el("login-dialog").close());
el("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = el("login-token").value.trim();
  if (!value) return;
  el("login-submit").disabled = true;
  try {
    const response = await github("/actions/workflows", { tokenOverride: value });
    if (!response.ok) {
      el("login-error").textContent = "Cette clé n'est pas acceptée. Vérifie qu'elle donne accès au dépôt CarPocket.";
      el("login-error").hidden = false;
      return;
    }
    save("token", value);
    el("login-dialog").close();
    renderAll();
  } catch {
    el("login-error").textContent = "GitHub ne répond pas. Réessaie dans un instant.";
    el("login-error").hidden = false;
  } finally {
    el("login-submit").disabled = false;
  }
});
el("session-button").addEventListener("click", () => {
  save("token", null);
  renderAll();
});

/* Suppression */
const deleteDialog = el("delete-dialog");
let carToDelete = null;

function showDeleteError(message) {
  el("delete-error").textContent = message;
  el("delete-error").hidden = false;
}

el("delete-cancel").addEventListener("click", () => deleteDialog.close());

el("delete-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!carToDelete) return;
  const car = carToDelete;
  el("delete-submit").disabled = true;
  try {
    if (isLocal()) {
      const response = await fetch("/api/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: car.slug }),
      });
      if (response.status === 501) {
        showDeleteError("Ce serveur ne sait pas supprimer. Lance le site avec : python3 scripts/serve.py");
        return;
      }
      if (!response.ok && response.status !== 404) {
        showDeleteError("La suppression a échoué. Rien n'a été effacé.");
        return;
      }
      state.cars = state.cars.filter((c) => c.slug !== car.slug);
    } else {
      if (!(await runRobot("remove-car.yml", car.name))) {
        deleteDialog.close();
        requireLogin("Cette clé n'est plus valable. Donne-en une nouvelle.");
        return;
      }
      state.removing = [...state.removing, { name: car.name, at: Date.now() }];
      savePending();
      schedulePoll();
    }
  } catch {
    showDeleteError("La suppression n'a pas pu être lancée. Rien n'a été effacé.");
    return;
  } finally {
    el("delete-submit").disabled = false;
  }
  setCompare(state.compare.filter((s) => s !== car.slug));
  deleteDialog.close();
  if (location.hash.slice(1) === car.slug) location.hash = "";
  renderAll();
});

/* Actions sur les cartes */
document.addEventListener("click", (event) => {
  const del = event.target.closest("[data-delete]");
  if (del) {
    carToDelete = carBySlug(del.dataset.delete);
    if (!carToDelete) return;
    el("delete-title").textContent = `Supprimer ${carToDelete.name} ?`;
    el("delete-text").textContent = "La fiche et les photos seront effacées. Tu pourras ajouter de nouveau cette voiture, mais tes corrections seront perdues.";
    el("delete-submit").disabled = false;
    el("delete-error").hidden = true;
    deleteDialog.showModal();
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
    const item = state.pending.find((p) => p.name === retry.dataset.retry);
    if (item) addCar(item.name, item.thumb);
    return;
  }
  const dismiss = event.target.closest("[data-dismiss]");
  if (dismiss) {
    state.pending = state.pending.filter((p) => p.name !== dismiss.dataset.dismiss);
    savePending();
    renderLibrary();
  }
});

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
  state.pending = load("pending", []);
  state.removing = load("removing", []);
  state.compare = load("compare", []);
  state.mainPhotos = load("mainPhotos", []);
  renderSession();
  try {
    state.cars = await fetchCars();
    applyMainPhotos();
  } catch {
    el("count").textContent = "Impossible de charger les voitures. Recharge la page dans un instant.";
    return;
  }
  state.compare = state.compare.filter((s) => carBySlug(s)).slice(0, MAX_COMPARE);
  renderAll();
  window.scrollTo(0, 0);
  if (state.pending.length || state.removing.length || state.mainPhotos.length) poll();
}

start();
