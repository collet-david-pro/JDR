# Environnement de développement

Deux façons de faire tourner JDR en local :

- **Option A — Homebrew** : rapide, PHP intégré (`php -S`). Ne lit pas les `.htaccess`.
- **Option B — Docker Compose** : Apache + `mod_php` + MariaDB, fidèle à un hébergement mutualisé (`.htaccess`, compression, tampons de sortie). Recommandée pour valider les protections et le flux SSE.

Le front (Vite) tourne dans les deux cas sur la machine hôte.

## Option A — Homebrew

```bash
brew install php mariadb node          # ou mysql à la place de mariadb
brew services start mariadb
mysql -u root -e "CREATE DATABASE jdr_dev  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -e "CREATE DATABASE jdr_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Configuration locale : copier `config.example.php` en `config.php` à la racine (fichier ignoré par git, jamais livré). Pour partager le même fichier avec l'option B, lire l'hôte de la base depuis l'environnement :

```php
'db' => [
    'host' => getenv('JDR_DB_HOST') ?: '127.0.0.1',
    'port' => (int) (getenv('JDR_DB_PORT') ?: 3306),
    'name' => 'jdr_dev',
    'user' => 'root',
    'pass' => '',            // option B : utilisateur 'jdr' / mot de passe 'jdr' (ou root / root)
    'prefix' => 'jdr_',
],
'base_url' => getenv('JDR_BASE_URL') ?: 'http://localhost:8000',
```

Lancer :

```bash
php dev/migrate.php                    # applique les migrations sur la base de config.php
dev/serve.sh                           # http://localhost:8000  (PORT=8080 dev/serve.sh pour changer)
cd frontend && npm ci && npm run dev   # autre terminal : http://localhost:5173, proxy /api → :8000
```

`dev/serve.sh` lance `PHP_CLI_SERVER_WORKERS=8 php -S localhost:8000 index.php`. **Les 8 processus sont indispensables** : le serveur intégré est sinon mono-processus et un seul flux SSE (`/api/v1/stream`) bloque tout le site. `index.php` sert de routeur : il sert lui-même les fichiers statiques et refuse (403) les dossiers privés, puisque `php -S` ignore les `.htaccess`.

Mode de routage `query` (hébergeur sans `mod_rewrite`) : `http://localhost:8000/index.php?r=/api/v1/health`.

## Option B — Docker Compose

Fichiers : `dev/docker-compose.yml`, `dev/docker/php/` (image Apache + PHP), `dev/docker/db/init/` (création de `jdr_test`).

```bash
docker compose -f dev/docker-compose.yml up -d --build      # web + db
docker compose -f dev/docker-compose.yml --profile mail up -d   # + Mailpit (SMTP)
docker compose -f dev/docker-compose.yml logs -f web
docker compose -f dev/docker-compose.yml down               # arrêt (down -v efface la base)
```

| Service | Accès depuis l'hôte | Depuis le conteneur `web` | Détails |
|---|---|---|---|
| `web` | http://localhost:8080 | — | `php:8.1-apache`, `rewrite` + `headers`, `pdo_mysql`, `gd` (jpeg, webp, freetype), `zip` ; dépôt monté en `/var/www/html` ; `AllowOverride All` |
| `db` | `127.0.0.1:3307` | `db:3306` | `mariadb:10.3`, volume `db-data` ; bases `jdr_dev` et `jdr_test` ; utilisateur `jdr`/`jdr`, root/`root` |
| `mail` (profil `mail`) | http://localhost:8025 (interface), SMTP `localhost:1025` | `mail:1025` | Mailpit, capture tous les e-mails |

Le conteneur `web` exporte `JDR_DB_HOST=db`, `JDR_DB_PORT=3306`, `JDR_BASE_URL=http://localhost:8080`, `JDR_SMTP_HOST=mail`, `JDR_SMTP_PORT=1025` : avec le `config.php` ci-dessus, le même fichier sert aux deux options (adapter `user`/`pass`).

Le PHP du conteneur est réglé comme un mutualisé courant (`dev/docker/php/php.ini` : `output_buffering=4096`, `mod_deflate` actif) pour éprouver le flux SSE et ses parades.

Variantes (variables d'environnement ou fichier `dev/.env`, ignoré par git) :

```bash
PHP_VERSION=8.3 docker compose -f dev/docker-compose.yml up -d --build   # autre version de PHP
DB_IMAGE=mysql:8.0 docker compose -f dev/docker-compose.yml up -d        # MySQL au lieu de MariaDB
```

Changer d'image de base demande de recréer le volume (`down -v`) : les fichiers de données MariaDB et MySQL ne sont pas interchangeables.

> Sous Linux, si `storage/` n'est pas inscriptible par Apache : `chmod -R a+rwX storage` (dev uniquement).

## Base de test et tests PHP

PHPUnit est un PHAR de développement, jamais livré :

```bash
dev/get-phpunit.sh                       # télécharge dev/bin/phpunit.phar (PHPUnit 10)
php dev/bin/phpunit.phar -c phpunit.xml
```

Les tests utilisent une base dédiée, **vidée par les tests** : ne jamais la faire pointer vers `jdr_dev`. Paramètres par variables d'environnement (défauts entre parenthèses) :

| Variable | Défaut | CI |
|---|---|---|
| `JDR_TEST_DB_HOST` | `127.0.0.1` | `127.0.0.1` |
| `JDR_TEST_DB_PORT` | `3306` | `3306` |
| `JDR_TEST_DB_NAME` | `jdr_test` | `jdr_test` |
| `JDR_TEST_DB_USER` | `root` | `root` |
| `JDR_TEST_DB_PASS` | *(vide)* | `root` |
| `JDR_TEST_DB_PREFIX` | `jdrt_` | `jdrt_` |

Contre la base Docker : `JDR_TEST_DB_PORT=3307 JDR_TEST_DB_PASS=root php dev/bin/phpunit.phar -c phpunit.xml`.

Style PHP (PSR-12, facultatif en local) : `phpcs` à la racine (règles dans `phpcs.xml`).

## Tests front

```bash
cd frontend
npm run lint      # ESLint + Prettier
npm run check     # svelte-check / TypeScript
npm run test      # Vitest
```

## Build et livraison

```bash
cd frontend && npm run build      # vite build (→ assets/, sw.js) puis node ../dev/release.mjs manifest
node dev/release.mjs verify       # recalcule les SHA-256 et compare à manifest.json (code ≠ 0 si écart)
node dev/release.mjs package      # régénère manifest.json puis produit dist/*.zip
```

`dev/release.mjs` (Node ≥ 20, sans dépendance npm) :

- **`manifest`** écrit `manifest.json` : `{ "version", "generated_at", "files": { "chemin": "sha256" } }`, chemins triés, séparateur `/`.
  - Livrés : `index.php`, `install.php`, `update.php`, `cron.php`, `.htaccess`, `VERSION`, `CHANGELOG.md`, `sw.js`, `assets/`, `app/`, `migrations/`, `i18n/`, et le squelette de `storage/` (`storage/.htaccess`, `storage/index.php`, `storage/**/.gitkeep`). Les fichiers absents sont ignorés.
  - Jamais livrés : `config.php`, `config.example.php`, `frontend/`, `tests/`, `dev/`, `docs/`, `node_modules/`, `dist/`, `.git*`, `.github/`, `.vscode/`, `phpunit.xml`, `phpcs.xml`, le contenu de `storage/`, les fichiers cachés (sauf `.htaccess`), les liens symboliques.
- **`package`** produit :
  - `dist/jdr-vX.Y.Z-full.zip` : tout le livrable + `manifest.json` ;
  - `dist/jdr-update-vX.Y.Z.zip` : identique **sans** `install.php` ni `storage/`.

  Les fichiers sont à la racine de l'archive (à extraire puis envoyer tels quels par FTP). Chaque archive est relue et contrôlée (CRC) puis testée par `unzip -t` si disponible. `SOURCE_DATE_EPOCH=<secondes>` rend les archives reproductibles.
- **`verify`** sert en CI après le build.

La version vient du fichier `VERSION` à la racine (semver) : la modifier à la main avant une livraison, avec la section correspondante de `CHANGELOG.md`.

## Intégration continue

`.github/workflows/ci.yml` : `php-lint` (`php -l`, PHPCS informatif), `phpunit` (PHP 8.1/8.3 × MariaDB 10.3/MySQL 8.0), `frontend` (Node 22 : lint, check, test, build, `release.mjs verify`, archives en artefact), `migrations-frozen` (échec si une migration `NNNN_*.sql|php` déjà présente sur `main` ou dans un tag `v*` est modifiée, supprimée ou renommée), `e2e` Playwright (désactivé jusqu'à la phase 1).
