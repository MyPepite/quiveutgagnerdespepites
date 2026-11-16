# Mettre le jeu en ligne (pour jouer en 5G, sans ordinateur sur place)

Une fois en ligne, le jeu a une adresse fixe (du type `https://pepites-game.onrender.com`).
La TV ouvre `…/tv`, les joueurs scannent le QR code : plus besoin du même Wi-Fi.

Nous utilisons le service **Render** (environ 7 $/mois pour la formule « Starter » qui ne s'endort jamais ; vérifiez le tarif actuel sur render.com). La formule gratuite s'endort après 15 minutes sans visite et met environ une minute à se réveiller : déconseillée en soirée.

## Étape 1 : mettre le dossier sur GitHub (une seule fois)
1. Créez un compte gratuit sur https://github.com.
2. Cliquez sur **+** (en haut à droite) puis **New repository**. Nom : `pepites-game`. Choisissez **Private**. Validez.
3. Sur la page du dépôt, cliquez **uploading an existing file**.
4. Ouvrez le dossier `pepites-game` sur votre ordinateur, sélectionnez **tout son contenu** (les dossiers `donnees`, `jeux`, `public`, `test` et les fichiers) et glissez-le dans la page GitHub. Attendez la fin du chargement, puis cliquez **Commit changes**.
   Important : glissez le contenu du dossier, pas le dossier lui-même, pour que `server.js` soit visible directement à la racine.

## Étape 2 : créer le service sur Render
1. Créez un compte sur https://render.com (« Get started », connexion avec GitHub).
2. **New +** → **Blueprint** (ou **Web Service**), puis choisissez votre dépôt `pepites-game`.
3. Le fichier `render.yaml` remplit presque tout. Render vous demande une valeur **ADMIN_PASSWORD** : c'est le mot de passe qui permet de lancer une salle. Choisissez-en un et notez-le.
   Si vous passez par « Web Service » : Runtime `Node`, Build Command laissé vide, Start Command `node server.js`, et ajoutez la variable `ADMIN_PASSWORD`.
4. Cliquez **Deploy**. Au bout de quelques minutes, Render affiche l'adresse du jeu.

## Étape 3 : jouer
1. Sur l'ordinateur de la TV, ouvrez `https://VOTRE-ADRESSE/tv`. Au premier lancement, le jeu demande le mot de passe (il le mémorise ensuite).
2. Le QR code et l'adresse affichés fonctionnent pour tout le monde, en Wi-Fi comme en 5G.
3. Le reste ne change pas : téléphone animateur via le petit QR, mode manuel, etc.

## Mettre à jour le jeu ou les questions
Sur GitHub, ouvrez le fichier à modifier (par exemple `donnees/questions-pepites.json`), cliquez sur le crayon, modifiez, puis **Commit changes**. Render redéploie tout seul (environ 2 minutes). Une partie en cours est interrompue pendant ce temps.

## Bon à savoir
- Les salles et l'historique des questions déjà posées sont gardés en mémoire : ils sont perdus à chaque redéploiement ou redémarrage.
- Un nom de domaine à vous (par exemple `jeu.mon-site.fr`) se branche dans Render, onglet **Settings → Custom Domains**. Optionnel.
- Le mot de passe empêche des inconnus de créer des salles sur votre serveur. Les joueurs, eux, n'en ont pas besoin.
