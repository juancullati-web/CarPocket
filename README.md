# CarPocket

Ma bibliothèque de voitures préférées : photos et fiches techniques, complétées automatiquement depuis Wikipédia et Wikimedia Commons.

## Ajouter une voiture

Sur le site, clique sur **Ajouter une voiture**, tape le nom, puis valide le formulaire sur GitHub. Le robot répond dans la demande en deux minutes environ, avec le lien de la fiche et ce qu'il n'a pas trouvé.

Conseil : sois précis. « Porsche 911 (993) » donne une meilleure fiche que « Porsche 911 ».

## Supprimer une voiture

Clique sur **Supprimer** sur la voiture, dans la galerie ou sur sa fiche, puis confirme.

- **En ligne :** le formulaire s'ouvre sur GitHub. Valide-le, et la voiture disparaît en deux minutes environ.
- **Sur ce Mac :** avec `scripts/serve.py`, la suppression est immédiate.

## Corriger une fiche

Ouvre la fiche, clique sur **Corriger cette fiche**, et renseigne le bloc `overrides` :

```json
"overrides": {
  "top_speed": "324 km/h",
  "torque": "577 Nm"
}
```

Tes corrections priment sur les données du robot et ne sont jamais écrasées.

Champs possibles : `engine`, `power`, `torque`, `transmission`, `layout`, `top_speed`, `zero_100`, `weight`, `length`, `width`, `height`, `wheelbase`, `body`, `production`, `designer`, `assembly`.

## Ce qu'il faut savoir

- Un astérisque sur une valeur signifie qu'elle vient du texte de l'article et qu'elle peut concerner une autre version du modèle. Vérifie-la.
- « Non renseigné » signifie que le robot n'a rien trouvé. Il n'invente jamais de valeur.
- Seules des photos sous licence libre sont utilisées, avec leur auteur et leur licence sur la fiche.
- Le site et ce dépôt sont publics, mais seul le propriétaire du dépôt peut déclencher le robot.

## En local

```bash
python3 -m unittest discover -s tests
```

```bash
python3 scripts/add_car.py "Aston Martin DB5"
```

```bash
python3 scripts/serve.py
```
