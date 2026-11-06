/* L'espace d'administration : toutes les fiches, les indicateurs, la réserve et les comptes.
   Les règles de la base font foi : ce fichier n'affiche que ce que le compte a le droit de lire.
   Les collections ne servent ici qu'à compter : ni leurs notes ni leur contenu ne sont affichés. */
(() => {
  const TABS = [
    ["indicateurs", "Indicateurs", "#admin:indicateurs"],
    ["fiches", "Fiches", "#admin:fiches"],
    ["reserve", "Réserve", "#admin:reserve"],
    ["comptes", "Comptes", "#comptes"],
  ];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const LOW_FILL = 50;
  const box = () => el("admin");
  const PERIODS = [7, 30, 90];
  const list = { query: "", filter: "all", sort: "name", missing: "" };
  const fieldLabel = (key) => SPEC_GROUPS.flatMap(([, rows]) => rows).find(([id]) => id === key)?.[1] || key;
  let period = 30;
  let figures = null;
  let shownTab = "";

  const tabsHtml = (active) => `<section class="compare-head"><div class="wrap">
      <h1 class="display-xl">Administration</h1>
      <nav class="admin-tabs" aria-label="Sections de l'administration">
        ${TABS.map(([id, label, href]) => `<a href="${href}"${id === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      </nav>
    </div></section>`;

  /** Compter demande peu : le détail d'une collection masquée n'est jamais affiché, seulement compté. */
  async function loadFigures() {
    const since = new Date(Date.now() - 2 * PERIODS.at(-1) * DAY_MS).toISOString();
    const [items, profiles, comments, reactions] = await Promise.all([
      db.from("deck_items").select("title, user_id, added_at"),
      db.from("profiles").select("id, username, shared").order("username"),
      db.from("car_comments").select("id, owner_id, title, author_name, body, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
      db.from("car_reactions").select("owner_id, title, user_id, kind, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(1000),
    ]);
    if (items.error || profiles.error) throw items.error || profiles.error;
    const decks = new Map();
    items.data.forEach((row) => decks.set(row.title, (decks.get(row.title) || 0) + 1));
    figures = {
      decks,
      items: items.data,
      profiles: profiles.data,
      comments: comments.error ? null : comments.data,
      reactions: reactions.error ? null : reactions.data,
    };
  }
  const profileOf = (id) => figures.profiles.find((row) => row.id === id);
  const isShared = (id) => Boolean(profileOf(id)?.shared);
  const nameOf = (id) => {
    const account = profileOf(id);
    return account ? displayName(account.username) : "Compte supprimé";
  };
  /** Les lignes de la période, et le même nombre de jours juste avant, pour comparer. */
  function inPeriod(rows, field) {
    if (!rows) return { now: null, before: null };
    const start = Date.now() - period * DAY_MS;
    const previous = start - period * DAY_MS;
    const at = (row) => Date.parse(row[field]);
    return { now: rows.filter((row) => at(row) >= start), before: rows.filter((row) => at(row) >= previous && at(row) < start) };
  }
  function trend({ now, before }) {
    if (!now) return "";
    const gap = now.length - before.length;
    return gap === 0 ? `autant que les ${period} jours d'avant` : `${gap > 0 ? "+" : ""}${gap} par rapport aux ${period} jours d'avant`;
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
    missing: (car) => !car.specs?.[list.missing],
  };

  /* Les fiches de la réserve attendent leur booster : elles n'ont pas leur place dans cette liste. */
  const sheets = () => state.catalog.filter((car) => !car.reserve);
  const isCorrected = (car) => Object.values(car.specs || {}).some((spec) => spec.corrected);
  const removable = () => sheets().filter((car) => inDecks(car) === 0 && !isCorrected(car));

  function purgeBar() {
    const bar = el("admin-purge");
    const count = removable().length;
    bar.hidden = list.filter !== "orphan" || !count;
    bar.innerHTML = count ? `<button type="button" class="button button-secondary" id="admin-purge-button">Supprimer ${plural(count, "fiche")} sans deck</button>
      <span>Celles que tu as corrigées restent.</span>` : "";
  }

  function sheetRows() {
    const query = list.query.trim().toLowerCase();
    const cars = sheets()
      .filter(FILTERS[list.filter])
      .filter((car) => !query || `${car.name} ${car.brand}`.toLowerCase().includes(query))
      .sort(SORTS[list.sort]);
    el("admin-count").textContent = `${plural(cars.length, "fiche")} sur ${sheets().length}`;
    purgeBar();
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
        <div class="admin-row-actions">${photo ? "" : `<button type="button" class="text-link" data-add-photo="${esc(car.slug)}" data-tip="Choisir une photo libre pour cette fiche">Ajouter une photo ›</button>`}
          <button type="button" class="text-link" data-edit-sheet="${esc(car.slug)}" data-tip="Corriger les valeurs de cette fiche pour tout le monde">Corriger ›</button></div>
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
          <select id="admin-filter">${options([["all", "Toutes"], ["nophoto", "Sans photo"], ["low", `Remplies à moins de ${LOW_FILL} %`], ["orphan", "Dans aucun deck"], ...(list.missing ? [["missing", `Sans : ${fieldLabel(list.missing)}`]] : [])], list.filter)}</select></label>
        <label class="field"><span class="label">Trier par</span>
          <select id="admin-sort">${options([["name", "Nom"], ["decks", "Les plus présentes"], ["emptiest", "Les moins remplies"], ["recent", "Mises à jour récentes"]], list.sort)}</select></label>
      </div>
      <p class="admin-count" id="admin-count" role="status"></p>
      <div class="admin-purge" id="admin-purge" hidden></div>
      <ul class="admin-rows" id="admin-rows"></ul>
    </div></section>`;
  }

  function tile(value, label, href, detail = "") {
    const body = `<strong>${value === null ? "Non disponible" : esc(String(value))}</strong><span>${esc(label)}</span>${detail ? `<small>${esc(detail)}</small>` : ""}`;
    return value === null ? `<div class="admin-figure">${body}</div>` : `<a class="admin-figure" href="${href}">${body}<i aria-hidden="true">›</i></a>`;
  }
  const count = (rows) => (rows ? rows.length : null);

  function figuresHtml() {
    const cars = sheets();
    const fill = cars.length ? Math.round(cars.reduce((sum, car) => sum + completeness(car).percent, 0) / cars.length) : 0;
    const owners = new Set(figures.items.map((row) => row.user_id)).size;
    const hidden = figures.profiles.filter((row) => !row.shared).length;
    const added = inPeriod(figures.items, "added_at");
    const comments = inPeriod(figures.comments, "created_at");
    const reactions = inPeriod(figures.reactions, "created_at");
    const top = [...cars].sort(SORTS.decks).filter((car) => inDecks(car)).slice(0, 5);
    const brands = [...cars.reduce((map, car) => map.set(car.brand, (map.get(car.brand) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).slice(0, 5);
    const fields = SPEC_KEYS.map((key) => [key, cars.filter((car) => !car.specs?.[key]).length]).filter(([, missing]) => missing).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const ranked = (rows) => `<ol class="admin-top">${rows.join("")}</ol>`;
    return `<section class="section"><div class="wrap admin-groups">
      <div><div class="admin-group-head"><h2 class="display-sm">Activité</h2>
        <div class="admin-periods" role="group" aria-label="Période">${PERIODS.map((days) => `<button type="button" data-period="${days}" aria-pressed="${days === period}">${days} jours</button>`).join("")}</div></div>
        <div class="admin-figures">
        ${tile(count(added.now), "voitures ajoutées", "#admin:indicateurs:ajouts", trend(added))}
        ${tile(count(comments.now), "commentaires", "#admin:indicateurs:commentaires", trend(comments))}
        ${tile(count(reactions.now), "réactions", "#admin:indicateurs:reactions", trend(reactions))}
      </div></div>
      <div><h2 class="display-sm">Comptes</h2><div class="admin-figures">
        ${tile(figures.profiles.length, "comptes", "#admin:indicateurs:comptes", hidden ? `dont ${hidden} avec une collection masquée` : "")}
        ${tile(owners, "ont au moins une voiture", "#admin:indicateurs:avec-voitures")}
        ${tile(owners ? (figures.items.length / owners).toFixed(1).replace(".", ",") : 0, "voitures par compte, en moyenne", "#admin:indicateurs:comptes")}
        ${tile(figures.items.length, "voitures dans les decks", "#admin:fiches:decks", "tous comptes confondus")}
      </div></div>
      <div><h2 class="display-sm">Catalogue</h2><div class="admin-figures">
        ${tile(cars.length, "fiches", "#admin:fiches:toutes")}
        ${tile(`${fill} %`, "de remplissage moyen", "#admin:fiches:moins-remplies", "Rempli ne veut pas dire vérifié.")}
        ${tile(cars.filter(FILTERS.nophoto).length, "sans photo", "#admin:fiches:nophoto")}
        ${tile(cars.filter(FILTERS.orphan).length, "dans aucun deck", "#admin:fiches:orphan")}
      </div></div>
      <div class="admin-lists">
        <div><h2 class="display-sm">Les plus présentes</h2>
          ${top.length ? ranked(top.map((car) => `<li><a href="#${esc(car.slug)}">${esc(car.name)}</a><span>${plural(inDecks(car), "deck")}</span></li>`)) : `<p class="admin-none">Aucune voiture dans les decks.</p>`}</div>
        <div><h2 class="display-sm">Marques</h2>
          ${ranked(brands.map(([brand, total]) => `<li><a href="#admin:fiches:marque-${encodeURIComponent(brand)}">${esc(brand)}</a><span>${plural(total, "fiche")}</span></li>`))}</div>
        <div><h2 class="display-sm">Champs les plus vides</h2>
          ${fields.length ? ranked(fields.map(([key, missing]) => `<li><a href="#admin:fiches:manque-${key}">${esc(fieldLabel(key))}</a><span>${plural(missing, "fiche")}</span></li>`)) : `<p class="admin-none">Tous les champs sont remplis.</p>`}</div>
      </div>
    </div></section>`;
  }

  /* Le détail d'un chiffre. Ce qui vient d'une collection masquée est compté, jamais montré. */
  const carLink = (title) => {
    const car = state.catalog.find((entry) => titleOf(entry) === title);
    return car ? `<a href="#${esc(car.slug)}">${esc(car.name)}</a>` : esc(title);
  };
  const hiddenNote = (total) => (total ? `<p class="admin-count">${total} de plus dans des collections masquées : ${total > 1 ? "elles restent comptées, sans détail" : "elle reste comptée, sans détail"}.</p>` : "");
  const REACTION_LABEL = { like: "aime", want: "la veut" };

  function detailHtml(key) {
    const shell = (title, intro, content) => `<section class="section"><div class="wrap admin-detail">
      <a class="back" href="#admin:indicateurs">‹ Indicateurs</a>
      <h2 class="display-sm">${esc(title)}</h2>${intro ? `<p class="admin-count">${esc(intro)}</p>` : ""}${content}
    </div></section>`;
    if (key === "comptes" || key === "avec-voitures") {
      const owned = new Map();
      figures.items.forEach((row) => owned.set(row.user_id, (owned.get(row.user_id) || 0) + 1));
      const rows = figures.profiles.filter((row) => key === "comptes" || owned.get(row.id))
        .sort((a, b) => (owned.get(b.id) || 0) - (owned.get(a.id) || 0));
      return shell(key === "comptes" ? "Comptes" : "Comptes avec au moins une voiture", plural(rows.length, "compte"),
        `<ul class="admin-rows">${rows.map((row) => `<li class="admin-line">
          <div><strong>${esc(displayName(row.username))}</strong><p>${plural(owned.get(row.id) || 0, "voiture")}${row.shared ? "" : " · collection masquée"}</p></div>
          ${row.shared ? `<button type="button" class="text-link" data-view-user="${esc(row.id)}">Voir la collection ›</button>` : ""}
        </li>`).join("")}</ul>`);
    }
    const scope = `Sur les ${period} derniers jours.`;
    if (key === "ajouts") {
      const rows = [...inPeriod(figures.items, "added_at").now].sort((a, b) => b.added_at.localeCompare(a.added_at));
      const open = rows.filter((row) => isShared(row.user_id));
      return shell("Voitures ajoutées", scope, `<ul class="admin-rows">${open.map((row) => `<li class="admin-line">
          <div><strong>${carLink(row.title)}</strong><p>${esc(nameOf(row.user_id))} · ${frenchDay(row.added_at)}</p></div></li>`).join("") || `<li class="admin-none">Rien à montrer sur cette période.</li>`}</ul>${hiddenNote(rows.length - open.length)}`);
    }
    if (key === "commentaires") {
      const rows = inPeriod(figures.comments, "created_at").now || [];
      const open = rows.filter((row) => isShared(row.owner_id));
      return shell("Commentaires", scope, `<ul class="admin-rows">${open.map((row) => `<li class="admin-line">
          <div><strong>${carLink(row.title)}</strong><p>${esc(row.author_name || "Compte supprimé")} sur la collection de ${esc(nameOf(row.owner_id))} · ${frenchDay(row.created_at)}</p>
          <blockquote>${esc(row.body)}</blockquote></div></li>`).join("") || `<li class="admin-none">Rien à montrer sur cette période.</li>`}</ul>${hiddenNote(rows.length - open.length)}`);
    }
    if (key === "reactions") {
      const rows = inPeriod(figures.reactions, "created_at").now || [];
      const open = rows.filter((row) => isShared(row.owner_id));
      return shell("Réactions", scope, `<ul class="admin-rows">${open.map((row) => `<li class="admin-line">
          <div><strong>${carLink(row.title)}</strong><p>${esc(nameOf(row.user_id))} ${REACTION_LABEL[row.kind] || esc(row.kind)} · collection de ${esc(nameOf(row.owner_id))} · ${frenchDay(row.created_at)}</p></div></li>`).join("") || `<li class="admin-none">Rien à montrer sur cette période.</li>`}</ul>${hiddenNote(rows.length - open.length)}`);
    }
    return figuresHtml();
  }

  /** Un chiffre mène à la liste des fiches déjà filtrée : le lien décrit le filtre. */
  function applySheetLink(link) {
    if (!link) return;
    Object.assign(list, { query: "", filter: "all", sort: "name", missing: "" });
    if (["nophoto", "orphan", "low"].includes(link)) list.filter = link;
    else if (link === "decks") list.sort = "decks";
    else if (link === "moins-remplies") list.sort = "emptiest";
    else if (link.startsWith("manque-")) { list.missing = link.slice(7); list.filter = "missing"; }
    else if (link.startsWith("marque-")) list.query = decodeURIComponent(link.slice(7));
  }

  const reserveHtml = () => `<section class="section"><div class="wrap admin-empty">
      <h2 class="display-sm">La réserve n'existe pas encore</h2>
      <p>Elle arrivera avec les boosters. Tu y verras les voitures restantes, le prochain renouvellement, et tu pourras retirer une voiture ou la passer en remarquable.</p>
    </div></section>`;

  async function render(route) {
    const [tab, ...rest] = route.split(":");
    const extra = rest.join(":");
    const known = TABS.some(([id]) => id === tab) && tab !== "comptes";
    const active = known ? tab : "indicateurs";
    const target = box();
    const view = `${active}:${extra}`;
    // Une actualisation du site ne doit pas effacer une recherche en cours.
    if (shownTab === view && document.activeElement?.id === "admin-search") return;
    if (active === "fiches" && shownTab !== view) applySheetLink(extra);
    shownTab = view;
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
    if (shownTab !== view) return;
    target.innerHTML = tabsHtml(active) + (active === "fiches" ? sheetsHtml() : extra ? detailHtml(extra) : figuresHtml());
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
  box().addEventListener("click", (event) => {
    const button = event.target.closest("[data-period]");
    if (!button) return;
    period = Number(button.dataset.period);
    box().innerHTML = tabsHtml("indicateurs") + figuresHtml();
  });
  /* Le retrait groupé rattrape ce que le nettoyage automatique a manqué (compte supprimé, robot en échec). */
  box().addEventListener("click", (event) => {
    if (!event.target.closest("#admin-purge-button")) return;
    const cars = removable();
    askConfirm({
      title: `Supprimer ${plural(cars.length, "fiche")} ?`,
      text: "Ces fiches ne sont dans aucun deck. Elles disparaissent avec leurs photos. Quelqu'un pourra les rajouter, le robot les recréera.",
      label: "Supprimer",
      action: async () => {
        // Le serveur revérifie chaque fiche : il ne retire que celles que personne n'a.
        const results = await Promise.allSettled(cars.map((car) => server("release-sheet", { title: titleOf(car) })));
        const started = results.filter((result) => result.status === "fulfilled" && result.value.removing).length;
        const startedTitles = new Set(cars.filter((_, index) => results[index].status === "fulfilled" && results[index].value.removing).map(titleOf));
        state.catalog = state.catalog.filter((car) => !startedTitles.has(titleOf(car)));
        sheetRows();
        showToast(`${plural(started, "suppression")} lancée${started > 1 ? "s" : ""}. Le catalogue sera à jour après la publication.`);
      },
    });
  });
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

  /* Une photo pour une fiche qui n'en a pas : l'admin choisit, le robot relit la licence sur Commons. */
  const picking = { car: null, results: [] };
  async function searchPick() {
    const query = el("pick-query").value.trim();
    if (!query || !picking.car) return;
    el("pick-status").textContent = "Recherche…";
    el("pick-list").innerHTML = "";
    el("pick-error").hidden = true;
    try {
      picking.results = await searchFreePhotos(picking.car, query);
    } catch {
      el("pick-status").textContent = "";
      el("pick-error").textContent = "Wikimedia Commons ne répond pas. Réessaie dans un instant.";
      el("pick-error").hidden = false;
      return;
    }
    el("pick-status").textContent = picking.results.length ? `${plural(picking.results.length, "photo")} trouvée${picking.results.length > 1 ? "s" : ""}.` : "Aucune photo pour ces mots. Essaie avec moins de mots, par exemple la marque et le modèle.";
    el("pick-list").innerHTML = picking.results.map((result, index) => `<button type="button" class="free-choice" data-pick-photo="${index}">
      <img src="${esc(result.photo.thumb)}" alt="" loading="lazy">
      <span class="free-name">${esc(result.fileName)}</span>
      <small>${esc(result.photo.author.slice(0, 60))} · ${esc(result.photo.license)}</small>
    </button>`).join("");
  }
  function openPick(slug) {
    const car = catalogCar(slug);
    if (!car) return;
    picking.car = car;
    el("pick-title").textContent = `Une photo pour ${car.name}`;
    el("pick-query").value = car.name.replace(/\s*\(.*?\)/g, "");
    el("pick-dialog").showModal();
    searchPick();
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-photo]");
    if (button && isAdmin()) openPick(button.dataset.addPhoto);
  });
  el("pick-cancel").addEventListener("click", () => el("pick-dialog").close());
  el("pick-form").addEventListener("submit", (event) => {
    event.preventDefault();
    searchPick();
  });
  el("pick-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-pick-photo]");
    if (!button) return;
    const result = picking.results[Number(button.dataset.pickPhoto)];
    el("pick-list").querySelectorAll("button").forEach((other) => { other.disabled = true; });
    el("pick-error").hidden = true;
    try {
      await server("edit-sheet", { slug: picking.car.slug, photo: `File:${result.fileName}` });
      el("pick-dialog").close();
      showToast(`Photo envoyée pour ${esc(picking.car.name)}. Elle sera visible après la publication, dans quelques minutes.`);
    } catch (error) {
      el("pick-error").textContent = error.message || "La photo n'a pas pu être envoyée. Réessaie dans un instant.";
      el("pick-error").hidden = false;
      el("pick-list").querySelectorAll("button").forEach((other) => { other.disabled = false; });
    }
  });

  window.CarPocketAdmin = { render, tabsHtml };
  if (isAdmin() && decodeURIComponent(location.hash.slice(1)).startsWith("admin")) renderRoute();
})();
