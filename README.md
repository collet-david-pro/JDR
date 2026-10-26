# JDR

Outil web de **construction et de projection de maps** pour le jeu de rôle : le MJ construit ses cartes (à la main ou, plus tard, par génération procédurale), les organise par partie et les projette à ses joueurs, en ligne ou en présentiel (écran posé sur la table, vidéoprojecteur). Les joueurs découvrent la map au fil de l'exploration (vision des tokens, brouillard de guerre).

Ce n'est **pas un VTT de règles** : ni dés, ni initiative, ni fiches, ni points de vie.

Conçu pour un **hébergement PHP/MySQL sans dépendance serveur** (mutualisé classique ou auto-hébergement, Apache ou Nginx) : installation par simple envoi des fichiers puis `install.php`, aucune extension exotique, aucun démon, aucun Composer en production.

> **État : en développement — version 0.1.0 (non publiée).** Les phases 0 à 6 de la feuille de route sont terminées (voir ci-dessous et [CHANGELOG.md](CHANGELOG.md)). Pas encore prêt pour la production.

## Ce qui fonctionne aujourd'hui

- **Installation guidée** (`install.php`, 6 étapes, fonctionne même sans JavaScript, reprise après interruption) ; détection automatique du mode de routage (réécriture d'URL ou non).
- **Comptes** : inscription (ouverte, fermée ou sur invitation), connexion, « se souvenir de moi », mot de passe oublié (SMTP optionnel), limitation des tentatives, profil, export et suppression des données personnelles.
- **Administration** : comptes, quotas, invitations, réglages, envoi d'e-mail de test, diagnostic (dont test du flux temps réel), journal d'audit, migrations.
- **Bibliothèque d'images** : import par glisser-déposer (PNG, JPEG, WebP, GIF et WebP animés), contrôle strict des fichiers (type réel, dimensions, animations, fichiers piégés refusés, ré-encodage), miniatures, quotas, catégories, tags, favoris, bibliothèque générale, packs ZIP, liens de fichiers signés.
- **Parties** : création, archivage, corbeille ; membres (joueurs, co-MJ) ; **tokens** (image, taille, vision, lumière) et **rencontres** préparées ; cloisonnement strict entre parties.
- **Éditeur de maps** (WebGPU, repli WebGL2) : grille carrée et thèmes de grille, calques, tuiles par blocs, pinceau, gomme, remplissage, formes, sélection, pipette, règle, annuler/rétablir, raccourcis clavier, trackpad.
  - Enregistrement automatique avec **file d'attente hors ligne** (aucune perte en cas de coupure réseau ou de fermeture brutale de l'onglet).
  - **Historique de versions** restaurable, **export/import** JSON ou ZIP (images incluses), miniatures.
  - **Export PNG** haute résolution (×1, ×2, ×4 ou personnalisé, jusqu'à de très grandes images, fond transparent, mode impression en pages A4/A3/Letter), avec tokens, éclairage et brouillard en option.
- **Murs, lumière, vision et brouillard** : outils Mur (`W`, polyligne ou pièce, aimantation), Porte/fenêtre (`D`, posée sur un mur qu'elle découpe ; portes ouvertes/fermées, verrouillées, secrètes), Lumière (`L`, préréglages torche, lanterne, bougie, feu de camp, lumière magique ; couleur, vacillement, cônes), Token (`K`), Révéler/masquer (`F`, pinceau, rectangle ou pièce entière).
  - Lumière et vision **arrêtées par les murs** (calcul dans un worker), ambiance (obscurité, teinte, cycle jour/nuit), ombres portées.
  - **Brouillard de guerre** explorable et enregistré ; vue **« comme le joueur »** (un token ou tous les PJ) ; panneaux Propriétés, Tokens et Ambiance.
- **Séances** : code de séance, lobby et préchargement, console MJ (joueurs, affectations, tokens, révéler, ambiance, notes, maps), vue joueur (vision, murs infranchissables, exploration), pause, textes à lire, expulsion ; temps réel SSE → long polling → polling avec bascule automatique, un seul flux par navigateur, rattrapage sans doublon ; brouillard strict et filtrage anti-fuite côté serveur.
- Interface en français, thème clair/sombre/automatique et plusieurs styles d'interface (moderne, fantasy, science-fiction).

## Feuille de route

| Phase | Contenu | État |
|---|---|---|
| P0 | Fondations : routeur, base, migrations, sécurité, build, outillage | ✅ |
| P1 | Installeur, comptes, administration | ✅ |
| P2 | Bibliothèque d'images et quotas | ✅ |
| P3 | Parties, membres, tokens, rencontres | ✅ |
| P4 | Éditeur de maps (moteur, outils, persistance hors ligne, versions, import/export, export PNG) | ✅ |
| P5 | Murs, portes, fenêtres, lumières, vision des tokens, brouillard de guerre | ✅ |
| P6 | Séances de jeu en temps réel (code de séance, lobby, synchronisation) | ✅ |
| P7 | Mode présentiel : écrans de projection appairés, échelle réelle | à venir |
| P8 | Génération procédurale (donjons, grottes, extérieurs, villages, textures) | à venir |
| P9 | Outils MJ avancés (étages, notes, liens entre maps, co-édition…) | à venir |
| P10 | Durcissement : sécurité, performances, accessibilité, sauvegardes, mises à jour (`update.php`) | à venir |
| P11 | Options : grille hexagonale, WebSocket, anglais | à venir |

## Prérequis

| Usage | Logiciels |
|---|---|
| Production | PHP ≥ 8.1 (`pdo_mysql`, `gd`, `mbstring`, `fileinfo`, `openssl`, `zlib` ; `zip` et `imagick` optionnels), MySQL ≥ 5.7 ou MariaDB ≥ 10.3, Apache (`.htaccess` fourni) ou Nginx ([docs/nginx.md](docs/nginx.md)) |
| Développement | les mêmes + Node.js ≥ 20.19 (22 LTS conseillé) — uniquement pour construire le front, jamais requis en production |

## Développement local

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

Pour tester l'installation guidée de bout en bout, partir d'une copie sans `config.php` et ouvrir `install.php`. Détails (base de test, Docker optionnel, variables) : [dev/README.md](dev/README.md).

## Tests

```bash
dev/get-phpunit.sh                       # une fois : télécharge dev/bin/phpunit.phar
php dev/bin/phpunit.phar -c phpunit.xml  # PHPUnit (base de test jdr_test)

cd frontend && npm run lint && npm run check && npm run test   # ESLint/Prettier, svelte-check/tsc, Vitest

cd e2e && npm ci && npx playwright install && npx playwright test   # bout en bout : Chromium, Firefox, WebKit
```

Les tests de bout en bout installent l'application dans une copie isolée, sur une base vierge, puis nettoient tout.

## Build et livraison

```bash
cd frontend && npm run build             # assets/ + sw.js + manifest.json
node dev/release.mjs verify              # contrôle manifest.json
node dev/release.mjs package             # dist/jdr-vX.Y.Z-full.zip et dist/jdr-update-vX.Y.Z.zip
```

- `jdr-vX.Y.Z-full.zip` : installation neuve (envoyer le contenu sur le serveur, puis ouvrir `install.php`).
- `jdr-update-vX.Y.Z.zip` : mise à jour sans `install.php` ni `storage/` (la procédure `update.php` arrive en phase 10).

## Documentation

- [docs/installation.md](docs/installation.md) — installation et dépannage
- [docs/nginx.md](docs/nginx.md) — configuration Nginx (dont le flux temps réel)
- [docs/realtime.md](docs/realtime.md) — temps réel des séances (SSE, long polling, polling)
- [docs/architecture.md](docs/architecture.md) — architecture et décisions techniques
- [dev/README.md](dev/README.md) — environnement de développement et tests

La version courante est dans [`VERSION`](VERSION).
