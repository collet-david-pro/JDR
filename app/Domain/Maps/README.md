# app/Domain/Maps

Cartes : étages, chunks de cellules, objets, jetons posés, brouillard, notes, liens entre cartes, modèles, versions et transferts.

## Fichiers clés

- `MapService.php, MapRepository.php` : CRUD des cartes, corbeille
- `MapOpsService.php, MapOpsInput.php` : `POST /maps/{id}/ops` : lots d'opérations idempotents avec révision de base
- `MapSceneService.php, MapSceneRepository.php` : objets, jetons posés et brouillard
- `MapNotes.php, MapNotesOps.php` : notes et audiences
- `MapFloors.php, MapLinks.php` : étages et liens (escaliers, portails)
- `MapTemplates.php, BuiltinTemplates.php` : modèles
- `Versions/, Transfer/` : versions et import / export
- `MapPolicy.php` : droits : MJ et co-MJ de la partie

## Invariants

- Une écriture porte un `client_op_id` : la rejouer renvoie le même résultat.
- Chaque lot est appliqué sous verrou, vérifie la révision de base et incrémente la révision.
- Les références d'assets (`map_asset_refs`) suivent exactement le contenu.
- La logique d'application des opérations vit dans `app/Maps/`.

## Tests

- `tests/php/Maps/`
- `tests/php/MapsP4c/`
- `tests/php/MapsP5/`
- `tests/php/MapsP9/`
- `tests/php/MapsP9b/`
- `tests/php/MapsP9c/`
