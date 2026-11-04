"use strict";

const SPEC_GROUPS = [
  ["Moteur", [["engine", "Moteur"], ["power", "Puissance"], ["torque", "Couple"], ["transmission", "Boîte"], ["layout", "Architecture"]]],
  ["Performances", [["top_speed", "Vitesse maximale"], ["zero_100", "Accélération"]]],
  ["Gabarit", [["weight", "Poids"], ["length", "Longueur"], ["width", "Largeur"], ["height", "Hauteur"], ["wheelbase", "Empattement"], ["body", "Carrosserie"]]],
  ["Histoire", [["production", "Production"], ["designer", "Design"], ["assembly", "Assemblage"]]],
];

const el = (id) => document.getElementById(id);
const state = { cars: [], brand: "" };

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Seuls les liens http(s) des données sont rendus cliquables. */
const safeUrl = (url) => (/^https?:\/\//i.test(url || "") ? url : "");

const ratioOf = (car) =>
  car.power_ch && car.weight_kg ? Math.round((car.power_ch / car.weight_kg) * 1000) : null;

const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;

const STAR = `<abbr class="mark" title="Extrait du texte de l'article : à vérifier">*</abbr>`;

/** Année, puissance et poids : seulement ce qui est connu. */
function tagline(car) {
  return [car.year, car.power_ch && `${car.power_ch} ch`, car.weight_kg && `${car.weight_kg} kg`]
    .filter(Boolean)
    .join(" · ");
}

/** Le dépôt se déduit de l'adresse GitHub Pages : <compte>.github.io/<dépôt>/. */
function repository() {
  const host = location.hostname.match(/^([^.]+)\.github\.io$/i);
  const repo = location.pathname.split("/").filter(Boolean)[0];
  return host && repo ? `https://github.com/${host[1]}/${repo}` : null;
}

function issueUrl(template, name) {
  const repo = repository();
  if (!repo) return null;
  return `${repo}/issues/new?template=${template}&nom=${encodeURIComponent(name)}`;
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
        <a class="text-link" href="#${esc(car.slug)}">Voir la fiche ›</a>
        <button type="button" class="text-link quiet" data-delete="${esc(car.slug)}" aria-label="Supprimer ${esc(car.name)}">Supprimer</button>
      </div>
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

/** À la une : la voiture la plus récemment ajoutée qui a une photo. */
function renderHero() {
  const car = [...state.cars].sort(SORTERS.added).find((c) => c.photos.length);
  const hero = el("hero");
  hero.hidden = !car;
  if (!car) return;
  hero.innerHTML = `<div class="hero-grid">
    <div class="hero-copy">
      <p class="label">${esc(car.brand)}</p>
      <h1 class="display-xl">${esc(car.name)}</h1>
      <p>${esc(tagline(car))}</p>
      <a class="button button-primary" href="#${esc(car.slug)}">Voir la fiche</a>
    </div>
    <div class="hero-photo"><img src="${esc(car.photos[0].file)}" alt="${esc(car.name)}"></div>
  </div>`;
}

function renderBrands() {
  const brands = [...new Set(state.cars.map((car) => car.brand))].sort((a, b) => a.localeCompare(b, "fr"));
  if (!brands.includes(state.brand)) state.brand = "";
  const chip = (value, label) =>
    `<button type="button" class="chip" data-brand="${esc(value)}" aria-pressed="${state.brand === value}">${esc(label)}</button>`;
  el("brands").innerHTML = chip("", "Toutes les marques") + brands.map((b) => chip(b, b)).join("");
}

function renderLibrary() {
  const query = el("search").value.trim().toLowerCase();
  const visible = state.cars
    .filter((car) => !state.brand || car.brand === state.brand)
    .filter((car) => {
      if (!query) return true;
      const specs = Object.values(car.specs).map((s) => s.value).join(" ");
      return `${car.name} ${car.brand} ${specs}`.toLowerCase().includes(query);
    })
    .sort(SORTERS[el("sort").value]);

  el("grid").innerHTML = visible.map(cardHtml).join("");
  el("count").textContent = visible.length === state.cars.length
    ? plural(state.cars.length, "voiture")
    : `${visible.length} sur ${plural(state.cars.length, "voiture")}`;

  const empty = el("empty");
  empty.hidden = visible.length > 0;
  empty.textContent = state.cars.length
    ? "Aucune voiture ne correspond à cette recherche."
    : "La bibliothèque est vide. Ajoute ta première voiture avec le bouton en haut.";
}

function specRow(car, key, label) {
  const spec = car.specs[key];
  if (!spec) {
    return `<div class="spec-row"><dt>${label}</dt><dd class="unknown">Non renseigné</dd></div>`;
  }
  return `<div class="spec-row"><dt>${label}</dt><dd>${esc(spec.value)}${spec.from_text ? STAR : ""}</dd></div>`;
}

/** Les chiffres clés sous la photo : seulement ceux qui sont connus. */
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

function detailHtml(car) {
  const hasTextValues = Object.values(car.specs).some((s) => s.from_text);
  const repo = repository();
  const photos = car.photos;
  const cells = specCells(car);

  return `<section class="detail-hero">
      <div class="wrap detail-title">
        <a class="back" href="#">‹ Toutes les voitures</a>
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
        ${photos.length ? `<p class="photo-credit" id="hero-credit">${esc(creditText(photos[0]))}</p>` : ""}
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
            ${repo ? `<a class="text-link" href="${esc(`${repo}/edit/main/data/cars/${car.slug}.json`)}" target="_blank" rel="noopener">Corriger cette fiche ›</a>` : ""}
            <button type="button" class="text-link quiet" data-delete="${esc(car.slug)}">Supprimer cette voiture</button>
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

function route() {
  const slug = decodeURIComponent(location.hash.slice(1));
  const car = state.cars.find((c) => c.slug === slug);
  el("library").hidden = Boolean(car);
  el("detail").hidden = !car;
  document.title = car ? `${car.name} · CarPocket` : "CarPocket";
  if (car) el("detail").innerHTML = detailHtml(car);
  window.scrollTo(0, 0);
}

el("detail").addEventListener("click", (event) => {
  const button = event.target.closest("[data-photo]");
  if (!button) return;
  const car = state.cars.find((c) => c.slug === decodeURIComponent(location.hash.slice(1)));
  const photo = car.photos[Number(button.dataset.photo)];
  el("hero-photo").src = photo.file;
  el("hero-credit").textContent = creditText(photo);
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

/* Ajout */
const dialog = el("add-dialog");
function openAdd() {
  el("add-hint").hidden = Boolean(repository());
  el("add-submit").disabled = !repository();
  dialog.showModal();
  el("add-name").focus();
}
el("open-add").addEventListener("click", openAdd);
el("open-add-cta").addEventListener("click", openAdd);
el("add-cancel").addEventListener("click", () => dialog.close());
el("add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const url = issueUrl("ajouter-voiture.yml", el("add-name").value.trim());
  if (url) window.open(url, "_blank", "noopener");
  dialog.close();
  el("add-name").value = "";
});

/* Suppression : directe sur ce Mac, par le formulaire GitHub une fois en ligne. */
const isLocal = () => ["localhost", "127.0.0.1"].includes(location.hostname);
const deleteDialog = el("delete-dialog");
let carToDelete = null;

function showDeleteError(message) {
  const error = el("delete-error");
  error.textContent = message;
  error.hidden = false;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;
  carToDelete = state.cars.find((car) => car.slug === button.dataset.delete);
  if (!carToDelete) return;
  el("delete-title").textContent = `Supprimer ${carToDelete.name} ?`;
  el("delete-text").textContent = isLocal()
    ? "La fiche et les photos seront effacées. Tu pourras ajouter de nouveau cette voiture, mais tes corrections seront perdues."
    : "Le formulaire s'ouvre sur GitHub. Valide-le : la voiture disparaît du site en deux minutes environ.";
  el("delete-submit").textContent = isLocal() ? "Supprimer" : "Continuer sur GitHub";
  el("delete-submit").disabled = false;
  el("delete-error").hidden = true;
  deleteDialog.showModal();
});

el("delete-cancel").addEventListener("click", () => deleteDialog.close());

el("delete-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!carToDelete) return;
  if (!isLocal()) {
    const url = issueUrl("retirer-voiture.yml", carToDelete.name);
    if (url) window.open(url, "_blank", "noopener");
    deleteDialog.close();
    return;
  }
  el("delete-submit").disabled = true;
  try {
    const response = await fetch("/api/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: carToDelete.slug }),
    });
    if (response.status === 501) {
      showDeleteError("Ce serveur ne sait pas supprimer. Lance le site avec : python3 scripts/serve.py");
      return;
    }
    if (!response.ok && response.status !== 404) {
      showDeleteError("La suppression a échoué. Rien n'a été effacé.");
      return;
    }
  } catch {
    showDeleteError("Le serveur local ne répond pas. Rien n'a été effacé.");
    return;
  } finally {
    el("delete-submit").disabled = false;
  }
  const slug = carToDelete.slug;
  state.cars = state.cars.filter((car) => car.slug !== slug);
  deleteDialog.close();
  renderHero();
  renderBrands();
  renderLibrary();
  if (location.hash.slice(1) === slug) location.hash = "";
});

async function start() {
  try {
    const response = await fetch("cars.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(String(response.status));
    state.cars = await response.json();
  } catch {
    el("count").textContent = "Impossible de charger les voitures. Recharge la page dans un instant.";
    return;
  }
  renderHero();
  renderBrands();
  renderLibrary();
  route();
}

start();
