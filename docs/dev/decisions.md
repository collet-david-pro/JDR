# Décisions d'architecture

Les décisions qui structurent le code, avec leur raison. Format : **contexte**, **décision**, **conséquence**. Ne remettre une décision en cause qu'en le signalant explicitement. Vue d'ensemble : [architecture.md](architecture.md).

## Hébergement et back-end

### D1 — PHP sans framework ni Composer
- **Contexte** : cible principale = hébergement mutualisé, déploiement par FTP.
- **Décision** : PHP >= 8.1, autoloader PSR-4 maison (`app/autoload.php`), conteneur à autowiring maison, aucune dépendance Composer en production.
- **Conséquence** : tout se téléverse tel quel ; pas de `vendor/`. Aucune extension exotique ni démon. Toute nouvelle dépendance serveur est refusée.

### D2 — MySQL / MariaDB, portabilité d'abord
- **Contexte** : versions et réglages variables selon l'hébergeur.
- **Décision** : MySQL >= 5.7 / MariaDB >= 10.3, InnoDB, `utf8mb4`, préfixe de tables configurable (`jdr_`). `sql_mode` et fuseau horaire imposés à chaque connexion. Colonnes indexées en `VARCHAR(191)` (limite de clé de MySQL 5.7).
- **Conséquence** : pas d'`ENUM`, de colonne générée, de `CHECK`, de trigger, de procédure stockée ni de fonction JSON SQL ; les colonnes JSON sont opaques pour SQL (jamais dans un `WHERE`). Requêtes préparées uniquement ; noms dynamiques depuis une liste blanche.

### D14 — Le schéma n'existe que sous forme de migrations
- **Contexte** : une installation neuve et une mise à jour doivent aboutir au même schéma.
- **Décision** : `migrations/NNNN_description.sql|php`, même moteur pour l'installeur et la mise à jour, aucun `schema.sql` parallèle. Chaque migration appliquée est enregistrée avec son empreinte SHA-256 (`schema_migrations`).
- **Conséquence** : modifier une migration livrée bloque la mise à jour (empreinte différente). Les migrations sont rejouables (le DDL MySQL n'est pas transactionnel), appliquées une par requête, et suivent « étendre puis contracter » : jamais de suppression destructive dans la version qui introduit le remplaçant. Les gros contenus (maps) portent un `format_version` et sont migrés à la volée au chargement.

### D13 — Fichiers hors base, URL signées
- **Contexte** : base légère, contrôle d'accès, cache navigateur ; l'appartenance d'un asset à une partie ne s'indexe pas (palette en JSON).
- **Décision** : fichiers dans `storage/`, servis par PHP via des URL signées HMAC-SHA256 (clé `app_secret`), à échéance journalière ; table `map_asset_refs` pour les usages.
- **Conséquence** : pas de chemin direct vers `storage/` ; les URL sont stables un jour (cache `immutable`, Service Worker).

### D12 — E-mail optionnel
- **Contexte** : `mail()` est souvent bloqué en mutualisé.
- **Décision** : SMTP configurable, facultatif ; sans e-mail, l'administrateur réinitialise les mots de passe.
- **Conséquence** : aucune fonctionnalité ne doit exiger l'envoi d'un e-mail.

## Temps réel

### D6 — Journal d'événements MySQL, transport à détection automatique
- **Contexte** : pas de WebSocket ni de démon en mutualisé ; certains hébergeurs tamponnent la sortie (gzip, FastCGI, LiteSpeed).
- **Décision** : tout changement observable est un événement du journal `events`, écrit dans la même transaction que le changement. Transports SSE, puis long polling, puis polling court, choisis par le client (bascule si le flux reste muet, coupures répétées) ; le mode retenu est mémorisé.
- **Conséquence** : un événement ne peut pas exister sans son changement ni l'inverse. Un client resynchronise par instantané (`410 events_gone`) quand son `since` est trop ancien.

### D16 — Événements rattachés à un canal
- **Contexte** : la co-édition d'une map existe hors séance.
- **Décision** : canaux `session:{id}` et `map:{id}`, pas seulement une session.
- **Conséquence** : un client s'abonne à plusieurs canaux (au plus 4 par requête).

### Fichiers témoins pour éviter de sonder MySQL
- **Contexte** : un long polling qui interroge MySQL en boucle charge un mutualisé.
- **Décision** : à chaque événement, après validation, `storage/cache/ch/<sha1(canal)>` est réécrit (et APCu s'il existe) ; les boucles testent la date du fichier toutes les 250 ms et n'interrogent MySQL que s'il a changé, avec un contrôle de sécurité périodique.
- **Conséquence** : le signal est émis après `COMMIT`, jamais avant.

### Un seul flux par navigateur
- **Contexte** : HTTP/1.1 limite à 6 connexions par domaine ; un flux par onglet bloquerait le site.
- **Décision** : l'onglet qui obtient le verrou Web Locks `jdr-sync` ouvre le flux et relaie les événements aux autres par `BroadcastChannel`.
- **Conséquence** : sans ces API, repli sur un flux par onglet. Les routes longues libèrent le verrou de session PHP (`session_write_close()`), sinon elles bloqueraient les autres requêtes du même utilisateur.

### Authentification des écrans de projection
- **Contexte** : `EventSource` ne peut pas envoyer d'en-tête, et un jeton dans l'URL finirait dans les journaux.
- **Décision** : cookie dédié `HttpOnly` `jdr_display`, obtenu à l'appairage par code.
- **Conséquence** : les routes d'écran déclarent `display => 'only'` ; l'appairage est limité par IP.

## Confiance, confidentialité et sécurité

### D8 — Les contenus MJ ne quittent jamais le serveur vers un joueur ou un écran
- **Contexte** : joueurs qui se connaissent, donc pas d'anti-triche poussé ; mais le filtrage est le point de sécurité du jeu.
- **Décision** : chaque événement porte une audience (`all`, `gm`, `players`, `displays`, `user`). Quand un même changement est vu différemment, le serveur écrit plusieurs événements d'audiences différentes plutôt que de filtrer à la volée.
- **Conséquence** : tout nouveau type d'événement s'ajoute à `EventTypes::ALL` ; `tests/php/Security/LeakTest.php` rejoue une séance complète et échoue si un type n'est pas provoqué ou si un contenu caché atteint un joueur ou un écran.

### D9 — Brouillard strict
- **Contexte** : sinon un joueur « lirait » la map dans le réseau.
- **Décision** : réglage de partie `fog_strict`, activé par défaut : les blocs non explorés et hors de portée, et les événements sur une zone invisible, ne sont pas envoyés.
- **Conséquence** : le client charge le bloc quand la zone entre dans sa portée.

### D10 — Collision des tokens de joueurs côté serveur
- **Contexte** : sans elle, un joueur révèle le brouillard à travers un mur.
- **Décision** : les tokens des joueurs ne traversent ni murs ni portes fermées (`players_blocked_by_walls`, activé par défaut) ; le MJ n'est jamais bloqué. Colonnes `bbox_*` sur `map_objects` pour la requête spatiale.
- **Conséquence** : le déplacement est une action de séance validée par le serveur.

### Sécurité applicative
- **Décision** : mots de passe Argon2id (sinon bcrypt coût 12), réponses identiques pour compte inconnu et mot de passe faux ; jeton CSRF par session dans `X-CSRF-Token` pour toute méthode non-GET ; CSP stricte sans `unsafe-eval` (Pixi via son module sans eval) ; limitation de débit par action (table `rate_limits`) ; notes du MJ en texte brut avec un Markdown restreint rendu par un analyseur maison, jamais de `{@html}` avec du contenu utilisateur ; journaux sans secret.
- **Conséquence** : `tests/php/Security/RouteCoverageTest.php` impose à chaque route API un niveau d'accès et un test de droits par objet. Dossiers privés protégés trois fois (`.htaccess`, `index.php` en 403, garde `JDR_BOOT`) et testés par une vraie requête à l'installation.

### Mises à jour signées
- **Contexte** : la mise à jour automatique télécharge du code exécutable.
- **Décision** : chaque release publie `SHA256SUMS` et sa signature Ed25519 `SHA256SUMS.sig` ; la clé publique est dans le code (`ReleaseSignature`), la clé privée reste hors dépôt. Sauvegarde de la base et activation de la maintenance avant toute copie.
- **Conséquence** : une archive non signée est refusée par la mise à jour automatique.

## Concurrence et travaux de fond

### Sérialisation des écritures de map
- **Décision** : verrou par map (`SELECT … FOR UPDATE` sur la ligne `maps`), tuiles en « dernier écrivain gagne » par cellule, objets par révision.
- **Conséquence** : les opérations rejouées sont dédupliquées (`processed_ops`).

### Pas de cron garanti
- **Contexte** : beaucoup d'hébergeurs n'offrent pas de cron.
- **Décision** : pseudo-cron en fin de requête (2 % des requêtes, budget 2 s, sous verrou `GET_LOCK`), cron réel facultatif (`cron.php?key=…`). Tâches idempotentes. Travaux longs en tranches de quelques secondes (`background_jobs`), déclenchées par le navigateur de l'administrateur, reprenables.
- **Conséquence** : aucune tâche ne suppose une exécution à heure fixe.

## Front

### D3 — Svelte 5 (runes), TypeScript strict, Vite, sans SvelteKit
- **Contexte** : pas de rendu côté serveur possible avec ce back-end ; seul le résultat du build est téléversé.
- **Décision** : SPA ; en mode de routage `query`, le front bascule sur un routage par hash.
- **Conséquence** : le build est local (`assets/`, `sw.js`, `manifest.json`).

### D4 et D5 — PixiJS v8, calculs lourds dans des Web Workers
- **Décision** : rendu WebGPU avec repli WebGL2 ; vision, génération procédurale, export PNG et décodage d'animations dans des workers (`OffscreenCanvas`) pour ne jamais figer l'interface.
- **Conséquence** : aucun objet Pixi dans un état réactif (`$state` crée des proxys profonds). L'export PNG utilise un encodeur en flux, pas d'assemblage de tuiles.

### Budget du bundle
- **Décision** : 150 Ko gzip pour le graphe initial, 600 Ko pour l'éditeur (`dev/bundle-budget.mjs`, lancé par `npm run build`). Les pages lourdes sont chargées en différé.
- **Conséquence** : un build hors budget échoue.

### D11 — Interface en français, chaînes externalisées
- **Décision** : aucune chaîne d'interface en dur ; clés dans `i18n/fr.json` partagé entre PHP et front.
- **Conséquence** : `frontend/tests/i18n-keys.test.ts` échoue sur une clé littérale absente. L'anglais viendra plus tard sans toucher au code.

## Modèle de données

### D7 — Grille carrée d'abord
- **Décision** : grille carrée ; la grille hexagonale est prévue plus tard, le modèle porte déjà `grid_type`.

### D15 — Table `play_sessions`
- **Décision** : les séances de jeu s'appellent `play_sessions`, pas `sessions`, pour ne pas les confondre avec les sessions PHP.

### Contenu des maps versionné
- **Décision** : le document de map porte `format_version` ; l'ancien contenu est converti au chargement puis réenregistré, avec conversion par lots facultative depuis l'administration.
- **Conséquence** : pas de réécriture massive pendant une mise à jour.

### Admin et MJ sont deux notions distinctes
- **Décision** : l'administrateur est un rôle global du site ; le MJ est un rôle par partie. Les deux sont indépendants.
- **Conséquence** : les contrôles de droits distinguent toujours « admin du site » et « MJ de la partie ».

### Sauvegarde SQL en PHP
- **Décision** : export découpé en plusieurs requêtes, colonnes binaires en hexadécimal, rejouable par tranches.
- **Conséquence** : la restauration est un job découpé comme les autres.
