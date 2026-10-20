# JDR

Outil web de **construction et de projection de maps** pour le jeu de rôle : le MJ construit ses cartes (à la main ou par génération procédurale), les organise par partie et les projette à ses joueurs, en ligne ou en présentiel (écran sur la table, vidéoprojecteur). Les joueurs découvrent la map au fil de l'exploration (vision des tokens, brouillard de guerre).

Ce n'est pas un VTT de règles : ni dés, ni initiative, ni fiches.

Conçu pour un **hébergement PHP/MySQL mutualisé** : installation par FTP + `install.php`, mises à jour sans perte de données via `update.php`, aucune dépendance serveur.

> État : en développement (phase 0, fondations). Voir [CHANGELOG.md](CHANGELOG.md).

## Prérequis

| Usage | Logiciels |
|---|---|
| Production | PHP ≥ 8.1 (`pdo_mysql`, `gd`, `zip`), MySQL ≥ 5.7 ou MariaDB ≥ 10.3, Apache (`.htaccess`) ou Nginx ([docs/nginx.md](docs/nginx.md)) |
| Développement | les mêmes + Node.js 22 LTS (front uniquement, jamais requis en production) |

## Développement local (option A, Homebrew)

```bash
brew install php mariadb node
brew services start mariadb
mysql -u root -e "CREATE DATABASE jdr_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
cp config.example.php config.php        # puis adapter (jamais commité)

dev/serve.sh                             # PHP sur http://localhost:8000 (8 processus, requis pour le SSE)
cd frontend && npm ci && npm run dev     # autre terminal : Vite sur http://localhost:5173
```

L'environnement Docker (Apache + MariaDB, plus fidèle à la production) et tous les détails sont dans [dev/README.md](dev/README.md).

## Tests

```bash
dev/get-phpunit.sh                       # une fois : télécharge dev/bin/phpunit.phar
php dev/bin/phpunit.phar -c phpunit.xml  # base de test jdr_test (voir dev/README.md)

cd frontend && npm run lint && npm run check && npm run test
```

## Build et livraison

```bash
cd frontend && npm run build             # assets/ + sw.js + manifest.json
node dev/release.mjs verify              # contrôle manifest.json
node dev/release.mjs package             # dist/jdr-vX.Y.Z-full.zip et dist/jdr-update-vX.Y.Z.zip
```

- `jdr-vX.Y.Z-full.zip` : installation neuve (envoyer le contenu par FTP, puis ouvrir `install.php`).
- `jdr-update-vX.Y.Z.zip` : mise à jour (sans `install.php` ni `storage/`), à envoyer par-dessus l'installation, puis ouvrir `update.php`.

La version courante est dans [`VERSION`](VERSION). Documentation d'exploitation : [docs/](docs/).
