# CarPocket

Mon deck de voitures préférées : photos et fiches techniques, complétées automatiquement depuis Wikipédia et Wikimedia Commons.

## Ajouter une voiture

Clique sur **Ajouter une voiture**, tape quelques lettres, puis choisis une suggestion. La carte apparaît dans le deck, et la fiche complète arrive en une ou deux minutes.

La première fois sur un appareil, le site demande une clé d'accès. Elle n'autorise que le lancement du robot de ce dépôt et reste enregistrée dans ce navigateur. Sans clé, le site se consulte mais ne se modifie pas.

## Comparer

Clique sur **Comparer** sur 2 ou 3 cartes, puis sur le bouton de comparaison en bas de l'écran.

## Supprimer une voiture

Clique sur **Supprimer** sur la carte ou sur la fiche, puis confirme.

## Corriger une fiche

Ouvre `data/cars/<nom>.json` sur GitHub et renseigne le bloc `overrides` :

```json
"overrides": {
  "top_speed": "324 km/h",
  "torque": "577 Nm"
}
```

Tes corrections priment sur les données du robot et ne sont jamais écrasées.

Champs possibles : `engine`, `power`, `torque`, `transmission`, `layout`, `top_speed`, `zero_100`, `weight`, `length`, `width`, `height`, `wheelbase`, `body`, `production`, `designer`, `assembly`.

## Ce qu'il faut savoir

- Un astérisque signale une valeur lue dans le texte de l'article : elle peut concerner une autre version du modèle.
- « Non renseigné » signifie que le robot n'a rien trouvé. Il n'invente jamais de valeur.
- Seules des photos sous licence libre sont enregistrées, avec leur auteur et leur licence sur la fiche.

## En local

```bash
python3 -m unittest discover -s tests
```

```bash
python3 scripts/serve.py
```
