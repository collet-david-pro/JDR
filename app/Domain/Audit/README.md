# app/Domain/Audit

Journal d'audit des actions d'administration et des suppressions de compte.

## Fichiers clés

- `AuditLog.php` : écriture et lecture de la table `audit_log`

## Invariants

- Aucun secret n'est stocké : les données passent par `Logger::redact()`.

## Tests

- `tests/php/Api/AdminApiTest.php`
- `tests/php/Security/`
