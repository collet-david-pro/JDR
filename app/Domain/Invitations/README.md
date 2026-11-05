# app/Domain/Invitations

Codes d'invitation (mode d'inscription sur invitation).

## Fichiers clés

- `InvitationService.php` : création, validation, révocation
- `InvitationRepository.php` : accès SQL

## Invariants

- Seul le SHA-256 du code est stocké.
- Utilisations limitées, expiration et adresse e-mail optionnelles.

## Tests

- `tests/php/Api/AuthApiTest.php`
- `tests/php/Api/AdminApiTest.php`
