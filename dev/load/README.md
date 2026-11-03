# Test de charge (P10e)

Simule N séances en parallèle, chacune avec 1 MJ, 5 joueurs et 1 écran appairé, contre une copie isolée
du site (`dev/e2e-serve.sh` : copie du livrable, base `jdr_load`, port 8092, **8 workers PHP** comme
`dev/serve.sh`). Node 20+ suffit (`fetch`, pas de dépendance).

## Lancer

Le front doit être construit (`cd frontend && npm run build`). Sur une machine partagée, prendre les verrous :

```bash
lockf /tmp/jdr-phpunit.lock lockf /tmp/jdr-build.lock \
  node dev/load/run.mjs --transport=sse --sessions=5          # 60 s par défaut
node dev/load/run.mjs --transport=poll --sessions=5 --duration=60
node dev/load/run.mjs --transport=longpoll --sessions=10
```

Options : `--transport=sse|longpoll|poll` (défaut `sse`), `--sessions=N` (défaut 5), `--duration=S`
(défaut 60), `--workers=N` (défaut 8), `--poll-ms=MS` (intervalle du polling court, défaut 2000).
Serveur, copie et base sont supprimés à la fin (aussi sur erreur ou Ctrl+C). Code de sortie 1 si une erreur
HTTP, réseau ou timeout est survenue.

## Scénario

- Préparation (hors mesure) : comptes `gmN`, `pN_k` (`dev/load/seed.php`), partie, 5 membres, carte 60x40,
  6 jetons placés, séance créée, joueurs rattachés à un jeton, séance démarrée, écran créé et appairé.
- Mesure : le MJ envoie toutes les 2 s un déplacement de jeton (et une révélation de brouillard une fois
  sur deux) ; chaque joueur déplace son jeton toutes les 3 s ; les 5 joueurs et l'écran écoutent le canal
  de la séance : flux SSE (`sse`), attente longue 15 s (`longpoll`) ou interrogation toutes les 2 s (`poll`).

## Lire les chiffres

- `POST actions` : latence p50/p95/p99 des requêtes d'écriture (hors flux). Objectif projet : p95 < 150 ms.
- `GET /events wait=0` (mode `poll`) : latence des interrogations courtes.
- `event propagation` : délai entre l'envoi d'un déplacement du MJ et sa réception chez un client
  (une valeur par client qui reçoit l'événement ; les déplacements fusionnés peuvent en faire disparaître).
- `errors` : réponses HTTP >= 400 (dont 429), erreurs réseau, timeouts (30 s). Objectif : 0 à 5 séances.
- `SQL` : requêtes par seconde (`SHOW GLOBAL STATUS LIKE 'Questions'` avant/après ; inclut les quelques
  requêtes du script lui-même, négligeables) et connexions MySQL (échantillon max de `Threads_connected` ;
  `Max_used_connections` est une marque globale du serveur depuis son démarrage, donc indicative).

Limite à garder en tête : un flux SSE ou une attente longue occupe un worker PHP pendant toute la requête.
Avec 8 workers, 5 séances en SSE (35 flux) saturent le serveur intégré ; ce comportement est la mesure.
