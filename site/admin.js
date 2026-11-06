/* L'espace d'administration : toutes les fiches, les indicateurs, la réserve et les comptes.
   Les règles de la base font foi : ce fichier n'affiche que ce que le compte a le droit de lire.
   Les collections ne servent ici qu'à compter : ni leurs notes ni leur contenu ne sont affichés. */
(() => {
  const TABS = [
    ["fiches", "Fiches", "#admin:fiches"],
    ["indicateurs", "Indicateurs", "#admin:indicateurs"],
    ["reserve", "Réserve", "#admin:reserve"],
    ["comptes", "Comptes", "#comptes"],
  ];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const LOW_FILL = 50;
  const box = () => el("admin");
  const list = { query: "", filter: "all", sort: "name" };
  let figures = null;
  let shownTab = "";

  const tabsHtml = (active) => `<section class="compare-head"><div class="wrap">
      <h1 class="display-xl">Administration</h1>
      <nav class="admin-tabs" aria-label="Sections de l'administration">
        ${TABS.map(([id, label, href]) => `<a href="${href}"${id === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      </nav>
    </div></section>`;

  /** Ne garde que les titres et les dates : compter ne demande pas de lire une collection. */
  async function loadFigures() {
    const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const [items, profiles, comments, reactions] = await Promise.all([
      db.from("deck_items").select("title, user_id, added_at"),
      db.from("profiles").select("id, shared"),
      db.from("car_comments").select("id", { count: "exact", head: true }).gte("created_at", since),
      db.from("car_reactions").select("owner_id", { count: "exact", head: true }).gte("created_at", since),
    ]);
    if (items.error || profiles.error) throw items.error || profiles.error;
    const decks = new Map();
    items.data.forEach((row) => decks.set(row.title, (decks.get(row.title) || 0) + 1));
    figures = {
      decks,
      total: items.data.length,
      owners: new Set(items.data.map((row) => row.user_id)).size,
      recent: items.data.filter((row) => row.added_at >= since).length,
      accounts: profiles.data.length,
      hidden: profiles.data.filter((row) => !row.shared).length,
      comments: comments.error ? null : comments.count,
      reactions: reactions.error ? null : reactions.count,
    };
  }

  const inDecks = (car) => figures?.decks.get(titleOf(car)) || 0;
  const SORTS = {
    name: (a, b) => a.name.localeCompare(b.name, "fr"),
    decks: (a, b) => inDecks(b) - inDecks(a) || a.name.localeCompare(b.name, "fr"),
    emptiest: (a, b) => completeness(a).percent - completeness(b).percent || a.name.localeCompare(b.name, "fr"),
    recent: (a, b) => String(b.updated || "").localeCompare(String(a.updated || "")) || a.name.localeCompare(b.name, "fr"),
  };
  const FILTERS = {
    all: () => true,
    nophoto: (car) => !car.photos?.length,
    low: (car) => completeness(car).percent < LOW_FILL,
    orphan: (car) => inDecks(car) === 0,
  };

  function sheetRows() {
    const query = list.query.trim().toLowerCase();
    const cars = state.catalog
      .filter(FILTERS[list.filter])
      .filter((car) => !query || `${car.name} ${car.brand}`.toLowerCase().includes(query))
      .sort(SORTS[list.sort]);
    el("admin-count").textContent = `${plural(cars.length, "fiche")} sur ${state.catalog.length}`;
    el("admin-rows").innerHTML = cars.length ? cars.map((car) => {
      const photo = car.photos?.[0];
      const { percent } = completeness(car);
      const decks = inDecks(car);
      const date = frenchDay(car.updated);
      return `<li class="admin-row">
        <a class="admin-row-photo" href="#${esc(car.slug)}" tabindex="-1" aria-hidden="true">${photo ? `<img src="${esc(photo.thumb || photo.file)}" alt="" loading="lazy">` : ""}</a>
        <div class="admin-row-main">
          <a class="admin-row-name" href="#${esc(car.slug)}">${esc(car.name)}</a>
          <p>${percent} % rempli · ${decks ? `dans ${plural(decks, "deck")}` : "dans aucun deck"}${photo ? "" : " · sans photo"}${date ? ` · mise à jour le ${date}` : ""}</p>
        </div>
        <button type="button" class="text-link" data-edit-sheet="${esc(car.slug)}" data-tip="Corriger les valeurs de cette fiche pour tout le monde">Corriger ›</button>
      </li>`;
    }).join("") : `<li class="admin-none">Aucune fiche ne correspond.</li>`;
  }

  function sheetsHtml() {
    const options = (pairs, value) => pairs.map(([id, label]) => `<option value="${id}"${id === value ? " selected" : ""}>${label}</option>`).join("");
    return `<section class="section"><div class="wrap">
      <div class="toolbar">
        <label class="field grow"><span class="label">Rechercher une fiche</span>
          <input id="admin-search" type="search" placeholder="Nom ou marque" autocomplete="off" value="${esc(list.query)}"></label>
        <label class="field"><span class="label">Afficher</span>
          <select id="admin-filter">${options([["all", "Toutes"], ["nophoto", "Sans photo"], ["low", `Remplies à moins de ${LOW_FILL} %`], ["orphan", "Dans aucun deck"]], list.filter)}</select></label>
        <label class="field"><span class="label">Trier par</span>
          <select id="admin-sort">${options([["name", "Nom"], ["decks", "Les plus présentes"], ["emptiest", "Les moins remplies"], ["recent", "Mises à jour récentes"]], list.sort)}</select></label>
      </div>
      <p class="admin-count" id="admin-count" role="status"></p>
      <ul class="admin-rows" id="admin-rows"></ul>
    </div></section>`;
  }

  function tile(value, label, detail = "") {
    return `<div class="admin-figure"><strong>${value === null ? "Non disponible" : esc(String(value))}</strong><span>${esc(label)}</span>${detail ? `<small>${esc(detail)}</small>` : ""}</div>`;
  }

  function figuresHtml() {
    const cars = state.catalog;
    const fill = cars.length ? Math.round(cars.reduce((sum, car) => sum + completeness(car).percent, 0) / cars.length) : 0;
    const noPhoto = cars.filter(FILTERS.nophoto).length;
    const orphans = cars.filter(FILTERS.orphan).length;
    const top = [...cars].sort(SORTS.decks).filter((car) => inDecks(car)).slice(0, 5);
    return `<section class="section"><div class="wrap admin-groups">
      <div><h2 class="display-sm">Comptes</h2><div class="admin-figures">
        ${tile(figures.accounts, "comptes", figures.hidden ? `dont ${figures.hidden} avec une collection masquée` : "")}
        ${tile(figures.owners, "ont au moins une voiture")}
      </div></div>
      <div><h2 class="display-sm">Catalogue</h2><div class="admin-figures">
        ${tile(cars.length, "fiches")}
        ${tile(`${fill} %`, "de remplissage moyen", "Rempli ne veut pas dire vérifié.")}
        ${tile(noPhoto, "sans photo")}
        ${tile(orphans, "dans aucun deck")}
      </div></div>
      <div><h2 class="display-sm">Activité sur 30 jours</h2><div class="admin-figures">
        ${tile(figures.recent, "voitures ajoutées")}
        ${tile(figures.comments, "commentaires")}
        ${tile(figures.reactions, "réactions")}
        ${tile(figures.total, "voitures dans les decks", "au total, tous comptes confondus")}
      </div></div>
      <div><h2 class="display-sm">Les plus présentes</h2>
        ${top.length ? `<ol class="admin-top">${top.map((car) => `<li><a href="#${esc(car.slug)}">${esc(car.name)}</a><span>${plural(inDecks(car), "deck")}</span></li>`).join("")}</ol>` : `<p class="admin-none">Aucune voiture dans les decks.</p>`}
      </div>
    </div></section>`;
  }

  const reserveHtml = () => `<section class="section"><div class="wrap admin-empty">
      <h2 class="display-sm">La réserve n'existe pas encore</h2>
      <p>Elle arrivera avec les boosters. Tu y verras les voitures restantes, le prochain renouvellement, et tu pourras retirer une voiture ou la passer en remarquable.</p>
    </div></section>`;

  async function render(tab) {
    const known = TABS.some(([id]) => id === tab) && tab !== "comptes";
    const active = known ? tab : "fiches";
    const target = box();
    // Une actualisation du site ne doit pas effacer une recherche en cours.
    if (shownTab === active && target.contains(document.activeElement) && document.activeElement.id === "admin-search") return;
    shownTab = active;
    if (active === "reserve") {
      target.innerHTML = tabsHtml(active) + reserveHtml();
      return;
    }
    if (!figures) target.innerHTML = `${tabsHtml(active)}<section class="section"><div class="wrap"><p class="admin-none">Chargement…</p></div></section>`;
    try {
      if (!figures) await loadFigures();
    } catch {
      target.innerHTML = `${tabsHtml(active)}<section class="section"><div class="wrap"><p class="notice failed">Ces informations n'ont pas pu être chargées. Réessaie dans un instant.</p></div></section>`;
      return;
    }
    if (shownTab !== active) return;
    target.innerHTML = tabsHtml(active) + (active === "fiches" ? sheetsHtml() : figuresHtml());
    if (active === "fiches") sheetRows();
  }

  box().addEventListener("input", (event) => {
    if (event.target.id === "admin-search") list.query = event.target.value;
    else if (event.target.id === "admin-filter") list.filter = event.target.value;
    else if (event.target.id === "admin-sort") list.sort = event.target.value;
    else return;
    sheetRows();
  });
  window.addEventListener("hashchange", () => {
    // Revenir à l'administration après un changement ailleurs doit montrer des chiffres à jour.
    if (!decodeURIComponent(location.hash.slice(1)).startsWith("admin")) {
      figures = null;
      shownTab = "";
    }
  });

  /* La correction d'une fiche : seuls les champs changés partent, et la base du site ne change qu'après publication. */
  let editing = null;
  function openSheetEditor(slug) {
    const car = catalogCar(slug);
    if (!car) return;
    editing = car;
    el("sheet-title").textContent = `Corriger ${car.name}`;
    el("sheet-error").hidden = true;
    el("sheet-fields").innerHTML = SPEC_GROUPS.map(([title, rows]) => `<fieldset>
      <legend>${title}</legend>
      ${rows.map(([key, label]) => `<label class="field"><span class="label">${label}</span>
        <input data-sheet-key="${key}" maxlength="200" autocomplete="off" value="${esc(car.specs[key]?.value || "")}"></label>`).join("")}
    </fieldset>`).join("");
    el("sheet-dialog").showModal();
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-sheet]");
    if (button && isAdmin()) openSheetEditor(button.dataset.editSheet);
  });
  el("sheet-cancel").addEventListener("click", () => el("sheet-dialog").close());
  el("sheet-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const changes = {};
    el("sheet-fields").querySelectorAll("[data-sheet-key]").forEach((input) => {
      const value = input.value.trim();
      if (value !== (editing.specs[input.dataset.sheetKey]?.value || "")) changes[input.dataset.sheetKey] = value;
    });
    if (!Object.keys(changes).length) {
      el("sheet-dialog").close();
      return;
    }
    const submit = el("sheet-submit");
    submit.disabled = true;
    el("sheet-error").hidden = true;
    try {
      await server("edit-sheet", { slug: editing.slug, changes });
      el("sheet-dialog").close();
      showToast(`Correction envoyée pour ${esc(editing.name)}. Elle sera visible après la publication, dans quelques minutes.`);
    } catch (error) {
      el("sheet-error").textContent = error.message || "La correction n'a pas pu être envoyée. Réessaie dans un instant.";
      el("sheet-error").hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  window.CarPocketAdmin = { render, tabsHtml };
  if (isAdmin() && decodeURIComponent(location.hash.slice(1)).startsWith("admin")) renderRoute();
})();
