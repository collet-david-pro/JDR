# app/Domain/Assets

Bibliothèque d'assets : import (upload ou pack), validation et ré-encodage des images, miniatures, catégories, tags, favoris, quota, service des fichiers par URL signée.

## Fichiers clés

- `AssetService.php, AssetRepository.php` : opérations sur un asset, accès SQL
- `AssetImporter.php, ImageProcessor.php` : pipeline d'import partagé par upload et packs
- `AssetStorage.php` : arborescence `storage/assets/ab/cd/<uuid>`
- `AssetUrls.php, FileServer.php` : URL signées (uuid, type, expiration, HMAC) et service des fichiers
- `AssetPolicy.php` : droits : bibliothèque générale ou personnelle
- `StorageQuota.php` : `users.storage_used_bytes` tenu atomiquement
- `Packs/` : export et import de packs ZIP par tranches

## Invariants

- Un fichier n'est jamais servi sans signature valide ; la session n'intervient pas.
- La bibliothèque générale (propriétaire nul) n'est modifiable que par un admin et ne consomme aucun quota.
- Le type réel et les dimensions sont vérifiés, puis le fichier est ré-encodé ; le fichier d'origine n'est jamais servi.
- Les limites d'envoi effectives sont plafonnées par les limites PHP (`AssetLimits`).

## Tests

- `tests/php/Assets/`
- `tests/php/Imaging/`
