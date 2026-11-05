# app/Domain/Update : mise à jour de l'application

Vérification, téléchargement, validation et application des mises à jour, depuis l'administration ou la page autonome `update.php`. Il n'existe pas de dossier `app/Update` : tout le module vit ici.

## Fichiers clés

- `UpdateChecker.php` : compare la version installée aux publications du dépôt
- `PackageInspector.php, PackageRules.php` : validation complète de l'archive avant toute écriture
- `ReleaseSignature.php, Manifest.php` : signature Ed25519 de SHA256SUMS et manifeste des fichiers
- `UpdateRunner.php, RunSteps.php, RunState.php` : machine à états reprenable, `state.json` par exécution
- `UpdateFiles.php, RecoverySteps.php` : copie des fichiers avec sauvegarde, retour arrière automatique
- `SqlBackup.php, PreUpdateBackup.php` : sauvegarde SQL avant mise à jour, proposée au téléchargement
- `AutoUpdater.php` : mise à jour automatique pilotée par le cron
- `UpdatePage.php, UpdateView.php, UpdateText.php` : page `update.php` sans JavaScript, textes autonomes

## Invariants

- Rien n'est écrit dans le code avant que l'archive soit entièrement validée (contenu autorisé, limites ZIP, sommes de contrôle).
- Le format de `state.json` (`RunState`) reste stable : la nouvelle version reprend un run commencé par l'ancienne.
- `update.php` doit fonctionner pendant un 503 : pas de dépendance à l'i18n ni à la SPA.
- La mise à jour est découpée en tranches de quelques secondes.

## Tests

- `tests/php/Update/`
