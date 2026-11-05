# app/Domain/Procgen

Pack de base : assets générés installés dans la bibliothèque générale.

## Fichiers clés

- `BasePackInstaller.php` : installation par tranches, idempotente
- `BasePackManifest.php` : lit et valide `app/Seed/base-pack/pack.json`

## Invariants

- Installation reprenable et rejouable sans doublons.
- Une version de manifeste différente déclenche une remise à niveau.

## Tests

- `tests/php/Procgen/`
