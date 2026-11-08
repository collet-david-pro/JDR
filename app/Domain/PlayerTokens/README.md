# app/Domain/PlayerTokens

Tokens fabriqués par les joueurs (générateur côté front) : collection personnelle d'un compte et choix d'un token par partie.

## Fichiers clés

- `PlayerTokenService.php` : collection (100 au plus par compte), import du PNG rendu et du portrait source, choix par partie
- `PlayerTokenRepository.php` : tables `player_tokens` et `game_token_choices`
- `PlayerTokenPresenter.php` : représentation API (URL signées, réservée au propriétaire)
- `PlayerTokenUserData.php` : export et suppression de compte

## Invariants

- Le PNG (512 px, carré) et le portrait source sont des assets du compte (`source` = `player_token` / `player_token_src`) : réencodés par `AssetImporter`, quota compté, absents de la bibliothèque, supprimés quand plus aucun token de la collection ne les référence.
- Tout accès à la collection est limité à son propriétaire (404 sinon) ; choisir un token exige une partie visible (404 sinon) et un token de sa collection.
- Le choix est refusé pendant une séance en cours (`running`, `paused`), sauf le premier choix fait en rejoignant la partie.
- L'image effective d'une définition de token est résolue dans `TokenRepository::select()` : token du joueur (propriétaire par défaut) sauf si `tokens.gm_image_forced` ; aucun nouvel événement de séance, les clients lisent `image` comme avant.
- Le design (JSON borné) est opaque pour le serveur ; il sert à rééditer le token.

## Tests

- `tests/php/PlayerTokens/PlayerTokensTest.php`
