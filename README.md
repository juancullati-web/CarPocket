# CarPocket

Mon deck de voitures préférées : photos et fiches techniques, complétées automatiquement depuis Wikipédia et Wikimedia Commons.

## Se connecter

Chaque compte se connecte avec son identifiant et son mot de passe, et retrouve sa propre collection sur tous ses appareils. L'administrateur gère les comptes depuis **Gérer les comptes**, en bas de page. Il peut aussi regarder les collections, sans les modifier.

## Ajouter une voiture

Clique sur **Ajouter une voiture**, tape quelques lettres, puis choisis une suggestion. Si quelqu'un l'a déjà ajoutée, elle arrive tout de suite. Sinon, la fiche et les photos arrivent en une ou deux minutes.

## Comparer

Clique sur **Comparer** sur 2 ou 3 cartes, puis sur le bouton de comparaison en bas de l'écran.

## Retirer une voiture

Clique sur **Retirer** sur la carte ou sur la fiche, puis confirme. La fiche reste disponible pour les autres comptes. Seul l'administrateur peut supprimer une fiche pour tout le monde.

## Choisir la photo principale

Sur une fiche, clique sur une miniature, puis sur **Choisir comme photo principale**. Ce choix ne concerne que ta collection.

## Corriger une fiche

Depuis le compte administrateur, ouvre la fiche, clique sur **Corriger cette fiche** et renseigne le bloc `overrides` :

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
- Les fiches et les photos sont publiques. Les collections ne sont visibles qu'après connexion, par leur propriétaire et l'administrateur.
- Le projet Supabase gratuit se met en pause après une semaine sans activité. Une tâche automatique le sollicite deux fois par semaine. Si la connexion échoue, regarde s'il faut le réactiver dans le tableau de bord.

## En local

```bash
python3 -m unittest discover -s tests
```

```bash
python3 scripts/serve.py
```
