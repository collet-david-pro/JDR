# app/Middleware

Middlewares de la chaîne HTTP, dans l'ordre de `App::handle()` : JSON, maintenance, session, authentification, accès en maintenance, CSRF, limitation de débit.

## Fichiers clés

- `Maintenance.php, MaintenanceGate.php` : 503 hors installation ou en maintenance
- `Session.php` : session paresseuse
- `Json.php` : type et taille du corps
- `Auth.php` : utilisateur ou écran, `auth` / `role`
- `Csrf.php` : jeton `X-CSRF-Token` sur les méthodes non sûres
- `RateLimit.php` : seaux de limitation

## Invariants

- Les options de route pilotent leur comportement.
- Une route peut se dispenser de CSRF ou de session seulement par option explicite.

## Tests

- `tests/php/Core/`
- `tests/php/Api/`
- `tests/php/Security/`
