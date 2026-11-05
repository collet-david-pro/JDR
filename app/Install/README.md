# app/Install : assistant d'installation

Logique de `install.php` : assistant en cinq étapes (prérequis, base de données, site et stockage, compte admin, installation), utilisable sans JavaScript. Autonome : il fonctionne avant que config.php, la base ou l'i18n existent.

## Fichiers clés

- `Installer.php` : contrôleur de l'assistant, une action par étape
- `Requirements.php, DbInspector.php` : prérequis serveur et vérifications de la base
- `Installation.php` : étape 5 : migrations et seed, une unité de travail par requête, reprenable
- `ConfigWriter.php, Secrets.php` : écriture atomique de config.php (0640) et secrets
- `StorageSetup.php` : arborescence `storage/` et protections
- `State.php` : état entre requêtes, blob chiffré AES-256-GCM dans une session dédiée
- `Guard.php` : détection « déjà installé » (config.php ou storage/install.lock)
- `Strings.php / strings.fr.php` : textes français propres à l'installeur

## Invariants

- Une instance installée ne peut pas être réinstallée : `Guard` bloque dès que config.php ou le verrou existe.
- L'installation est reprenable à tout moment et idempotente.
- Seul le hash du mot de passe admin transite par l'état ; jamais le mot de passe.
- Les textes ne dépendent pas de `i18n/fr.json`.

## Tests

- `tests/php/Install/`
