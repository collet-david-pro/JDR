# app/Domain/Users

Comptes utilisateurs : profil, préférences, appareils, export et suppression de compte.

## Fichiers clés

- `UserRepository.php, User.php` : table `users`
- `AccountService.php` : opérations de l'utilisateur sur son compte
- `AccountDeletion.php` : suppression : extensions des domaines d'abord
- `UserDataExtension.php, UserDataExtensions.php` : point d'extension d'export et de suppression
- `UserPrefs.php` : préférences, clés en liste blanche

## Invariants

- Un compte supprimé logiquement est invisible de tous les finders.
- Tout domaine qui possède des données personnelles s'inscrit comme `UserDataExtension`.

## Tests

- `tests/php/Api/MeApiTest.php`
