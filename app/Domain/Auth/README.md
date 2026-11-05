# app/Domain/Auth

Inscription, connexion, déconnexion, mot de passe oublié, « se souvenir de moi » et utilisateur courant.

## Fichiers clés

- `AuthService.php` : parcours d'authentification
- `Authenticator.php` : résout l'utilisateur depuis la session, sinon le cookie persistant
- `Passwords.php` : Argon2id si disponible, sinon bcrypt coût 12
- `PasswordResets.php` : liens à usage unique, valables 1 h, signés HMAC
- `RememberMe.php, RememberTokenRepository.php` : cookie `sélecteur:validateur`, seul le hash du validateur est stocké
- `LoginAttempts.php` : journal des tentatives, conservé 30 jours
- `CurrentUser.php` : accès à l'utilisateur et à la session de la requête

## Invariants

- Le statut du compte est relu à chaque requête : un compte suspendu perd l'accès immédiatement.
- Les réponses ne permettent pas d'énumérer les comptes.
- Aucun mot de passe ni jeton en clair en base ni dans les journaux.

## Tests

- `tests/php/Api/AuthApiTest.php`
- `tests/php/Security/AccountEnumerationTest.php`
- `tests/php/Domain/SessionTest.php`
