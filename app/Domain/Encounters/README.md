# app/Domain/Encounters

Rencontres préparées : jetons d'un même jeu avec leurs décalages en cases (sans caractéristiques).

## Fichiers clés

- `EncounterService.php` : création, lecture, suppression
- `EncounterRepository.php` : accès SQL ; seuls les jetons vivants sont listés

## Invariants

- Réservé au MJ et aux co-MJ : un joueur reçoit 403, un non-membre 404.

## Tests

- `tests/php/Games/EncountersApiTest.php`
