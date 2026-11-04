"use strict";

const SPEC_GROUPS = [
  ["Moteur", [["engine", "Moteur"], ["power", "Puissance"], ["torque", "Couple"], ["transmission", "Boîte"], ["layout", "Architecture"]]],
  ["Performances", [["top_speed", "Vitesse maximale"], ["zero_100", "Accélération"]]],
  ["Gabarit", [["weight", "Poids"], ["length", "Longueur"], ["width", "Largeur"], ["height", "Hauteur"], ["wheelbase", "Empattement"], ["body", "Carrosserie"]]],
  ["Histoire", [["production", "Production"], ["designer", "Design"], ["assembly", "Assemblage"]]],
];

const el = (id) => document.getElementById(id);
const state = { cars: [] };

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Seuls les liens http(s) des données sont rendus cliquables. */
const safeUrl = (url) => (/^https?:\/\//i.test(url || "") ? url : "");

const ratioOf = (car) =>
  car.power_ch && car.weight_kg ? Math.round((car.power_ch / car.weight_kg) * 1000) : null;

const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;

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
  const figure = (label, value) => `<div><dt>${label}</dt><dd>${value ?? "–"}</dd></div>`;
  return `<div class="card-wrap"><a class="card" href="#${esc(car.slug)}">
    <div class="card-photo">
      ${photo ? `<img src="${esc(photo.file)}" alt="${esc(car.name)}" loading="lazy">` : `<div class="no-photo">Pas de photo libre trouvée</div>`}
      ${car.example ? `<span class="tag">Exemple</span>` : ""}
    </div>
    <p class="card-brand">${esc(car.brand)}</p>
    <h2>${esc(car.name)}</h2>
    <dl class="figures">
      ${figure("Année", car.year)}
      ${figure("Puissance", car.power_ch ? `${car.power_ch} ch` : null)}
      ${figure("Poids", car.weight_kg ? `${car.weight_kg} kg` : null)}
    </dl>
  </a>
  <button type="button" class="card-delete" data-delete="${esc(car.slug)}" aria-label="Supprimer ${esc(car.name)}">Supprimer</button>
  </div>`;
}

const SORTERS = {
  added: (a, b) => (b.added || "").localeCompare(a.added || "") || a.name.localeCompare(b.name),
  name: (a, b) => a.name.localeCompare(b.name, "fr"),
  power: (a, b) => (b.power_ch ?? -1) - (a.power_ch ?? -1),
  ratio: (a, b) => (ratioOf(b) ?? -1) - (ratioOf(a) ?? -1),
  year: (a, b) => (b.year ?? -1) - (a.year ?? -1),
};

function renderLibrary() {
  const query = el("search").value.trim().toLowerCase();
  const brand = el("brand").value;
  const visible = state.cars
    .filter((car) => !brand || car.brand === brand)
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
  const mark = spec.from_text
    ? `<abbr class="mark" title="Extrait du texte de l'article : à vérifier">*</abbr>`
    : "";
  return `<div class="spec-row"><dt>${label}</dt><dd>${esc(spec.value)}${mark}</dd></div>`;
}

function creditText(photo) {
  return `Photo : ${photo.author}, ${photo.license}`;
}

function detailHtml(car) {
  const ratio = ratioOf(car);
  const hasTextValues = Object.values(car.specs).some((s) => s.from_text);
  const repo = repository();
  const photos = car.photos;

  return `<a class="back" href="#">← Toutes les voitures</a>
    <header class="detail-head">
      <div>
        <p class="card-brand">${esc(car.brand)}${car.example ? ` <span class="tag">Exemple</span>` : ""}</p>
        <h1>${esc(car.name)}</h1>
      </div>
    </header>
    <div class="detail-layout">
      <div>
        <div class="hero-photo">
          ${photos.length ? `<img id="hero" src="${esc(photos[0].file)}" alt="${esc(car.name)}">` : `<div class="no-photo">Pas de photo libre trouvée</div>`}
        </div>
        ${photos.length > 1 ? `<div class="thumbs">${photos.map((photo, i) => `
          <button type="button" data-photo="${i}" aria-label="Voir la photo ${i + 1}" aria-current="${i === 0}">
            <img src="${esc(photo.file)}" alt="" loading="lazy">
          </button>`).join("")}</div>` : ""}
        ${photos.length ? `<p class="photo-credit" id="hero-credit">${esc(creditText(photos[0]))}</p>` : ""}
        ${car.summary ? `<p class="summary">${esc(car.summary)}</p>
          <p class="summary-source">Source : <a href="${esc(safeUrl(car.summary_url))}" target="_blank" rel="noopener">Wikipédia${car.summary_lang === "en" ? " (en anglais)" : ""}</a></p>` : ""}
      </div>
      <div>
        ${car.variant ? `<p class="note">Ce modèle a plusieurs générations. Cette fiche décrit la version <strong>${esc(car.variant)}</strong>.</p>` : ""}
        ${ratio ? `<div class="ratio"><strong>${ratio}</strong><span>ch par tonne</span></div>` : ""}
        ${SPEC_GROUPS.map(([title, rows]) => `<section class="spec-group">
          <h2>${title}</h2>
          <dl>${rows.map(([key, label]) => specRow(car, key, label)).join("")}</dl>
        </section>`).join("")}
        ${hasTextValues ? `<p class="legend">* Valeur extraite du texte de l'article, à vérifier. Elle peut concerner une autre version du modèle.</p>` : ""}
        <div class="actions">
          ${repo ? `<a href="${esc(`${repo}/edit/main/data/cars/${car.slug}.json`)}" target="_blank" rel="noopener">Corriger cette fiche</a>` : ""}
          <button type="button" class="danger-link" data-delete="${esc(car.slug)}">Supprimer cette voiture</button>
        </div>
      </div>
    </div>
    ${photos.length ? `<section class="credits">
      <h2>Crédits photos</h2>
      <ol>${photos.map((photo) => `<li>${esc(photo.author)}, ${safeUrl(photo.license_url)
        ? `<a href="${esc(photo.license_url)}" target="_blank" rel="noopener">${esc(photo.license)}</a>`
        : esc(photo.license)}${safeUrl(photo.source_url)
        ? ` (<a href="${esc(photo.source_url)}" target="_blank" rel="noopener">Wikimedia Commons</a>)` : ""}</li>`).join("")}</ol>
    </section>` : ""}`;
}

function route() {
  const slug = decodeURIComponent(location.hash.slice(1));
  const car = state.cars.find((c) => c.slug === slug);
  el("library").hidden = Boolean(car);
  el("detail").hidden = !car;
  document.title = car ? `${car.name} · Carnet de garage` : "Carnet de garage";
  if (car) el("detail").innerHTML = detailHtml(car);
  window.scrollTo(0, 0);
}

el("detail").addEventListener("click", (event) => {
  const button = event.target.closest("[data-photo]");
  if (!button) return;
  const car = state.cars.find((c) => c.slug === decodeURIComponent(location.hash.slice(1)));
  const photo = car.photos[Number(button.dataset.photo)];
  el("hero").src = photo.file;
  el("hero-credit").textContent = creditText(photo);
  el("detail").querySelectorAll("[data-photo]").forEach((b) => b.setAttribute("aria-current", String(b === button)));
});

["search", "brand", "sort"].forEach((id) => el(id).addEventListener("input", renderLibrary));
window.addEventListener("hashchange", route);

const dialog = el("add-dialog");
el("open-add").addEventListener("click", () => {
  el("add-hint").hidden = Boolean(repository());
  el("add-submit").disabled = !repository();
  dialog.showModal();
  el("add-name").focus();
});
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
  fillBrands();
  renderLibrary();
  if (location.hash.slice(1) === slug) location.hash = "";
});

function fillBrands() {
  const select = el("brand");
  const current = select.value;
  const brands = [...new Set(state.cars.map((car) => car.brand))].sort((a, b) => a.localeCompare(b, "fr"));
  select.innerHTML = `<option value="">Toutes</option>` + brands.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("");
  select.value = brands.includes(current) ? current : "";
}

async function start() {
  try {
    const response = await fetch("cars.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(String(response.status));
    state.cars = await response.json();
  } catch {
    el("count").textContent = "Impossible de charger les voitures. Recharge la page dans un instant.";
    return;
  }
  fillBrands();
  renderLibrary();
  route();
}

start();
