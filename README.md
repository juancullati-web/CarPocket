# CarPocket

Mon deck de voitures préférées : photos et fiches techniques, complétées automatiquement depuis Wikipédia et Wikimedia Commons.

## Se connecter

Chaque compte se connecte avec son identifiant et son mot de passe, et retrouve sa propre collection sur tous ses appareils. L'administrateur gère les comptes depuis le menu du profil. Il peut aussi regarder les collections, sans les modifier.

## Installer l'application

Depuis le menu de ta pastille, sur téléphone, choisis **Installer l'application**. Sur iPhone : dans Safari, **Partager**, puis **Sur l'écran d'accueil**. Hors connexion, CarPocket affiche la dernière version enregistrée sur l'appareil, sans pouvoir la modifier.

## Gérer son profil

Clique sur la pastille de ton avatar, en haut à droite. Le menu donne accès à **Mon profil**, où tu peux choisir ton avatar et changer ton mot de passe, et à **Se déconnecter**. Pour l'administrateur, il donne aussi accès à **Gérer les comptes**.

## Voir les collections de ses amis

Depuis **Voir les collections de mes amis**, tu vois les collections des autres comptes et tu peux ajouter leurs voitures à ton deck avec **+ Mon deck**. Personne ne peut modifier la collection d'un autre. Pour masquer la tienne, décoche le réglage dans **Mon profil**.

## Ajouter une voiture

Clique sur **Ajouter une voiture**, ou sur le **+** en haut de page, tape quelques lettres, puis choisis une suggestion. Si la page décrit plusieurs générations, choisis celle que tu veux : chacune a sa propre carte. Si quelqu'un l'a déjà ajoutée, elle arrive tout de suite. Sinon, la fiche et les photos arrivent en une ou deux minutes.

## Comparer

Clique sur **Comparer** sur 2 ou 3 cartes, puis sur le bouton de comparaison en bas de l'écran. La sélection te suit quand tu visites la collection d'un ami : tu peux donc comparer tes voitures avec les siennes.

## Retirer une voiture

Clique sur **Retirer** sur la carte ou sur la fiche, puis confirme. La fiche reste disponible pour les autres comptes. Seul l'administrateur peut supprimer une fiche pour tout le monde.

## Ajouter une voiture

Tape directement le nom, par exemple « Ferrari 488 Pista », ou choisis la marque, le modèle, puis la version. Si elle manque, tape-la : la fiche est créée à ce nom et reste à compléter. Les listes viennent de l'EPA (États-Unis), de l'ADEME (France), d'[openvehicle-data](https://github.com/mirkobechini/openvehicle-data) (Mirko Bechini, CC BY 4.0), de Wikidata et de Wikipédia, et se mettent à jour chaque mois.

## Statut d'une voiture

Sur la fiche, indique si la voiture est **possédée**, **essayée** ou **rêvée**. Un second appui retire le statut. Le statut s'affiche sur la carte, et le filtre **Statut** trie ton deck.

## Choisir une version précise

Sur la fiche d'une voiture de ta collection, l'icône **Choisir une version précise** remplace la fiche par la bonne version. Tes photos, ta présentation, tes notes et tes valeurs suivent.

## Notes et informations modifiées

Sur la fiche d'une voiture de ta collection, écris tes notes : elles s'enregistrent toutes seules. Le bouton crayon change les valeurs de la fiche technique pour ta collection seulement, et chaque valeur changée porte la mention « Modifié ». Tu peux réinitialiser une valeur dans le formulaire, ou toutes les valeurs avec le bouton voisin.

Sur une fiche incomplète, **Chercher les infos manquantes** propose des valeurs de l'EPA, de l'ADEME, d'openvehicle-data et de Wikipédia, avec leur source. Rien n'est ajouté sans que tu le coches.

Tu peux aussi écrire ta propre présentation, ou modifier celle de Wikipédia, puis revenir au texte d'origine.

Tes amis voient tes notes, ta présentation et tes valeurs modifiées tant que ta collection est partagée.

## Gérer ses photos

Sur la fiche d'une voiture de ta collection, tu peux :

- **ajouter tes photos**, depuis ta galerie ou avec l'appareil photo du téléphone. Elles sont réduites et leur position GPS est retirée avant l'envoi ;
- **masquer** une photo du catalogue pour ta collection, puis la rétablir quand tu veux ;
- **supprimer** tes propres photos ;
- **choisir la photo principale**, utilisée sur la carte et dans le carrousel.

Tes photos sont privées : seuls les comptes connectés qui peuvent voir ta collection peuvent les voir.

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
- Les fiches et les photos sont publiques. Les collections ne sont visibles qu'après connexion : les visiteurs n'y ont pas accès, et un compte peut masquer la sienne aux autres comptes.
- Le projet Supabase gratuit se met en pause après une semaine sans activité. Une tâche automatique le sollicite deux fois par semaine. Si la connexion échoue, regarde s'il faut le réactiver dans le tableau de bord.

## Crédits des avatars

- Logos : [Simple Icons](https://simpleicons.org) (CC0), et [Wikimedia Commons](https://commons.wikimedia.org) (domaine public selon Commons) pour Alpine et Mercedes-Benz. Ces logos restent des marques de leurs propriétaires, et CarPocket n'est affilié à aucune d'elles.
- Personnages et objets : [Fluent Emoji](https://github.com/microsoft/fluentui-emoji), Copyright (c) Microsoft Corporation, licence MIT.

## En local

```bash
python3 -m unittest discover -s tests
```

```bash
python3 scripts/serve.py
```
