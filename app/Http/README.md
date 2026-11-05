# app/Http : routes et contrôleurs

Couche HTTP de l'API : déclaration des routes et contrôleurs fins. Un contrôleur lit la requête, appelle un service de `app/Domain/`, enveloppe le résultat dans `Response::ok()`. Aucune règle métier ici.

## Fichiers clés

- `routes.php` : charge les fichiers de `routes/` dans l'ordre alphabétique
- `routes/NN-*.php` : une famille de routes par fichier (auth, admin, assets, games, maps, realtime, sessions, displays, ...)
- `Controllers/` : un contrôleur par ressource, méthodes `index/show/create/update/delete` ou verbe métier
- `Shell.php` : coquille HTML de la SPA (nonce CSP, données de démarrage)
- `ViteManifest.php` : lecture du manifeste Vite pour injecter les bons fichiers

## Invariants

- Chaque route déclare ses options : `auth`, `role`, `rate`, `session`, `csrf`, `raw_body`, `maintenance_exempt`. Une route sans option d'accès est une anomalie.
- Les droits sont vérifiés par les politiques du domaine (`*Policy`, `*Access`), jamais dans la route seule.
- `tests/php/Security/RouteCoverageTest.php` échoue si une route n'est pas couverte par un test de droits : l'ajouter en même temps que la route.
- Les réponses d'erreur passent par les exceptions de `app/Core/Errors/`.

## Tests

- `tests/php/Http/ (App, ViteManifest)`
- `tests/php/Api/`
- `tests/php/Security/RouteCoverageTest.php`

Pour ajouter une route, voir `docs/dev/recettes.md`.
