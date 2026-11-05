# Recettes : comment ajouter...

Chaque recette donne les fichiers à toucher dans l'ordre, les tests, les pièges et un exemple réel du dépôt. Les noms de fichiers sont ceux du dépôt à la date de rédaction : en cas d'écart, chercher l'exemple cité (`grep -rn`). Règles générales : [AGENTS.md](../../AGENTS.md).

## Une route API

1. Service de domaine : ajouter la méthode dans `app/Domain/<Domaine>/` (droits par objet, validation des entrées, transaction si plusieurs écritures).
2. Contrôleur : méthode mince dans `app/Http/Controllers/` (`CurrentUser::require($request)`, appel du service, `Response::ok(...)`).
3. Route : `app/Http/routes/NN-domaine.php` (fichier chargé automatiquement, ordre alphabétique). Options : `auth`, `csrf` (actif par défaut hors GET), `rate`, `raw_body`, `maintenance_exempt`, `display`.
4. `tests/php/Security/RouteCoverageTest.php` : lister la route avec son niveau d'accès et le test qui prouve les droits par objet (ou une justification).
5. Test d'API du domaine (hériter de `ApiTestCase`) : cas nominal, 401 anonyme, 403 sans droit, 404, validation.
6. Côté front : appel dans `frontend/src/lib/<domaine>/` via `lib/api.ts` ; clés i18n des erreurs.

Pièges : un contenu MJ ne doit jamais sortir dans la réponse d'un joueur (passer par un présentateur, voir `Domain/Sessions/PlayerView`) ; oublier `RouteCoverageTest` fait échouer la suite ; la route ne doit pas attendre longtemps en gardant le verrou de session.
Exemple : `app/Http/routes/62-displays.php` + `app/Http/Controllers/DisplaysController.php`.

## Une migration

1. Prochain numéro libre : `migrations/NNNN_description.sql` (ou `.php` avec `up(Db $db, Logger $log): void` pour transformer des données). Préfixe de table : `{{prefix}}` en SQL.
2. La rendre **rejouable** : `CREATE TABLE IF NOT EXISTS`, `$db->columnExists()` / `indexExists()` / `foreignKeyExists()` avant un `ALTER`, ou `-- @idempotent-ddl` en SQL pur. Étendre puis contracter : pas de `DROP` ni de renommage destructif dans la version qui introduit le remplaçant. Pas d'`ENUM`, `CHECK`, colonne générée, trigger, fonction JSON SQL ; `VARCHAR(191)` pour une colonne indexée.
3. Relever `REQUIRED_DB_VERSION` dans `app/bootstrap.php`.
4. Gros volumes : traiter par lots (curseur sur l'`id`), reprenable.
5. Tests : `tests/php/Migrate/` (`MigrationFileTest`, `SchemaTest`, `RunnerTest`) ; ajouter un test dédié si la migration transforme des données.

Pièges : ne jamais modifier une migration déjà livrée (`PublishedMigrationsTest` et la mise à jour comparent les empreintes) ; MySQL ne tient pas le DDL dans une transaction.
Exemples : `migrations/0004_revoke_ended_displays.sql` (SQL rejouable), `migrations/0006_notes_audience.php` (PHP avec tests de colonnes).

## Un réglage d'administration

1. `app/Domain/Settings/Settings.php` : valeur par défaut dans `DEFAULTS`.
2. `app/Domain/Settings/SettingsService.php` : bornes dans `INTS` (ou liste `BOOLS`, ou validation dédiée comme `registration_mode`) ; l'écriture est journalisée dans l'audit.
3. Front : `frontend/src/lib/settings-form.ts` (`INT_KEYS`, `FLAG_KEYS`, `TEXT_KEYS`...) et le formulaire `frontend/src/pages/admin/AdminSettings.svelte`.
4. `i18n/fr.json` : libellé (et aide `admin.settings.hints.<clé>` si la clé est dans `INT_HINT_KEYS`).
5. Utiliser la valeur par `Settings::int()` / `bool()` / `string()`.
6. Tests : `tests/php/Api/AdminApiTest.php` (lecture, écriture, bornes) ; Vitest du formulaire s'il y a de la logique.
7. Aide administrateur : `frontend/src/help/admin/` si le réglage concerne l'exploitation.

Piège : un secret (mot de passe SMTP) passe par `SecretBox`, jamais en clair (`NoPlaintextSecretsTest`).
Exemple : `realtime_max_waiting`.

## Une tâche cron

1. Ajouter la méthode idempotente dans le service concerné (`purge...()` renvoie le nombre d'éléments traités).
2. L'enregistrer dans `Cron::tasks()` (`app/Core/Cron.php`) : clé stable => fermeture. `Cron::runTasks()` les enchaîne sous un budget de temps (2 s en pseudo-cron, 30 s en cron réel) : travailler par petits lots.
3. Test : `tests/php/Core/CronTest.php` ; test du service lui-même.

Pièges : elle peut être appelée à tout moment, deux fois de suite ou par deux processus (verrou `GET_LOCK`) ; ne rien supposer d'une heure fixe.
Exemple : `'events' => EventPurger::purge()`.

## Un job découpé (tranches)

Pour un travail plus long que quelques secondes (sauvegarde, import, conversion).
1. Classe `app/Domain/<Domaine>/<Nom>Job.php` implémentant `JDR\Domain\Jobs\JobHandler` : `step(Job $job, float $deadline)` travaille jusqu'à `$deadline` (`microtime(true)`), met à jour `done`, `state` et `result`, et passe le statut à `done` à la fin ; `cleanup(Job $job)` libère les fichiers après annulation ou échec.
2. L'enregistrer dans `JobRunner::HANDLERS` (type => classe).
3. Route de création et de suivi dans le contrôleur du domaine (le navigateur de l'administrateur rappelle l'étape jusqu'à la fin) ; barre de progression côté front.
4. Tests : un test qui enchaîne les tranches avec une horloge/échéance courte pour prouver la reprise (voir `tests/php/Backup/`).

Pièges : l'état doit tenir en base (une requête peut mourir à n'importe quel moment) ; toute exception marque le job en échec ; ne pas garder de verrou entre deux tranches.
Exemple : `app/Domain/Backup/DbBackupJob.php`.

## Une clé i18n

1. Ajouter la clé (chemin à points, objet imbriqué) dans `i18n/fr.json`, en gardant l'ordre et l'indentation du fichier ; texte français, paramètres `{nom}` selon le format de `frontend/src/lib/translator.ts`.
2. Front : `t('domaine.cle')` avec une chaîne **littérale** (le test lit les sources). Une clé construite dynamiquement doit être listée dans `frontend/tests/i18n-keys.test.ts`.
3. PHP : `I18n::t('cle', [...])`.
4. Test : `cd frontend && npx vitest run tests/i18n-keys.test.ts tests/i18n.test.ts`.

Pièges : une clé manquante s'affiche telle quelle et journalise un avertissement ; ne pas laisser de clé inutilisée ; pas de chaîne en dur dans un composant. Si un travail parallèle ne peut pas éditer `fr.json`, il peut écrire `i18n/_pending/<lot>.json` (accepté par le test, fusionné ensuite).
Exemple : `frontend/src/editor/ui/labels.ts`.

## Un outil de l'éditeur

1. `frontend/src/editor/tools/types.ts` : ajouter l'identifiant à `ToolId`.
2. `frontend/src/editor/tools/<nom>.ts` : `create<Nom>Tool(ctx: ToolContext): Tool` (gestes souris/tactile, opérations émises sur le document pour que l'historique annuler/refaire et la synchronisation les voient).
3. Le déclarer dans `createTools()` (`frontend/src/editor/tools/index.ts`, l'ordre est celui de la barre).
4. Barre d'outils : `frontend/src/components/editor/ToolBar.svelte` ; libellés `frontend/src/editor/ui/labels.ts` ; commandes et raccourci `frontend/src/editor/ui/editor-commands.ts` et `frontend/src/editor/shortcuts.ts` (la section « Raccourcis clavier » de l'aide les lit).
5. Si l'outil crée un objet : type d'objet et validation côté serveur (`app/Domain/Maps`), format du document (`format_version`) et rendu dans la scène (`frontend/src/scene`).
6. i18n, section d'aide (voir plus bas), tests Vitest de l'outil (`frontend/tests/`) et, si l'objet est visible des joueurs, test d'absence de fuite.

Pièges : jamais d'objet Pixi dans un `$state` ; toute écriture passe par une opération (sinon pas de co-édition ni d'annulation) ; les objets cachés ne partent pas aux joueurs.
Exemple : `frontend/src/editor/tools/door.ts`.

## Une action de séance

Action jouée par le MJ ou un joueur pendant une séance (`POST /sessions/{id}/actions`).
1. Validation : `app/Domain/Sessions/Actions/ActionInput.php` (champs autorisés par type d'action, valeurs normalisées).
2. Exécution : `Actions/ActionHandlers.php` (`apply()` aiguille par type) ; méthode dédiée qui modifie l'état et alimente le `FanoutBatch` : un événement par audience (`$f->gm(...)`, `$f->object(...)`, joueurs, écrans).
3. Type d'événement correspondant : voir la recette suivante.
4. Front : type de l'action dans `frontend/src/lib/sessions/types.ts`, envoi depuis le client de séance, application de l'événement dans `frontend/src/lib/sessions/reducer.ts`.
5. Tests : `tests/php/SessionsActions/` (nominal, droits, concurrence, collision) et `tests/php/Security/LeakTest.php`.

Pièges : la route est limitée à 30 requêtes par seconde et par utilisateur ; le serveur est l'autorité (collision, droits) ; le déplacement ou la révélation ne doit pas dévoiler d'information cachée dans la réponse.
Exemple : `door.toggle` (`ActionInput`, `ActionHandlers::door`, événement `door.toggled`).

## Un type d'événement temps réel

1. `app/Domain/Sessions/EventTypes.php` : constante et entrée dans `EventTypes::ALL`.
2. Écriture : via `EventFanout` / `FanoutBatch`, dans la même transaction que le changement, avec l'audience la plus étroite possible (plusieurs événements si le contenu diffère selon le public).
3. `tests/php/Security/LeakTest.php` : le scénario doit provoquer le type (sinon le test échoue) ; ajouter les assertions de non-fuite (objets cachés, notes MJ, zones hors portée avec `fog_strict`).
4. Front : nom dans `frontend/src/lib/realtime/event-types.ts` (le transport SSE écoute chaque nom), charge utile typée dans `frontend/src/lib/sessions/event-payloads.ts`, traitement dans `frontend/src/lib/sessions/reducer.ts`.
5. Tests : `tests/php/Sessions/SessionEventsAudienceTest.php`, `tests/php/Realtime/`, Vitest `frontend/tests/sessions/`.

Pièges : un type oublié dans `ALL` ou dans la liste du front est ignoré silencieusement côté client ; un événement hors transaction peut décrire un changement annulé ; le signal du canal part après `COMMIT`.
Exemple : `door.toggled`.

## Une section d'aide

1. Fichier `frontend/src/help/<public>/NN-nom.md` (`joueur`, `mj`, `irl`, `admin`). Le titre est la ligne `# …`, l'ancre est `<public>-<nom>` (`NN-` ne fixe que l'ordre). Français, courtes phrases, étapes numérotées.
2. Liens internes `[texte](#mj-creer-une-map)` ; capture `![texte alternatif](nom.webp)` avec le fichier dans `frontend/src/help/img/` (génération : voir [AGENTS.md](../../AGENTS.md)).
3. Lien « ? » depuis un écran : `<HelpLink anchor="mj-creer-une-map" />` (`frontend/src/components/HelpLink.svelte`).
4. Raccourci clavier : le déclarer dans `frontend/src/editor/shortcuts.ts`, il apparaît seul dans l'aide.
5. Test : `cd frontend && npx vitest run tests/help-catalog.test.ts` (ancres uniques, liens et images résolus, ancres des `HelpLink` existantes).

Pièges : renommer un fichier change l'ancre et casse les liens existants (y compris `HelpLink`) ; les ancres sont des identifiants stables.
Exemple : `frontend/src/help/mj/22-lancer-une-seance.md`.
