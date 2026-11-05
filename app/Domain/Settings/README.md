# app/Domain/Settings

Réglages du site et chiffrement des secrets.

## Fichiers clés

- `Settings.php` : accès typé à la table `settings`, valeurs par défaut
- `SettingsService.php` : vue admin et mise à jour validée
- `SecretBox.php` : chiffrement des secrets (libsodium si présent)

## Invariants

- Chaque clé connue a une valeur par défaut identique à celle de la migration d'amorçage.
- Le mot de passe SMTP est en écriture seule et stocké chiffré.

## Tests

- `tests/php/Domain/SettingsTest.php`
- `tests/php/Domain/SecretBoxTest.php`
- `tests/php/Api/NoPlaintextSecretsTest.php`
