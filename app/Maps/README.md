# app/Maps : moteur de cartes

Logique pure des cartes (sans SQL direct) : codecs, règles de validation et application des opérations. Les dépôts SQL sont dans `app/Domain/Maps/`.

## Fichiers clés

- `ChunkCodec.php, FogCodec.php` : format binaire des chunks et du brouillard
- `OpsApplier.php, SceneApplier.php, FloorApplier.php` : application des opérations
- `ObjectRules*.php, TokenRules.php` : règles de validation des objets et jetons
- `PlayerFilter.php` : version d'une carte que voit un joueur
- `Collision.php` : segments de collision et rayons
- `Document/` : migration du document de carte

## Invariants

- Pas d'accès SQL : tout passe par les interfaces `ChunkStore`, `FloorStore`, `SceneStore`.
- Les codecs sont déterministes et rejettent les données mal formées.

## Tests

- `tests/php/Maps*/`
