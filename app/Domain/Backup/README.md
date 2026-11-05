# app/Domain/Backup

Sauvegarde et restauration de la base (dump SQL) et des assets (archive ZIP), par tranches pilotées par le navigateur.

## Fichiers clés

- `DbBackupJob.php, DbRestore.php` : dump et restauration SQL
- `AssetsBackupJob.php, AssetsRestoreJob.php` : archive ZIP de `storage/assets`
- `SqlDump.php` : liste blanche des instructions acceptées à la restauration
- `GzipLines.php` : lecture reprenable d'un fichier gzip
- `BackupStorage.php, BackupUploads.php` : fichiers temporaires et envoi par morceaux

## Invariants

- Aucune sauvegarde n'est conservée sur le serveur : fichiers dans `storage/backup-tmp`, téléchargés puis supprimés.
- À la restauration, seules les instructions de la liste blanche sont exécutées, et seuls les chemins conformes à la disposition des assets sont écrits.
- Chaque tranche respecte une échéance de temps.

## Tests

- `tests/php/Backup/`
