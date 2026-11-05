# app/Domain/Support

Utilitaires partagés par les domaines.

## Fichiers clés

- `Dates.php` : DATETIME UTC et ISO 8601
- `Links.php` : URL absolues pour e-mails et liens générés
- `Validator.php` : validation d'un corps JSON, erreurs par champ
- `AppPaths.php` : emplacements sur disque

## Invariants

- Les dates en base sont en UTC.
- Le validateur collecte les erreurs ; il ne lève qu'à l'appel de l'appelant.

## Tests

- (couvert indirectement par les tests des domaines)
