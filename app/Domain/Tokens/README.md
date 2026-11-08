# app/Domain/Tokens

Définitions de jetons d'une partie (image, taille, attributs).

## Fichiers clés

- `TokenService.php` : lecture et écriture, droits
- `TokenRepository.php` : accès SQL, suppression logique
- `TokenInput.php` : validation, distances en cases
- `TokenPresenter.php` : représentation API

## Invariants

- Le MJ et les co-MJ voient tous les jetons, un joueur seulement ceux qui lui sont destinés.
- Suppression logique (`TokenRepository`) : les lectures ignorent les jetons supprimés.
- Image effective (`Token::assetUuid`) : le token choisi par le propriétaire par défaut (domaine `PlayerTokens`) l'emporte sur l'image du MJ, sauf `gm_image_forced` ; `gm_image` expose toujours l'image du MJ.

## Tests

- `tests/php/Games/TokensApiTest.php`
