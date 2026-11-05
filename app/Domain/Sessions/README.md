# app/Domain/Sessions

Séances de jeu : codes, joueurs, présence, instantané, actions du MJ et des joueurs, diffusion d'événements filtrés (brouillard strict, notes, écran de table).

## Fichiers clés

- `SessionService.php, SessionPlayers.php` : cycle de vie, adhésion, assignations
- `SessionAccess.php, SessionContext.php` : droits et rôle de l'utilisateur dans la séance
- `SnapshotService.php, PreloadService.php` : état complet pour un client, URL à précharger
- `EventFanout.php, FanoutBatch.php, EventTypes.php` : écriture des événements de contenu, un par audience
- `PlayerView.php, PlayerSight.php, FogScope.php` : ce qu'un joueur voit
- `TableView.php, TableAudience.php` : vue de l'écran de projection
- `PresenceService.php` : présence des joueurs
- `Actions/` : actions de séance (déplacer, révéler, ...)

## Invariants

- Un joueur ne reçoit jamais la version MJ d'un objet : filtre, brouillard et notes s'appliquent avant l'écriture de l'événement.
- Les écritures sont idempotentes (`client_op_id`).
- Tout type d'événement émis est listé dans `EventTypes` ; le test anti-fuite s'appuie dessus.
- Une seule séance ouverte par partie.

## Tests

- `tests/php/Sessions/`
- `tests/php/SessionsActions/`
- `tests/php/Security/`
