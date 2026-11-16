# Pépites : mode d'emploi

Jeu pour bar : la TV affiche les questions, chaque client répond avec son téléphone (aucune application à installer).
Premier jeu inclus : **Qui veut gagner des pépites ?**

## 1. Installation (une seule fois)

Sur l'ordinateur qui sera branché à la TV :

1. Installez **Node.js** (version « LTS », gratuite) : https://nodejs.org
2. Dézippez le dossier `pepites-game` où vous voulez (le Bureau, par exemple).

## 2. Lancer une soirée

1. Branchez l'ordinateur à la TV (câble HDMI) et connectez-le au Wi-Fi du bar.
2. Lancez le serveur :
   - **Windows** : double-clic sur `Lancer-Windows.bat`
   - **Mac** : double-clic sur `Lancer-Mac.command` (la première fois : clic droit > Ouvrir)
3. Une fenêtre noire s'ouvre : **laissez-la ouverte** pendant toute la soirée.
4. Dans le navigateur de l'ordinateur, ouvrez **http://localhost:3000/tv** puis appuyez sur **F** pour passer en plein écran.
5. La TV affiche un QR code. Les clients le scannent avec l'appareil photo de leur téléphone, choisissent un pseudo, et c'est parti.
6. Choisissez la longueur de la partie et le temps par question, puis **Lancer la partie** (ou touche Entrée).

**Important : les téléphones doivent être sur le même Wi-Fi que l'ordinateur.** Si les clients ne peuvent pas ouvrir la page, deux causes possibles : ils sont en 4G/5G (demandez-leur de se connecter au Wi-Fi du bar), ou le Wi-Fi du bar bloque la communication entre appareils (« isolation des clients »). Dans ce cas, utilisez un petit routeur Wi-Fi à vous, ou partagez la connexion de votre téléphone avec l'ordinateur.

## 3. Pendant la partie

| Touche (sur l'ordinateur) | Effet |
|---|---|
| Espace | Passer à l'étape suivante (lancer la question, révéler la réponse, question suivante, classement) |
| Entrée | Lancer la partie, depuis la salle d'attente |
| H | Affiche un QR code « télécommande » : scannez-le avec VOTRE téléphone pour piloter sans toucher à l'ordinateur |
| F | Plein écran |

### Question suivante : manuelle ou automatique

Dans la salle d'attente, le réglage **Question suivante** a deux positions :

- **Manuel** (par défaut) : vous gardez la main pour animer. Le jeu attend votre signal pour lancer la première question, puis pour passer de la réponse à la question suivante, puis pour afficher le classement. Appuyez sur **Espace** (ou sur le bouton « Question suivante » qui apparaît quand vous bougez la souris, ou sur la télécommande du téléphone).
- **Automatique** : le jeu enchaîne tout seul (présentation de 5 secondes, réponse affichée 8 secondes).

Dans les deux modes, la réponse est révélée toute seule quand le chrono se termine ou que tout le monde a répondu. Vous pouvez aussi la révéler plus tôt avec Espace.

## Règles du jeu

- Tout le monde répond à la même question, en même temps, sur son téléphone.
- Chaque joueur a sa propre échelle de gains : chaque bonne réponse le fait monter d'un cran (jusqu'à 1 000 000 de pépites pour la partie de 15 questions).
- **Personne n'est éliminé.** Une mauvaise réponse (ou pas de réponse) fait retomber le joueur au dernier **palier** franchi (◆ sur l'échelle), ou à zéro s'il n'en a pas encore franchi, et il repart de là à la question suivante.
- Sur la TV, l'échelle affiche le nombre de joueurs à chaque cran. Sur le téléphone, chacun voit ce qu'il a en jeu, son palier et ce que rapporte une bonne réponse.
- La partie dure jusqu'à la dernière question.
- Chaque joueur a **un joker 50:50 par partie** : il retire 2 mauvaises réponses, pour lui seul.
- Classement final : pépites, puis nombre de bonnes réponses, puis rapidité.

## Modifier les questions

Ouvrez `donnees/questions-pepites.json` avec le Bloc-notes (ou n'importe quel éditeur de texte). Chaque question ressemble à ceci :

```
{
  "niveau": 2,
  "categorie": "Géographie",
  "question": "Quel est le plus haut sommet des Alpes ?",
  "bonne_reponse": "Le mont Blanc",
  "mauvaises_reponses": ["Le Cervin", "Le mont Rose", "L'Eiger"],
  "anecdote": "Facultatif : affiché après la réponse."
}
```

- `niveau` va de 1 (très facile) à 6 (très difficile) : la partie pioche des questions de plus en plus difficiles, et **la dernière question de chaque partie est toujours de niveau 6**.
- Il faut **exactement 3 mauvaises réponses**.
- Attention aux virgules entre les questions, et aux guillemets.
- Redémarrez le serveur après modification. Au lancement, la fenêtre noire signale les questions mal écrites.

La banque contient **200 questions** (40 de niveau 1, 40 de niveau 2, 40 de niveau 3, 40 de niveau 4, 24 de niveau 5 et 16 de niveau 6).

**Pas de question répétée** : tant que vous restez dans la même salle, une question déjà posée ne revient pas. Sans répétition, on peut enchaîner environ **12 parties de 15 questions**, ou **16 parties de 10 ou de 5 questions** (la limite vient des 16 questions de niveau 6, une par partie). Au-delà, les questions recommencent. L'historique est perdu si vous redémarrez le serveur ou créez une nouvelle salle.

Si vous ajoutez vos questions, gardez au moins 3 questions par niveau et par partie, et une bonne réserve de niveau 6.

## Mettre à jour le jeu

1. **Fermez la fenêtre noire du serveur** (c'est important : tant qu'elle reste ouverte, l'ancienne version continue de tourner).
2. Remplacez le dossier `pepites-game` par le nouveau (recopiez d'abord votre fichier `donnees/questions-pepites.json` si vous l'avez modifié).
3. Relancez le serveur, puis rechargez la page de la TV.

## Dépannage

- **Un réglage de la salle d'attente ne répond pas / un message rouge indique que le serveur est ancien** : le serveur tourne encore avec l'ancienne version. Fermez la fenêtre noire, relancez-le, rechargez la page de la TV.
- **« node n'est pas reconnu »** : Node.js n'est pas installé (étape 1).
- **La page ne s'ouvre pas sur les téléphones** : voir l'encadré Wi-Fi plus haut. L'adresse à utiliser est affichée dans la fenêtre noire.
- **La TV s'est rechargée en pleine partie** : la partie en cours est perdue, une nouvelle salle est créée.
- **Arrêter le serveur** : fermez la fenêtre noire.
