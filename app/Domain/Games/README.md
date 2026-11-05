# app/Domain/Games

Parties et leurs membres : MJ, co-MJ, joueurs, réglages, corbeille.

## Fichiers clés

- `GameService.php, GameRepository.php` : cycle de vie des parties
- `GamePolicy.php` : droits : voir, éditer, gérer
- `GameMemberRepository.php` : membres (`player` ou `co_gm`)
- `GameSettings.php` : réglages JSON validés clé par clé
- `GameHousekeeping.php` : purge de la corbeille (cron)
- `GameUserData.php` : export et suppression de compte

## Invariants

- Le MJ est `games.gm_user_id` et n'a pas de ligne dans `game_members`.
- Toute lecture se fait pour un spectateur : son rôle accompagne la partie.
- Les droits passent par `GamePolicy`, jamais par des tests de rôle dispersés.

## Tests

- `tests/php/Games/`
