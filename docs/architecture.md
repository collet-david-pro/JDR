# Architecture

Vue d'ensemble pour les contributeurs. JDR est une SPA (Svelte 5 + PixiJS) servie par un back-end PHP sans framework, conçu pour un hébergement mutualisé : pas de démon, pas de WebSocket, pas de Composer, pas de cron garanti.

```
Navigateur : SPA Svelte 5 ── moteur de scène Pixi ── Web Workers ── IndexedDB / Service Worker
      │  fetch JSON (/api/v1)              │  SSE → long polling → polling court
PHP : index.php → Router → Middleware → Controllers → services métier → repositories (PDO)
      Realtime (journal d'événements MySQL + fichiers témoins) · Imaging · Migrate
      │                                    │
MySQL / MariaDB                      storage/ (assets, journaux, sauvegardes, cache)
```

## Arborescence

La racine du dépôt est la racine envoyée par FTP, sauf les dossiers de développement.

| Chemin | Rôle | Livré |
|---|---|---|
| `index.php` | contrôleur frontal unique (pages + API) | oui |
| `install.php`, `update.php`, `cron.php` | installeur, mise à jour, tâches planifiées (clé) | oui (`install.php` absent de l'archive de mise à jour) |
| `.htaccess` | réécriture vers `index.php` + protections | oui |
| `VERSION`, `CHANGELOG.md`, `manifest.json` | version semver, journal, SHA-256 de chaque fichier livré | oui |
| `assets/`, `sw.js` | front compilé (noms hachés) et Service Worker, générés par le build | oui (non versionnés) |
| `app/` | code PHP privé, espace de noms `JDR\` (Core, Middleware, Domain, Http, Realtime, Imaging, Maps, Migrate, Mail, Views, Seed, Vendor) | oui |
| `migrations/` | `NNNN_description.sql` / `.php`, jamais modifiées une fois publiées | oui |
| `i18n/` | traductions partagées PHP / front | oui |
| `storage/` | données d'exécution (assets, sauvegardes, journaux, cache, verrous) ; jamais écrasé | squelette seulement |
| `config.php` | généré par l'installeur | jamais |
| `frontend/` | sources du front (Svelte, TypeScript, Vite) | non |
| `tests/` | PHPUnit, Playwright, fichiers de test | non |
| `dev/` | scripts (serveur local, release, migrations), Docker Compose | non |
| `docs/` | documentation | non |

### Protection des dossiers privés

L'hébergeur ne permet pas toujours de choisir la racine web : tout ce qui est livré est donc public par défaut. `app/`, `migrations/`, `storage/` et `i18n/` sont protégés par **trois** mécanismes : un `.htaccess` (« deny all »), un `index.php` qui renvoie 403, et une garde en tête de chaque fichier PHP privé :

```php
declare(strict_types=1);
defined('JDR_BOOT') || exit;
```

L'installeur vérifie par une vraie requête HTTP que ces dossiers sont inaccessibles. Sous Nginx, voir [nginx.md](nginx.md).

## Décisions structurantes

| # | Sujet | Décision |
|---|---|---|
| D1 | Back-end | PHP ≥ 8.1, sans framework ni Composer en production, autoloader PSR-4 maison |
| D2 | Base | MySQL ≥ 5.7 / MariaDB ≥ 10.3, InnoDB, `utf8mb4`, préfixe de tables configurable (`jdr_`) |
| D3 | Front | Svelte 5 (runes) + TypeScript strict + Vite, SPA sans SvelteKit |
| D4 | Rendu | PixiJS v8 (WebGPU, repli WebGL2) |
| D5 | Calculs lourds | Web Workers (+ `OffscreenCanvas`) : vision, génération, export, décodage d'animations |
| D6 | Temps réel | journal d'événements MySQL + transport SSE → long polling → polling court, détecté automatiquement |
| D7 | Grille | carrée ; hexagonale prévue plus tard (`grid_type`) |
| D8 | Confiance | pas d'anti-triche poussé, mais les contenus MJ ne sont jamais envoyés aux joueurs ni aux écrans |
| D9 | Brouillard strict | `fog_strict` (activé par défaut) : les zones non explorées ne sont pas envoyées |
| D10 | Collision | les tokens des joueurs ne traversent pas les murs ni les portes fermées (contrôle serveur) |
| D11 | Langue | interface en français d'abord, toutes les chaînes externalisées |
| D12 | E-mail | optionnel (SMTP) ; sans e-mail, réinitialisation par l'admin |
| D13 | Fichiers | hors base, dans `storage/`, servis par PHP avec des URL signées (HMAC) |
| D14 | Schéma | uniquement par migrations numérotées, même moteur pour l'installation et la mise à jour |
| D15 | Séances | table `play_sessions` (pas `sessions`) |
| D16 | Canaux | événements rattachés à un canal (`session:{id}`, `map:{id}`) |

## Cycle d'une requête

`index.php` définit `JDR_BOOT`, charge `app/bootstrap.php` (autoload, configuration, gestion des erreurs, en-têtes de sécurité), puis le routeur résout la route : en mode `rewrite` depuis le chemin de l'URL, en mode `query` depuis `index.php?r=/chemin`. Les middlewares (JSON, maintenance, puis session, CSRF, limitation de débit) précèdent le contrôleur. Toute exception typée est convertie en réponse JSON par un gestionnaire unique :

```json
{ "ok": true,  "data": { }, "meta": { } }
{ "ok": false, "error": { "code": "…", "message": "…", "fields": { } } }
```

## Migrations et mises à jour

- Chaque migration appliquée est enregistrée avec son empreinte SHA-256 ; une empreinte modifiée bloque la mise à jour. La CI refuse toute modification d'une migration déjà publiée.
- Les migrations sont rejouables (le DDL MySQL n'est pas transactionnel) et appliquées une par requête pour tenir dans `max_execution_time`.
- `update.php` contrôle d'abord les fichiers envoyés avec `manifest.json`, sauvegarde la base, active la maintenance, puis migre.

## Livraison

`dev/release.mjs` calcule `manifest.json` et produit les archives `jdr-vX.Y.Z-full.zip` (installation) et `jdr-update-vX.Y.Z.zip` (mise à jour, sans `install.php` ni `storage/`). Détails : [dev/README.md](../dev/README.md).
