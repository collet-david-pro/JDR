# Sécurité : revue OWASP Top 10 (2021)

Revue faite pour la version 0.2 (lot P10d). Pour chaque catégorie : les protections en place (avec renvoi au code, `fichier:symbole`), les tests qui les vérifient, les écarts trouvés et corrigés, et les risques acceptés. Les chemins sont relatifs à la racine du site ; les tests sont dans `tests/php/`.

**Bilan de la revue** : 4 écarts corrigés, tous de gravité faible à moyenne. Aucune faille critique (injection, contournement d'authentification, exécution de code) n'a été trouvée.

| # | Écart | Gravité | Correction | Test |
|---|---|---|---|---|
| 1 | « Mot de passe oublié » avec SMTP : la réponse arrivait plus tard quand le compte existait (lien créé et e-mail envoyé avant de répondre), ce qui permettait de deviner si une adresse avait un compte. | Moyenne | Recherche du compte, création du lien et envoi passent **après** la réponse (`app/Core/AfterResponse.php`, `app/Domain/Auth/AuthService.php:forgot`, `app/Core/App.php:run` avec `fastcgi_finish_request()`, sinon réponse fermée avec `Content-Length` et `Connection: close`). | `Security/AccountEnumerationTest::testForgotPasswordDoesNothingBeforeTheResponse`, `Api/AdminApiTest::testSmtpTestAndForgotByEmail` |
| 2 | Connexion avec un identifiant inconnu : le « faux » contrôle de mot de passe calculait d'abord un hachage Argon2id (une deuxième opération coûteuse par requête), donc un identifiant inconnu répondait **plus lentement** qu'un identifiant connu. | Faible | Hachage factice précalculé au coût courant (`app/Domain/Auth/Passwords.php:dummyHash`) : une seule vérification dans les deux cas. | `Security/AccountEnumerationTest::testUnknownLoginCostsOneVerificationAtTheCurrentCost` |
| 3 | Journaux applicatifs (`storage/logs/app-AAAA-MM-JJ.log`) jamais supprimés, alors que la durée annoncée est de 14 jours (RGPD). | Faible | Tâche cron `logs` (`app/Core/Cron.php:tasks`, `app/Core/Logger.php:purge`, `Logger::RETENTION_DAYS = 14`). | `Security/LogRetentionTest`, `Domain/CronTasksTest` |
| 4 | Aucun test ne garantissait que chaque route de l'API soit protégée : une route ajoutée sans option `auth` serait passée inaperçue. | Faible (préventif) | Test de couverture de toutes les routes. | `Security/RouteCoverageTest` |

---

## A01 — Contrôle d'accès défaillant

**En place**
- Chaque route déclare son niveau dans `app/Http/routes/*.php` : `auth` (connecté), `role => 'admin'`, `display => 'only'` (écran de projection) ou rien (public). Le contrôle est fait par `app/Middleware/Auth.php:process` avant le contrôleur et avant le CSRF : anonyme ⇒ 401, non-admin sur une route admin ⇒ 403.
- Droits par objet (propriétaire, membre, MJ, co-MJ, joueur) dans les services : `app/Domain/Sessions/SessionAccess.php`, accès aux parties, cartes, assets. Un objet d'un autre utilisateur répond 404 (existence non révélée), un joueur membre reçoit 403 quand l'action est réservée au MJ.
- Contenu réservé au MJ (objets cachés, brouillard, notes MJ) filtré côté serveur avant envoi aux joueurs et aux écrans.
- CSRF : en-tête `X-CSRF-Token` comparé avec `hash_equals` (`app/Middleware/Csrf.php`) sur toute requête non-GET.

**Tests**
- `Security/RouteCoverageTest` : lit **toutes** les routes du routeur de l'application. Chacune doit figurer dans la liste du test avec son niveau (public, utilisateur, admin, écran, jeton) et la classe de test qui prouve ses droits par objet, ou une justification. Une route ajoutée sans être listée fait échouer le test, de même qu'une route listée qui n'existe plus. Vérifie pour chaque route : anonyme ⇒ 401 (hors liste blanche publique), utilisateur non-admin ⇒ 403 sur `/admin/**`, utilisateur sans cookie d'écran ⇒ 401 `display_unpaired` sur `/display/me`, options déclarées cohérentes avec le niveau.
- Matrices de droits : `Assets/RightsMatrixTest`, `Games/GameRightsMatrixTest`, `Sessions/SessionRightsMatrixTest`, `Displays/DisplayRightsMatrixTest`, plus `MapsP5/MapSceneRightsTest`, `MapsP9c/TemplatesRightsTest`, `MapsP4c/MapVersionsTest`, `MapsP4c/MapTransferTest`, `Games/MembersApiTest`, `Games/EncountersApiTest`.
- Fuites de contenu MJ : `Security/LeakTest`, `Security/LeakNotesTest`, `Sessions/SessionEventsAudienceTest`, `Sessions/FogStrictScopeTest`.

**Routes publiques (liste blanche du test)** : `/health`, `/version`, `/auth/me`, `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/password/forgot`, `/auth/password/reset`, `/invitations/{code}`, `/files/{uuid}` et `/map-thumbs/{id}` (URL signées), `/display/pair`.

**Routes à jeton**
| Route | Jeton | Comparaison | Durée de vie |
|---|---|---|---|
| `POST /admin/backup/restore/db/{id}/step` | 128 bits (`random_bytes`), donné à l'admin qui lance la restauration | `hash_equals` (`app/Domain/Backup/DbRestore.php:step`) ; absent ⇒ 422, faux ⇒ 404 | jusqu'à la fin de la restauration (état `running`) |
| `/files/{uuid}`, `/map-thumbs/{id}` | HMAC-SHA256 avec `app_secret` | `hash_equals` (`app/Core/Signer.php:verify`) | expiration signée dans l'URL (`Signer::verifyWithExpiry`) |
| Écran de projection (cookie `jdr_display`) | 256 bits, stocké haché | `hash_equals` (`app/Domain/Displays/DisplayDevice.php`) | 30 jours (`DisplayAuth::LIFETIME`), révocable par le MJ |
| Téléchargement de la sauvegarde d'avant mise à jour | dérivé du jeton CSRF de l'admin | `hash_equals` (`app/Domain/Update/PreUpdateBackup.php`) | session de l'admin ; fichier purgé par le cron |
| `cron.php?key=` | `cron_key` de `config.php` | `hash_equals` (`app/Core/Cron.php:run`) | permanent |

Test : `RouteCoverageTest::testTokenRoutesRefuseAMissingOrWrongToken`, `::testSecretsAreComparedInConstantTime` ; `Core/SignerTest`, `Assets/FilesApiTest`, `Backup/BackupApiTest`, `Update/PreUpdateBackupTest`.

**Risques acceptés**
- Confiance entre joueurs d'une même table : un joueur peut envoyer des actions permises à son rôle par le réseau sans passer par l'interface (`projet.md` §24 : « joueur qui triche via le réseau : hors périmètre »). Le serveur valide toujours le rôle et la cible ; il ne valide pas l'intention de jeu.
- Une restauration de base abandonnée garde son jeton valable tant qu'aucune autre restauration ne la remplace ; le jeton n'est connu que de l'admin qui l'a lancée.

## A02 — Défaillances cryptographiques

**En place**
- Mots de passe : Argon2id (paramètres par défaut de PHP), sinon bcrypt coût 12 (`app/Domain/Auth/Passwords.php:hash`) ; ré-hachage au besoin (`Passwords::needsRehash`) ; 10 à 256 caractères, 1000 mots de passe courants refusés.
- Jetons : `random_bytes` partout (session, CSRF 256 bits, « se souvenir de moi », réinitialisation 256 bits, restauration, écran). Codes courts (invitation, séance, appairage) : `random_int`.
- « Se souvenir de moi » : sélecteur + validateur, seul le SHA-256 du validateur est en base, rotation à chaque usage, vol détecté (`app/Domain/Auth/RememberMe.php`). Liens de réinitialisation : SHA-256 en base, usage unique, 1 h (`app/Domain/Auth/PasswordResets.php`).
- Cookies : toujours `HttpOnly`, `SameSite=Lax` (écran : `Strict`), `Secure` quand le site est en HTTPS (`cookie_secure`, déduit de `base_url` à l'installation) (`app/Core/Session/CookieJar.php`).
- URL signées : HMAC-SHA256 avec `app_secret` et expiration (`app/Core/Signer.php`).
- `app_secret` (64 caractères aléatoires, `config.php`) ; mot de passe SMTP chiffré en base avec sodium (`app/Domain/Settings/SecretBox.php`), jamais renvoyé par l'API.

**Tests** : `Core/SignerTest`, `Domain/SecretBoxTest`, `Api/NoPlaintextSecretsTest`, `Api/AuthApiTest::testRememberMeRotationAndTheftDetection`, `::testExpiredResetLink`, `Install/SecretsTest`.

**Risques acceptés** : sans HTTPS, les cookies circulent en clair ; l'installation et la page d'administration le signalent (voir « Pour l'hébergeur »).

## A03 — Injection

**En place**
- SQL : requêtes préparées partout (`app/Core/Db.php`). Les seules concaténations sont des noms de tables préfixés (`Db::t`), des listes de colonnes en dur, des entiers (`LIMIT`) ou des noms de tables lus en base. Recherche faite sur tout `app/`.
- Restauration de sauvegarde : le fichier SQL n'est jamais exécuté tel quel. Chaque ligne passe une liste blanche (`app/Domain/Backup/SqlDump.php:check`) : seulement `DROP TABLE IF EXISTS`, `CREATE TABLE` sans `SELECT`, `INSERT INTO ... VALUES` de littéraux, sur des tables au préfixe attendu, réécrit vers le préfixe du site.
- ZIP (import de packs, de cartes, sauvegarde d'assets, mise à jour) : lecteur maison `app/Zip/ZipReader.php:checkName` qui refuse chemins absolus, `..`, antislash, NUL, segments vides, doublons, UTF-8 invalide ; limites de taille et de nombre (`app/Zip/ZipLimits.php`).
- Notes en Markdown : rendu en nœuds DOM sans HTML brut (`frontend/src/components/MarkdownView.svelte`). Un seul `{@html}` dans le front : le QR code de l'appairage d'écran (`frontend/src/components/sessions/DisplayPairing.svelte`), un SVG généré localement à partir de nombres uniquement (`frontend/src/lib/displays/qr.ts`).
- En-têtes : les noms de fichiers dans `Content-Disposition` sont filtrés (`[A-Za-z0-9._-]`, `app/Domain/Assets/FileServer.php:fileName`).
- XSS : Svelte échappe tout texte ; CSP avec nonce (voir A05).

**Tests** : `Backup/SqlDumpTest`, `Backup/BackupRoundTripTest`, `Assets/ZipTest`.

## A04 — Conception non sécurisée

**En place**
- Limites de débit (`app/Core/RateLimiter.php:BUCKETS`, `app/Middleware/RateLimit.php`) : connexion (blocage temporaire au 6e échec, par identifiant et IP, durée croissante), inscription (5/h/IP), mot de passe oublié (3/h par adresse et IP), rejoindre une séance (10/min), appairage d'écran (10/min/IP), envois de fichiers (60/h), actions de jeu (30/s).
- Routes publiques sans limite justifiées : `/auth/password/reset` (jeton 256 bits), `/invitations/{code}` (20 caractères, environ 99 bits).
- Quotas de stockage par utilisateur, tailles maximales d'envoi, limites ZIP, plafonds de carte.

**Tests** : `Api/AuthApiTest::testSixFailedLoginsBlockTemporarily`, `::testRegisterIsRateLimitedPerIp`, `Domain/RateLimiterTest`, `Assets/UploadApiTest`.

## A05 — Mauvaise configuration de sécurité

**En place**
- En-têtes (`app/Core/SecurityHeaders.php:headers`) : CSP avec nonce par requête, sans `unsafe-eval` ni `unsafe-inline` pour les scripts, `frame-ancestors 'none'`, `object-src 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS si HTTPS. Appliqués à toute réponse de `index.php` (`app/Core/App.php:finalize`, y compris page 503 et fichiers servis), à `update.php` (`app/Domain/Update/UpdatePage.php`) et à `install.php`.
- `install.php` refuse de servir une fois le site installé (`app/Install/Guard.php:isInstalled`, `ownsInstallation`).
- Dossiers privés : `.htaccess` (« deny all ») et `index.php` de garde dans `app/`, `storage/`, `migrations/`, `i18n/` ; le routeur refuse aussi ces chemins (`app/Core/PathGuard.php`). Les fichiers PHP de `app/` commencent par `defined('JDR_BOOT') || exit;` (sauf le `index.php` de garde).
- Livrable (`dev/release.mjs`) : ni `dev/`, ni `tests/`, ni `frontend/`, ni `config.php`, ni `docs/`.
- Erreurs : `display_errors` désactivé (`app/Core/ErrorHandler.php`, `update.php`, `install.php`) ; message générique et identifiant de requête en production, détails seulement si `debug` dans `config.php`.

**Tests** : `Core/SecurityHeadersTest`, `Core/PathGuardTest`, `Install/GuardTest`, `Update/UpdatePageTest`.

**Risques acceptés** : `style-src 'unsafe-inline'` (styles calculés par Svelte et le canevas ; pas de risque d'exécution de script). La page d'erreur fatale d'urgence (`ErrorHandler::emergencyOutput`) est un texte fixe sans en-têtes CSP.

## A06 — Composants vulnérables et obsolètes

- PHP : **aucune dépendance tierce** (pas de Composer ; `dev/bin/phpunit.phar` sert seulement aux tests et n'est pas livré).
- Front : `npm audit --omit=dev` dans `frontend/` le 2026-11-03 : **0 vulnérabilité**. Les dépendances sont compilées dans `assets/` ; rien n'est chargé d'un CDN.

## A07 — Identification et authentification

**En place**
- Blocage temporaire après 6 échecs de connexion (`app/Domain/Auth/AuthService.php:login`), réponses d'échec identiques que l'identifiant existe ou non, coût identique (écart n° 2 corrigé).
- Régénération de l'identifiant de session à la connexion (`app/Domain/Auth/Authenticator.php:login`) et périodique ; empreinte de session liée au mot de passe : changer de mot de passe déconnecte partout.
- Suspension : le statut est relu à chaque requête, déconnexion immédiate.
- Mot de passe oublié : même réponse et même travail avant réponse que le compte existe ou non (écart n° 1 corrigé).

**Tests** : `Api/AuthApiTest` (`testSixFailedLoginsBlockTemporarily`, `testLoginLogoutAndIdenticalFailures`, `testSuspensionLogsOutImmediately`, `testSessionIdleTimeout`), `Security/AccountEnumerationTest`.

**Risques acceptés**
- À l'inscription, un nom d'utilisateur ou un e-mail déjà pris est signalé (inévitable pour choisir un nom) ; limité à 5 essais par heure et par IP.
- Un compte suspendu dont on donne le bon mot de passe reçoit « compte suspendu » (il faut connaître le mot de passe).
- Sans PHP-FPM (`fastcgi_finish_request` absent, ex. mod_php), la réponse au « mot de passe oublié » est envoyée complète et fermée avant l'envoi de l'e-mail ; un proxy qui la retient jusqu'à la fin du script peut laisser subsister un écart de temps.

## A08 — Intégrité des logiciels et des données

- `manifest.json` : SHA-256 de chaque fichier livré, vérifié par le diagnostic (`app/Domain/Admin/Diagnostic.php`) et l'outil d'intégrité.
- Releases signées Ed25519 (sodium) ; la mise à jour vérifie la signature et le SHA-256 du paquet (`app/Domain/Update/ReleaseSignature.php`, `UpdatePackage.php`, `AutoUpdater.php:acceptableAsset`). La mise à jour automatique ne télécharge que depuis `https://github.com/<dépôt officiel>/releases/download/`.
- Aucun `unserialize` ni `eval` dans le code ; les données externes sont en JSON.

**Tests** : `Update/ReleaseSignatureTest`, `Update/UpdatePackageTest`, `Update/AutoUpdaterTest`, `Update/UpdateCheckerTest`.

## A09 — Journalisation et surveillance

- Journal d'audit en base (`app/Domain/Audit/AuditLog.php`) pour les actions d'administration : utilisateurs, réglages, invitations, sauvegarde, restauration, intégrité, mise à jour ; consultable dans l'administration.
- Journaux applicatifs JSON par jour ; clés sensibles masquées (`app/Core/Logger.php:SECRET_PATTERN` : mot de passe, secret, jeton, cookie, CSRF, clé cron, codes) ; contexte d'exception sans arguments.
- Conservation : journaux 14 jours (écart n° 3 corrigé), événements 24 h, tentatives de connexion 30 jours, séances terminées 90 jours (tâches de `app/Core/Cron.php`).

**Tests** : `Core/LoggerTest`, `Security/LogRetentionTest`, `Domain/CronTasksTest`, `Api/AdminApiTest`.

**Risque accepté** : `cron.php?key=` met la clé dans l'URL (journaux du serveur web) ; l'en-tête `X-Cron-Key` ou la ligne de commande l'évitent.

## A10 — Falsification de requête côté serveur (SSRF)

Requêtes sortantes possibles, aucune vers une URL fournie par un utilisateur :
- vérification des versions : `https://api.github.com/repos/<dépôt>/releases` (`app/Domain/Update/UpdateChecker.php`) ;
- téléchargement d'une release : préfixe GitHub du dépôt imposé, HTTPS seulement, redirections HTTPS seulement (`NativeReleaseDownloader.php`) ;
- SMTP : hôte réglé par un admin (`app/Mail/SocketTransport.php`, certificat vérifié) ;
- sonde du diagnostic : `base_url` de `config.php` + chemins fixes (`app/Domain/Admin/HttpProbe.php`, `Diagnostic.php`) ;
- installation : sonde de l'adresse du site saisie par l'installateur, sans redirection (`app/Install/NativeHttpClient.php`), seulement tant que le site n'est pas installé.

## Point de dette examiné : `window.__jdrTest`

`frontend/src/lib/sessions/session-sync.ts:recordTestEvent` n'agit que si `localStorage['jdr.test'] === '1'`. Il copie dans `window.__jdrTest` des données que la page possède déjà en mémoire (identifiants d'événements, positions des pions, état des portes) : l'état d'un joueur est déjà filtré par le serveur, rien de réservé au MJ n'y entre. Il reste dans le build de production parce que les tests E2E tournent sur le livrable construit (`dev/e2e-serve.sh`). Inerte sinon.

---

## Pour l'hébergeur

- **HTTPS obligatoire** en pratique : sans lui, mots de passe et cookies circulent en clair. Mettez `base_url` en `https://` ; `cookie_secure` et HSTS suivent.
- **Droits des dossiers** : seul `storage/` doit être modifiable par PHP (plus `config.php` à l'installation et le site entier pendant une mise à jour). Pas de `777`.
- **`storage/` hors du web si possible** : réglez `storage_path` dans `config.php` vers un dossier hors de la racine web. Sinon, vérifiez que `https://votre-site/storage/` répond 403 (`.htaccess` actif, `AllowOverride` autorisé).
- **Extension sodium** requise (chiffrement du mot de passe SMTP, signature des mises à jour).
- PHP-FPM recommandé (`fastcgi_finish_request`) ; `expose_php = Off` et `display_errors = Off` dans la configuration PHP.
- Gardez `config.php` (et son `app_secret`) hors de toute copie publique : il signe les URL et chiffre les secrets.

## Mesures en place (vue d'ensemble)

Repris du README du dépôt.


- **Dossiers privés** : `app/`, `migrations/`, `storage/`, `i18n/` et `config.php` sont protégés par un `.htaccess`, un `index.php` qui renvoie 403 et une garde en tête de chaque fichier PHP privé. L'installeur vérifie par une vraie requête HTTP que ces dossiers sont inaccessibles. Sous Nginx, la protection est à ajouter ([nginx.md](nginx.md)).
- **CSRF et limitation de débit** : middlewares appliqués aux requêtes de l'API.
- **Images** : contrôle strict à l'import (type réel, dimensions, fichiers piégés refusés), ré-encodage, quotas.
- **Fichiers** : stockés hors base, servis par PHP avec des liens signés (HMAC).
- **Anti-fuite en séance** : le serveur filtre tout ce qu'il envoie aux joueurs et aux écrans (tokens cachés, objets du MJ, portes secrètes non révélées, code de séance). Un joueur ne peut révéler du brouillard que dans la vision de ses tokens.
- **Écrans de projection** : cookie `jdr_display` HttpOnly, SameSite=Strict, révocation immédiate.
- **Mise à jour** : contrôle des chemins, du manifeste et des empreintes de l'archive, releases signées (Ed25519), sauvegarde préalable.
- **Sauvegarde et restauration** : base et assets, depuis l'administration, sans copie gardée sur le serveur.
- **Intégrité** : vérification et correction des données depuis l'administration.
- **Journal d'audit** dans l'administration.
- **Installeur** verrouillé après usage.


## Signaler une vulnérabilité

N'écrivez pas les détails d'une faille dans une issue publique. Ouvrez une [issue](https://github.com/collet-david-pro/JDR/issues) **sans détail sensible** et demandez un contact privé.

