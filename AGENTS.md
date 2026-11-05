# AGENTS.md

Point d'entrée pour tout agent IA ou mainteneur qui modifie Clairvoie (dépôt JDR) : application web de table de jeu de rôle, SPA Svelte 5 + PixiJS servie par un back-end PHP sans framework, pensée pour un hébergement mutualisé (pas de démon, pas de WebSocket, pas de Composer, pas de cron garanti).

Lire ensuite : [docs/dev/architecture.md](docs/dev/architecture.md), [docs/dev/decisions.md](docs/dev/decisions.md), [docs/dev/recettes.md](docs/dev/recettes.md). Environnement local détaillé : [dev/README.md](dev/README.md).

## Carte du dépôt

| Chemin | Rôle |
|---|---|
| `index.php`, `install.php`, `update.php`, `cron.php` | contrôleur frontal, installeur, mise à jour, tâches planifiées |
| `app/` | PHP privé, espace de noms `JDR\` : `Core` (routeur, conteneur, base, cron), `Middleware`, `Http` (contrôleurs, `routes/*.php`), `Domain/*` (métier), `Realtime`, `Imaging`, `Maps`, `Migrate`, `Install`, `Mail`, `Views`, `Seed`, `Zip` |
| `migrations/` | `NNNN_description.sql` ou `.php`, jamais modifiées une fois livrées |
| `i18n/` | traductions partagées PHP et front (`fr.json`) |
| `frontend/` | sources du front (Svelte 5, TypeScript, Vite) : `src/{components,pages,lib,editor,engine,scene,vision,procgen,workers,stores,help}`, tests Vitest dans `frontend/tests` |
| `assets/`, `sw.js`, `manifest.json` | sortie du build front et empreintes des fichiers livrés (générés) |
| `tests/php/` | PHPUnit (un dossier par domaine, `Security/` pour les fuites et les droits) |
| `e2e/` | Playwright (bout en bout, captures de l'aide dans `e2e/shots`) |
| `dev/` | scripts (serveur local, migrations, release, budget du bundle, test de charge), Docker Compose |
| `docs/` | documentation utilisateur et administrateur ; `docs/dev/` pour les contributeurs |
| `storage/` | données d'exécution (assets, sauvegardes, journaux, cache) ; jamais écrasé par une mise à jour |
| `config.php` | généré par l'installeur ou copié de `config.example.php` ; jamais commité ni livré |

`etapes/`, `projet.md`, `SUITE.md` et `MAJ.md` sont des notes de pilotage locales, non versionnées : ne pas s'y fier dans le dépôt public (les décisions utiles sont reprises dans `docs/dev/decisions.md`).

## Stack

PHP >= 8.1 (autoloader PSR-4 maison, PDO, aucune dépendance Composer en production) ; MySQL >= 5.7 / MariaDB >= 10.3 ; Svelte 5 (runes), TypeScript strict, Vite 8, PixiJS v8 ; PHPUnit 10 (PHAR dans `dev/bin`), Vitest, Playwright ; Node >= 20.

## Conventions

- **Langues** : code, identifiants, tables, colonnes, commits et commentaires en anglais ; interface et documentation en français.
- **Commits** : `type(scope): résumé` en anglais (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`), petits, une intention chacun. Ne jamais commiter `config.php`, `storage/*` (hors squelette), `node_modules/`, `.env`, clé de signature.
- **Chaînes d'interface** : jamais en dur ; clés dans `i18n/fr.json`, utilisées par `t('cle')` côté front et `I18n` côté PHP. `frontend/tests/i18n-keys.test.ts` échoue si une clé littérale manque.
- **Garde PHP** : chaque fichier PHP privé commence par `declare(strict_types=1); defined('JDR_BOOT') || exit;`.
- **SQL** : requêtes préparées uniquement ; pas de `ENUM`, colonne générée, `CHECK`, fonction JSON SQL, trigger (portabilité MySQL 5.7 / MariaDB 10.3).
- **Dépendances** : aucune nouvelle dépendance serveur ; côté front, justifier toute dépendance npm.
- **Tests** : toute fonctionnalité arrive avec ses tests. Pendant le travail, lancer seulement les tests ciblés ; la suite complète une fois, à la fin.
- **Verrous** : sur une machine partagée, ne jamais lancer deux PHPUnit ensemble, ni un build en même temps qu'un E2E. Préfixer par `lockf /tmp/jdr-phpunit.lock` (PHPUnit) et `lockf /tmp/jdr-build.lock` (build, E2E, test de charge) ; les deux s'enchaînent : `lockf /tmp/jdr-phpunit.lock lockf /tmp/jdr-build.lock <commande>`.
- **Pas de pull request** : le projet n'en accepte pas (forks libres, voir README).

## Commandes

```bash
php dev/migrate.php                                              # applique les migrations sur la base de config.php
dev/get-phpunit.sh                                               # une fois : télécharge dev/bin/phpunit.phar
cd frontend && npm ci                                            # dépendances du front
cd frontend && npm run build                                     # assets/, sw.js, manifest.json + budget du bundle
cd frontend && npm run check                                     # svelte-check + tsc
cd frontend && npm run lint                                      # ESLint + Prettier
cd frontend && npm run test                                      # Vitest ; ciblé : npx vitest run tests/<fichier>
php dev/bin/phpunit.phar -c phpunit.xml                          # PHPUnit (base jdr_test, vidée par les tests) ; ciblé : --filter NomDuTest
php -l fichier.php                                               # contrôle de syntaxe d'un fichier touché
cd e2e && npm ci && npx playwright install && npx playwright test   # E2E ; ciblé : npx playwright test tests/<fichier>.spec.ts
dev/serve.sh                                                     # PHP sur http://localhost:8000 (8 processus, requis pour le temps réel)
```

Captures de l'aide (après un build) : `cd e2e && E2E_HELP_SHOTS=1 E2E_BROWSERS=chromium npx playwright test --project=help-shots` (script `e2e/shots/help-shots.ts`, sortie dans `frontend/src/help/img/`).

## Release signée

1. Mettre à jour `VERSION` et la section correspondante de `CHANGELOG.md`, commiter (`chore(release): X.Y.Z`).
2. `cd frontend && npm run build` (écrit aussi `manifest.json`), puis `node dev/release.mjs verify`.
3. `node dev/release.mjs package` produit dans `dist/` : `jdr-vX.Y.Z-full.zip`, `jdr-update-vX.Y.Z.zip`, `SHA256SUMS` et `SHA256SUMS.sig`.
4. La signature est Ed25519, faite avec une clé **hors dépôt** (`JDR_RELEASE_KEY` ou `~/.config/jdr/release-ed25519.pem`, créée une fois par `node dev/release-key.mjs`). Sans clé, l'archive est non signée et la mise à jour automatique la refuse. Ne jamais commiter ni afficher la clé privée ; la clé publique vérifiée par `app/Domain/Update/ReleaseSignature.php` est dans le code.
5. Ne publier (tag, release GitHub) et ne pousser que sur demande explicite du propriétaire.

## Règles de sécurité à ne jamais casser

- **Filtrage d'audience** : tout événement porte une audience (`all`, `gm`, `players`, `displays`, `user`) ; un changement visible différemment selon le public produit plusieurs événements, jamais un payload filtré à la volée. Aucun contenu MJ (objets `visibility = gm`, notes MJ, tokens cachés, calque MJ, blocs hors portée avec `fog_strict`) ne doit atteindre un joueur ou un écran, ni par événement, ni par instantané. Tout nouveau type d'événement s'ajoute à `app/Domain/Sessions/EventTypes.php` et au test `tests/php/Security/LeakTest.php`.
- **Données joueur** : les réponses destinées aux joueurs passent par les présentateurs et vues dédiés (`PlayerView`, `TableView`, `SessionPresenter`), pas par les lignes brutes.
- **URL signées des assets** : les fichiers sont servis par PHP avec URL signée HMAC (`app/Core/Signer.php`, `app/Domain/Assets/AssetUrls.php`) ; jamais de chemin direct vers `storage/`.
- **CSRF** : tout appel non-GET exige `X-CSRF-Token` (`app/Middleware/Csrf.php`) ; ne pas ajouter d'exception sans raison.
- **Mode maintenance** : pendant une mise à jour ou une restauration, seuls les administrateurs et la connexion sont servis ; une route qui doit rester joignable le déclare (`maintenance_exempt`).
- **Migrations** : jamais de modification d'une migration livrée (l'empreinte SHA-256 bloque la mise à jour) ; rejouables ; étendre puis contracter. Voir la recette dans `docs/dev/recettes.md`.
- **Couverture des routes** : toute route API est listée dans `tests/php/Security/RouteCoverageTest.php` avec son niveau d'accès et le test qui prouve les droits par objet ; une route ajoutée sans y figurer fait échouer le test.
- **Sessions PHP et flux longs** : les routes SSE et long polling appellent `session_write_close()` avant d'attendre.
- **Journaux** : jamais de mot de passe, jeton, code complet, cookie ou corps de requête d'authentification.
- **Budget du bundle** : `dev/bundle-budget.mjs` (appelé par `npm run build`) impose 150 Ko gzip pour le graphe initial et 600 Ko pour l'éditeur ; un build qui dépasse échoue.
- **Dossiers privés** : `app/`, `migrations/`, `storage/`, `i18n/` restent protégés (`.htaccess`, `index.php` en 403, garde `JDR_BOOT`).
