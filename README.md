# JDR

Outil web pour construire et projeter des cartes (maps) de jeu de rôle. Le maître de jeu (MJ) dessine ses cartes, les range par partie et les montre à ses joueurs, en ligne ou autour de la table.

> **Version alpha `0.1.0-alpha.1`.** Utilisable pour des essais entre amis. Il n'y a pas encore de revue de sécurité complète, et l'installation n'a pas encore été testée sur de vrais hébergeurs. Téléchargement : [page des releases](https://github.com/collet-david-pro/JDR/releases).

## Pour qui, pour quoi

- **Le MJ** construit ses maps, les organise par partie, puis les projette. Il place des murs, des portes, des lumières et des tokens. Les joueurs ne voient que ce qu'ils explorent (vision des tokens, brouillard de guerre).
- **Les joueurs** rejoignent la séance avec un code, sur leur navigateur.
- **En présentiel**, un écran posé sur la table (tablette, télévision, vidéoprojecteur) affiche la map à l'échelle réelle, pour y poser de vraies figurines.

**Ce n'est pas un VTT de règles** : pas de dés, pas d'initiative, pas de fiches de personnage, pas de points de vie. L'outil sert à la carte, pas aux règles.

L'outil est conçu pour un hébergement PHP/MySQL classique, sans serveur dédié : on envoie les fichiers, puis on ouvre `install.php`. Aucun démon, aucun Composer en production.

## Fonctionnalités

Le détail complet est dans le [CHANGELOG](CHANGELOG.md). Voici l'essentiel.

### Éditeur de maps

- Grille carrée, calques, tuiles par blocs, pinceau, gomme, remplissage, formes, sélection, pipette, règle, annuler et rétablir.
- Enregistrement automatique, avec une file d'attente hors ligne : une coupure réseau ou un onglet fermé brutalement ne fait pas perdre les modifications.
- Historique de versions restaurable, export et import JSON ou ZIP (images incluses).
- Export PNG haute résolution, fond transparent, mode impression (A4, A3, Letter).
- Rendu WebGPU, avec repli WebGL2.

### Murs, lumière, vision et brouillard

- Murs en polyligne ou par pièce, avec aimantation. Portes et fenêtres, ouvrables, verrouillées ou secrètes.
- Lumières préréglées (torche, lanterne, bougie, feu de camp, lumière magique) : couleur, vacillement, cônes.
- Lumière et vision arrêtées par les murs. Ambiance (obscurité, teinte, cycle jour et nuit) et ombres portées.
- Brouillard de guerre explorable, enregistré sur le serveur. Vue « comme le joueur ».

### Génération procédurale

- Quatre générateurs : donjons, grottes, extérieurs (biomes, rivières, routes, ponts) et villages.
- Une graine reproductible : la même graine redonne toujours la même map. Préréglages, aperçu, annulation.
- Génération dans une nouvelle map, dans la map actuelle ou dans une sélection. Un seul Ctrl+Z annule tout.
- Textures raccordables, à enregistrer dans sa bibliothèque.
- Détails : [docs/procgen.md](docs/procgen.md).

### Séances en ligne

- Le MJ lance une séance. Les joueurs la rejoignent avec un code, sur `/join`.
- Lobby avec préchargement, console du MJ (joueurs, affectations, tokens, révélations, ambiance, notes, maps), vue joueur.
- Pause, textes à lire à voix haute, expulsion d'un joueur.
- Mise à jour en temps réel sans WebSocket : d'abord par flux SSE, puis par long polling, puis par polling, avec bascule automatique selon l'hébergement.
- Brouillard strict : le serveur filtre ce que chaque joueur reçoit. Les tokens cachés et les objets réservés au MJ ne sortent jamais du serveur vers les joueurs.
- Détails : [docs/realtime.md](docs/realtime.md).

### Mode présentiel

- Des écrans de projection se branchent à la séance avec un code à 6 chiffres ou un QR code. Pas de compte à créer.
- L'écran ne montre que la vue de table, filtrée côté serveur.
- Échelle réelle (25 mm par case par défaut), calibrée à la diagonale ou à la règle. Rotation, miroir, pilotage de la caméra, verrou de vue.
- Jusqu'à 8 écrans par séance. Révocation immédiate.
- Détails : [docs/irl.md](docs/irl.md).

<!-- captures d'écran à venir -->

### Bibliothèque d'images

- Import par glisser-déposer (PNG, JPEG, WebP, GIF, WebP animés).
- Contrôle strict des fichiers : type réel, dimensions, fichiers piégés refusés, ré-encodage, miniatures.
- Quotas, catégories, tags, favoris, bibliothèque générale, packs ZIP, liens de fichiers signés.

### Parties et tokens

- Parties : création, archivage, corbeille. Membres et co-MJ.
- Tokens avec image, taille, vision et lumière, et rencontres préparées à l'avance.
- Cloisonnement strict entre les parties.

### Administration et hébergement

- Installeur web en 6 étapes, qui reprend là où il s'est arrêté. Fonctionne même sans JavaScript.
- Comptes : inscription ouverte, fermée ou sur invitation ; connexion, « se souvenir de moi », mot de passe oublié (SMTP optionnel), export et suppression des données personnelles.
- Console d'administration : comptes, quotas, invitations, réglages, envoi d'e-mail de test, diagnostic, journal d'audit, migrations, mise à jour.
- Interface en français, thème clair, sombre ou automatique, trois styles (moderne, fantasy, science-fiction).

## Installation

Le guide complet, avec le dépannage, est dans [docs/installation.md](docs/installation.md).

1. Téléchargez `jdr-v0.1.0-alpha.1-full.zip` depuis la [page des releases](https://github.com/collet-david-pro/JDR/releases) et décompressez-le sur votre ordinateur.
2. Avec un client FTP (FileZilla, par exemple), envoyez **tout le contenu** du dossier dans le dossier web de votre hébergement (souvent `www/` ou `public_html/`). Affichez les fichiers cachés : les fichiers `.htaccess` doivent être envoyés.
3. Dans le panneau de votre hébergeur, créez une base MySQL ou MariaDB. Notez le serveur, le port, le nom, l'utilisateur et le mot de passe. L'assistant peut aussi créer la base, si l'utilisateur en a le droit.
4. Ouvrez `https://votre-site/install.php` et suivez les 6 étapes : prérequis, base de données, site, administrateur, installation, fin.

Une fois l'installation terminée, supprimez `install.php` par FTP si l'assistant ne l'a pas fait.

### Prérequis

| Élément | Exigence |
|---|---|
| PHP | 8.1 ou plus récent |
| Extensions PHP obligatoires | `pdo_mysql`, `mbstring`, `json`, `fileinfo`, `gd`, `zlib`, `openssl`, `ctype`, `session` |
| Extensions facultatives | `imagick`, `apcu`, `zip`, `sodium` |
| Base de données | MySQL 5.7 ou plus, ou MariaDB 10.3 ou plus ; moteur InnoDB ; jeu de caractères `utf8mb4` |
| Droits de l'utilisateur de la base | `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `INDEX`, `REFERENCES`, `DROP` |
| Serveur web | Apache (fichiers `.htaccess`), LiteSpeed, ou Nginx ([docs/nginx.md](docs/nginx.md)) |
| Conseillé | HTTPS ; `memory_limit` de 128 Mo ou plus ; `upload_max_filesize` et `post_max_size` de 10 Mo ou plus |

La réécriture d'adresses (`mod_rewrite`) est conseillée mais pas obligatoire. Sans elle, le site fonctionne en mode « sans réécriture ». Le guide d'installation explique ce mode.

Le développement demande en plus Node.js 20.19 ou plus (22 LTS conseillé). Node ne sert qu'à construire le front : il n'est pas requis en production.

## Mise à jour

Une version installée peut être mise à jour depuis l'administration :

1. Connectez-vous en administrateur, puis ouvrez l'onglet **Mise à jour**.
2. Cliquez sur **Vérifier les mises à jour**. Le site consulte les releases GitHub.
3. Téléchargez le zip de mise à jour (`jdr-update-vX.Y.Z.zip`), puis envoyez-le au site.
4. Cliquez sur **Installer**. Le script `update.php` passe le site en maintenance, sauvegarde la base et les fichiers remplacés, copie les nouveaux fichiers, puis applique les migrations. Si la copie échoue, il revient en arrière tout seul ; si une migration échoue, il propose de réessayer ou de tout restaurer.

Vous pouvez aussi envoyer le zip de mise à jour par FTP, puis ouvrir `update.php` dans le navigateur : il termine le travail (contrôle des fichiers, sauvegarde, migrations).

Chaque release publie un fichier `SHA256SUMS` avec les empreintes officielles des archives. Le site s'en sert pour vérifier que le zip envoyé n'a pas été modifié ; s'il ne peut pas joindre GitHub, il demande une confirmation avant d'installer. La mise à jour automatique en un clic, avec des archives signées, viendra plus tard (phase 10).

Les archives de mise à jour ne contiennent ni `config.php`, ni `storage/`, ni `install.php` : vos données ne sont pas touchées.

## Feuille de route

| Phase | Contenu | État |
|---|---|---|
| P0 | Fondations : routeur, base, migrations, sécurité, build, outillage | ✅ |
| P1 | Installeur, comptes, administration | ✅ |
| P2 | Bibliothèque d'images et quotas | ✅ |
| P3 | Parties, membres, tokens, rencontres | ✅ |
| P4 | Éditeur de maps : moteur, outils, hors ligne, versions, import et export, PNG | ✅ |
| P5 | Murs, portes, fenêtres, lumières, vision, brouillard de guerre | ✅ |
| P6 | Séances en temps réel : code de séance, lobby, synchronisation | ✅ |
| P7 | Mode présentiel : écrans appairés, échelle réelle | ✅ |
| P8 | Génération procédurale : donjons, grottes, extérieurs, villages, textures | ✅ |
| P9 | MJ en séance : étages et escaliers, liens entre maps, notes et épingles du MJ, zones de texte à lire, secrets et pièges, modèles de maps, palette de commandes (Cmd+K) | à venir |
| P10 | Durcissement : revue de sécurité, accessibilité, performances et tests de charge, mise à jour automatique signée, sauvegarde et restauration, documentation d'exploitation | à venir |
| P11 | Grille hexagonale (option) | à venir |
| P12 | Tutoriels : aide intégrée au site et tutoriel | à venir |

Retirés du projet : traduction anglaise, co-édition en direct, carte du monde, WebSocket.

## Développement

Documentation détaillée : [dev/README.md](dev/README.md).

### Développement local

```bash
brew install php mysql node             # ou mariadb
brew services start mysql
mysql -u root -e "CREATE DATABASE jdr_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
cp config.example.php config.php        # adapter (jamais commité)
php dev/migrate.php                     # applique les migrations sur la base de config.php

cd frontend && npm ci && npm run build && cd ..
dev/serve.sh                            # PHP sur http://localhost:8000 (8 processus, requis pour le temps réel)
# ou, pour développer le front : cd frontend && npm run dev   (Vite sur http://localhost:5173)
```

Pour tester l'installation guidée de bout en bout, partez d'une copie sans `config.php` et ouvrez `install.php`.

### Tests

```bash
dev/get-phpunit.sh                       # une fois : télécharge dev/bin/phpunit.phar
php dev/bin/phpunit.phar -c phpunit.xml  # PHPUnit (base de test jdr_test)

cd frontend && npm run lint && npm run check && npm run test   # ESLint/Prettier, svelte-check/tsc, Vitest

cd e2e && npm ci && npx playwright install && npx playwright test   # bout en bout : Chromium, Firefox, WebKit
```

Les tests de bout en bout installent l'application dans une copie isolée, sur une base vierge, puis nettoient tout.

### Build et livraison

```bash
cd frontend && npm run build             # assets/ + sw.js + manifest.json
node dev/release.mjs verify              # contrôle manifest.json
node dev/release.mjs package             # dist/jdr-vX.Y.Z-full.zip et dist/jdr-update-vX.Y.Z.zip
```

- `jdr-vX.Y.Z-full.zip` : installation neuve (envoyer le contenu sur le serveur, puis ouvrir `install.php`).
- `jdr-update-vX.Y.Z.zip` : mise à jour, sans `install.php` ni `storage/` (installée avec `update.php`, voir la section Mise à jour).

## Documentation

- [docs/installation.md](docs/installation.md) : installation, configuration et dépannage
- [docs/nginx.md](docs/nginx.md) : configuration Nginx, dont le flux temps réel
- [docs/realtime.md](docs/realtime.md) : temps réel des séances (SSE, long polling, polling)
- [docs/irl.md](docs/irl.md) : mode présentiel (écrans de projection, calibrage, sécurité)
- [docs/procgen.md](docs/procgen.md) : génération procédurale (générateurs, sélection, déterminisme, pack de base, textures)
- [docs/architecture.md](docs/architecture.md) : architecture et décisions techniques
- [dev/README.md](dev/README.md) : environnement de développement et tests
- [CHANGELOG.md](CHANGELOG.md) : liste des changements, phase par phase
- [`VERSION`](VERSION) : version courante

## Technologies

| Domaine | Choix |
|---|---|
| Serveur | PHP 8.1 ou plus, sans dépendance externe ; MySQL ou MariaDB |
| Interface | Svelte 5, TypeScript, Vite |
| Rendu des maps | PixiJS 8 (WebGPU, repli WebGL2) |
| Calculs lourds | Web Workers (lumière, vision, génération) |
| Hors ligne | IndexedDB, Service Worker |
| Tests | PHPUnit 10, Vitest, Playwright (Chromium, Firefox, WebKit) |
| Intégration continue | GitHub Actions (en pause pendant l'alpha : les tests tournent en local) |

## Licence

À définir.
