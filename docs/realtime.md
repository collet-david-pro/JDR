# Temps réel des séances

Ce document décrit comment une séance de jeu (phase 6) tient tous les navigateurs à jour, sans WebSocket et sur un hébergement PHP mutualisé. Le code serveur est dans `app/Realtime/` et `app/Domain/Sessions/`, le client dans `frontend/src/lib/realtime/` et `frontend/src/lib/sessions/`.

## Modèle

- **Canaux** : `session:{id}` (tout ce qui concerne la séance : état, tokens, portes, textes à lire, présence) et `map:{id}` (opérations de l'éditeur, réservées au MJ). Une requête suit au plus 4 canaux.
- **Événements** : chaque événement a un `id` numérique croissant (séquence globale `event_seq`), un type, une charge utile JSON et une **audience** : `all`, `gm`, `players`, `displays` ou `user` (un seul utilisateur). Le serveur ne renvoie à un lecteur que les événements de son audience ; un joueur ne reçoit jamais un événement `gm`.
- **Ordre** : les ids sont comparés comme des entiers ; un client n'applique jamais un événement dont l'id est inférieur ou égal au dernier appliqué.
- **Purge** : une tâche cron supprime les événements de plus de 24 h (réglage `events_retention_hours`) et les événements éphémères (caméra du MJ) de plus de 2 min. Avant de supprimer, elle relève une marque `purged_upto`. Un client dont le `since` est sous la marque reçoit `410 events_gone` (ou `event: events_gone` en SSE) : il recharge alors l'instantané de la séance.

## Transports et bascule

Le client choisit seul, du plus réactif au plus compatible (constantes dans `lib/realtime/types.ts`) :

| Mode | Principe | Quand |
|---|---|---|
| `sse` | `GET /api/v1/stream`, flux `text/event-stream` de 25 s, ping toutes les 10 s | par défaut |
| `longpoll` | `GET /api/v1/events?wait=20`, réponse dès qu'un événement arrive | SSE muet plus de 5 s (`SSE_SILENCE_MS`, tampon d'un proxy), ou 3 coupures courtes (< 3 s) en 60 s |
| `poll` | `GET /api/v1/events?wait=0` toutes les 1 s (jeu), 3 s (lobby), 8 s (pause, onglet masqué) | 3 coupures de requêtes longues (`LONGPOLL_MAX_CUTS`) |

Après une bascule, le client retente le meilleur mode au bout de 5 min. Les reconnexions utilisent un recul exponentiel (0,5 s à 15 s, avec gigue).

## Un seul flux par navigateur

Tous les onglets d'un navigateur partagent un flux. L'onglet qui obtient le verrou Web Locks `jdr-sync` devient **leader** : il ouvre le flux et relaie les événements aux autres par `BroadcastChannel`. Chaque onglet annonce ses abonnements et son activité toutes les 30 s ; un onglet silencieux depuis 90 s (`TAB_EXPIRY_MS`) est oublié. À la fermeture, un message `bye` libère le verrou et un autre onglet prend le relais immédiatement. Sans Web Locks ni BroadcastChannel, chaque onglet ouvre son propre flux.

## Rattrapage et dédoublonnage

Chaque abonnement part du `last_event_id` de l'instantané (`since`). Après une coupure, la reconnexion reprend à `since` (en-tête `Last-Event-ID` pour SSE) : les événements manqués sont rejoués dans l'ordre. Deux garde-fous évitent les doublons : le client retient les ids déjà livrés, et le réducteur d'état ignore tout id inférieur ou égal au dernier appliqué.

## Présence

Chaque client de séance envoie `POST /api/v1/presence` toutes les 20 s ; le MJ voit qui est connecté dans le panneau « Joueurs ». Les mouvements de caméra du MJ (`camera.moved`) sont des événements éphémères.

## Brouillard strict et anti-fuite

Avec `fog_strict` (réglage de la partie, actif par défaut), un joueur ne reçoit que les blocs de brouillard explorés ou proches de ses tokens, et seulement les objets et tokens de cette zone. Dans tous les cas, le serveur filtre avant d'envoyer (instantané, préchargement, blocs, événements) : tokens cachés, objets réservés au MJ, portes secrètes non révélées (vues comme des murs), lumières suivant un token caché (liaison supprimée), code de séance. Un joueur ne peut révéler du brouillard (`fog.reveal`) que dans le disque de vision (portée + 1 case) de ses tokens ; le reste est rejeté (`rejected_bits`) et jamais enregistré.

## Diagnostic

- Page d'administration **Diagnostic** : test du flux SSE (vérifie qu'aucun tampon ne retient les données).
- **Indicateur réseau** de la vue joueur : état (connecté, reconnexion, hors ligne) et mode de transport en infobulle (`data-mode` : `sse`, `longpoll`, `poll`).
- Côté serveur, voir [nginx.md](nginx.md) pour vérifier le flux avec `curl -N`.

## Tests

`e2e/tests/sessions-criteria.spec.ts` couvre les 9 critères de la phase 6 ; `e2e/helpers/buffering-proxy.ts` simule un hébergeur qui met les réponses en tampon. Dans l'application, `window.__jdrTest` (ids reçus, positions, portes) n'existe que si `localStorage['jdr.test'] === '1'`.
