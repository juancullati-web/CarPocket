# Carnet de garage

Site statique (GitHub Pages) d'une bibliothèque de voitures. Parle français à l'utilisateur.

- `data/cars/<slug>.json` est la source de vérité. `site/cars.json` est généré par `scripts/build_index.py` à chaque publication et au lancement de `scripts/serve.py` : il n'est pas versionné.
- Les corrections manuelles vont dans `overrides` et priment sur `specs`.
- `scripts/add_car.py` et `remove_car.py` sont lancés par GitHub Actions depuis les issues du propriétaire du dépôt, et fonctionnent aussi en local.
- Python 3.9 sans dépendance pour les scripts ; HTML, CSS et JS sans framework pour le site.
- Ne jamais inventer de valeur technique : un champ inconnu reste absent et s'affiche « Non renseigné ». Une valeur lue dans le texte de l'article garde `from_text: true`.
- Photos : uniquement Wikimedia Commons sous licence libre, avec auteur et licence conservés.
- Le texte d'une issue n'est jamais interpolé dans une commande de workflow : il passe par une variable d'environnement.

Tests : `python3 -m unittest discover -s tests`. Aperçu avec suppression : `python3 scripts/serve.py`.
