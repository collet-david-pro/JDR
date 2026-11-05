# app/Realtime : événements temps réel

Journal d'événements par canal (`session:{id}`, `map:{id}`) et ses trois transports : SSE (`/stream`), long polling (`/events`) et lecture courte. Les événements sont écrits dans la transaction du changement qu'ils décrivent.

## Fichiers clés

- `EventStore.php` : écrit les événements ; `record()` met en tampon, la validation de la transaction les publie
- `EventReader.php` : lit les événements au-delà d'un curseur (500 au plus), filtrés par audience
- `ChannelAuthorizer.php` : canaux lisibles par un utilisateur ou un écran, et son rôle sur chacun
- `Audience.php` : audiences (`gm`, `player`, ...) et rôles de lecteur
- `SseStream.php / LongPoll.php` : boucles de transport, avec `WaitSlots.php` pour plafonner les connexions en attente
- `ChannelSignal.php / ChannelWatch.php` : signal « nouveaux événements » pour ne pas interroger MySQL en boucle
- `EventPurger.php` : purge des anciens événements (cron)
- `LoopListener.php / LoopListeners.php` : crochets appelés à chaque tour de boucle (présence, écrans)

## Invariants

- Un lecteur ne reçoit que les événements de son audience : c'est la barrière anti-fuite, testée par `tests/php/Security/Leak*`.
- Un canal n'est lisible que via `ChannelAuthorizer` ; 4 canaux au plus par abonnement.
- Les curseurs sont des entiers croissants ; un curseur plus ancien que la purge donne 410 (`EventReader::gone()`).
- Une boucle d'attente libère le verrou de session et respecte un plafond de durée.

## Tests

- `tests/php/Realtime/`
- `tests/php/Security/ (Leak, LeakNotes)`
