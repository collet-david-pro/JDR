# app/Domain/Admin

Administration du site : comptes (suspension, suppression, rôles), statistiques, diagnostic.

## Fichiers clés

- `UserAdminService.php` : actions sur les comptes, toutes inscrites au journal d'audit
- `Diagnostic.php` : vérifications de l'environnement (ok / warn / error)
- `AdminStats.php` : chiffres du tableau de bord
- `HttpProbe.php` : requête GET minimale pour sonder le site

## Invariants

- Toute action d'admin est écrite dans `AuditLog`.
- On ne peut pas retirer ses droits au dernier admin actif.

## Tests

- `tests/php/Api/AdminApiTest.php`
