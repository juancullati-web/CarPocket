# CarPocket

Adresse : https://carpocket.inzight.fr (sous-domaine pointant vers GitHub Pages). `inzight.fr` est le site personnel du propriétaire, hébergé chez Hostinger : ne pas y toucher.

Site statique (GitHub Pages) d'une bibliothèque de voitures, avec comptes et collections sur Supabase. Parle français à l'utilisateur.

- `data/cars/<slug>.json` est la source de vérité. `site/cars.json` est généré par `scripts/build_index.py` à chaque publication et au lancement de `scripts/serve.py` : il n'est pas versionné.
- Les corrections manuelles vont dans `overrides` et priment sur `specs`.
- `data/cars` est un catalogue partagé et public. Les collections sont dans la table Supabase `deck_items`, liées au catalogue par le titre Wikipédia (`Page#Génération` pour une génération précise, soit une infobox nommée de la page). Le choix de photo principale est propre à chaque personne (`main_photo`).
- `scripts/add_car.py` et `remove_car.py` sont lancés par GitHub Actions (`workflow_dispatch`) depuis la fonction `supabase/functions/carpocket`, seule à détenir la clé GitHub (secret `GH_ACTIONS_TOKEN`) et les droits d'administration. Toute modification de `supabase/` se redéploie à la main dans le tableau de bord.
- Une collection est visible par les comptes connectés tant que `profiles.shared` est vrai (vrai par défaut). Le rôle n'est pas lisible directement : passer par `is_admin()` ou `account_roles()`.
- Les accès reposent sur les règles de `supabase/schema.sql`. Les inscriptions libres sont fermées et un compte a l'adresse `identifiant@users.carpocket.example`. L'identifiant reste stocké en minuscules, sans accent, et s'affiche avec une majuscule via `displayName`. Ne jamais mettre de clé `sb_secret_` ni la clé GitHub dans le site.
- Python 3.9 sans dépendance pour les scripts ; HTML, CSS et JS sans framework pour le site.
- Ne jamais inventer de valeur technique : un champ inconnu reste absent et s'affiche « Non renseigné ». Une valeur lue dans le texte de l'article garde `from_text: true`.
- Photos : uniquement Wikimedia Commons sous licence libre, avec auteur et licence conservés. L'import automatique ne garde qu'une photo, l'image principale de l'article : les recherches élargies ramenaient d'autres voitures.
- Le nom reçu par un workflow n'est jamais interpolé dans une commande : il passe par une variable d'environnement.
- Design : page blanche, bandes bleu nuit `#1a2129`, un seul bleu d'action `#1c69d4`, angles droits, aucune ombre, Inter en 700 et 300. Pas de logo ni de nom de marque d'un constructeur. Thèmes clair et sombre, au choix.

Avatars (`site/avatars`) : logos de [Simple Icons](https://simpleicons.org) en CC0, Alpine et Mercedes-Benz de Wikimedia Commons, personnages et objets de [Fluent Emoji](https://github.com/microsoft/fluentui-emoji) sous licence MIT. Les logos restent des marques de leurs propriétaires.

PWA : `site/manifest.webmanifest` et `site/sw.js`. Le service worker ne met jamais en cache les appels Supabase. Il sert réseau d'abord pour les pages, et cache d'abord pour `photos/` et `avatars/`.

Ajout d'une voiture : marque, modèle, puis version, depuis `site/reference` (généré chaque mois par `scripts/build_reference.py` : EPA, ADEME en Licence Ouverte, openvehicle-data en CC BY 4.0 à créditer, Wikidata et Wikipédia). Une version de la liste ou tapée à la main donne une fiche à son nom exact ; ses valeurs viennent de la liste si toutes ses variantes concordent (`source` sur la valeur) ; openvehicle-data donne une fourchette quand elles diffèrent, et les calculs retiennent le bas. Une fiche créée depuis Wikipédia ne reçoit ses valeurs que pour les champs manquants, à la même époque et hors fiche d'une seule génération. Pas de page Wikipédia voisine ni de photo d'une autre version : une photo Commons doit citer le nom exact dans son fichier.

Statut d'une voiture dans une collection : colonne `status` de `deck_items` (`owned`, `driven`, `dream`), visible avec elle.

Commentaires et réactions : tables `car_comments` et `car_reactions`, liées à une voiture d'une collection et lisibles avec elle. L'auteur et la date viennent de la base, pas du navigateur. Ce qui est déjà vu est dans `user_state`, commun aux appareils du compte.

Dossiers : table `deck_folders` et colonne `folder_id` de `deck_items`, une voiture dans un seul dossier. Supprimer un dossier garde ses voitures, et la clé inclut le compte pour interdire le dossier d'un autre.

Complétude : part des 16 champs de la fiche technique remplis, valeurs de la collection comprises. Rempli ne veut pas dire vérifié.

Notes, présentation et valeurs modifiées : colonnes `notes`, `custom_summary` et `custom_specs` de `deck_items`, propres à chaque collection et visibles avec elle. Une valeur modifiée porte `edited: true` à l'affichage et ne touche jamais `data/cars`. Le bouton « Chercher les infos manquantes » lit la liste de référence et Wikipédia depuis le navigateur, propose des valeurs avec leur source (`custom_sources`) et n'écrit que ce que la personne coche.

Photos libres : `free_photos` de `deck_items`, choisies par la personne parmi les résultats Commons, avec auteur et licence. Le site affiche l'image depuis Wikimedia, elle ne rejoint pas le catalogue.

Photos personnelles : bucket privé `user-photos`, dossier par compte, affichées par adresses signées. Les masquages et les choix sont dans `deck_items`. Le fichier ré-encodé en JPEG perd ses métadonnées avant l'envoi.

Dates d'une fiche : `updated` dans `data/cars` change seulement si une valeur change (`scripts/car_dates.py`, lancé par `stamp-cars.yml` pour une correction à la main). `custom_updated_at` de `deck_items` est posée par la base pour les changements de la collection, et vide s'il n'en reste aucun. Ni l'une ni l'autre ne veut dire vérifié.

Administration (`site/admin.js`, routes `#admin:…` et `#comptes`) : l'accueil du compte admin, qui n'a pas de deck. Fiches, indicateurs, réserve, comptes. Les collections n'y servent qu'à compter. Une correction de fiche passe par l'action `edit-sheet`, le workflow `edit-car.yml` et `scripts/edit_car.py` : elle va dans `overrides` et ne touche jamais les valeurs d'une collection.

Tests : `python3 -m unittest discover -s tests`. Aperçu avec suppression : `python3 scripts/serve.py`.
