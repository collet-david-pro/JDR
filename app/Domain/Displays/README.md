# app/Domain/Displays

Écrans de projection (la « table ») : appairage par code, réglages, état en direct.

## Fichiers clés

- `DisplayService.php` : création, liste, réglages et révocation par le MJ
- `DisplayDevice.php` : ce que l'écran fait pour lui-même : s'appairer, lire son état
- `DisplayAuth.php` : identité de l'écran, cookie `jdr_display`, seul son hash est stocké
- `PairingCode.php` : code à 6 chiffres, stocké en HMAC, valable 10 minutes
- `DisplayWatch.php` : revalide l'écran toutes les 5 s pendant ses lectures temps réel
- `DisplayEvents.php` : événements `display.*`
- `DisplayCleanup.php` : révoque les écrans à la fin d'une séance

## Invariants

- Le code d'appairage et le jeton ne sont jamais journalisés ni stockés en clair.
- Un écran révoqué voit son flux fermé.
- Un écran ne lit que ce que la vue « table » autorise.

## Tests

- `tests/php/Displays/`
