# app/Imaging : traitement des images

Détection du type réel, contrôle des dimensions et des animations, ré-encodage et miniatures. Aucune dépendance à autre chose que GD ou Imagick.

## Fichiers clés

- `ImagePipeline.php` : enchaîne les contrôles et le ré-encodage
- `Sniffer.php` : type par signature
- `PngParser / JpegParser / GifParser / WebpParser` : lecture des en-têtes sans décoder
- `TrapScanner.php, DimensionGuard.php` : refus des fichiers piégés ou trop grands
- `Reencoder.php, Thumbnailer.php` : sortie propre et miniature

## Invariants

- Un fichier n'est jamais conservé tel quel : il est ré-encodé.
- Un refus produit une `ImageRejected` avec un code stable.

## Tests

- `tests/php/Imaging/`
