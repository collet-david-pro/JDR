# app/Migrate

Exécuteur de migrations de schéma (fichiers SQL et PHP).

## Fichiers clés

- `Runner.php` : applique les migrations en attente sous verrou
- `MigrationFile.php` : fichier de migration, somme de contrôle
- `SqlSplitter.php` : découpe un fichier SQL
- `Lock.php` : verrou de base par schéma et préfixe

## Invariants

- Une migration appliquée ne doit plus changer : une somme de contrôle différente est une erreur.
- Une migration SQL rejouable porte `-- @idempotent-ddl`.
- Un seul exécuteur à la fois (verrou).

## Tests

- `tests/php/Migrate/`
