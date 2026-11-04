# CarPocket

Site statique (GitHub Pages) d'une bibliothèque de voitures, avec comptes et collections sur Supabase. Parle français à l'utilisateur.

- `data/cars/<slug>.json` est la source de vérité. `site/cars.json` est généré par `scripts/build_index.py` à chaque publication et au lancement de `scripts/serve.py` : il n'est pas versionné.
- Les corrections manuelles vont dans `overrides` et priment sur `specs`.
- `data/cars` est un catalogue partagé et public. Les collections sont dans la table Supabase `deck_items`, liées au catalogue par le titre Wikipédia (`Page#Génération` pour une génération précise, soit une infobox nommée de la page). Le choix de photo principale est propre à chaque personne (`main_photo`).
- `scripts/add_car.py` et `remove_car.py` sont lancés par GitHub Actions (`workflow_dispatch`) depuis la fonction `supabase/functions/carpocket`, seule à détenir la clé GitHub (secret `GH_ACTIONS_TOKEN`) et les droits d'administration. Toute modification de `supabase/` se redéploie à la main dans le tableau de bord.
- Les accès reposent sur les règles de `supabase/schema.sql`. Les inscriptions libres sont fermées et un compte a l'adresse `identifiant@users.carpocket.example`. Ne jamais mettre de clé `sb_secret_` ni la clé GitHub dans le site.
- Python 3.9 sans dépendance pour les scripts ; HTML, CSS et JS sans framework pour le site.
- Ne jamais inventer de valeur technique : un champ inconnu reste absent et s'affiche « Non renseigné ». Une valeur lue dans le texte de l'article garde `from_text: true`.
- Photos : uniquement Wikimedia Commons sous licence libre, avec auteur et licence conservés.
- Le nom reçu par un workflow n'est jamais interpolé dans une commande : il passe par une variable d'environnement.
- Design : page blanche, bandes bleu nuit `#1a2129`, un seul bleu d'action `#1c69d4`, angles droits, aucune ombre, Inter en 700 et 300. Pas de logo ni de nom de marque d'un constructeur. Thème clair uniquement.

Tests : `python3 -m unittest discover -s tests`. Aperçu avec suppression : `python3 scripts/serve.py`.
